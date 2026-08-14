export type AuthorizationPurpose = "unlock" | "wallet-authorization" | "exchange-order" | "quant-strategy-action" | "dex-transaction" | "developer-contract-deployment" | "transaction-sign" | "recovery-view" | "account-import" | "account-delete" | "wallet-reset";

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
  "wallet-reset": "Reset unreadable YNX Wallet storage",
};

export type LocalAuthenticationAdapter = Readonly<{
  hasHardware(): Promise<boolean>;
  isEnrolled(): Promise<boolean>;
  enrolledLevel(): Promise<number>;
  strongSecurityLevel: number;
  authenticate(options: Readonly<{
    promptMessage: string;
    cancelLabel: "Cancel";
    disableDeviceFallback: true;
    fallbackLabel: "";
    requireConfirmation: true;
    biometricsSecurityLevel: "strong";
  }>): Promise<Readonly<{ success: boolean; error?: string }>>;
}>;

export async function authorizeLocalKeyUseWith(adapter: LocalAuthenticationAdapter, purpose: AuthorizationPurpose): Promise<void> {
  if (!Object.hasOwn(prompts, purpose)) throw new Error("Unknown Wallet biometric authorization purpose");
  if (!await adapter.hasHardware()) throw new Error("System biometric hardware is unavailable");
  if (!await adapter.isEnrolled()) throw new Error("Enroll Face ID or a strong fingerprint before using Wallet keys");
  const level = await adapter.enrolledLevel();
  if (level !== adapter.strongSecurityLevel) throw new Error("Strong system biometrics are required");
  const result = await adapter.authenticate({
    promptMessage: prompts[purpose],
    cancelLabel: "Cancel",
    disableDeviceFallback: true,
    fallbackLabel: "",
    requireConfirmation: true,
    biometricsSecurityLevel: "strong",
  });
  if (!result.success) throw new Error(result.error === "user_cancel" ? "Biometric authorization was cancelled" : "Biometric authorization failed");
}
