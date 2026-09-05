/**
 * Tiny paying client. Hits the Fare resource server; @x402/fetch handles
 * 402 → sign Hedera transfer → retry with PAYMENT-SIGNATURE.
 *
 *   npm run pay
 *   npm run pay:demo
 *   npx tsx scripts/pay-once.ts ping
 *   npx tsx scripts/pay-once.ts account 0.0.98
 *   npx tsx scripts/pay-once.ts txs 0.0.98 10
 *   npx tsx scripts/pay-once.ts txs 0.0.98 25
 *   npx tsx scripts/pay-once.ts job
 *   npx tsx scripts/pay-once.ts job 10 'console.log("hi")'
 *   npx tsx scripts/pay-once.ts demo 0.0.98
 */
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { loadClientConfig } from "../src/config.js";
import { hashscanAccountUrl, hashscanTxUrl } from "../src/hashscan.js";
import { HBAR_ASSET } from "../src/price.js";

const DEFAULT_BUDGET_TINYBARS = 1_000_000n;

const cfg = loadClientConfig();
const budgetTinybars = loadBudgetTinybars();

const hederaSigner = createClientHederaSigner(cfg.payerId, PrivateKey.fromStringECDSA(cfg.payerKey), {
  network: cfg.caipNetwork,
});

const client = new x402Client().register("hedera:*", new ExactHederaScheme(hederaSigner));
// @x402/core defaults Hedera spend controls to USDC; Fare quotes native HBAR.
// allowedAssets[].maxAmountPerPayment is integer tinybars (digits), not a $ USD cap.
client.setSpendControls({
  allowedAssets: [
    {
      network: "hedera:*",
      asset: HBAR_ASSET,
      maxAmountPerPayment: budgetTinybars.toString(),
    },
  ],
});
const httpClient = new x402HTTPClient(client);

const loggingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 402) {
    const quoted = quoteFrom402(response);
    console.log("\n2. MERCHANT QUOTED  (HTTP 402 — no data yet)");
    if (quoted?.amount) {
      console.log(`   price     ${quoted.amount} tinybars  =  ${hbarLabel(quoted.amount)}`);
      console.log(`   asset     ${quoted.asset} (${quoted.network})`);
      console.log(`   pay to    ${quoted.payTo}`);
      if (quoted.feePayer) console.log(`   fee payer ${quoted.feePayer}  (Blocky402)`);
    } else {
      console.log("   (402 with no decodeable quote)");
    }
  }
  return response;
};

const fetchWithPayment = wrapFetchWithPayment(loggingFetch, client);

type Target = { label: string; path: string; init?: RequestInit; ask?: string };

type Quote = {
  amount?: string;
  asset?: string;
  network?: string;
  payTo?: string;
  feePayer?: string;
};

type DemoLegResult = {
  label: string;
  path: string;
  quoteTinybars: string | undefined;
  settleTx: string | undefined;
  skipped: string | undefined;
};

function loadBudgetTinybars(): bigint {
  const raw = process.env.FARE_BUDGET_TINYBARS?.trim();
  if (!raw) return DEFAULT_BUDGET_TINYBARS;
  if (!/^\d+$/.test(raw)) {
    throw new Error("FARE_BUDGET_TINYBARS must be a non-negative integer (tinybars, digits only)");
  }
  return BigInt(raw);
}

function targetsFromArgv(argv: string[]): Target[] {
  const [cmd = "ping", a, b] = argv;
  switch (cmd) {
    case "ping":
      return [{ label: "ping", path: "/v1/ping", ask: "dummy ping — prove 402 → pay → { ok: true }" }];
    case "account": {
      const id = a ?? "0.0.98";
      return [
        {
          label: "lookups / account",
          path: `/v1/accounts/${id}`,
          ask: `Hedera account summary for ${id} (balance, key, memo)`,
        },
      ];
    }
    case "txs": {
      const id = a ?? "0.0.98";
      const limit = b ?? "10";
      return [
        {
          label: "lookups / transactions",
          path: `/v1/accounts/${id}/transactions?limit=${limit}`,
          ask: `last ${limit} transactions for ${id} (metered: more rows = more HBAR)`,
        },
      ];
    }
    case "job": {
      const timeout = a && /^\d+$/.test(a) ? Number.parseInt(a, 10) : 10;
      const script = a && !/^\d+$/.test(a) ? a : (b ?? 'console.log("fare-job")');
      return [
        {
          label: "jobs / AWS Lambda",
          path: "/v1/jobs",
          ask: `run this Node script for up to ${timeout}s, return stdout`,
          init: {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ script, timeoutSeconds: timeout }),
          },
        },
      ];
    }
    default:
      if (cmd.startsWith("/")) return [{ label: cmd, path: cmd }];
      throw new Error(`Unknown command ${cmd}. Use ping | account | txs | job | demo | /path`);
  }
}

function demoTargets(accountId: string): { cheap: Target; expensive: Target } {
  return {
    cheap: {
      label: "lookups / account (cheap)",
      path: `/v1/accounts/${accountId}`,
      ask: `Hedera account summary for ${accountId} — 1 unit`,
    },
    expensive: {
      label: "lookups / transactions (expensive)",
      path: `/v1/accounts/${accountId}/transactions?limit=25`,
      ask: `last 25 transactions for ${accountId} — 4 units`,
    },
  };
}

function quoteFrom402(response: Response): Quote | null {
  const header = response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("payment-required");
  if (!header) return null;
  try {
    const json = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      accepts?: Array<{
        amount?: string;
        asset?: string;
        network?: string;
        payTo?: string;
        extra?: { feePayer?: string };
      }>;
    };
    const first = json.accepts?.[0];
    if (!first) return null;
    return {
      amount: first.amount,
      asset: first.asset,
      network: first.network,
      payTo: first.payTo,
      feePayer: first.extra?.feePayer,
    };
  } catch {
    return null;
  }
}

function settlementOf(response: Response): { transaction?: string; payer?: string; success?: boolean } | null {
  try {
    return httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
  } catch {
    return null;
  }
}

function hbarLabel(tinybars: string | number | undefined): string {
  const n = typeof tinybars === "number" ? tinybars : Number(tinybars ?? 0);
  if (!Number.isFinite(n)) return "? HBAR";
  return `${n / 1e8} HBAR`;
}

function printAsk(target: Target): void {
  const method = String(target.init?.method ?? "GET").toUpperCase();
  const url = `${cfg.baseUrl}${target.path}`;
  console.log("\n────────────────────────────────────────");
  console.log("1. YOU ASKED");
  console.log(`   service   ${target.label}`);
  if (target.ask) console.log(`   meaning   ${target.ask}`);
  console.log(`   request   ${method} ${url}`);
  if (typeof target.init?.body === "string") {
    console.log(`   body      ${target.init.body}`);
  }
}

function highlightOutput(body: unknown): string[] {
  if (!body || typeof body !== "object") return [`raw  ${String(body)}`];
  const rec = body as Record<string, unknown>;
  const lines: string[] = [];

  if (rec.ok === true && rec.pricing) {
    lines.push("ping ok — payment loop works, no Hedera data in this ticket");
    return lines;
  }

  if (rec.account && typeof rec.account === "object" && !Array.isArray(rec.account)) {
    const a = rec.account as Record<string, unknown>;
    const bal = a.balance as { hbar?: number; tinybars?: number } | undefined;
    lines.push(`account    ${a.account ?? "?"}`);
    if (bal?.hbar !== undefined) lines.push(`balance    ${bal.hbar} HBAR  (${bal.tinybars} tinybars)`);
    if (a.evmAddress) lines.push(`evm        ${a.evmAddress}`);
    if (a.memo !== undefined && a.memo !== "") lines.push(`memo       ${a.memo}`);
    lines.push("source     Hedera Mirror Node");
    return lines;
  }

  if (Array.isArray(rec.transactions)) {
    const txs = rec.transactions as Array<Record<string, unknown>>;
    lines.push(`account    ${rec.account ?? "?"}`);
    lines.push(`rows       ${txs.length} transactions  (asked limit=${rec.limit ?? "?"})`);
    for (const tx of txs.slice(0, 5)) {
      lines.push(`  • ${tx.transactionId ?? "?"}   ${tx.name ?? "?"}   ${tx.result ?? "?"}`);
    }
    if (txs.length > 5) lines.push(`  … ${txs.length - 5} more`);
    lines.push("source     Hedera Mirror Node");
    return lines;
  }

  if (typeof rec.stdout === "string" || rec.provider) {
    lines.push(`provider   ${rec.provider ?? "?"}`);
    lines.push(`status     ${rec.status ?? "?"}   exit ${rec.exitCode ?? "n/a"}   ${rec.timeoutSeconds ?? "?"}s`);
    const out = String(rec.stdout ?? "").replace(/\n$/, "");
    const err = String(rec.stderr ?? "").replace(/\n$/, "");
    lines.push("stdout");
    if (out.length) {
      for (const line of out.split("\n")) lines.push(`             ${line}`);
    } else {
      lines.push("             (empty)");
    }
    if (err) {
      lines.push("stderr");
      for (const line of err.split("\n")) lines.push(`             ${line}`);
    }
    return lines;
  }

  lines.push(JSON.stringify(body));
  return lines;
}

function printPaid(status: number, body: unknown, settled: { transaction?: string } | null): void {
  console.log("\n3. YOU PAID");
  if (settled?.transaction) {
    console.log(`   settle    ${settled.transaction}`);
    console.log(`   HashScan  ${hashscanTxUrl(cfg.network, settled.transaction)}`);
  } else {
    console.log("   settle    (no PAYMENT-RESPONSE — not charged, or handler failed first)");
  }
  console.log(`   http      ${status}`);

  console.log("\n4. YOU GOT");
  for (const line of highlightOutput(body)) {
    console.log(`   ${line}`);
  }
}

function parseTinybars(amount: string | undefined): bigint | undefined {
  if (!amount || !/^\d+$/.test(amount)) return undefined;
  return BigInt(amount);
}

async function drain(response: Response): Promise<void> {
  await response.arrayBuffer().catch(() => undefined);
}

async function unpaidQuote(target: Target): Promise<string | undefined> {
  printAsk(target);
  const url = `${cfg.baseUrl}${target.path}`;
  const response = await loggingFetch(url, target.init ?? { method: "GET" });
  const quoted = quoteFrom402(response);
  await drain(response);
  console.log("\n   (stopped here — unpaid, so no output body)");
  return quoted?.amount;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const bodyText = await response.text();
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText;
  }
}

async function payOnce(target: Target): Promise<void> {
  printAsk(target);
  const url = `${cfg.baseUrl}${target.path}`;
  const response = await fetchWithPayment(url, target.init ?? { method: "GET" });
  const body = await readJsonBody(response);

  const settled = settlementOf(response);
  printPaid(response.status, body, settled);

  if (!response.ok) {
    throw new Error(`Paid request failed: HTTP ${response.status}`);
  }
}

async function payIfWithinBudget(
  target: Target,
  quoteTinybars: string | undefined,
  remaining: bigint,
): Promise<{ remaining: bigint; settleTx?: string; skipped?: string }> {
  const amount = parseTinybars(quoteTinybars);
  if (amount === undefined) {
    const skipped = "no 402 quote";
    console.log(`  skip — ${skipped}`);
    return { remaining, skipped };
  }
  if (amount > remaining) {
    const skipped = `quote ${amount} tinybars > remaining budget ${remaining}`;
    console.log(`  skip — ${skipped}`);
    return { remaining, skipped };
  }

  printAsk(target);
  console.log(`   budget    ${amount} tinybars quoted, ${remaining} remaining`);
  const url = `${cfg.baseUrl}${target.path}`;
  const response = await fetchWithPayment(url, target.init ?? { method: "GET" });
  const body = await readJsonBody(response);
  const settled = settlementOf(response);
  printPaid(response.status, body, settled);

  if (!response.ok) {
    throw new Error(`Paid request failed: HTTP ${response.status}`);
  }

  return { remaining: remaining - amount, settleTx: settled?.transaction };
}

function printRecap(budget: bigint, cheap: DemoLegResult, expensive: DemoLegResult): void {
  console.log("\n────────────────────────────────────────");
  console.log("RECAP  (cheap vs expensive lookup)");
  console.log(`budget     ${budget} tinybars (${Number(budget) / 1e8} HBAR)`);
  for (const leg of [cheap, expensive]) {
    console.log(leg.label);
    console.log(`  path      ${leg.path}`);
    console.log(`  quote     ${leg.quoteTinybars ?? "missing"} tinybars`);
    if (leg.skipped) {
      console.log(`  settle    skipped (${leg.skipped})`);
      console.log("  HashScan  skipped");
    } else if (leg.settleTx) {
      console.log(`  settle    ${leg.settleTx}`);
      console.log(`  HashScan  ${hashscanTxUrl(cfg.network, leg.settleTx)}`);
    } else {
      console.log("  settle    (no PAYMENT-RESPONSE)");
      console.log("  HashScan  skipped");
    }
  }
}

async function runDemo(accountId: string): Promise<void> {
  const { cheap, expensive } = demoTargets(accountId);
  let remaining = budgetTinybars;

  console.log(`budget     ${budgetTinybars} tinybars (${Number(budgetTinybars) / 1e8} HBAR)`);
  console.log("unpaid quotes first — same account, 1 unit vs 4 units");

  const cheapQuote = await unpaidQuote(cheap);
  const expensiveQuote = await unpaidQuote(expensive);
  console.log(`\n402 quotes ${cheapQuote ?? "missing"} vs ${expensiveQuote ?? "missing"} tinybars`);

  const cheapPaid = await payIfWithinBudget(cheap, cheapQuote, remaining);
  remaining = cheapPaid.remaining;
  const expensivePaid = await payIfWithinBudget(expensive, expensiveQuote, remaining);

  printRecap(
    budgetTinybars,
    {
      label: cheap.label,
      path: cheap.path,
      quoteTinybars: cheapQuote,
      settleTx: cheapPaid.settleTx,
      skipped: cheapPaid.skipped,
    },
    {
      label: expensive.label,
      path: expensive.path,
      quoteTinybars: expensiveQuote,
      settleTx: expensivePaid.settleTx,
      skipped: expensivePaid.skipped,
    },
  );
}

async function main(): Promise<void> {
  console.log("Fare — two tickets: Hedera lookups, AWS Lambda jobs");
  console.log(`Payer      ${cfg.payerId}  (${cfg.caipNetwork})`);
  console.log(`Merchant   ${hashscanAccountUrl(cfg.network, cfg.operatorId ?? "(set HEDERA_OPERATOR_ID)")}`);

  const argv = process.argv.slice(2);
  if ((argv[0] ?? "ping") === "demo") {
    await runDemo(argv[1] ?? "0.0.98");
    return;
  }

  const targets = targetsFromArgv(argv);
  for (const target of targets) {
    await payOnce(target);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
