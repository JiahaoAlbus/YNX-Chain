#!/usr/bin/env node
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";
import { recoverStaleSponsorshipStateLock } from "../src/sponsorship-ledger-node.js";

try {
  if (process.argv[2] !== "recover" || process.argv.length !== 3) fail("USAGE", "usage: ynx-wallet-sponsorship-state-lock recover");
  const statePath = required("YNX_WALLET_SPONSORSHIP_STATE_PATH");
  const minimumAgeMs = integer(required("YNX_WALLET_SPONSORSHIP_LOCK_MINIMUM_AGE_MS"), "YNX_WALLET_SPONSORSHIP_LOCK_MINIMUM_AGE_MS");
  process.stdout.write(`${canonicalJSON(recoverStaleSponsorshipStateLock(statePath, { minimumAgeMs }))}\n`);
} catch (caught) {
  const commandCodes = new Set(["INVALID_POLICY", "MISSING_ENVIRONMENT", "USAGE"]);
  const exposed = caught instanceof WalletAuthError || commandCodes.has(caught?.code);
  const code = exposed ? caught.code : "SPONSORSHIP_LOCK_COMMAND_FAILED";
  const message = code === "SPONSORSHIP_LOCK_COMMAND_FAILED" ? "Sponsorship authorization state lock command failed closed" : caught.message;
  process.stderr.write(`${canonicalJSON({ error: { code, message }, ok: false })}\n`);
  process.exitCode = 2;
}

function required(name) { const value = process.env[name]; if (!value) fail("MISSING_ENVIRONMENT", `${name} is required`); return value; }
function integer(value, label) { if (!/^[0-9]+$/.test(value)) fail("INVALID_POLICY", `${label} must be a non-negative integer`); const parsed = Number(value); if (!Number.isSafeInteger(parsed)) fail("INVALID_POLICY", `${label} is outside policy`); return parsed; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
