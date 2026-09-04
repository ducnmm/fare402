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
const BODY_PREVIEW_CHARS = 800;

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
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const response = await fetch(input, init);

  if (response.status === 402) {
    const quoted = quoteFrom402(response);
    console.log(`← 402 Payment Required  ${method} ${url}`);
    if (quoted) {
      console.log(`   amount    ${quoted.amount} tinybars (${Number(quoted.amount) / 1e8} HBAR)`);
      console.log(`   asset     ${quoted.asset}  network ${quoted.network}  payTo ${quoted.payTo}`);
      if (quoted.feePayer) console.log(`   feePayer  ${quoted.feePayer} (Blocky402)`);
    }
  } else {
    console.log(`← ${response.status} ${method} ${url}`);
  }
  return response;
};

const fetchWithPayment = wrapFetchWithPayment(loggingFetch, client);

type Target = { label: string; path: string };

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
      return [{ label: "ping", path: "/v1/ping" }];
    case "account": {
      const id = a ?? "0.0.98";
      return [{ label: "account summary", path: `/v1/accounts/${id}` }];
    }
    case "txs": {
      const id = a ?? "0.0.98";
      const limit = b ?? "10";
      return [{ label: `transactions limit=${limit}`, path: `/v1/accounts/${id}/transactions?limit=${limit}` }];
    }
    default:
      if (cmd.startsWith("/")) return [{ label: cmd, path: cmd }];
      throw new Error(`Unknown command ${cmd}. Use ping | account | txs | demo | /path`);
  }
}

function demoTargets(accountId: string): { cheap: Target; expensive: Target } {
  return {
    cheap: { label: "cheap — account summary (1 unit)", path: `/v1/accounts/${accountId}` },
    expensive: {
      label: "expensive — transactions limit=25 (4 units)",
      path: `/v1/accounts/${accountId}/transactions?limit=25`,
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

function previewJson(body: unknown): string {
  let value: unknown = body;
  if (value && typeof value === "object" && !Array.isArray(value) && "transactions" in value) {
    const rec = { ...(value as Record<string, unknown>) };
    if (Array.isArray(rec.transactions)) {
      rec.transactions = [`${rec.transactions.length} transactions omitted`];
    }
    value = rec;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= BODY_PREVIEW_CHARS) return text;
  return `${text.slice(0, BODY_PREVIEW_CHARS)}\n  … truncated`;
}

function parseTinybars(amount: string | undefined): bigint | undefined {
  if (!amount || !/^\d+$/.test(amount)) return undefined;
  return BigInt(amount);
}

async function drain(response: Response): Promise<void> {
  await response.arrayBuffer().catch(() => undefined);
}

async function unpaidQuote(target: Target): Promise<string | undefined> {
  const url = `${cfg.baseUrl}${target.path}`;
  console.log(`\n→ unpaid ${target.label}`);
  console.log(`  ${url}`);
  const response = await loggingFetch(url, { method: "GET" });
  const quoted = quoteFrom402(response);
  await drain(response);
  return quoted?.amount;
}

async function payOnce(target: Target): Promise<void> {
  const url = `${cfg.baseUrl}${target.path}`;
  console.log(`\n→ ${target.label}`);
  console.log(`  ${url}`);

  const response = await fetchWithPayment(url, { method: "GET" });
  const bodyText = await response.text();
  let body: unknown = bodyText;
  try {
    body = JSON.parse(bodyText);
  } catch {
    /* keep raw */
  }

  const settled = settlementOf(response);
  if (settled?.transaction) {
    console.log(`  settle tx  ${settled.transaction}`);
    console.log(`  HashScan   ${hashscanTxUrl(cfg.network, settled.transaction)}`);
  } else {
    console.log("  (no PAYMENT-RESPONSE / settlement header)");
  }

  console.log("  body", JSON.stringify(body, null, 2));

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

  const url = `${cfg.baseUrl}${target.path}`;
  console.log(`\n→ pay ${target.label}`);
  console.log(`  ${url}`);
  console.log(`  quote ${amount} tinybars ≤ remaining ${remaining}`);

  const response = await fetchWithPayment(url, { method: "GET" });
  const bodyText = await response.text();
  let body: unknown = bodyText;
  try {
    body = JSON.parse(bodyText);
  } catch {
    /* keep raw */
  }

  const settled = settlementOf(response);
  if (settled?.transaction) {
    console.log(`  settle tx  ${settled.transaction}`);
    console.log(`  HashScan   ${hashscanTxUrl(cfg.network, settled.transaction)}`);
  } else {
    console.log("  (no PAYMENT-RESPONSE / settlement header)");
  }
  console.log("  body", previewJson(body));

  if (!response.ok) {
    throw new Error(`Paid request failed: HTTP ${response.status}`);
  }

  return { remaining: remaining - amount, settleTx: settled?.transaction };
}

function printRecap(budget: bigint, cheap: DemoLegResult, expensive: DemoLegResult): void {
  console.log("\n=== recap ===");
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
  console.log("unpaid quotes first (expect 100000 vs 400000 tinybars)");

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
  console.log(`Fare payer ${cfg.payerId} on ${cfg.caipNetwork}`);
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
