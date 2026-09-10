export type MirrorAccount = {
  account: string;
  alias: string | null;
  evmAddress: string | null;
  memo: string | null;
  key: { _type: string; key: string } | null;
  balance: {
    timestamp: string | null;
    tinybars: number | null;
    hbar: number | null;
  };
  createdTimestamp: string | null;
};

export type MirrorTransaction = {
  transactionId: string;
  name: string;
  result: string;
  consensusTimestamp: string;
  chargedTxFee: number | null;
  transfers: Array<{ account: string; amount: number }>;
  hashscan: string;
};

export class MirrorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MirrorError";
  }
}

type MirrorAccountResponse = {
  account?: string;
  alias?: string | null;
  evm_address?: string | null;
  memo?: string | null;
  key?: { _type?: string; key?: string } | null;
  balance?: { timestamp?: string | null; balance?: number | null } | null;
  created_timestamp?: string | null;
};

type MirrorTxResponse = {
  transactions?: Array<{
    transaction_id?: string;
    name?: string;
    result?: string;
    consensus_timestamp?: string;
    charged_tx_fee?: number;
    transfers?: Array<{ account?: string; amount?: number }>;
  }>;
  links?: { next?: string | null };
};

const MIRROR_TIMEOUT_MS = 45_000;
const MIRROR_TX_TIMEOUT_MS = 75_000;
const MIRROR_RETRIES = 3;
const MIRROR_TX_PAGE = 25;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function isTransientHttp(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (next.startsWith("http://") || next.startsWith("https://")) {
    const url = new URL(next);
    return `${url.pathname}${url.search}`;
  }
  return next.startsWith("/") ? next : `/${next}`;
}

async function mirrorGet<T>(baseUrl: string, path: string, timeoutMs = MIRROR_TIMEOUT_MS): Promise<T> {
  const url = `${baseUrl}${path}`;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MIRROR_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 404) {
        throw new MirrorError("account not found on Hedera mirror node", 404);
      }
      if (!response.ok) {
        if (isTransientHttp(response.status) && attempt < MIRROR_RETRIES) {
          await delay(800 * (attempt + 1));
          continue;
        }
        throw new MirrorError(`mirror node HTTP ${response.status}`, response.status);
      }
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof MirrorError) throw err;
      lastErr = err;
      if (isTimeout(err) && attempt < MIRROR_RETRIES) {
        await delay(800 * (attempt + 1));
        continue;
      }
      if (isTimeout(err)) {
        throw new MirrorError("mirror node timeout", 504);
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new MirrorError("mirror_node_unavailable", 502);
}

export async function fetchAccountSummary(baseUrl: string, accountId: string): Promise<MirrorAccount> {
  const body = await mirrorGet<MirrorAccountResponse>(
    baseUrl,
    `/api/v1/accounts/${encodeURIComponent(accountId)}?transactions=false`,
  );

  const tinybars = body.balance?.balance ?? null;
  return {
    account: body.account ?? accountId,
    alias: body.alias ?? null,
    evmAddress: body.evm_address ?? null,
    memo: body.memo ?? null,
    key: body.key?._type && body.key.key ? { _type: body.key._type, key: body.key.key } : null,
    balance: {
      timestamp: body.balance?.timestamp ?? null,
      tinybars,
      hbar: tinybars === null ? null : tinybars / 1e8,
    },
    createdTimestamp: body.created_timestamp ?? null,
  };
}

function mapTx(
  tx: NonNullable<MirrorTxResponse["transactions"]>[number],
  hashscanTx: (txId: string) => string,
): MirrorTransaction {
  const transactionId = tx.transaction_id ?? "";
  return {
    transactionId,
    name: tx.name ?? "UNKNOWN",
    result: tx.result ?? "UNKNOWN",
    consensusTimestamp: tx.consensus_timestamp ?? "",
    chargedTxFee: tx.charged_tx_fee ?? null,
    transfers: (tx.transfers ?? [])
      .filter((t) => t.account !== undefined && t.amount !== undefined)
      .map((t) => ({ account: t.account as string, amount: t.amount as number })),
    hashscan: transactionId ? hashscanTx(transactionId) : "",
  };
}

export async function fetchAccountTransactions(
  baseUrl: string,
  accountId: string,
  limit: number,
  hashscanTx: (txId: string) => string,
): Promise<{ account: string; limit: number; transactions: MirrorTransaction[] }> {
  const transactions: MirrorTransaction[] = [];
  const firstQuery = new URLSearchParams({
    "account.id": accountId,
    limit: String(Math.min(MIRROR_TX_PAGE, limit)),
    order: "desc",
  });
  let path: string | null = `/api/v1/transactions?${firstQuery.toString()}`;

  while (path && transactions.length < limit) {
    const body = await mirrorGet<MirrorTxResponse>(baseUrl, path, MIRROR_TX_TIMEOUT_MS);
    const page = (body.transactions ?? []).map((tx) => mapTx(tx, hashscanTx));
    if (page.length === 0) break;
    transactions.push(...page);
    if (transactions.length >= limit) break;
    path = nextPath(body.links?.next ?? null);
  }

  return { account: accountId, limit, transactions: transactions.slice(0, limit) };
}
