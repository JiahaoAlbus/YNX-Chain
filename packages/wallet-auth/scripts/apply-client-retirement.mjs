#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { decodeGatewayBackupKey, retireGatewayClientState } from "../src/gateway-backup.js";
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";

try {
  const registryPath = required("YNX_WALLET_GATEWAY_REGISTRY_PATH");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const result = retireGatewayClientState({
    backupPath: required("YNX_WALLET_GATEWAY_RETIREMENT_BACKUP_PATH"),
    expectedStateDigest: required("YNX_WALLET_GATEWAY_EXPECT_STATE_DIGEST"),
    key: decodeGatewayBackupKey(required("YNX_WALLET_GATEWAY_BACKUP_KEY")),
    productId: required("YNX_WALLET_GATEWAY_RETIRE_PRODUCT_ID"),
    registry,
    statePath: required("YNX_WALLET_GATEWAY_STATE_PATH"),
    at: required("YNX_WALLET_GATEWAY_RETIRE_AT"),
  });
  process.stdout.write(`${canonicalJSON({ ok: true, ...result })}\n`);
} catch (caught) {
  const code = caught instanceof WalletAuthError ? caught.code : "INTERNAL";
  const message = caught instanceof WalletAuthError ? caught.message : "Canonical Gateway client retirement failed closed";
  process.stderr.write(`${canonicalJSON({ error: { code, message }, ok: false })}\n`);
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < 1) throw new WalletAuthError("INVALID_RETIREMENT", `${name} is required`);
  return value;
}
