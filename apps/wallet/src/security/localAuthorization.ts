import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { authorizeLocalKeyUseWith, type AuthorizationPurpose, type LocalAuthenticationAdapter } from "./localAuthorizationPolicy";
import { LocalAuthorizationAttemptCoordinator } from "./localAuthorizationAttemptPolicy";
export type { AuthorizationPurpose } from "./localAuthorizationPolicy";

const platformLocalAuthentication: LocalAuthenticationAdapter = Object.freeze({
  hasHardware: () => LocalAuthentication.hasHardwareAsync(),
  isEnrolled: () => LocalAuthentication.isEnrolledAsync(),
  enrolledLevel: () => LocalAuthentication.getEnrolledLevelAsync(),
  strongSecurityLevel: LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG,
  authenticate: (options) => LocalAuthentication.authenticateAsync(options),
});

const attempts=new LocalAuthorizationAttemptCoordinator();

export function cancelLocalKeyAuthorization():void{
  const nativePromptActive=attempts.cancel();
  if(Platform.OS==="android"&&nativePromptActive)void LocalAuthentication.cancelAuthenticate().catch(()=>undefined);
}

export async function authorizeLocalKeyUse(purpose: AuthorizationPurpose): Promise<void> {
  const attempt=attempts.begin();
  const guarded:LocalAuthenticationAdapter=Object.freeze({
    strongSecurityLevel:platformLocalAuthentication.strongSecurityLevel,
    hasHardware:async()=>{attempts.assertActive(attempt);const result=await platformLocalAuthentication.hasHardware();attempts.assertActive(attempt);return result},
    isEnrolled:async()=>{attempts.assertActive(attempt);const result=await platformLocalAuthentication.isEnrolled();attempts.assertActive(attempt);return result},
    enrolledLevel:async()=>{attempts.assertActive(attempt);const result=await platformLocalAuthentication.enrolledLevel();attempts.assertActive(attempt);return result},
    authenticate:async(options)=>{const prompt=attempts.beginPrompt(attempt);try{const result=await platformLocalAuthentication.authenticate(options);attempts.assertActive(attempt);return result}finally{attempts.finishPrompt(prompt)}},
  });
  return authorizeLocalKeyUseWith(guarded,purpose);
}
