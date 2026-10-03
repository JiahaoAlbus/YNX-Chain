export type BiometricProtectionReason = "hardware-unavailable" | "enrollment-required" | "strong-enrollment-required";
export class BiometricProtectionRequired extends Error {
  constructor(readonly reason: BiometricProtectionReason) {
    super(reason === "hardware-unavailable" ? "System biometric hardware is unavailable" : reason === "enrollment-required" ? "Enroll Face ID or a strong fingerprint before using Wallet keys" : "Strong system biometrics are required");
    this.name = "BiometricProtectionRequired";
  }
}
export interface BiometricCapabilities {
  hasHardwareAsync(): Promise<boolean>;
  isEnrolledAsync(): Promise<boolean>;
  getEnrolledLevelAsync(): Promise<number>;
  SecurityLevel: { BIOMETRIC_STRONG: number };
}
/** A capability check, never an approval or a substitute for cipher-bound authentication. */
export async function checkBiometricProtection(api: BiometricCapabilities, assertCurrent: () => void = () => {}): Promise<void> {
  assertCurrent();
  const hardware = await api.hasHardwareAsync(); assertCurrent();
  if (!hardware) throw new BiometricProtectionRequired("hardware-unavailable");
  const enrolled = await api.isEnrolledAsync(); assertCurrent();
  if (!enrolled) throw new BiometricProtectionRequired("enrollment-required");
  const level = await api.getEnrolledLevelAsync(); assertCurrent();
  if (level !== api.SecurityLevel.BIOMETRIC_STRONG) throw new BiometricProtectionRequired("strong-enrollment-required");
}
/** Check before generating recovery material; returning from Settings never invokes this by itself. */
export async function prepareProtectedWallet<T>(check: () => Promise<void>, generate: () => Promise<T>, assertCurrent: () => void, dispose: (value:T) => void = () => {}): Promise<T> {
  assertCurrent(); await check(); assertCurrent();
  const value = await generate();
  try { assertCurrent(); return value; } catch (caught) { dispose(value); throw caught; }
}
