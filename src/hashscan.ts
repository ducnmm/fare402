/**
 * Hedera tx ids look like `0.0.123@1700000000.000000000`.
 * HashScan uses `0.0.123-1700000000-000000000`.
 */
export function encodeHashscanTxId(txId: string): string {
  const at = txId.indexOf("@");
  if (at === -1) return txId;
  const account = txId.slice(0, at);
  const rest = txId.slice(at + 1);
  const dot = rest.indexOf(".");
  if (dot === -1) return `${account}-${rest}`;
  return `${account}-${rest.slice(0, dot)}-${rest.slice(dot + 1)}`;
}

export function hashscanTxUrl(network: "testnet" | "mainnet", txId: string): string {
  return `https://hashscan.io/${network}/transaction/${encodeHashscanTxId(txId)}`;
}

export function hashscanAccountUrl(network: "testnet" | "mainnet", accountId: string): string {
  return `https://hashscan.io/${network}/account/${accountId}`;
}

export function hashscanTopicUrl(network: "testnet" | "mainnet", topicId: string): string {
  return `https://hashscan.io/${network}/topic/${topicId}`;
}
