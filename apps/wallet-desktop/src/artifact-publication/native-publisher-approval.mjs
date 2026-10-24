import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
/** Original private Main entry, not an IPC/provider factory. The caller hands
 * over the actual already-bound original SDK Native Source object. The same
 * App addon checks its own tag/env/thread/current and retains the original
 * parent. No Source snapshot, raw parent/key, module path, signer or clock is
 * accepted from JS. Module loading is lazy and fixed to the sole canonical
 * App image. Old images without this Main binding remain unavailable.
 * Return the original holder directly, including a partial/failed holder:
 * its first cause, once tombstone and explicit cleanup must not be discarded.
 */
export function captureOriginalWalletPublisherApproval(originalSource){
 if(process.platform!=='darwin')throw Object.assign(Error('Original Mac publication approval is unavailable.'),{code:'WALLET_PUBLISHER_NATIVE_PLATFORM_UNAVAILABLE'});
 const native=require('../../native/original-auth-identity.node');
 if(typeof native?.captureOriginalWalletPublisherApproval!=='function')throw Object.assign(Error('Original Main publication binding is not supplied.'),{code:'WALLET_PUBLISHER_NATIVE_BINDING_NOT_SUPPLIED'});
 return native.captureOriginalWalletPublisherApproval(originalSource);
}
