# Fare

Two x402 tickets on Hedera. Agents pay **HBAR** through **Blocky402**; the fare scales with how much they ask for.

| Service | What you buy | Route |
| --- | --- | --- |
| **Lookups** | Hedera account + recent txs (Mirror Node JSON) | `GET /v1/accounts/…` |
| **Jobs** | One Node.js run on AWS Lambda (`stdout` / `stderr` / `exitCode`) | `POST /v1/jobs` |

Built for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026/prizes/hedera) — Hedera × [Blocky402](https://blocky402.com/) (From Scratch). The merchant is hosted on Railway; jobs execute on AWS Lambda.

> Fare = vé từng chuyến. A cheap account lookup is a cheap ticket. A longer job (or a wider tx scan) is a more expensive ticket.

## Live

Merchant: https://fare-production.up.railway.app

Settlements below are from ETHOnline day 1 (2026-09-04), Hedera testnet.

| Call | Fare | Settlement |
| --- | --- | --- |
| `GET /v1/ping` (live) | **1 unit** / `100000` tinybars | [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784-1788535275-825788964) |
| `GET /v1/accounts/0.0.98` | **1 unit** / `100000` tinybars | [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784-1788527411-784211089) |
| `GET /v1/accounts/0.0.98/transactions?limit=25` | **4 units** / `400000` tinybars | [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784-1788527413-392360407) |
| `POST /v1/jobs` (AWS Lambda) | **2 units** / `200000` tinybars | [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784-1788572341-958451191) |

HCS topic: `0.0.10320508` — https://hashscan.io/testnet/topic/0.0.10320508

```bash
npm start          # merchant
npm run try        # unpaid smoke vs live Railway (no wallet)
npm run pay        # one paid ping (local .env FARE_BASE_URL)
npm run pay:live   # one paid ping against Railway
npm run pay:demo   # unpaid 402 quotes, then cheap + expensive pays (budgeted)
npm run pay:job    # paid AWS Lambda job on Railway (console.log fare-job)
npx tsx scripts/pay-once.ts job 10 'console.log(1+1)'
npm run hcs:topic  # create an HCS audit topic; prints HCS_TOPIC_ID=…
```

### Video (6 beats)

1. **One-liner.** Fare sells two tickets: Hedera lookups and an AWS Lambda job. Price scales with the ask.
2. **Unpaid 402.** `GET /v1/accounts/0.0.98` returns 402 with `100000` tinybars.
3. **Pay + JSON.** The client pays; the body is a mirror-node account summary.
4. **Cheap HashScan.** Settlement for 1 unit / `100000` tinybars.
5. **`limit=25` vs job.** Wider scan (`400000` tinybars) or `POST /v1/jobs` (`200000`, stdout `2`).
6. **HCS topic.** Audit lines with `amountTinybars` on the topic. Stop.

## What you get

A live HTTP API with **two paid products**:

1. **Lookups** — `GET /v1/accounts/{id}` (and `/transactions`). JSON from the public [Hedera Mirror Node](https://docs.hedera.com/hedera/sdks-and-apis/rest-api).
2. **Jobs** — `POST /v1/jobs` with `{ script, timeoutSeconds }`. One Node run on AWS Lambda; body is `{ status, stdout, stderr, exitCode, provider: "aws-lambda" }`.

Shared payment path:

1. Agent hits a paid route with no payment header
2. Server returns **402** + a Hedera `exact` quote (tinybars, `asset: 0.0.0`)
3. Client pays through **Blocky402** (we do **not** run a facilitator)
4. Retry with payment proof → product JSON
5. Settlement tx is visible on [HashScan](https://hashscan.io)

This repo is the **merchant** (resource server) plus a **tiny paying client**. `GET /v1/ping` is a 1-unit dummy to prove the 402 loop.

## Endpoints

| Path | Auth | Price (testnet) |
| --- | --- | --- |
| `GET /health` | free | — |
| `GET /v1/ping` | x402 | **1 unit** = 0.001 HBAR (`100000` tinybars) |
| `GET /v1/accounts/{accountId}` | x402 | **1 unit** — balance, key, memo |
| `GET /v1/accounts/{accountId}/transactions?limit=` | x402 | **`1 + ceil(limit/10)` units**. Default `limit=10` (2 units). `limit=25` → 4 units. Cap 100. |
| `POST /v1/jobs` | x402 | **`1 + ceil(timeoutSeconds/10)` units**. Body `{ script, timeoutSeconds? }`. Default timeout 10s (2 units). Cap 60s. AWS Lambda when `AWS_SANDBOX_LAMBDA_ARN` is set; `FARE_JOB_LOCAL=1` runs on the merchant. |

**Lookups** read `https://testnet.mirrornode.hedera.com` (`MIRROR_NODE_URL`). No indexer of our own.

**Jobs** invoke Lambda `AWS_SANDBOX_LAMBDA_ARN` (`runtime: node22`). Unconfigured merchants return **503** `jobs_not_configured` and never 402. `FARE_JOB_LOCAL=1` is dev-only (child process on the merchant — do not set on a public host).

## Architecture

```
paying client (scripts/pay-once.ts)
    │  GET /v1/accounts/…   or   POST /v1/jobs
    │  402 + PAYMENT-REQUIRED (Hedera exact, HBAR)
    │  sign TransferTransaction (payer)
    │  retry with PAYMENT-SIGNATURE
    ▼
Fare resource server (src/server.ts)
    │  @x402/express + ExactHederaScheme
    │  verify/settle via Blocky402
    │  onAfterSettle → optional HCS audit line
    ├─ lookups → Hedera Mirror Node REST
    └─ jobs    → AWS Lambda (fare-job-runner)
                   HashScan
```

Metering lives in `src/price.ts`. Lookups meter on `limit`; jobs meter on `timeoutSeconds`. Not a flat per-request charge.

## Payment flow

1. **Request.** Client hits a paid route with no payment header.
2. **402.** Middleware asks Blocky402 `GET /supported`, fills `extra.feePayer`, returns `PAYMENT-REQUIRED`. Amount is tinybars. Asset is `0.0.0` (HBAR).
3. **Sign.** `@x402/hedera` builds a `TransferTransaction` from the payer to `HEDERA_OPERATOR_ID`. The facilitator is the fee payer; the client only signs as the HBAR sender.
4. **Retry.** `@x402/fetch` sends the same request with `PAYMENT-SIGNATURE`.
5. **Verify + settle.** Resource server forwards the payload to Blocky402. Blocky402 co-signs, submits to Hedera, returns a transaction id (`0.0.<feePayer>@<seconds>.<nanos>`).
6. **Body.** After settlement, lookups return Mirror Node JSON; jobs return Lambda `{status, stdout, stderr, exitCode}`. The `PAYMENT-RESPONSE` header carries the settle tx. Optional: `src/hcs.ts` appends `{account, amountTinybars, txId}` to an HCS topic.

We do **not** fork x402 or Blocky402. We do **not** copy the Hedera inference PoC — that repo is flow reference only.

## Setup

Need **two ECDSA** Hedera testnet accounts (portal: https://portal.hedera.com), both funded with test HBAR (https://faucet.hedera.com):

- **Merchant** (`HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY`) — receives funds. Operator key is only required if you enable HCS.
- **Payer** (`HEDERA_PAYER_ID` / `HEDERA_PAYER_KEY`) — demo client.

```bash
cp .env.example .env
# fill merchant + payer ids/keys
```

Keys must be ECDSA (`0x…` from the portal). ED25519 accounts will not sign x402 Hedera payloads.

Node **≥ 20**.

```bash
npm install
```

## Run the merchant

```bash
npm start
# Fare merchant on http://0.0.0.0:4021
```

Health (free):

```bash
curl -s http://localhost:4021/health
```

## See a 402 (no wallet)

```bash
curl -si http://localhost:4021/v1/ping
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: <base64>

curl -si 'http://localhost:4021/v1/accounts/0.0.98/transactions?limit=25' \
  | grep -i payment

curl -si http://localhost:4021/v1/jobs \
  -H 'content-type: application/json' \
  -d '{"script":"console.log(1+1)","timeoutSeconds":10}'
# 402, amount 200000 tinybars
```

Decode the quote (`curl -I` is 405 — x402 is GET/POST only, not HEAD):

```bash
curl -sD - -o /dev/null http://localhost:4021/v1/ping \
  | awk 'tolower($1)=="payment-required:"{print $2}' \
  | tr -d '\r' \
  | base64 -d \
  | python3 -m json.tool
```

You should see `"amount": "100000"`, `"asset": "0.0.0"`, `"network": "hedera:testnet"`.

A `limit=25` quote should be **4×** a ping (`400000` tinybars).

## Run the paying client

One paid ping:

```bash
npm run pay
# or: npx tsx scripts/pay-once.ts ping
```

Metered demo — unpaid 402 quotes (expect `100000` vs `400000` tinybars), then pay each route if it fits `FARE_BUDGET_TINYBARS` (default `1000000` = 0.01 HBAR):

```bash
npm run pay:demo
# or: npx tsx scripts/pay-once.ts demo 0.0.98
```

Other calls:

```bash
npx tsx scripts/pay-once.ts account 0.0.98
npx tsx scripts/pay-once.ts txs 0.0.98 10
npx tsx scripts/pay-once.ts txs 0.0.98 25
npx tsx scripts/pay-once.ts job 10 'console.log(1+1)'
```

The script logs the 402 amount, the settle tx id, and a HashScan link.

x402 client spend controls default to Hedera USDC; Fare allowlists native HBAR (`asset: 0.0.0`). Per-payment cap is `FARE_BUDGET_TINYBARS` as an integer tinybar string (not `$`).

## Optional HCS audit trail

After each successful settle, Fare can append `{account, amountTinybars, txId}` to a Consensus Service topic. Amounts are tinybars so HashScan is not read as HBAR.

```bash
npm run hcs:topic
# prints HCS_TOPIC_ID=0.0.x and a HashScan topic URL
```

Put that id in `.env` as `HCS_TOPIC_ID` (the script does not write `.env`) and restart the merchant. Operator key is required. Failed HCS writes are logged and **do not** roll back the payment.

## Deploy (Railway)

Set the same env vars (do **not** commit `.env`), including AWS keys for jobs. `PORT` is provided by the host. Start command is `npm start`. Health check: `GET /health` (`jobs` should be `"aws-lambda"`).

Point `FARE_BASE_URL` at the public HTTPS origin when you run the client against prod.

## Tests (offline)

```bash
npm test
npm run typecheck
```

Pricing math does not hit the network. Live 402/Blocky402 is verified with `curl` + `npm run pay`.

## Layout

```
src/server.ts         402 gate + mirror proxy + paid jobs
src/price.ts          units → tinybars
src/mirror.ts         Hedera Mirror Node REST
src/job.ts            AWS Lambda / local Node runner
src/hcs.ts            optional payment audit trail
scripts/pay-once.ts   wrapFetchWithPayment + ExactHederaScheme
scripts/create-topic.ts  create an HCS audit topic
```

## AI-assisted files

Cursor / Claude / Codex / Grok were allowed for this hackathon. Files that were AI-assisted:

- `src/server.ts`, `src/price.ts`, `src/mirror.ts`, `src/job.ts`, `src/hcs.ts`, `src/config.ts`, `src/hashscan.ts`, `src/account-id.ts`
- `scripts/pay-once.ts`, `scripts/create-topic.ts`, `scripts/try.ts`
- `README.md`, `package.json`, `tsconfig.json`, `.env.example`

## Out of scope

- Building or forking a facilitator
- dugong / World AgentKit / Continuity / ATS / Harness
- OpenAI-behind-Lambda inference clone
- A2A, ERC-8004, UCP directory, streamed micropayments
- A UI — CLI + HashScan is the demo
