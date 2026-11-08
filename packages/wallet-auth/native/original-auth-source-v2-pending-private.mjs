// DISTINCT pending-only compile composition. Same Source kernel, same fixed
// Core two-port math, same registered snapshot parser. No public provider seam.
import{createDeviceSourceKernelFromFixedParts}from'./original-auth-source-v2-device-kernel.mjs';
import{pendingDeviceScopeRegistry as scopeRegistry}from'./original-auth-source-v2-device-scopes-pending-private.mjs';
import{createOriginalSourceV2FixedCoreGates}from'./original-auth-source-v2-fixed-core-gates.mjs';
import{inspectPQAuthorizationView,originalPQSnapshotStateDATA}from'../src/pq-registered-snapshot-data.js';
export function createOriginalPendingDeviceSourceV2PrivateKernel(nativeObject){
 const core=createOriginalSourceV2FixedCoreGates(nativeObject);
 function verifyMath(role,frame,binding,bodyRaw,wire,snapshot,historical){
  const view=inspectPQAuthorizationView(snapshot),s=originalPQSnapshotStateDATA(snapshot),record=view.activeRecord;
  if(!snapshot.enabled||!view.pqSigningEnabled||!record||view.authorizationStatus==='revoked'||snapshot.networkId!==binding.networkId||snapshot.owner!==binding.owner)throw Object.assign(Error('PQ_REGISTERED_CONTEXT_MISMATCH'),{code:'PQ_REGISTERED_CONTEXT_MISMATCH'});
  if(record.revision!==binding.keyVersion)throw Object.assign(Error('PQ_REGISTERED_KEY_VERSION_MISMATCH'),{code:'PQ_REGISTERED_KEY_VERSION_MISMATCH'});
  return core(role,frame,binding,bodyRaw,wire,{observedHeight:snapshot.executionHeight,activeFrom:record.activeFrom,revokedAt:s.revocation?.revokedFrom??'0',pkA:record.pkA,pkB:record.pkB,enabled:snapshot.enabled,hasRevokedAt:s.revocation!==null},historical);
 }
 return createDeviceSourceKernelFromFixedParts(Object.freeze({scopeRegistry,verifyMath}));
}
