import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteFrom402 } from "./payment-required.js";

function paymentRequiredHeader(body: unknown): string {
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

test("quoteFrom402 reads the first accept", () => {
  const header = paymentRequiredHeader({
    accepts: [
      {
        amount: "100000",
        asset: "0.0.0",
        network: "hedera:testnet",
        payTo: "0.0.1",
        extra: { feePayer: "0.0.2" },
      },
    ],
  });
  const response = new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": header } });
  assert.deepEqual(quoteFrom402(response), {
    amount: "100000",
    asset: "0.0.0",
    network: "hedera:testnet",
    payTo: "0.0.1",
    feePayer: "0.0.2",
  });
});

test("quoteFrom402 is null when the header is missing or junk", () => {
  assert.equal(quoteFrom402(new Response(null, { status: 402 })), null);
  const response = new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": "not-base64-json" } });
  assert.equal(quoteFrom402(response), null);
});
