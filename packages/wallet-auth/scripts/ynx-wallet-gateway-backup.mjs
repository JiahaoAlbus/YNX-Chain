#!/usr/bin/env node
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";
import {
  createGatewayStateBackup,
  decodeGatewayBackupKey,
  restoreGatewayStateBackup,
  verifyGatewayStateBackup,
} from "../src/gateway-backup.js";

const operation = process.argv[2];
if (!operation || process.argv.length !== 3 || !["create", "verify", "restore"].includes(operation)) {
  fail("INVALID_BACKUP_OPERATION", "Expected exactly one operation: create, verify or restore");
}

const backupPath = required("YNX_WALLET_GATEWAY_BACKUP_PATH");
const encodedKey = required("YNX_WALLET_GATEWAY_BACKUP_KEY_BASE64URL");
delete process.env.YNX_WALLET_GATEWAY_BACKUP_KEY_BASE64URL;

try {
  const key = decodeGatewayBackupKey(encodedKey);
  const policy = optionalPolicy(process.env);
  let result;
  if (operation === "create") {
    result = createGatewayStateBackup({
      backupPath,
      key,
      statePath: required("YNX_WALLET_GATEWAY_STATE_PATH"),
    });
  } else if (operation === "verify") {
    result = verifyGatewayStateBackup({ backupPath, key, ...policy });
  } else {
    result = restoreGatewayStateBackup({
      backupPath,
      key,
      statePath: required("YNX_WALLET_GATEWAY_STATE_PATH"),
      ...policy,
    });
  }
  process.stdout.write(`${canonicalJSON({ ok: true, operation, result })}\n`);
} catch (caught) {
  if (caught instanceof WalletAuthError) fail(caught.code, caught.message);
  fail("BACKUP_INTERNAL", "Canonical Gateway backup operation failed closed");
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) fail("MISSING_BACKUP_INPUT", `${name} is required`);
  return value;
}

function optionalPolicy(env) {
  const policy = {};
  if (env.YNX_WALLET_GATEWAY_BACKUP_MINIMUM_CREATED_AT !== undefined) {
    policy.minimumCreatedAt = env.YNX_WALLET_GATEWAY_BACKUP_MINIMUM_CREATED_AT;
  }
  if (env.YNX_WALLET_GATEWAY_BACKUP_MAX_AGE_MS !== undefined) {
    const value = env.YNX_WALLET_GATEWAY_BACKUP_MAX_AGE_MS;
    if (!/^[0-9]+$/.test(value)) fail("INVALID_BACKUP_POLICY", "YNX_WALLET_GATEWAY_BACKUP_MAX_AGE_MS must be a non-negative integer");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) fail("INVALID_BACKUP_POLICY", "YNX_WALLET_GATEWAY_BACKUP_MAX_AGE_MS is outside policy");
    policy.maxAgeMs = parsed;
  }
  return policy;
}

function fail(code, message) {
  process.stderr.write(`${canonicalJSON({ error: { code, message }, ok: false })}\n`);
  process.exit(1);
}
