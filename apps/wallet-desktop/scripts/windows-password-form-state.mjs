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
