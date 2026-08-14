#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";
import { inspectGatewayStateLock, recoverGatewayStateLock } from "../src/gateway-node-host.js";

try {
  const command = process.argv[2];
  if (command !== "inspect" && command !== "recover") fail("USAGE", "usage: ynx-wallet-gateway-state-lock inspect|recover");
  const statePath = required("YNX_WALLET_GATEWAY_STATE_PATH");

  if (command === "inspect") {
    process.stdout.write(`${canonicalJSON(inspectGatewayStateLock(statePath))}\n`);
  } else {
    const registryPath = process.env.YNX_WALLET_GATEWAY_REGISTRY_PATH
      ? resolve(process.env.YNX_WALLET_GATEWAY_REGISTRY_PATH)
      : fileURLToPath(new URL("../central-registry.json", import.meta.url));
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    const minimumAgeMs = integer(required("YNX_WALLET_GATEWAY_LOCK_MINIMUM_AGE_MS"), "YNX_WALLET_GATEWAY_LOCK_MINIMUM_AGE_MS");
    process.stdout.write(`${canonicalJSON(recoverGatewayStateLock(registry, { minimumAgeMs, now: () => new Date(), statePath }))}\n`);
  }
} catch (caught) {
  const commandCodes = new Set(["INVALID_POLICY", "MISSING_ENVIRONMENT", "USAGE"]);
  const exposed = caught instanceof WalletAuthError || commandCodes.has(caught?.code);
  const code = exposed ? caught.code : "LOCK_COMMAND_FAILED";
  const message = code === "LOCK_COMMAND_FAILED" ? "Canonical Gateway state lock command failed closed" : caught.message;
  process.stderr.write(`${canonicalJSON({ error: { code, message }, ok: false })}\n`);
  process.exitCode = 2;
}

function required(name) {
  const value = process.env[name];
  if (!value) fail("MISSING_ENVIRONMENT", `${name} is required`);
  return value;
}

function integer(value, label) {
  if (!/^[0-9]+$/.test(value)) fail("INVALID_POLICY", `${label} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail("INVALID_POLICY", `${label} is outside policy`);
  return parsed;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
