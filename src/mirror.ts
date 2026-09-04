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

const MIRROR_TIMEOUT_MS = 30_000;
const MIRROR_RETRIES = 1;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

async function mirrorGet<T>(baseUrl: string, path: string): Promise<T> {
  const url = `${baseUrl}${path}`;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MIRROR_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
      });

      if (response.status === 404) {
        throw new MirrorError("account not found on Hedera mirror node", 404);
      }
      if (!response.ok) {
        throw new MirrorError(`mirror node HTTP ${response.status}`, response.status);
      }
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof MirrorError) throw err;
      lastErr = err;
      if (isTimeout(err) && attempt < MIRROR_RETRIES) continue;
      if (isTimeout(err)) {
        throw new MirrorError("mirror node timeout", 504);
      }
      throw err;
    }
  }

  throw lastErr;
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

export async function fetchAccountTransactions(
  baseUrl: string,
  accountId: string,
  limit: number,
  hashscanTx: (txId: string) => string,
): Promise<{ account: string; limit: number; transactions: MirrorTransaction[] }> {
  const query = new URLSearchParams({
    "account.id": accountId,
    limit: String(limit),
    order: "desc",
  });
  const body = await mirrorGet<MirrorTxResponse>(baseUrl, `/api/v1/transactions?${query.toString()}`);

  const transactions = (body.transactions ?? []).map((tx) => {
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
  });

  return { account: accountId, limit, transactions };
}
