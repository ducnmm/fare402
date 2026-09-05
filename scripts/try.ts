/**
 * Unpaid smoke against a Fare merchant. No wallet needed.
 *
 *   npm run try              # live Railway
 *   npm run try -- local     # http://localhost:4021
 *   npm run try -- https://… # any origin
 */
const LIVE = "https://fare-production.up.railway.app";

const arg = process.argv[2]?.trim();
const baseUrl = (arg === "local" ? "http://localhost:4021" : arg || LIVE).replace(/\/$/, "");

type Quote = {
  amount?: string;
  asset?: string;
  network?: string;
  payTo?: string;
};

function quoteFrom402(response: Response): Quote | null {
  const header = response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("payment-required");
  if (!header) return null;
  try {
    const json = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      accepts?: Array<{ amount?: string; asset?: string; network?: string; payTo?: string }>;
    };
    return json.accepts?.[0] ?? null;
  } catch {
    return null;
  }
}

async function hit(label: string, meaning: string, path: string, init?: RequestInit): Promise<void> {
  const url = `${baseUrl}${path}`;
  const method = init?.method ?? "GET";
  console.log("\n────────────────────────────────────────");
  console.log("YOU ASKED");
  console.log(`   service   ${label}`);
  console.log(`   meaning   ${meaning}`);
  console.log(`   request   ${method} ${url}`);
  if (typeof init?.body === "string") console.log(`   body      ${init.body}`);

  const response = await fetch(url, init ?? { method: "GET" });
  const quoted = quoteFrom402(response);
  const body = await response.text();

  if (quoted?.amount) {
    console.log("MERCHANT SAID  HTTP 402 — pay first, no data yet");
    console.log(`   price     ${quoted.amount} tinybars  =  ${Number(quoted.amount) / 1e8} HBAR`);
    console.log(`   pay to    ${quoted.payTo}`);
    return;
  }
  console.log(`MERCHANT SAID  HTTP ${response.status}  (free route)`);
  const preview = body.length > 240 ? `${body.slice(0, 240)}…` : body;
  console.log(`   body      ${preview}`);
}

async function main(): Promise<void> {
  console.log("Fare try — unpaid only (no wallet, no HBAR spent)");
  console.log(`Merchant  ${baseUrl}`);
  await hit("catalog", "list the two services", "/", { method: "GET" });
  await hit("health", "is the merchant up?", "/health");
  await hit("lookups / ping", "dummy ticket to prove 402", "/v1/ping");
  await hit("lookups / account", "balance of Hedera account 0.0.98", "/v1/accounts/0.0.98");
  await hit(
    "lookups / transactions",
    "last 25 txs for 0.0.98 (4× ping price)",
    "/v1/accounts/0.0.98/transactions?limit=25",
  );
  await hit("jobs / AWS Lambda", "run a Node script, return stdout", "/v1/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script: 'console.log("fare-job")', timeoutSeconds: 10 }),
  });
  console.log("\nTo actually pay and see output:");
  console.log(`  FARE_BASE_URL=${baseUrl} npm run pay`);
  console.log(`  FARE_BASE_URL=${baseUrl} npx tsx scripts/pay-once.ts account 0.0.98`);
  console.log(`  FARE_BASE_URL=${baseUrl} npx tsx scripts/pay-once.ts job 10 'console.log(1+1)'`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
