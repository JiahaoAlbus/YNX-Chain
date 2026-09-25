/** Decide which real, interactive password control an installed UI gate may use. */
import { MESSAGES } from "../src/desktop-i18n.mjs";

export function installedMessageIs(text, english) {
  return Object.values(MESSAGES[english] ?? { en: english }).includes(String(text ?? "").trim());
}

export function passwordFormAction(ui, expectedUnlock) {
  if (ui?.passwordSheetOpen === true) {
    if (ui.passwordModeUnlock !== expectedUnlock) return "mode-mismatch";
    return ui.passwordSubmitEnabled === true ? "submit-existing" : null;
  }
  return ui?.unlockEnabled === true ? "open" : null;
}

/** Locale-independent installed UI readiness, with the real control still required. */
export function passwordActionReady(state, expectedUnlock) {
  if (state?.error || state?.locked !== true || state?.account?.passwordConfigured !== expectedUnlock) return false;
  const action = passwordFormAction(state.ui, expectedUnlock);
  return action === "open" || action === "submit-existing";
}

/** 0.6.8 can discard its own error label after a rejected attempt closes the dialog. */
export function wrongPasswordRejected(state, expectedAccount, installedVersion) {
  if (state?.error || state?.locked !== true || state.account?.account !== expectedAccount || state.account?.initialized !== true || state.account?.passwordConfigured !== true) return false;
  const attempt = state.ui?.wrongPasswordAttempt;
  if (attempt?.submitObserved !== true || attempt.busyObserved !== true || state.ui?.unlockEnabled !== true) return false;
  const current = "The password is incorrect or this encrypted Wallet changed. It remains locked.";
  if ([state.ui.passwordResult, state.ui.unlockResult].some(value => installedMessageIs(value, current))) return true;
  const old = "The password is incorrect or the encrypted Wallet was changed.";
  return installedVersion === "0.6.8" && ([state.ui.passwordResult, state.ui.unlockResult].some(value => String(value ?? "").trim() === old) || attempt.settled === true && state.ui.passwordSheetOpen === false);
}
