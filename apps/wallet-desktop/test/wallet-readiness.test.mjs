import assert from "node:assert/strict";
import test from "node:test";
import { walletReadiness } from "../src/wallet-readiness.mjs";

test("cold setup, existing locked accounts and retained unreadable records lead to different safe actions", () => {
  const locked = { locked: true };
  assert.equal(walletReadiness(null, locked).state, "checking");
  assert.deepEqual(walletReadiness({ initialized: false, accounts: [], passwordConfigured: false }, locked), { state: "setup", title: "Set up Wallet protection", canPrepare: true });
  assert.equal(walletReadiness({ initialized: true, accounts: [{}], passwordConfigured: true }, locked).state, "locked");
  assert.equal(walletReadiness({ initialized: true, accounts: [{}] }, { locked: false }).state, "ready");
  for (const status of [{ initialized: false, accounts: [{}] }, { initialized: false, recoveryRequired: true }, { initialized: true, formatError: "PASSWORD_VAULT_INVALID" }]) {
    assert.equal(walletReadiness(status, locked).state, "recovery");
    assert.equal(walletReadiness(status, locked).canPrepare, false);
  }
  assert.equal(walletReadiness({ initialized: false, accounts: [] }, locked, true).canPrepare, false);
});
