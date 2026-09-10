/**
 * Local presenter: slides on the left, live terminal on the right.
 * Space runs the current command (allowlisted); Space again goes next.
 *
 *   npm run demo:deck
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "demo-deck");
const LIVE = "https://fare-production.up.railway.app";
const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.DEMO_DECK_PORT ?? "4040", 10) || 4040;
const RUN_TIMEOUT_MS = 180_000;
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

type Step = { argv: string[] };
type Job = { label: string; steps: Step[] };

const FARE = join(ROOT, "fare");

function fare(args: string[]): Step {
  return { argv: [FARE, ...args] };
}

const JOBS: Record<string, Job> = {
  ping402: {
    label: `curl -si ${LIVE}/v1/ping`,
    steps: [{ argv: ["curl", "-si", `${LIVE}/v1/ping`] }],
  },
  account: {
    label: "fare account 0.0.98",
    steps: [fare(["account", "0.0.98"])],
  },
  txs: {
    label: "fare txs 0.0.98 25",
    steps: [fare(["txs", "0.0.98", "25"])],
  },
  job: {
    label: "fare job 10 'console.log(1+1)'",
    steps: [fare(["job", "10", "console.log(1+1)"])],
  },
  hcs: {
    label: "fare topic",
    steps: [fare(["topic"])],
  },
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  FARE_BASE_URL: LIVE,
};

let running: ChildProcess | undefined;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function killRunning(): void {
  if (!running || running.killed) return;
  running.kill("SIGTERM");
  setTimeout(() => {
    if (running && !running.killed) running.kill("SIGKILL");
  }, 1500).unref();
}

function spawnStep(step: Step): ChildProcess {
  const [cmd, ...args] = step.argv;
  if (!cmd) throw new Error("empty command");
  return spawn(cmd, args, {
    cwd: ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function runJob(id: string, res: ServerResponse): Promise<void> {
  const job = JOBS[id];
  if (!job) {
    sendJson(res, 404, { error: "unknown_job" });
    return;
  }
  if (!existsSync(TSX) || !existsSync(FARE)) {
    sendJson(res, 500, { error: "tsx_missing" });
    return;
  }

  killRunning();
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  writeSse(res, { t: "cmd", s: `$ ${job.label}\n` });

  let aborted = false;
  const onClose = (): void => {
    if (res.writableEnded) return;
    aborted = true;
    killRunning();
  };
  res.once("close", onClose);

  const timer = setTimeout(() => {
    writeSse(res, { t: "out", s: "\n[timed out]\n" });
    killRunning();
  }, RUN_TIMEOUT_MS);

  let exitCode = 0;
  try {
    for (const [i, step] of job.steps.entries()) {
      if (aborted) {
        exitCode = 1;
        break;
      }
      if (job.steps.length > 1) {
        writeSse(res, { t: "out", s: `\n── step ${i + 1}/${job.steps.length} ──\n` });
      }
      const code = await new Promise<number>((resolve) => {
        const child = spawnStep(step);
        running = child;
        const onChunk = (buf: Buffer): void => {
          writeSse(res, { t: "out", s: buf.toString("utf8") });
        };
        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);
        child.once("error", (err) => {
          writeSse(res, { t: "out", s: `\n${err.message}\n` });
          resolve(1);
        });
        child.once("close", (status) => resolve(status ?? 1));
      });
      running = undefined;
      if (aborted) {
        exitCode = 1;
        break;
      }
      if (code !== 0) {
        exitCode = code;
        break;
      }
    }
  } finally {
    clearTimeout(timer);
    res.off("close", onClose);
    running = undefined;
    if (!res.writableEnded) {
      writeSse(res, { t: "end", code: exitCode });
      res.end();
    }
  }
}

async function serveStatic(urlPath: string, res: ServerResponse): Promise<void> {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  if (relative.includes("..")) {
    res.writeHead(400);
    res.end();
    return;
  }
  const file = join(PUBLIC, relative);
  if (!file.startsWith(PUBLIC) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  void (async () => {
    try {
      if (req.method === "GET" && url.pathname === "/deck-health") {
        sendJson(res, 200, { ok: true, live: LIVE, jobs: Object.keys(JOBS) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/run") {
        const raw = await readBody(req);
        let id = "";
        try {
          id = String((JSON.parse(raw) as { id?: unknown }).id ?? "");
        } catch {
          sendJson(res, 400, { error: "invalid_json" });
          return;
        }
        await runJob(id, res);
        return;
      }
      if (req.method === "GET") {
        await serveStatic(url.pathname, res);
        return;
      }
      res.writeHead(405);
      res.end();
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      if (!res.headersSent) sendJson(res, 500, { error: "deck_failed" });
      else res.end();
    }
  })();
});

server.listen(PORT, HOST, () => {
  const origin = `http://${HOST}:${PORT}`;
  console.log(`Fare demo deck  ${origin}`);
  console.log(`  live merchant ${LIVE}`);
  console.log("  Enter = run. Space = next slide. Keys stay on this machine.");
  if (process.env.DEMO_DECK_NO_OPEN !== "1" && process.platform === "darwin") {
    spawn("open", [origin], { stdio: "ignore", detached: true }).unref();
  }
});
