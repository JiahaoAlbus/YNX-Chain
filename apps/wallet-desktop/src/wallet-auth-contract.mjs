import { readFileSync } from "node:fs";
import { parseProductSessionRegistry, YNX_EVM_CHAIN_ID as SHARED_EVM_CHAIN_ID, YNX_TESTNET_CHAIN_QUANTITY as SHARED_CHAIN_QUANTITY } from "@ynx-chain/wallet-auth";

// Desktop consumes the same Product Session v2 authority as the public Gateway.
export const WALLET_AUTH_PROTOCOL_SOURCE = Object.freeze({
  package: "@ynx-chain/wallet-auth",
  sourceCommit: "776b9ca8642f2e014d79dfad25a504f8ce9985f7",
  sourcePath: "packages/wallet-auth/src/product-session-v2.js",
  sourceSha256: "71f787fafc9544b28c4113d6704190e73ee99666bef6ff805219ee3725bd205e",
  protocol: "product-session-v2"
});

export const PRODUCT_SESSION_REGISTRY = parseProductSessionRegistry(JSON.parse(readFileSync(
  new URL("../product-session-registry.json", import.meta.resolve("@ynx-chain/wallet-auth")), "utf8"
)));
export const YNX_TESTNET_CHAIN_QUANTITY = SHARED_CHAIN_QUANTITY;
export const YNX_EVM_CHAIN_ID = SHARED_EVM_CHAIN_ID;
