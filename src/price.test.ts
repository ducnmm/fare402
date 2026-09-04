import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampLimit,
  DEFAULT_LIMIT,
  hbarPrice,
  isLimitQueryValid,
  parseLimit,
  tinybarsForUnits,
  UNIT_TINYBARS,
  unitsForAccountSummary,
  unitsForTransactions,
} from "./price.js";

test("one unit is 0.001 HBAR in tinybars", () => {
  assert.equal(UNIT_TINYBARS, 100_000);
  assert.equal(tinybarsForUnits(1), 100_000);
  assert.deepEqual(hbarPrice(1), { asset: "0.0.0", amount: "100000" });
});

test("account summary is 1 unit", () => {
  assert.equal(unitsForAccountSummary(), 1);
});

test("transaction list meters 1 + ceil(limit/10)", () => {
  assert.equal(unitsForTransactions(1), 2);
  assert.equal(unitsForTransactions(10), 2);
  assert.equal(unitsForTransactions(11), 3);
  assert.equal(unitsForTransactions(25), 4);
  assert.equal(unitsForTransactions(100), 11);
  assert.equal(tinybarsForUnits(unitsForTransactions(25)), 400_000);
});

test("limit is clamped to 1..100", () => {
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(999), 100);
  assert.equal(parseLimit(undefined), DEFAULT_LIMIT);
  assert.equal(parseLimit("25"), 25);
  assert.equal(parseLimit(["25"]), 25);
  assert.equal(parseLimit("nope"), DEFAULT_LIMIT);
});

test("limit query validation", () => {
  assert.equal(isLimitQueryValid(undefined), true);
  assert.equal(isLimitQueryValid(""), true);
  assert.equal(isLimitQueryValid("25"), true);
  assert.equal(isLimitQueryValid("1"), true);
  assert.equal(isLimitQueryValid("100"), true);
  assert.equal(isLimitQueryValid(["25"]), true);
  assert.equal(isLimitQueryValid("0"), false);
  assert.equal(isLimitQueryValid("999"), false);
  assert.equal(isLimitQueryValid("-1"), false);
  assert.equal(isLimitQueryValid("1.5"), false);
  assert.equal(isLimitQueryValid("x"), false);
});
