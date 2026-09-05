/**
 * Paid AWS job ticket. One payment buys one Node script run.
 * Lambda when AWS_SANDBOX_LAMBDA_ARN is set; FARE_JOB_LOCAL=1 for a local child process.
 * Never log credentials. Never pass host env into the script.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { ServerConfig } from "./config.js";
import { clampTimeout, JOB_DEFAULT_TIMEOUT } from "./price.js";

export const JOB_MAX_SCRIPT_BYTES = 10_240;
export const JOB_MAX_OUTPUT_BYTES = 102_400;

export type JobStatus = "completed" | "failed" | "timeout" | "output_too_large";

export type JobRequest = {
  script: string;
  timeoutSeconds: number;
};

export type JobBackend = "aws-lambda" | "local";

export type JobResult = {
  status: JobStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timeoutSeconds: number;
  provider: JobBackend;
};

export class JobError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JobError";
  }
}

function lambdaConfigured(cfg: ServerConfig): boolean {
  return Boolean(cfg.jobLambdaArn && cfg.awsRegion && cfg.awsAccessKeyId && cfg.awsSecretAccessKey);
}

/** Lambda wins if both backends are set — same order as {@link runJob}. */
export function jobBackend(cfg: ServerConfig): JobBackend | null {
  if (lambdaConfigured(cfg)) return "aws-lambda";
  if (cfg.jobLocal) return "local";
  return null;
}

export function jobsEnabled(cfg: ServerConfig): boolean {
  return jobBackend(cfg) !== null;
}

export function timeoutFromBody(body: unknown): number {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return JOB_DEFAULT_TIMEOUT;
  const raw = (body as Record<string, unknown>).timeoutSeconds;
  if (raw === undefined || raw === null || raw === "") return JOB_DEFAULT_TIMEOUT;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return JOB_DEFAULT_TIMEOUT;
  return clampTimeout(n);
}

export function parseJobRequest(input: unknown): JobRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new JobError("job body must be a JSON object", 400);
  }
  const record = input as Record<string, unknown>;
  const extra = Object.keys(record).filter((k) => k !== "script" && k !== "timeoutSeconds");
  if (extra.length > 0) {
    throw new JobError(`unsupported field(s): ${extra.sort().join(", ")}`, 400);
  }

  const script = record.script;
  if (typeof script !== "string" || script.trim() === "") {
    throw new JobError("script must be a non-empty string", 400);
  }
  const scriptBytes = Buffer.byteLength(script, "utf8");
  if (scriptBytes > JOB_MAX_SCRIPT_BYTES) {
    throw new JobError(`script is ${scriptBytes} bytes; max ${JOB_MAX_SCRIPT_BYTES}`, 400);
  }

  let timeoutSeconds = JOB_DEFAULT_TIMEOUT;
  if (record.timeoutSeconds !== undefined) {
    if (typeof record.timeoutSeconds !== "number" || !Number.isInteger(record.timeoutSeconds)) {
      throw new JobError("timeoutSeconds must be an integer", 400);
    }
    if (record.timeoutSeconds < 1 || record.timeoutSeconds > 60) {
      throw new JobError("timeoutSeconds must be an integer 1-60", 400);
    }
    timeoutSeconds = record.timeoutSeconds;
  }

  return { script, timeoutSeconds };
}

export async function runJob(cfg: ServerConfig, request: JobRequest): Promise<JobResult> {
  const backend = jobBackend(cfg);
  if (backend === "aws-lambda") return invokeLambda(cfg, request);
  if (backend === "local") return runLocal(request);
  throw new JobError("jobs_not_configured", 503);
}

async function invokeLambda(cfg: ServerConfig, request: JobRequest): Promise<JobResult> {
  const client = new LambdaClient({
    region: cfg.awsRegion,
    credentials: {
      accessKeyId: cfg.awsAccessKeyId!,
      secretAccessKey: cfg.awsSecretAccessKey!,
    },
  });

  try {
    const response = await client.send(
      new InvokeCommand({
        FunctionName: cfg.jobLambdaArn,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(
          JSON.stringify({
            script: request.script,
            runtime: "node22",
            timeoutSeconds: request.timeoutSeconds,
          }),
        ),
      }),
    );

    if (response.FunctionError) {
      throw new JobError("job_upstream_error", 502);
    }
    const payload = response.Payload ? Buffer.from(response.Payload).toString("utf8") : "";
    return { ...normalizeLambdaResult(payload), timeoutSeconds: request.timeoutSeconds, provider: "aws-lambda" };
  } catch (err) {
    if (err instanceof JobError) throw err;
    console.error("job lambda failed:", err instanceof Error ? err.name : err);
    throw new JobError("job_upstream_unavailable", 502);
  } finally {
    client.destroy();
  }
}

function normalizeLambdaResult(raw: string): Omit<JobResult, "timeoutSeconds" | "provider"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new JobError("job_upstream_error", 502);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new JobError("job_upstream_error", 502);
  }
  const rec = parsed as Record<string, unknown>;
  const status = rec.status;
  if (status !== "completed" && status !== "failed" && status !== "timeout" && status !== "output_too_large") {
    throw new JobError("job_upstream_error", 502);
  }
  const stdout = typeof rec.stdout === "string" ? rec.stdout : "";
  const stderr = typeof rec.stderr === "string" ? rec.stderr : "";
  const exitCode = typeof rec.exitCode === "number" && Number.isInteger(rec.exitCode) ? rec.exitCode : null;
  return {
    status,
    exitCode: status === "timeout" || status === "output_too_large" ? null : exitCode,
    stdout: stdout.slice(0, JOB_MAX_OUTPUT_BYTES),
    stderr: stderr.slice(0, JOB_MAX_OUTPUT_BYTES),
    truncated: rec.truncated === true || stdout.length > JOB_MAX_OUTPUT_BYTES || stderr.length > JOB_MAX_OUTPUT_BYTES,
  };
}

async function runLocal(request: JobRequest): Promise<JobResult> {
  const scriptPath = join(tmpdir(), `fare-job-${randomUUID()}.js`);
  await writeFile(scriptPath, request.script, "utf8");
  try {
    const execResult = await execNode(scriptPath, request.timeoutSeconds);
    const stdout = execResult.stdout.slice(0, JOB_MAX_OUTPUT_BYTES);
    const stderr = execResult.stderr.slice(0, JOB_MAX_OUTPUT_BYTES);
    return {
      status: execResult.status,
      exitCode: execResult.status === "timeout" || execResult.status === "output_too_large" ? null : execResult.exitCode,
      stdout,
      stderr,
      truncated: execResult.stdout.length > JOB_MAX_OUTPUT_BYTES || execResult.stderr.length > JOB_MAX_OUTPUT_BYTES,
      timeoutSeconds: request.timeoutSeconds,
      provider: "local",
    };
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

function execNode(
  scriptPath: string,
  timeoutSeconds: number,
): Promise<{ status: JobStatus; exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [scriptPath],
      {
        timeout: timeoutSeconds * 1000,
        maxBuffer: JOB_MAX_OUTPUT_BYTES,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(), LANG: "C" },
      },
      (error, stdout, stderr) => {
        const out = stdout ?? "";
        const err = stderr ?? "";
        if (error && "killed" in error && error.killed) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            resolve({ status: "output_too_large", exitCode: null, stdout: out, stderr: err });
            return;
          }
          resolve({ status: "timeout", exitCode: null, stdout: out, stderr: err });
          return;
        }
        const exitCode = typeof error?.code === "number" ? error.code : error ? 1 : 0;
        resolve({
          status: exitCode === 0 ? "completed" : "failed",
          exitCode,
          stdout: out,
          stderr: err,
        });
      },
    );
  });
}

