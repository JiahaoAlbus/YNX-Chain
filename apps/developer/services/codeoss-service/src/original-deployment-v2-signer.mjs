import {loadBundledIdentitySDK} from '../../../desktop/identity-sdk-loader.mjs';
import {fault} from './central-identity.mjs';

// Backend composition only. HTTP input cannot choose an SDK, Source, Native
// owner, key or approval provider. The original zero-input factory owns those.
export function createOriginalDeploymentV2Signer({originalSDK,loadSDK=()=>loadBundledIdentitySDK('original-ide-deployment-v2')}={}) {
 const attempts=new Map();
 const snapshot=value=>value==null?null:structuredClone(value);
 function cleanup(attempt) {
  if(attempt.closed)return;
  if(!attempt.retired){attempt.owner.retire();attempt.retired=true;}
  // A pending join keeps the exact owner alive; never close or reacquire it.
  if(!attempt.joined){attempt.owner.join();attempt.joined=true;}
  if(attempt.closeSelected){if(attempt.closeFailed)throw attempt.closeError;return;}
  attempt.closeSelected=true;
  try {attempt.owner.close();attempt.closed=true;}
  catch(error){attempt.closeFailed=true;attempt.closeError=error;throw error;}
 }
 function publicError(first,partial,cleanupError,cleanupFailed) {
  const error=cleanupFailed?new AggregateError([first,cleanupError],'Original signing and cleanup require reconciliation.'):new Error('Original deployment signing did not complete.',{cause:first});
  error.code=first?.code??'IDE_DEPLOYMENT_V2_SIGNING_UNRESOLVED';
  error.partial=snapshot(partial);error.cleanupPending=cleanupFailed;error.retryAllowed=false;
  return error;
 }
 async function sign(operationID,payloadOriginal,actualArtifact,{signal,reserve,beforeSign,retainPartial}={}) {
  signal?.throwIfAborted();
  if(typeof operationID!=='string'||!operationID||!(payloadOriginal instanceof Uint8Array)||!(actualArtifact instanceof Uint8Array)||typeof reserve!=='function'||typeof beforeSign!=='function'||typeof retainPartial!=='function')throw TypeError('Exact original operation, bytes and backend journal hooks required.');
  if(attempts.has(operationID))throw fault('Reconcile the original signing attempt; do not sign again.','IDE_DEPLOYMENT_V2_SIGNING_RECONCILE_REQUIRED',409);
  const payload=Buffer.from(payloadOriginal),artifact=Buffer.from(actualArtifact),sdk=originalSDK??await loadSDK();
  signal?.throwIfAborted();
  if(typeof sdk?.acquireOriginalIDEDeploymentV2Signer!=='function')throw fault('Original V2 signing implementation is unavailable.','IDE_DEPLOYMENT_V2_IMPLEMENTATION_NOT_SUPPLIED',503);
  const acquired=sdk.acquireOriginalIDEDeploymentV2Signer();
  // Retain the nonnull partial owner BEFORE inspecting acquisition.error.
  const attempt={owner:acquired?.owner,partial:null,retired:false,joined:false,closeSelected:false,closeFailed:false,closed:false};
  if(attempt.owner==null)throw acquired?.error??fault('Dedicated original V2 Source required.','IDE_DEPLOYMENT_V2_ROOT_PROFILE_NOT_SUPPLIED',503);
  attempts.set(operationID,attempt);
  let failed=false,first,result;
  try {
   reserve();
   if(acquired.error!==null&&acquired.error!==undefined)throw acquired.error;
   signal?.throwIfAborted();await beforeSign();signal?.throwIfAborted();
   result=await attempt.owner.signOriginalE11(payload,artifact);
   attempt.partial=snapshot(result);retainPartial(snapshot(attempt.partial));
   signal?.throwIfAborted();
   if(result?.signed!==true||result.sourceGranted!==false||result.nativeAdmission!==false||result.deployed!==false||typeof result.memberOriginal!=='string'||!result.memberOriginal)throw fault('Original signed public member required.','IDE_DEPLOYMENT_V2_SIGNING_UNRESOLVED',503);
  }catch(error){
   failed=true;first=error;
   try {attempt.partial=snapshot(attempt.owner.status().partial);retainPartial(snapshot(attempt.partial));}
   catch(retainError){first=new AggregateError([error,retainError],'Original signing failure and partial retention failure.');}
  }
  let cleanupFailed=false,cleanupError;
  try {cleanup(attempt);}catch(error){cleanupFailed=true;cleanupError=error;}
  if(failed||cleanupFailed)throw publicError(failed?first:cleanupError,attempt.partial,cleanupError,cleanupFailed);
  return snapshot(result);
 }
 function finishCleanup(operationID) {
  const attempt=attempts.get(operationID);
  if(!attempt)throw fault('Original signing owner is not held in this process.','IDE_DEPLOYMENT_V2_CLEANUP_OWNER_NOT_HELD',409);
  cleanup(attempt);return Object.freeze({closed:attempt.closed,partial:snapshot(attempt.partial)});
 }
 return Object.freeze({sign,finishCleanup});
}
