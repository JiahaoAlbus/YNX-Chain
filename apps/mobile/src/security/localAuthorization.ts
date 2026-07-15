import type {
  LocalAuthenticationError,
  LocalAuthenticationOptions,
  LocalAuthenticationResult,
  SecurityLevel,
} from "expo-local-authentication";

export type LocalKeyPurpose =
  | "ownership-proof"
  | "signed-post"
  | "signed-social-action"
  | "native-transfer"
  | "device-revocation"
  | "device-rotation"
  | "recovery-key"
  | "identity-import"
  | "identity-removal";

export type LocalAuthorizationFailure = "unavailable" | "not-enrolled" | "cancelled" | "failed" | "locked-out";

export class LocalAuthorizationError extends Error {
  readonly code: LocalAuthorizationFailure;

  constructor(code: LocalAuthorizationFailure, message: string) {
    super(message);
    this.name = "LocalAuthorizationError";
    this.code = code;
  }
}

export type LocalAuthenticationAdapter = {
  hasHardwareAsync: () => Promise<boolean>;
  isEnrolledAsync: () => Promise<boolean>;
  getEnrolledLevelAsync: () => Promise<SecurityLevel>;
  authenticateAsync: (options?: LocalAuthenticationOptions) => Promise<LocalAuthenticationResult>;
};

export const BIOMETRIC_WEAK = 2 as SecurityLevel;
export const BIOMETRIC_STRONG = 3 as SecurityLevel;

const prompts: Record<LocalKeyPurpose, string> = {
  "ownership-proof": "Authorize YNX account connection",
  "signed-post": "Authorize signed YNX post",
  "signed-social-action": "Authorize signed YNX social action",
  "native-transfer": "Authorize YNXT transfer",
  "device-revocation": "Authorize YNX device revocation",
  "device-rotation": "Authorize YNX Chat device rotation",
  "recovery-key": "Authorize recovery key access",
  "identity-import": "Authorize recovery key import",
  "identity-removal": "Authorize identity removal",
};

export type LocalKeyAuthorizer = (purpose: LocalKeyPurpose) => Promise<void>;

export async function authorizeLocalKeyUse(
  purpose: LocalKeyPurpose,
  adapter?: LocalAuthenticationAdapter,
): Promise<void> {
  let native: LocalAuthenticationAdapter;
  try {
    native = adapter ?? await import("expo-local-authentication");
  } catch {
    throw failure("unavailable");
  }
  let hasHardware: boolean;
  let enrolled: boolean;
  let level: SecurityLevel;
  try {
    hasHardware = await native.hasHardwareAsync();
    if (!hasHardware) throw failure("unavailable");
    enrolled = await native.isEnrolledAsync();
    if (!enrolled) throw failure("not-enrolled");
    level = await native.getEnrolledLevelAsync();
  } catch (error) {
    if (error instanceof LocalAuthorizationError) throw error;
    throw failure("unavailable");
  }
  if (level !== BIOMETRIC_STRONG) throw failure("unavailable");

  let result: LocalAuthenticationResult;
  try {
    result = await native.authenticateAsync({
      promptMessage: prompts[purpose],
      cancelLabel: "Cancel",
      disableDeviceFallback: true,
      fallbackLabel: "",
      requireConfirmation: true,
      biometricsSecurityLevel: "strong",
    });
  } catch {
    throw failure("failed");
  }
  if (result.success) return;
  throw failure(mapError(result.error));
}

function mapError(error: LocalAuthenticationError): LocalAuthorizationFailure {
  switch (error) {
    case "not_available":
    case "passcode_not_set":
      return "unavailable";
    case "not_enrolled":
      return "not-enrolled";
    case "user_cancel":
    case "app_cancel":
    case "system_cancel":
    case "user_fallback":
      return "cancelled";
    case "lockout":
      return "locked-out";
    default:
      return "failed";
  }
}

function failure(code: LocalAuthorizationFailure): LocalAuthorizationError {
  const messages: Record<LocalAuthorizationFailure, string> = {
    unavailable: "Strong biometric authorization is unavailable on this device.",
    "not-enrolled": "Enroll a fingerprint or Face ID before using local YNX account keys.",
    cancelled: "Biometric authorization was cancelled.",
    failed: "Biometric authorization failed. Try again.",
    "locked-out": "Biometric authorization is locked. Unlock biometrics in system settings before continuing.",
  };
  return new LocalAuthorizationError(code, messages[code]);
}
