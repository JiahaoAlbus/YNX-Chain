import assert from "node:assert/strict";
import test from "node:test";
import { installedMessageIs, passwordActionReady, passwordFormAction } from "../scripts/windows-password-form-state.mjs";
import { MESSAGES } from "../src/desktop-i18n.mjs";

test("installed setup waits for its visible action instead of treating early custody IPC as UI readiness", () => {
  assert.equal(passwordFormAction({ unlockEnabled: false, passwordSheetOpen: false }, false), null);
  assert.equal(passwordFormAction({ unlockEnabled: true, passwordSheetOpen: false }, false), "open");
});

test("wrong password can be corrected through the same interactive unlock dialog", () => {
  const wrongPasswordPending = { passwordSheetOpen: true, passwordModeUnlock: true, passwordSubmitEnabled: false, unlockEnabled: true };
  assert.equal(passwordFormAction(wrongPasswordPending, true), null);
  assert.equal(passwordFormAction({ ...wrongPasswordPending, passwordSubmitEnabled: true }, true), "submit-existing");
  assert.equal(passwordFormAction({ ...wrongPasswordPending, passwordSubmitEnabled: true }, false), "mode-mismatch");
  assert.equal(passwordFormAction({ ...wrongPasswordPending, passwordSheetOpen: false, unlockEnabled: false }, true), null);
});

test("Arabic display text does not change installed password action readiness", () => {
  const account = { initialized: true, passwordConfigured: true, account: "0x123" };
  const ui = { unlockEnabled: true, unlockLabel: "الفتح بكلمة المرور المحلية", passwordSheetOpen: false };
  assert.equal(passwordActionReady({ account, locked: true, error: null, ui }, true), true);
  assert.equal(passwordActionReady({ account, locked: false, error: null, ui }, true), false);
  assert.equal(passwordActionReady({ account, locked: true, error: { code: "STORAGE_UNAVAILABLE" }, ui }, true), false);
  assert.equal(passwordActionReady({ account: { ...account, passwordConfigured: false }, locked: true, error: null, ui }, true), false);
  assert.equal(passwordActionReady({ account: { initialized: false, passwordConfigured: false }, locked: true, error: null, ui }, false), true);
  assert.equal(passwordActionReady({ account, locked: true, error: null, ui: { ...ui, unlockEnabled: false } }, true), false);
});

test("installed backup result accepts the exact selected locale success message", () => {
  const key = "Encrypted backup saved. Keep its password separately.";
  assert.equal(installedMessageIs(MESSAGES[key].ar, key), true);
  assert.equal(installedMessageIs(MESSAGES[key]["zh-CN"], key), true);
  assert.equal(installedMessageIs("Backup was not saved.", key), false);
  const wrong = "The password is incorrect or this encrypted Wallet changed. It remains locked.";
  assert.equal(installedMessageIs(MESSAGES[wrong].ar, wrong), true);
});
