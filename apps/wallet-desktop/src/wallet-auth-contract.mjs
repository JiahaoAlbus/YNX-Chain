import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseProductSessionRegistry, YNX_EVM_CHAIN_ID as SHARED_EVM_CHAIN_ID, YNX_TESTNET_CHAIN_QUANTITY as SHARED_CHAIN_QUANTITY } from "@ynx-chain/wallet-auth";

// Preserve the prior installed source and the exact A-issued compatible SDK.
// Unknown bytes fail closed rather than claiming an old source receipt.
const reviewedProtocolSources = Object.freeze({
  "7435a65bedac4fc6abd7d36a07cb8ab4c4ab957841475a36819a43b442b67130": "529471f3822d2bac43ea47a1ab8004fa2ae79885",
  "96d27a2a18c538725278db45675cf96a1ccc3f3d0f5af14b9950dd6334594a41": "1d4201b1a462dfd7b879fa810d2e3bd43a8642b1",
});
const sourceSha256 = createHash("sha256").update(readFileSync(new URL("./product-session-v2.js", import.meta.resolve("@ynx-chain/wallet-auth")))).digest("hex");
const sourceCommit = reviewedProtocolSources[sourceSha256];
if (!sourceCommit) throw new Error("The packaged Wallet authorization protocol has no reviewed source receipt.");
export const WALLET_AUTH_PROTOCOL_SOURCE = Object.freeze({
  package: "@ynx-chain/wallet-auth",
  sourceCommit,
  sourcePath: "packages/wallet-auth/src/product-session-v2.js",
  sourceSha256,
  protocol: "product-session-v2"
});

export const PRODUCT_SESSION_REGISTRY = parseProductSessionRegistry(JSON.parse(readFileSync(
  new URL("../product-session-registry.json", import.meta.resolve("@ynx-chain/wallet-auth")), "utf8"
)));
export const YNX_TESTNET_CHAIN_QUANTITY = SHARED_CHAIN_QUANTITY;
export const YNX_EVM_CHAIN_ID = SHARED_EVM_CHAIN_ID;
