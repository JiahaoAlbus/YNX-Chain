// Same package-private consumer seam as original account-policy verification.
// No Native/Source/registration setter or public export. A Node-only original
// protocol module installs its actual AND consumer, never an arbitrary signer.
import {WalletAuthError} from './canonical.js';
let selected=null;
export function installOriginalProductSessionV4ReadConsumer(consume){
 if(typeof consume!=='function'||selected!==null&&selected!==consume)throw new WalletAuthError('PQ_DEVICE_CONSUMER_CONFLICT','Original version4 consumer already selected');selected=consume;
}
export function openOriginalProductSessionV4Read(options){
 if(selected===null)throw new WalletAuthError('PQ_NATIVE_BACKEND_REQUIRED','Original AND verifier is not supplied for this runtime; no classic fallback');return selected(options);
}
