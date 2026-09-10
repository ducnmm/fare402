# Demo script

~2–3 minutes. Your voice, no music. Split screen: **slide (what to say) + live terminal**.

```bash
npm run demo:deck
```

Opens `http://127.0.0.1:4040`. Fullscreen (`F`). **Enter** (or Run) starts the terminal. **Space** is next slide only — it never runs a command. `←` `→` skip. `R` reruns.

Warm up is the first slide — off camera. Then start recording on **Two tickets**.

Hits live Railway (`FARE_BASE_URL` is set by the deck). HashScan URLs in the terminal become links under it.

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
