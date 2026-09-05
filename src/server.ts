import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient, type SettleResultContext } from "@x402/core/server";
import type { DynamicPrice } from "@x402/core/http";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { isHederaAccountId } from "./account-id.js";
import { loadServerConfig } from "./config.js";
import { appendAudit, closeHcs, hcsEnabled } from "./hcs.js";
import { hashscanTopicUrl, hashscanTxUrl } from "./hashscan.js";
import { JobError, jobBackend, parseJobRequest, runJob, timeoutFromBody } from "./job.js";
import { fetchAccountSummary, fetchAccountTransactions, MirrorError } from "./mirror.js";
import {
  hbarPrice,
  isLimitQueryValid,
  MAX_LIMIT,
  MIN_LIMIT,
  parseLimit,
  PING_UNITS,
  pricingMeta,
  unitsForAccountSummary,
  unitsForJob,
  unitsForTransactions,
} from "./price.js";

const cfg = loadServerConfig();
const hcsOn = hcsEnabled(cfg);
const jobsProvider = jobBackend(cfg);

const facilitatorClient = new HTTPFacilitatorClient({ url: cfg.facilitatorUrl });

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(cfg.caipNetwork, new ExactHederaScheme({}))
  .onAfterSettle(async (context: SettleResultContext) => {
    if (context.phase !== "after-handler") return;
    const payer = context.result.payer ?? "unknown";
    const txId = context.result.transaction ?? "";
    const amount = context.requirements.amount ?? "";
    if (!txId) return;
    console.log(`settled ${txId}  payer=${payer}  amount=${amount} tinybars`);
    console.log(`  ${hashscanTxUrl(cfg.network, String(txId))}`);
    // Do not await HCS: onAfterSettle runs after settle, before PAYMENT-RESPONSE/body.
    void appendAudit(cfg, { account: String(payer), amountTinybars: String(amount), txId: String(txId) });
  });

const paidAccepts = {
  scheme: "exact" as const,
  network: cfg.caipNetwork,
  payTo: cfg.operatorId,
};

const transactionsPrice: DynamicPrice = (context) => {
  const limit = parseLimit(context.adapter.getQueryParam?.("limit"));
  return hbarPrice(unitsForTransactions(limit));
};

const jobsPrice: DynamicPrice = (context) => {
  const timeout = timeoutFromBody(context.adapter.getBody?.());
  return hbarPrice(unitsForJob(timeout));
};

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "fare",
    oneLiner: "Two x402 tickets on Hedera: Hedera lookups, and a Node job on AWS Lambda.",
    health: "/health",
    services: {
      lookups: {
        what: "Hedera account summary and recent transactions (Mirror Node)",
        routes: {
          ping: "GET /v1/ping",
          account: "GET /v1/accounts/0.0.98",
          transactions: "GET /v1/accounts/0.0.98/transactions?limit=25",
        },
      },
      jobs: {
        what: "Run one Node.js script; pay per timeout. Returns stdout/stderr/exitCode",
        route: "POST /v1/jobs",
        body: { script: "console.log(1+1)", timeoutSeconds: 10 },
        backend: jobsProvider,
      },
    },
    tryUnpaid: "npm run try",
    tryPaid: "FARE_BASE_URL=<this-origin> npm run pay",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "fare",
    network: cfg.caipNetwork,
    facilitator: cfg.facilitatorUrl,
    merchant: cfg.operatorId,
    hcs: hcsOn ? (cfg.hcsTopicId ?? null) : null,
    jobs: jobsProvider,
  });
});

app.use(guardPaidPath);

app.use(
  paymentMiddleware(
    {
      "GET /v1/ping": {
        accepts: { ...paidAccepts, price: hbarPrice(PING_UNITS) },
        description: "Paid ping — proves the 402 → pay → JSON loop",
        mimeType: "application/json",
      },
      "GET /v1/accounts/:accountId": {
        accepts: { ...paidAccepts, price: hbarPrice(unitsForAccountSummary()) },
        description: "Hedera account summary (balance, key, memo)",
        mimeType: "application/json",
      },
      "GET /v1/accounts/:accountId/transactions": {
        accepts: {
          ...paidAccepts,
          price: transactionsPrice,
        },
        description: "Recent Hedera transactions. Price = 1 + ceil(limit/10) units (1 unit = 0.001 HBAR)",
        mimeType: "application/json",
      },
      "POST /v1/jobs": {
        accepts: {
          ...paidAccepts,
          price: jobsPrice,
        },
        description:
          "Run a short Node.js script. Price = 1 + ceil(timeoutSeconds/10) units. Max 10KB script, timeout 1-60s.",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/v1/ping", (_req, res) => {
  res.json({ ok: true, pricing: pricingMeta(PING_UNITS) });
});

app.get("/v1/accounts/:accountId", async (req, res) => {
  const accountId = String(req.params.accountId);
  try {
    const account = await fetchAccountSummary(cfg.mirrorNodeUrl, accountId);
    res.json({
      pricing: pricingMeta(unitsForAccountSummary()),
      account,
      source: "hedera-mirror-node",
    });
  } catch (err) {
    sendMirrorError(res, err);
  }
});

app.get("/v1/accounts/:accountId/transactions", async (req, res) => {
  const accountId = String(req.params.accountId);
  const limit = parseLimit(req.query.limit);
  try {
    const data = await fetchAccountTransactions(cfg.mirrorNodeUrl, accountId, limit, (txId) =>
      hashscanTxUrl(cfg.network, txId),
    );
    res.json({
      pricing: pricingMeta(unitsForTransactions(limit)),
      ...data,
      source: "hedera-mirror-node",
    });
  } catch (err) {
    sendMirrorError(res, err);
  }
});

app.post("/v1/jobs", async (req, res) => {
  try {
    const request = parseJobRequest(req.body);
    const result = await runJob(cfg, request);
    res.json({
      pricing: pricingMeta(unitsForJob(request.timeoutSeconds)),
      ...result,
    });
  } catch (err) {
    if (err instanceof JobError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(502).json({ error: "job_failed" });
  }
});

function sendMethodNotAllowed(req: express.Request, res: express.Response, allow: string): void {
  res.set("Allow", allow);
  res.status(405);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.json({ error: "method_not_allowed" });
}

function guardPaidPath(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!req.path.startsWith("/v1")) {
    next();
    return;
  }

  if (req.path === "/v1/jobs") {
    if (req.method !== "POST") {
      sendMethodNotAllowed(req, res, "POST");
      return;
    }
    if (!jobsProvider) {
      res.status(503).json({ error: "jobs_not_configured" });
      return;
    }
    try {
      parseJobRequest(req.body);
    } catch (err) {
      if (err instanceof JobError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: "invalid_job" });
      return;
    }
    next();
    return;
  }

  // x402 only matches GET /...; Express maps HEAD onto GET handlers, so unpaid HEAD would 200.
  if (req.method !== "GET") {
    sendMethodNotAllowed(req, res, "GET");
    return;
  }

  if (!req.path.startsWith("/v1/accounts/")) {
    next();
    return;
  }

  const rest = req.path.slice("/v1/accounts/".length);
  const accountId = rest.split("/")[0] ?? "";
  if (!isHederaAccountId(accountId)) {
    res.status(400).json({ error: "invalid_account_id", expected: "shard.realm.num" });
    return;
  }
  if (rest.includes("/transactions") && !isLimitQueryValid(req.query.limit)) {
    res.status(400).json({ error: "invalid_limit", expected: `integer ${MIN_LIMIT}-${MAX_LIMIT}` });
    return;
  }
  next();
}

function sendMirrorError(res: express.Response, err: unknown): void {
  if (err instanceof MirrorError) {
    res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(502).json({ error: "mirror_node_unavailable" });
}

function stop(): void {
  void closeHcs().finally(() => process.exit(0));
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

app.listen(cfg.port, cfg.host, () => {
  console.log(`Fare merchant on http://${cfg.host}:${cfg.port}`);
  console.log(`  network     ${cfg.caipNetwork}`);
  console.log(`  payTo       ${cfg.operatorId}`);
  console.log(`  facilitator ${cfg.facilitatorUrl}`);
  console.log(`  mirror      ${cfg.mirrorNodeUrl}`);
  console.log(`  jobs        ${jobsProvider ?? "off"}`);
  if (hcsOn && cfg.hcsTopicId) {
    console.log(`  hcs topic   ${cfg.hcsTopicId}`);
    console.log(`  hcs         ${hashscanTopicUrl(cfg.network, cfg.hcsTopicId)}`);
  } else if (cfg.hcsTopicId) {
    console.warn("HCS_TOPIC_ID is set but HEDERA_OPERATOR_KEY is missing; HCS audit is disabled");
  }
});
