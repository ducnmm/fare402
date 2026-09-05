import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJobRequest, runJob, timeoutFromBody, JOB_MAX_SCRIPT_BYTES } from "./job.js";
import { JOB_DEFAULT_TIMEOUT, unitsForJob } from "./price.js";
import type { ServerConfig } from "./config.js";

test("job meters 1 + ceil(timeout/10)", () => {
  assert.equal(unitsForJob(1), 2);
  assert.equal(unitsForJob(10), 2);
  assert.equal(unitsForJob(11), 3);
  assert.equal(unitsForJob(30), 4);
  assert.equal(unitsForJob(60), 7);
});

test("timeoutFromBody defaults and clamps", () => {
  assert.equal(timeoutFromBody(undefined), JOB_DEFAULT_TIMEOUT);
  assert.equal(timeoutFromBody({ timeoutSeconds: 30 }), 30);
  assert.equal(timeoutFromBody({ timeoutSeconds: 0 }), 1);
  assert.equal(timeoutFromBody({ timeoutSeconds: 99 }), 60);
});

test("parseJobRequest requires script", () => {
  assert.throws(() => parseJobRequest({}), /script/);
  assert.throws(() => parseJobRequest({ script: "ok", extra: 1 }), /unsupported/);
  const parsed = parseJobRequest({ script: 'console.log("x")', timeoutSeconds: 5 });
  assert.equal(parsed.timeoutSeconds, 5);
});

test("parseJobRequest rejects oversized script", () => {
  const script = "a".repeat(JOB_MAX_SCRIPT_BYTES + 1);
  assert.throws(() => parseJobRequest({ script }), /bytes/);
});

test("local job returns stdout", async () => {
  const cfg = {
    jobLocal: true,
  } as ServerConfig;
  const result = await runJob(cfg, { script: 'console.log("fare-job")', timeoutSeconds: 5 });
  assert.equal(result.provider, "local");
  assert.equal(result.status, "completed");
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /fare-job/);
});
