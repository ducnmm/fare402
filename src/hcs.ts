import {
  AccountId,
  Client,
  PrivateKey,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";
import type { ServerConfig } from "./config.js";

export type AuditLine = {
  account: string;
  amountTinybars: string;
  txId: string;
  at: string;
};

let client: Client | undefined;
let queue: Promise<void> = Promise.resolve();

const DRAIN_MS = 2_500;

export function hcsEnabled(cfg: { hcsTopicId?: string; operatorKey?: string }): boolean {
  return Boolean(cfg.hcsTopicId && cfg.operatorKey);
}

function hederaClient(cfg: ServerConfig): Client | undefined {
  if (!hcsEnabled(cfg) || !cfg.operatorId || !cfg.operatorKey) return undefined;
  if (client) return client;

  const networkClient = cfg.network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  try {
    // Portal / x402 Hedera keys are ECDSA, not ED25519.
    networkClient.setOperator(AccountId.fromString(cfg.operatorId), PrivateKey.fromStringECDSA(cfg.operatorKey));
    // Hung topic submit must not pin the process. SDK default grpcDeadline is 10s; requestTimeout must be larger.
    networkClient.setGrpcDeadline(4_000);
    networkClient.setRequestTimeout(8_000);
  } catch (err) {
    networkClient.close();
    throw err;
  }
  client = networkClient;
  return client;
}

async function writeAudit(cfg: ServerConfig, line: Omit<AuditLine, "at">): Promise<void> {
  try {
    const hcs = hederaClient(cfg);
    if (!hcs || !cfg.hcsTopicId) return;

    const payload: AuditLine = { ...line, at: new Date().toISOString() };
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(cfg.hcsTopicId))
      .setMessage(JSON.stringify(payload))
      .execute(hcs);
    const receipt = await response.getReceipt(hcs);
    console.log(`HCS audit ${receipt.status.toString()} topic=${cfg.hcsTopicId} tx=${line.txId}`);
  } catch (err) {
    console.error("HCS audit failed (payment still settled):", err instanceof Error ? err.message : err);
  }
}

/**
 * Enqueue `{account, amountTinybars, txId}` on the configured HCS topic.
 * Serializes submits on one Client. Never throws. No-ops when HCS is unset.
 */
export function appendAudit(cfg: ServerConfig, line: Omit<AuditLine, "at">): void {
  queue = queue.then(
    () => writeAudit(cfg, line),
    () => writeAudit(cfg, line),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Drain the submit queue briefly, then close the SDK client. Does not wait forever. */
export async function closeHcs(): Promise<void> {
  try {
    await Promise.race([queue, delay(DRAIN_MS)]);
  } finally {
    client?.close();
    client = undefined;
  }
}
