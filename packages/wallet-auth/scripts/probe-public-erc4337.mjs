#!/usr/bin/env node

import { probePublicERC4337Readiness } from "../src/public-erc4337-readiness.js";

if (process.env.YNX_WALLET_ERC4337_PUBLIC_PROBE !== "1") throw new Error("YNX_WALLET_ERC4337_PUBLIC_PROBE=1 is required for explicit public network access");

const result = await probePublicERC4337Readiness({
  rpcEndpoint: required("YNX_EVM_RPC_URL"),
  bundlerEndpoint: required("YNX_ERC4337_BUNDLER_URL"),
  entryPoint: process.env.YNX_ERC4337_ENTRYPOINT_ADDRESS,
  expectedRuntimeSha256: process.env.YNX_ERC4337_ENTRYPOINT_RUNTIME_SHA256,
  timeoutMs: optionalInteger("YNX_ERC4337_PROBE_TIMEOUT_MS", 10_000),
});
console.log(JSON.stringify(result, null, 2));
if (!result.ready) process.exitCode = 2;

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function optionalInteger(name, fallback) { const value = process.env[name]; if (value === undefined) return fallback; if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`); return Number(value); }
