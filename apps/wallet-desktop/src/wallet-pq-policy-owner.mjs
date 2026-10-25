import {exactPQRecord} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {types} from 'node:util';
import {isCometPolicyObservation} from './original-policy-supplier/comet-projection.mjs';
import {decodeObservedPolicyOriginal} from './original-policy-supplier/operator-policy-original.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
/** App ownership of a foreign fixed-factory resource, NOT a source factory or
 * authority brand. Consume frozen PQ_ACCOUNT_POLICY_RESOURCE_R1.md exactly. */
export function retainPQPolicyResource(resource,{networkId,account,now}){
 let view,snapshot,raw,retired=false,closePass,closed=false,cleanupDebt=false,firstCause,firstCausePresent=false,cleanupCause,cleanupCausePresent=false;
 const retain=cause=>{if(!firstCausePresent){firstCause=cause;firstCausePresent=true;}};
 const cleanup=cause=>{cleanupDebt=true;if(!cleanupCausePresent){cleanupCause=cause;cleanupCausePresent=true;}};
 function assert(){
  if(retired||cleanupDebt)fail('PQ_POLICY_RESOURCE_RETIRED');
  if(resource.assertCurrent()!==undefined)fail('PQ_POLICY_CURRENT_INVALID');
  if(view){const at=now().toISOString();if(at<view.observedAt||at>=view.expiresAt)fail('PQ_POLICY_REVIEW_EXPIRED');}
 }
 function read(){
  assert();const original=resource.readOriginal();
  const v3=original?.version==='YNX-WALLET-TRANSACTION-POLICY/v3',comet=v3||original?.version==='YNX-WALLET-TRANSACTION-POLICY/v2';
  exactPQRecord(original,['version','networkId','nativeChainId','canonicalOwner','authorization','observedAt','expiresAt',...(comet?['observation']:[]),...(v3?['originalPolicy']:[])]);
  if(!['YNX-WALLET-TRANSACTION-POLICY/v1','YNX-WALLET-TRANSACTION-POLICY/v2','YNX-WALLET-TRANSACTION-POLICY/v3'].includes(original.version)||original.networkId!==networkId||original.nativeChainId!=='6423'||original.canonicalOwner!==account||!Object.isFrozen(original))fail('PQ_POLICY_ORIGINAL_INVALID');
  if(comet&&(!isCometPolicyObservation(original.observation)||original.observation.independentFinality!==false))fail('PQ_POLICY_ORIGINAL_INVALID');
  for(const field of ['observedAt','expiresAt'])if(typeof original[field]!=='string'||!Number.isFinite(Date.parse(original[field]))||new Date(original[field]).toISOString()!==original[field])fail('PQ_POLICY_ORIGINAL_INVALID');
  if(original.observedAt>=original.expiresAt)fail('PQ_POLICY_ORIGINAL_INVALID');
  const parsed=parsePQAccountAuthorization(original.authorization,{chainId:networkId,nativeChainId:'6423',owner:account});
  if(v3)decodeObservedPolicyOriginal(original.originalPolicy,parsed);
  const encoded=JSON.stringify(original);
  if(view&&(original!==view||encoded!==raw))fail('PQ_POLICY_ORIGINAL_CHANGED');
  if(snapshot)assertPQAuthorizationCurrent(snapshot,parsed);
  if(!view){view=original;snapshot=parsed;raw=encoded;}
  assert();return Object.freeze({snapshot,expiresAt:view.expiresAt});
 }
 async function recheck(){assert();if(await resource.recheck()!==undefined)fail('PQ_POLICY_RECHECK_INVALID');assert();return read();}
 function retire(...causes){
  if(causes.length)retain(causes[0]);if(retired)return;retired=true;
  try{if(resource.retire()!==undefined)fail('PQ_POLICY_RETIRE_INVALID');}catch(cause){cleanup(cause);}
 }
 function close(){
  if(closePass)return closePass;
  // Reserve BEFORE foreign retirement, so synchronous callbacks cannot cause
  // a second close/acquisition or erase a prior cleanup failure.
  let resolve,reject;closePass=new Promise((yes,no)=>{resolve=yes;reject=no;});retire();
  void (async()=>{
   try{if(await resource.join()!==undefined)fail('PQ_POLICY_JOIN_INVALID');if(await resource.close()!==undefined)fail('PQ_POLICY_CLOSE_INVALID');closed=true;if(cleanupDebt)throw cleanupCause;resolve();}
   catch(cause){cleanup(cause);reject(cause);}
  })();void closePass.catch(()=>{});return closePass;
 }
 function copyOriginalPolicyBytes(){
  read();if(view.version!=='YNX-WALLET-TRANSACTION-POLICY/v3'||typeof resource.copyOriginalPolicyBytes!=='function')fail('PQ_NATIVE_POLICY_ORIGINAL_NOT_SUPPLIED');
  const bytes=resource.copyOriginalPolicyBytes();
  if(!types.isUint8Array(bytes)||bytes.buffer instanceof SharedArrayBuffer||!bytes.byteLength||bytes.byteLength>8388608)fail('PQ_NATIVE_POLICY_ORIGINAL_NOT_SUPPLIED');
  const detached=Buffer.from(bytes);if(!detached.equals(Buffer.from(view.originalPolicy.utf8,'base64url')))fail('PQ_POLICY_ORIGINAL_CHANGED');read();return detached;
 }
 return Object.freeze({read,recheck,assert,retire,close,copyOriginalPolicyBytes,status:()=>Object.freeze({closed,cleanupDebt}),outcome:()=>Object.freeze({firstCausePresent,firstCause,cleanupCausePresent,cleanupCause})});
}
