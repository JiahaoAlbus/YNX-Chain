import { readFileSync } from "node:fs";
import { parseProductSessionRegistry, YNX_EVM_CHAIN_ID as SHARED_EVM_CHAIN_ID, YNX_TESTNET_CHAIN_QUANTITY as SHARED_CHAIN_QUANTITY } from "@ynx-chain/wallet-auth";

// Exact Product Session v2 source bundled with this Desktop candidate.
export const WALLET_AUTH_PROTOCOL_SOURCE = Object.freeze({
  package: "@ynx-chain/wallet-auth",
  sourceCommit: "d817dfcf992d5383ae9acf793f0617df0bcf8d9c",
  sourcePath: "packages/wallet-auth/src/product-session-v2.js",
  sourceSha256: "7c4fb6bba0628c91feb704c1dd837db41a1a8f80b2972987817d57966e50ba75",
  protocol: "product-session-v2"
});

export const PRODUCT_SESSION_REGISTRY = parseProductSessionRegistry(JSON.parse(readFileSync(
  new URL("../product-session-registry.json", import.meta.resolve("@ynx-chain/wallet-auth")), "utf8"
)));
export const YNX_TESTNET_CHAIN_QUANTITY = SHARED_CHAIN_QUANTITY;
export const YNX_EVM_CHAIN_ID = SHARED_EVM_CHAIN_ID;
