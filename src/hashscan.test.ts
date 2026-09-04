import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeHashscanTxId, hashscanTopicUrl, hashscanTxUrl } from "./hashscan.js";
import { isHederaAccountId } from "./account-id.js";

test("HashScan encodes Hedera tx ids", () => {
  assert.equal(encodeHashscanTxId("0.0.7162784@1700000000.000000000"), "0.0.7162784-1700000000-000000000");
  assert.equal(
    hashscanTxUrl("testnet", "0.0.7162784@1700000000.000000000"),
    "https://hashscan.io/testnet/transaction/0.0.7162784-1700000000-000000000",
  );
});

test("HashScan topic url", () => {
  assert.equal(hashscanTopicUrl("testnet", "0.0.123"), "https://hashscan.io/testnet/topic/0.0.123");
});

test("account id shape", () => {
  assert.equal(isHederaAccountId("0.0.98"), true);
  assert.equal(isHederaAccountId("0.0.foo"), false);
  assert.equal(isHederaAccountId("98"), false);
});
