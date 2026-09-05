# Demo script

~2–3 minutes. Your voice, laptop screen, no music, no slides. Terminal font large.

Open beforehand:

- terminal in `/Users/ducnmm/Documents/ducnmm/fare`
- https://fare-production.up.railway.app/health
- https://hashscan.io/testnet/account/0.0.10119186
- https://hashscan.io/testnet/topic/0.0.10320508

Against **live** (not localhost):

```bash
export FARE_BASE_URL=https://fare-production.up.railway.app
```

Warm up once off-camera: `npm run try` then one `npx tsx scripts/pay-once.ts ping`.

The client prints four blocks: **YOU ASKED → MERCHANT QUOTED → YOU PAID → YOU GOT**. Zoom those.

---

### 0:00–0:15 — one sentence

> Fare sells two tickets. Hedera lookups, and a Node job on AWS Lambda. You pay HBAR per request. More data or a longer job costs more.

### 0:15–0:40 — unpaid 402

```bash
curl -si https://fare-production.up.railway.app/v1/ping
```

> No payment, so 402. One unit is 100000 tinybars — 0.001 HBAR. No JSON body yet.

Scroll `HTTP/2 402` and `PAYMENT-REQUIRED`.

### 0:40–1:20 — pay lookup

```bash
npx tsx scripts/pay-once.ts account 0.0.98
```

Point at:

1. YOU ASKED — account `0.0.98`
2. QUOTED — `100000` tinybars
3. PAID — HashScan link
4. YOU GOT — `balance … HBAR`

> Client pays 0.001 HBAR and gets the live balance from the Mirror Node.

Click the HashScan URL. Confirm CRYPTOTRANSFER SUCCESS, 100000 tinybars, payer → merchant.

### 1:20–2:00 — more data, higher fare

Wait for the JSON (~20–40s). Do not Ctrl+C.

```bash
npx tsx scripts/pay-once.ts txs 0.0.98 25
```

> Same account, limit 25. Four units, 400000 tinybars — four times a ping.

YOU GOT should list 25 transactions. Open the second HashScan.

### 2:00–2:40 — job ticket

```bash
npx tsx scripts/pay-once.ts job 10 'console.log(1+1)'
```

> Second product: pay 0.002 HBAR, Lambda runs the script, stdout is 2.

Point at `body` in YOU ASKED, then YOU GOT `provider aws-lambda` and `stdout 2`. Open the job HashScan.

### 2:40–3:00 — HCS, stop

https://hashscan.io/testnet/topic/0.0.10320508

> Each settle also writes amountTinybars onto this HCS topic. That's it.

---

If short on time: skip ping, keep **account + limit=25 + job**.  
If still long: skip HCS.

Do not explain architecture. Do not mention other products.
