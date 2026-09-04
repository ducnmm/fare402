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

async function hit(path: string): Promise<void> {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, { method: "GET" });
  const quoted = quoteFrom402(response);
  const body = await response.text();
  console.log(`\nGET ${path}`);
  console.log(`  ${response.status} ${url}`);
  if (quoted?.amount) {
    console.log(`  402 amount ${quoted.amount} tinybars  asset ${quoted.asset}  payTo ${quoted.payTo}`);
  } else {
    const preview = body.length > 300 ? `${body.slice(0, 300)}…` : body;
    console.log(`  body ${preview}`);
  }
}

async function main(): Promise<void> {
  console.log(`Fare try (unpaid)  ${baseUrl}`);
  await hit("/");
  await hit("/health");
  await hit("/v1/ping");
  await hit("/v1/accounts/0.0.98");
  await hit("/v1/accounts/0.0.98/transactions?limit=25");
  console.log("\nPaid ping (needs .env payer keys):");
  console.log(`  FARE_BASE_URL=${baseUrl} npm run pay`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
