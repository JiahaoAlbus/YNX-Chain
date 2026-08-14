import * as LocalAuthentication from "expo-local-authentication";
import { authorizeLocalKeyUseWith, type AuthorizationPurpose, type LocalAuthenticationAdapter } from "./localAuthorizationPolicy";
export type { AuthorizationPurpose } from "./localAuthorizationPolicy";

const platformLocalAuthentication: LocalAuthenticationAdapter = Object.freeze({
  hasHardware: () => LocalAuthentication.hasHardwareAsync(),
  isEnrolled: () => LocalAuthentication.isEnrolledAsync(),
  enrolledLevel: () => LocalAuthentication.getEnrolledLevelAsync(),
  strongSecurityLevel: LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG,
  authenticate: (options) => LocalAuthentication.authenticateAsync(options),
});

export async function authorizeLocalKeyUse(purpose: AuthorizationPurpose): Promise<void> {
  return authorizeLocalKeyUseWith(platformLocalAuthentication, purpose);
}
