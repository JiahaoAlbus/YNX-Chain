import {isCometPolicyObservation} from './comet-projection.mjs';
import {assertSessionProjectionSupported} from './operator-projection.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
/** Explicit checkpoint kinds: AppHash is NOT a block hash or native durable
 * checkpoint. Old session/registered-binding contracts cannot consume it. */
export function operatorProjectionCheckpoint(view,mode){
 if(view.observation!==undefined){
  if(!isCometPolicyObservation(view.observation))fail('AUTH_POLICY_COMET_OBSERVATION_INVALID');
  if(mode!=='transaction')fail('AUTH_POLICY_COMET_CHECKPOINT_UNAVAILABLE');
  return Object.freeze({kind:view.observation.kind,height:view.committedHeight,appHash:view.committedAppHash});
 }
 return Object.freeze({kind:'trusted-node-committed/v1',height:view.committedHeight,blockHash:view.committedBlockHash});
}
export const operatorCheckpointIdentity=value=>value.kind==='comet-node-observed-app-state/v1'?value.appHash:value.blockHash;
/** Main-private transport DATA, not an authenticated source constructor. Only
 * openNormalOperatorSource supplies the normal pinned HTTP/health lifecycle. */
export function encodeOperatorPolicyPacket(mode,request,view,now,deadline){
 const checkpoint=operatorProjectionCheckpoint(view,mode),common={networkId:request.networkId,nativeChainId:'6423',canonicalOwner:request.owner,authorization:view.authorization};
 const times={observedAt:new Date(now).toISOString(),expiresAt:new Date(deadline).toISOString()};
 if(mode==='transaction')return JSON.stringify({version:view.observation?'YNX-WALLET-TRANSACTION-POLICY/v2':'YNX-WALLET-TRANSACTION-POLICY/v1',...common,...(view.observation?{observation:view.observation}:{}),...times});
 if(mode==='registered-binding')return JSON.stringify({version:'YNX-WALLET-REGISTERED-BINDING/v1',...common,committedHeight:view.committedHeight,committedBlockHash:view.committedBlockHash,checkpointIntegrity:view.checkpointIntegrity,...times});
 if(mode!=='session')fail('AUTH_POLICY_SOURCE_KIND');
 assertSessionProjectionSupported(view);const r=view.committedRecord;
 return JSON.stringify({version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:request.networkId,canonicalOwner:request.owner,checkpoint,policyVersion:view.authorization.enabled?'YNX-ACCOUNT-POLICY/v1':null,algorithmVersion:r?'YNX-BATCH/v0.1':'legacy',activeRecord:r?{revision:r.revision,registeredAt:r.registeredAt,activeFrom:r.activeFrom,pkA:r.pkA,pkB:r.pkB}:null,...times});
}
