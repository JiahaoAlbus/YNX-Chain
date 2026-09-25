/** Decide which real, interactive password control an installed UI gate may use. */
export function passwordFormAction(ui, expectedUnlock) {
  if (ui?.passwordSheetOpen === true) {
    if (ui.passwordModeUnlock !== expectedUnlock) return "mode-mismatch";
    return ui.passwordSubmitEnabled === true ? "submit-existing" : null;
  }
  return ui?.unlockEnabled === true ? "open" : null;
}
