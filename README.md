# Fare

Pay-per-query tickets on Hedera. Agents pay **HBAR** via **x402** / [Blocky402](https://blocky402.com/). Price scales with the ask.

Merchant on Railway; jobs on AWS Lambda.

| Service | Buy | Route | Price |
| --- | --- | --- | --- |
| **Lookups** | Account / txs JSON (Mirror Node) | `GET /v1/accounts/{id}` · `…/transactions?limit=` | 1 unit · `1 + ceil(limit/10)` |
| **Jobs** | One Node run (`stdout`) | `POST /v1/jobs` `{script, timeoutSeconds?}` | `1 + ceil(timeout/10)` |

1 unit = 0.001 HBAR = `100000` tinybars. `limit=25` → 4 units. Job timeout 10s → 2 units.

## Live

https://fare-production.up.railway.app · `GET /health`

| Call | tinybars | HashScan |
| --- | --- | --- |
| ping | 100000 | [tx](https://hashscan.io/testnet/transaction/0.0.7162784-1788535275-825788964) |
| account `0.0.98` | 100000 | [tx](https://hashscan.io/testnet/transaction/0.0.7162784-1788527411-784211089) |
| txs `limit=25` | 400000 | [tx](https://hashscan.io/testnet/transaction/0.0.7162784-1788527413-392360407) |
| job Lambda | 200000 | [tx](https://hashscan.io/testnet/transaction/0.0.7162784-1788572341-958451191) |

HCS: [`0.0.10320508`](https://hashscan.io/testnet/topic/0.0.10320508)

```bash
npm start                          # merchant :4021
npm run try                        # unpaid 402 vs live (no wallet)
npm run pay:live                   # paid ping
npm run pay:job                    # paid Lambda job
npx tsx scripts/pay-once.ts account 0.0.98
npx tsx scripts/pay-once.ts txs 0.0.98 25
npx tsx scripts/pay-once.ts job 10 'console.log(1+1)'
```

Unpaid `GET /v1/ping` → **402**. `curl -I` is 405 (GET/POST only).

## Pay

1. Hit a paid route → **402** + Hedera `exact` quote (`asset: 0.0.0`, tinybars).
2. Client signs a transfer to `HEDERA_OPERATOR_ID`. Blocky402 is the fee payer.
3. Retry with `PAYMENT-SIGNATURE` → settle on testnet → JSON.
4. Lookups = Mirror Node. Jobs = Lambda `{status, stdout, stderr, exitCode}`.
5. Optional HCS line `{account, amountTinybars, txId}` after settle.

We do not run a facilitator. No UI — CLI + HashScan.

## Setup

Node ≥ 20. Two ECDSA testnet accounts (portal + faucet): merchant + payer.

```bash
cp .env.example .env   # HEDERA_OPERATOR_* / HEDERA_PAYER_*  (0x… ECDSA, not ED25519)
npm i && npm start
```

Jobs: set `AWS_SANDBOX_LAMBDA_ARN` + AWS keys, or `FARE_JOB_LOCAL=1` (dev only). Unset → `503`, never 402.

HCS: `npm run hcs:topic` → put `HCS_TOPIC_ID` in `.env`. Failed HCS does not roll back payment.

`npm test` · `npm run typecheck`

```
src/server.ts   402 + routes
src/price.ts    units → tinybars
src/mirror.ts   lookups
src/job.ts      Lambda / local
src/hcs.ts      optional audit
scripts/pay-once.ts
```

AI-assisted: `src/*`, `scripts/*`, `README.md`, `package.json`, `tsconfig.json`, `.env.example`.
