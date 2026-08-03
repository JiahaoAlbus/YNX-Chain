import * as LocalAuthentication from "expo-local-authentication";

export type AuthorizationPurpose = "unlock" | "wallet-authorization" | "transaction-sign" | "recovery-view" | "account-import" | "account-delete";

const prompts: Record<AuthorizationPurpose, string> = {
  unlock: "Unlock YNX Wallet",
  "wallet-authorization": "Approve exact Sign in with YNX Wallet request",
  "transaction-sign": "Sign this reviewed YNXT transfer",
  "recovery-view": "View YNX Wallet recovery key",
  "account-import": "Import a YNX Wallet account",
  "account-delete": "Remove this account from YNX Wallet",
};

export async function authorizeLocalKeyUse(purpose: AuthorizationPurpose): Promise<void> {
  if (!await LocalAuthentication.hasHardwareAsync()) throw new Error("System biometric hardware is unavailable");
  if (!await LocalAuthentication.isEnrolledAsync()) throw new Error("Enroll Face ID or a strong fingerprint before using Wallet keys");
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level !== LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG) throw new Error("Strong system biometrics are required");
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: prompts[purpose],
    cancelLabel: "Cancel",
    disableDeviceFallback: true,
    fallbackLabel: "",
    requireConfirmation: true,
    biometricsSecurityLevel: "strong",
  });
  if (!result.success) throw new Error(result.error === "user_cancel" ? "Biometric authorization was cancelled" : "Biometric authorization failed");
}
