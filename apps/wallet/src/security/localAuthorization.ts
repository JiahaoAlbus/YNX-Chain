import * as LocalAuthentication from "expo-local-authentication";
import { checkBiometricProtection } from "./biometricProtection";

export type AuthorizationPurpose = "unlock" | "wallet-authorization" | "transaction-sign" | "transaction-retry" | "recovery-view" | "account-import" | "account-delete" | "pending-removal-retry" | "wallet-reset" | "wallet-sessions-view" | "wallet-session-revoke";

const prompts: Record<AuthorizationPurpose, string> = {
  unlock: "Unlock YNX Wallet",
  "wallet-authorization": "Approve exact Sign in with YNX Wallet request",
  "transaction-sign": "Sign this reviewed YNXT transfer",
  "transaction-retry": "Resend only this original signed YNXT transfer",
  "recovery-view": "View YNX Wallet recovery key",
  "account-import": "Import a YNX Wallet account",
  "account-delete": "Remove this account from YNX Wallet",
  "pending-removal-retry": "Retry previously confirmed local account removals",
  "wallet-reset": "Reset the reviewed unreadable local Wallet",
  "wallet-sessions-view": "View connected apps for this Wallet account",
  "wallet-session-revoke": "Revoke this reviewed app session",
};

export async function assertStrongBiometrics(assertCurrent: () => void = () => {}): Promise<void> {
  await checkBiometricProtection(LocalAuthentication, assertCurrent);
}

export async function authorizeLocalKeyUse(purpose: AuthorizationPurpose): Promise<void> {
  await assertStrongBiometrics();
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
