#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { monitorPublicERC4337Deployment } from "../src/testnet-deployment-verifier.js";

if (process.env.YNX_WALLET_ERC4337_MONITOR !== "1") throw new Error("YNX_WALLET_ERC4337_MONITOR=1 is required for explicit public network access");
const manifestText = await readFile(required("YNX_WALLET_ERC4337_DEPLOYMENT_MANIFEST"), "utf8");
if (Buffer.byteLength(manifestText) > 1_048_576) throw new Error("deployment manifest exceeds 1 MiB");
const result = await monitorPublicERC4337Deployment({
  rpcEndpoint: required("YNX_EVM_RPC_URL"),
  bundlerEndpoint: required("YNX_ERC4337_BUNDLER_URL"),
  manifest: JSON.parse(manifestText),
  expectedSponsorshipEnabled: booleanFlag("YNX_PAYMASTER_EXPECT_SPONSORSHIP_ENABLED"),
  minimumDepositWei: requiredDecimal("YNX_PAYMASTER_MINIMUM_DEPOSIT_WEI"),
  maximumBlockAgeSeconds: optionalInteger("YNX_ERC4337_MAXIMUM_BLOCK_AGE_SECONDS", 60),
  timeoutMs: optionalInteger("YNX_ERC4337_MONITOR_TIMEOUT_MS", 10_000),
});
console.log(JSON.stringify(result, null, 2));
if (!result.healthy) process.exitCode = 2;

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function requiredDecimal(name) { const value = required(name); if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be canonical decimal`); return value; }
function booleanFlag(name) { const value = required(name); if (value === "1") return true; if (value === "0") return false; throw new Error(`${name} must be 0 or 1`); }
function optionalInteger(name, fallback) { const value = process.env[name]; if (value === undefined) return fallback; if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`); return Number(value); }
