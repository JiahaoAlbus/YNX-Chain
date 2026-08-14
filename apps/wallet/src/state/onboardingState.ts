export type OnboardingMode = "closed" | "create" | "import" | "recover";
export type OnboardingPhase = "editing" | "saving";

export type OnboardingState = Readonly<{
  mode: OnboardingMode;
  phase: OnboardingPhase;
  label: string;
  recoveryKey: string;
  backupConfirmation: string;
}>;

export type OnboardingEvent =
  | Readonly<{ type: "openCreate"; recoveryKey: string; label: string }>
  | Readonly<{ type: "openImport" }>
  | Readonly<{ type: "openRecover" }>
  | Readonly<{ type: "editLabel"; value: string }>
  | Readonly<{ type: "editRecoveryKey"; value: string }>
  | Readonly<{ type: "editBackupConfirmation"; value: string }>
  | Readonly<{ type: "beginSave" }>
  | Readonly<{ type: "saveFailed" }>
  | Readonly<{ type: "close" | "background" | "saveSucceeded" }>;

export const initialOnboardingState: OnboardingState = Object.freeze({
  mode: "closed",
  phase: "editing",
  label: "",
  recoveryKey: "",
  backupConfirmation: "",
});

export function reduceOnboardingState(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  if (event.type === "close" || event.type === "background" || event.type === "saveSucceeded") return initialOnboardingState;
  if (state.phase === "saving") return event.type === "saveFailed" ? Object.freeze({ ...state, phase: "editing" }) : state;
  switch (event.type) {
    case "openCreate":
      assertRecoveryKey(event.recoveryKey);
      return Object.freeze({ mode: "create", phase: "editing", label: validLabel(event.label), recoveryKey: event.recoveryKey, backupConfirmation: "" });
    case "openImport":
      return Object.freeze({ mode: "import", phase: "editing", label: "Imported account", recoveryKey: "", backupConfirmation: "" });
    case "openRecover":
      return Object.freeze({ mode: "recover", phase: "editing", label: "Recovered account", recoveryKey: "", backupConfirmation: "" });
    case "editLabel": return state.mode === "closed" ? state : Object.freeze({ ...state, label: event.value });
    case "editRecoveryKey": return state.mode === "import" || state.mode === "recover" ? Object.freeze({ ...state, recoveryKey: event.value }) : state;
    case "editBackupConfirmation": return state.mode === "create" ? Object.freeze({ ...state, backupConfirmation: event.value }) : state;
    case "beginSave": {
      const saving=beginOnboardingSave(state);
      return Object.freeze({...saving,recoveryKey:"",backupConfirmation:""});
    }
    case "saveFailed": return state;
  }
}

export function canSaveOnboarding(state: OnboardingState): boolean {
  if (state.mode === "closed" || state.phase !== "editing") return false;
  if (!isValidLabel(state.label) || !isRecoveryKey(state.recoveryKey.trim())) return false;
  return state.mode !== "create" || state.backupConfirmation === "BACKED UP";
}

export function beginOnboardingSave(state: OnboardingState): OnboardingState {
  if (!canSaveOnboarding(state)) throw new Error("Onboarding cannot save until every security gate is satisfied");
  return Object.freeze({ ...state, phase: "saving" });
}

export function onboardingAccountInput(state: OnboardingState, createdAt: string) {
  if (state.phase !== "saving" || state.mode === "closed") throw new Error("Onboarding account material is unavailable outside an active save");
  return Object.freeze({
    secretHex: state.recoveryKey.trim().toLowerCase(),
    label: validLabel(state.label.trim()),
    createdAt,
    backupConfirmed: true,
  });
}

export function onboardingPublicState(state: OnboardingState) {
  return Object.freeze({
    mode: state.mode,
    phase: state.phase,
    labelLength: state.label.length,
    recoveryKeyPresent: state.recoveryKey.length > 0,
    backupConfirmationComplete: state.backupConfirmation === "BACKED UP",
  });
}

function isRecoveryKey(value: string): boolean { return /^[0-9a-fA-F]{64}$/.test(value); }
function assertRecoveryKey(value: string): void { if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Generated recovery key must be canonical lowercase hex"); }
function isValidLabel(value: string): boolean { const normalized = value.trim(); return normalized.length >= 1 && normalized.length <= 40; }
function validLabel(value: string): string { if (!isValidLabel(value)) throw new Error("Account label must contain 1 to 40 characters"); return value; }
