/** Native HBAR in x402 exact/Hedera. Amounts are tinybars (1 HBAR = 10^8). */
export const HBAR_ASSET = "0.0.0";

/** One Fare unit = 0.001 HBAR = 100_000 tinybars. */
export const UNIT_TINYBARS = 100_000;

export const ACCOUNT_SUMMARY_UNITS = 1;
export const PING_UNITS = 1;

export const MIN_LIMIT = 1;
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 10;

export type HbarPrice = {
  asset: typeof HBAR_ASSET;
  amount: string;
};

export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
}

function limitToken(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/**
 * Mirror `limit` from a query value. Invalid / missing → default (does not throw).
 */
export function parseLimit(raw: unknown, fallback = DEFAULT_LIMIT): number {
  const value = limitToken(raw);
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return clampLimit(n);
}

/** Missing/empty → default. An explicit value must be an integer in 1..100. */
export function isLimitQueryValid(raw: unknown): boolean {
  const value = limitToken(raw);
  if (value === undefined) return true;
  if (!/^\d+$/.test(value)) return false;
  const n = Number.parseInt(value, 10);
  return n >= MIN_LIMIT && n <= MAX_LIMIT;
}

/** Account summary: 1 unit. */
export function unitsForAccountSummary(): number {
  return ACCOUNT_SUMMARY_UNITS;
}

/**
 * Transaction list: `1 + ceil(limit / 10)` units.
 * Querying more rows costs more HBAR.
 */
export function unitsForTransactions(limit: number): number {
  return 1 + Math.ceil(clampLimit(limit) / 10);
}

export function tinybarsForUnits(units: number): number {
  return units * UNIT_TINYBARS;
}

export function hbarPrice(units: number): HbarPrice {
  return {
    asset: HBAR_ASSET,
    amount: String(tinybarsForUnits(units)),
  };
}

export function pricingMeta(units: number): {
  units: number;
  tinybars: number;
  hbar: number;
} {
  const tinybars = tinybarsForUnits(units);
  return { units, tinybars, hbar: tinybars / 1e8 };
}
