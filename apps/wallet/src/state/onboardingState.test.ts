import assert from "node:assert/strict";
import { test } from "node:test";
import { beginOnboardingSave, canSaveOnboarding, initialOnboardingState, onboardingAccountInput, onboardingPublicState, reduceOnboardingState } from "./onboardingState";

const SECRET = "ab".repeat(32);

test("create requires an exact offline-backup confirmation before secure persistence", () => {
  let state = reduceOnboardingState(initialOnboardingState, { type: "openCreate", recoveryKey: SECRET, label: "Account 1" });
  assert.equal(canSaveOnboarding(state), false);
  state = reduceOnboardingState(state, { type: "editBackupConfirmation", value: "BACKED UP" });
  const saving = beginOnboardingSave(state);
  assert.deepEqual(onboardingAccountInput(saving, "2026-08-14T12:00:00.000Z"), {
    secretHex: SECRET,
    label: "Account 1",
    createdAt: "2026-08-14T12:00:00.000Z",
    backupConfirmed: true,
  });
});

test("import and replacement recovery accept canonical material but expose only redacted state", () => {
  for (const type of ["openImport", "openRecover"] as const) {
    let state = reduceOnboardingState(initialOnboardingState, { type });
    state = reduceOnboardingState(state, { type: "editRecoveryKey", value: `  ${SECRET.toUpperCase()}  ` });
    assert.equal(canSaveOnboarding(state), true);
    const serialized = JSON.stringify(onboardingPublicState(state));
    assert.equal(serialized.includes(SECRET), false);
    assert.equal(serialized.includes(SECRET.toUpperCase()), false);
    assert.equal(onboardingAccountInput(beginOnboardingSave(state), "2026-08-14T12:00:00.000Z").secretHex, SECRET);
  }
});

test("background, close and success wipe every secret-bearing onboarding field", () => {
  for (const terminal of ["background", "close", "saveSucceeded"] as const) {
    let state = reduceOnboardingState(initialOnboardingState, { type: "openRecover" });
    state = reduceOnboardingState(state, { type: "editRecoveryKey", value: SECRET });
    state = reduceOnboardingState(state, { type: terminal });
    assert.deepEqual(state, initialOnboardingState);
    assert.equal(JSON.stringify(state).includes(SECRET), false);
  }
});

test("saving immediately redacts React secret state and blocks edits until success or failure", () => {
  let state = reduceOnboardingState(initialOnboardingState, { type: "openImport" });
  state = reduceOnboardingState(state, { type: "editRecoveryKey", value: SECRET });
  state = reduceOnboardingState(state, { type: "beginSave" });
  assert.equal(state.phase, "saving");
  assert.equal(state.recoveryKey,"");
  assert.equal(JSON.stringify(state).includes(SECRET),false);
  assert.equal(reduceOnboardingState(state, { type: "editRecoveryKey", value: "00" }).recoveryKey, "");
  assert.equal(reduceOnboardingState(state, { type: "openRecover" }).mode, "import");
  assert.equal(reduceOnboardingState(state, { type: "beginSave" }), state);
  const failed=reduceOnboardingState(state, { type: "saveFailed" });
  assert.equal(failed.phase, "editing");
  assert.equal(failed.recoveryKey,"");
});
