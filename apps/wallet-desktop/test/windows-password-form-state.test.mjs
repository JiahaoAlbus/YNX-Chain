import assert from "node:assert/strict";
import test from "node:test";
import { passwordFormAction } from "../scripts/windows-password-form-state.mjs";

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
