/**
 * Create an HCS topic for Fare payment audit lines.
 * Prints HCS_TOPIC_ID=… — does not write .env.
 *
 *   npm run hcs:topic
 */
import { AccountId, Client, PrivateKey, TopicCreateTransaction } from "@hiero-ledger/sdk";
import { loadServerConfig } from "../src/config.js";
import { hashscanTopicUrl } from "../src/hashscan.js";

async function main(): Promise<void> {
  const cfg = loadServerConfig();
  if (!cfg.operatorKey) {
    throw new Error("HEDERA_OPERATOR_KEY is required to create an HCS topic");
  }

  const client = cfg.network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  try {
    client.setOperator(AccountId.fromString(cfg.operatorId), PrivateKey.fromStringECDSA(cfg.operatorKey));

    const response = await new TopicCreateTransaction()
      .setTopicMemo("fare payment audit")
      .setAutoRenewAccountId(cfg.operatorId)
      .execute(client);
    const receipt = await response.getReceipt(client);
    const topicId = receipt.topicId?.toString();
    if (!topicId) {
      throw new Error(`topic create returned ${receipt.status.toString()} without a topic id`);
    }

    console.log(`HCS_TOPIC_ID=${topicId}`);
    console.log(hashscanTopicUrl(cfg.network, topicId));
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
