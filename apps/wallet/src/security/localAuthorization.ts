import * as LocalAuthentication from "expo-local-authentication";

export type AuthorizationPurpose = "unlock" | "wallet-authorization" | "exchange-order" | "quant-strategy-action" | "dex-transaction" | "developer-contract-deployment" | "transaction-sign" | "recovery-view" | "account-import" | "account-delete";

const prompts: Record<AuthorizationPurpose, string> = {
  unlock: "Unlock YNX Wallet",
  "wallet-authorization": "Approve exact Sign in with YNX Wallet request",
  "exchange-order": "Approve this exact YNX Exchange Testnet order",
  "quant-strategy-action": "Approve this exact YNX Quant Testnet action",
  "dex-transaction": "Approve this exact YNX DEX Testnet transaction",
  "developer-contract-deployment": "Approve this exact YNX Developer contract deployment",
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
  console.info(`YNX_WALLET_BIOMETRIC_AUTH_REQUESTED purpose=${purpose} hardware=true enrolled=true securityLevel=BIOMETRIC_STRONG systemPromptDirectlyObserved=false`);
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: prompts[purpose],
    cancelLabel: "Cancel",
    disableDeviceFallback: true,
    fallbackLabel: "",
    requireConfirmation: true,
    biometricsSecurityLevel: "strong",
  });
  console.info(`YNX_WALLET_BIOMETRIC_AUTH_RESULT purpose=${purpose} success=${result.success}`);
  if (!result.success) throw new Error(result.error === "user_cancel" ? "Biometric authorization was cancelled" : "Biometric authorization failed");
}
