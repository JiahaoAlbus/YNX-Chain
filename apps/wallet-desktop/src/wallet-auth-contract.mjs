import { readFileSync } from "node:fs";
import { parseProductSessionRegistry, YNX_EVM_CHAIN_ID as SHARED_EVM_CHAIN_ID, YNX_TESTNET_CHAIN_QUANTITY as SHARED_CHAIN_QUANTITY } from "@ynx-chain/wallet-auth";

// Exact Product Session v2 source bundled with this Desktop candidate.
export const WALLET_AUTH_PROTOCOL_SOURCE = Object.freeze({
  package: "@ynx-chain/wallet-auth",
  sourceCommit: "25cede8d186bc7a44d01c41ee3e63e592d7a9539",
  sourcePath: "packages/wallet-auth/src/product-session-v2.js",
  sourceSha256: "96d27a2a18c538725278db45675cf96a1ccc3f3d0f5af14b9950dd6334594a41",
  protocol: "product-session-v2"
});

export const PRODUCT_SESSION_REGISTRY = parseProductSessionRegistry(JSON.parse(readFileSync(
  new URL("../product-session-registry.json", import.meta.resolve("@ynx-chain/wallet-auth")), "utf8"
)));
export const YNX_TESTNET_CHAIN_QUANTITY = SHARED_CHAIN_QUANTITY;
export const YNX_EVM_CHAIN_ID = SHARED_EVM_CHAIN_ID;
