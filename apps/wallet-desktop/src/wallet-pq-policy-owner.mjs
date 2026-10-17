import {exactPQRecord} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '@ynx-chain/wallet-auth/pq-wallet-policy';
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
  exactPQRecord(original,['version','networkId','nativeChainId','canonicalOwner','authorization','observedAt','expiresAt']);
  if(original.version!=='YNX-WALLET-TRANSACTION-POLICY/v1'||original.networkId!==networkId||original.nativeChainId!=='6423'||original.canonicalOwner!==account||!Object.isFrozen(original))fail('PQ_POLICY_ORIGINAL_INVALID');
  for(const field of ['observedAt','expiresAt'])if(typeof original[field]!=='string'||!Number.isFinite(Date.parse(original[field]))||new Date(original[field]).toISOString()!==original[field])fail('PQ_POLICY_ORIGINAL_INVALID');
  if(original.observedAt>=original.expiresAt)fail('PQ_POLICY_ORIGINAL_INVALID');
  const parsed=parsePQAccountAuthorization(original.authorization,{chainId:networkId,nativeChainId:'6423',owner:account});
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
 return Object.freeze({read,recheck,assert,retire,close,status:()=>Object.freeze({closed,cleanupDebt}),outcome:()=>Object.freeze({firstCausePresent,firstCause,cleanupCausePresent,cleanupCause})});
}
