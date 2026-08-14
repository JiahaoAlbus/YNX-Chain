#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { verifyPublicERC4337Deployment } from "../src/testnet-deployment-verifier.js";

if (process.env.YNX_WALLET_ERC4337_DEPLOYMENT_VERIFY !== "1") throw new Error("YNX_WALLET_ERC4337_DEPLOYMENT_VERIFY=1 is required for explicit public network access");
const manifestText = await readFile(required("YNX_WALLET_ERC4337_DEPLOYMENT_MANIFEST"), "utf8");
if (Buffer.byteLength(manifestText) > 1_048_576) throw new Error("deployment manifest exceeds 1 MiB");
const result = await verifyPublicERC4337Deployment({
  rpcEndpoint: required("YNX_EVM_RPC_URL"),
  bundlerEndpoint: required("YNX_ERC4337_BUNDLER_URL"),
  manifest: JSON.parse(manifestText),
  timeoutMs: optionalInteger("YNX_ERC4337_VERIFY_TIMEOUT_MS", 10_000),
});
console.log(JSON.stringify(result, null, 2));
if (!result.ready) process.exitCode = 2;

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function optionalInteger(name, fallback) { const value = process.env[name]; if (value === undefined) return fallback; if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`); return Number(value); }
