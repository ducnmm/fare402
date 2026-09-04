import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

export type HederaNetworkName = "testnet" | "mainnet";
export type HederaCaip = `hedera:${HederaNetworkName}`;

const DEFAULT_FACILITATOR: Record<HederaNetworkName, string> = {
  testnet: "https://api.testnet.blocky402.com",
  mainnet: "https://api.blocky402.com",
};

const DEFAULT_MIRROR: Record<HederaNetworkName, string> = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
};

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required env ${name}`);
  }
  return trimmed;
}

function networkName(): HederaNetworkName {
  const raw = (process.env.HEDERA_NETWORK ?? "testnet").trim().toLowerCase();
  if (raw === "testnet" || raw === "mainnet") return raw;
  throw new Error(`HEDERA_NETWORK must be testnet or mainnet, got ${raw}`);
}

function networkFields(): { network: HederaNetworkName; caipNetwork: HederaCaip } {
  const network = networkName();
  return { network, caipNetwork: `hedera:${network}` };
}

export type ServerConfig = {
  network: HederaNetworkName;
  caipNetwork: HederaCaip;
  operatorId: string;
  operatorKey: string | undefined;
  facilitatorUrl: string;
  mirrorNodeUrl: string;
  hcsTopicId: string | undefined;
  port: number;
  host: string;
};

export type ClientConfig = {
  network: HederaNetworkName;
  caipNetwork: HederaCaip;
  operatorId: string | undefined;
  payerId: string;
  payerKey: string;
  baseUrl: string;
};

export function loadServerConfig(): ServerConfig {
  const { network, caipNetwork } = networkFields();
  return {
    network,
    caipNetwork,
    operatorId: required("HEDERA_OPERATOR_ID", process.env.HEDERA_OPERATOR_ID),
    operatorKey: process.env.HEDERA_OPERATOR_KEY?.trim() || undefined,
    facilitatorUrl: process.env.BLOCKY402_FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR[network],
    mirrorNodeUrl: (process.env.MIRROR_NODE_URL?.trim() || DEFAULT_MIRROR[network]).replace(/\/$/, ""),
    hcsTopicId: process.env.HCS_TOPIC_ID?.trim() || undefined,
    port: Number.parseInt(process.env.PORT ?? "4021", 10) || 4021,
    host: process.env.HOST?.trim() || "0.0.0.0",
  };
}

export function loadClientConfig(): ClientConfig {
  const { network, caipNetwork } = networkFields();
  return {
    network,
    caipNetwork,
    operatorId: process.env.HEDERA_OPERATOR_ID?.trim() || undefined,
    payerId: required("HEDERA_PAYER_ID", process.env.HEDERA_PAYER_ID),
    payerKey: required("HEDERA_PAYER_KEY", process.env.HEDERA_PAYER_KEY),
    baseUrl: (process.env.FARE_BASE_URL?.trim() || `http://localhost:${process.env.PORT ?? "4021"}`).replace(/\/$/, ""),
  };
}
