import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const MUST_STAY_EMPTY = [
  "HEDERA_OPERATOR_ID",
  "HEDERA_OPERATOR_KEY",
  "HEDERA_PAYER_ID",
  "HEDERA_PAYER_KEY",
  "HCS_TOPIC_ID",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SANDBOX_LAMBDA_ARN",
  "FARE_JOB_LOCAL",
];

test(".env.example keeps credentials and account ids empty", () => {
  const examplePath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.example");
  const text = readFileSync(examplePath, "utf8");
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    values.set(line.slice(0, eq), line.slice(eq + 1));
  }
  for (const name of MUST_STAY_EMPTY) {
    assert.equal(values.get(name), "", `${name} must be empty in .env.example`);
  }
});
