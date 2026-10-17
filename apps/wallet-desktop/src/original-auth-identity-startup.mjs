import {initializeOriginalAuthIdentityIDEPrivateStartup,originalAuthIdentityIDEStartupStatus} from '../../../packages/wallet-auth/src/original-auth-identity-private-joint-registration.js';
// Normal main supplies only the original same Vault, never a path, key,
// approving callback, renderer DTO or alternative module constructor.
export function initializeOriginalAuthIdentityStartup(vault){
 try{initializeOriginalAuthIdentityIDEPrivateStartup(vault);return originalAuthIdentityIDEStartupStatus(vault);}
 catch(error){if(error?.code!=='AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED')throw error;return originalAuthIdentityIDEStartupStatus(vault);}
}
