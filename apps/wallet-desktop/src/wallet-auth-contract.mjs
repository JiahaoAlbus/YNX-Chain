import { readFileSync } from "node:fs";
import { parseProductSessionRegistry, YNX_EVM_CHAIN_ID as SHARED_EVM_CHAIN_ID, YNX_TESTNET_CHAIN_QUANTITY as SHARED_CHAIN_QUANTITY } from "@ynx-chain/wallet-auth";

// Exact Product Session v2 source bundled with this Desktop candidate.
export const WALLET_AUTH_PROTOCOL_SOURCE = Object.freeze({
  package: "@ynx-chain/wallet-auth",
  sourceCommit: "529471f3822d2bac43ea47a1ab8004fa2ae79885",
  sourcePath: "packages/wallet-auth/src/product-session-v2.js",
  sourceSha256: "7435a65bedac4fc6abd7d36a07cb8ab4c4ab957841475a36819a43b442b67130",
  protocol: "product-session-v2"
});

export const PRODUCT_SESSION_REGISTRY = parseProductSessionRegistry(JSON.parse(readFileSync(
  new URL("../product-session-registry.json", import.meta.resolve("@ynx-chain/wallet-auth")), "utf8"
)));
export const YNX_TESTNET_CHAIN_QUANTITY = SHARED_CHAIN_QUANTITY;
export const YNX_EVM_CHAIN_ID = SHARED_EVM_CHAIN_ID;
