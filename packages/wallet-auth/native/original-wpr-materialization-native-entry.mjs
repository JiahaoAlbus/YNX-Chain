// Actual independent normal WPR pre-load must already be ready. Synchronous
// zeroarg callee; not installed-consumer loader or an injected provider.
import{acquireOriginalWPRMaterializationNativeStageV1}from'../src/original-auth-identity-fixed-native-image.js';
const capturedAcquire=acquireOriginalWPRMaterializationNativeStageV1;
export function acquireOriginalWPRMaterializationLoanV1(){
 if(arguments.length)throw Object.assign(Error('WPR_NATIVE_ENTRY_ZERO_ARGUMENTS'),{code:'WPR_NATIVE_ENTRY_ZERO_ARGUMENTS'});
 return capturedAcquire();
}
