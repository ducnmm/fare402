/** Paying client: 402 → sign HBAR → retry → JSON.  npx tsx scripts/pay.ts GET /v1/accounts/0.0.98 */
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { loadClientConfig } from "../src/config.js";
import { hashscanTxUrl } from "../src/hashscan.js";
import { quoteFrom402 } from "../src/payment-required.js";
import { HBAR_ASSET } from "../src/price.js";

const cfg = loadClientConfig();
const signer = createClientHederaSigner(cfg.payerId, PrivateKey.fromStringECDSA(cfg.payerKey), {
  network: cfg.caipNetwork,
});
const x402 = new x402Client().register("hedera:*", new ExactHederaScheme(signer));
x402.setSpendControls({
  allowedAssets: [{ network: "hedera:*", asset: HBAR_ASSET, maxAmountPerPayment: "1000000" }],
});

const peek: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status === 402) {
    const q = quoteFrom402(res);
    console.log(`HTTP 402  quote ${q?.amount ?? "?"} tinybars  (${Number(q?.amount ?? 0) / 1e8} HBAR)`);
  }
  return res;
};
const pay = wrapFetchWithPayment(peek, x402);

const method = process.argv[2] ?? "GET";
const path = process.argv[3] ?? "/v1/ping";
const body = process.argv[4];
const res = await pay(`${cfg.baseUrl}${path}`, {
  method,
  headers: body ? { "content-type": "application/json" } : undefined,
  body,
});
try {
  const settled = new x402HTTPClient(x402).getPaymentSettleResponse((name) => res.headers.get(name));
  if (settled?.transaction) console.log(`paid  ${hashscanTxUrl(cfg.network, settled.transaction)}`);
} catch {
  /* unpaid or no PAYMENT-RESPONSE */
}
console.log(`HTTP ${res.status}`);
console.log(await res.text());
