import {preparePQAccountInitialTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const fail=code=>{throw Object.assign(Error(code),{code});};
/** Main-owned dedicated initial effect. Authority owns the genuine independent
 * Auth/Source lifetime. No permission factory, signature, retry or fallback. */
export function createPQAccountInitialBroadcast({intentStore,transport,isOriginalPermission}){
 return async({request,original,permission,guard})=>{
  if(typeof isOriginalPermission!=='function'||isOriginalPermission(permission)!==true||typeof transport?.submitAccountInitial!=='function'||typeof intentStore?.savePQAccountInitialSubmissionResult!=='function'||typeof guard?.submit!=='function'||typeof guard?.assertEffectCurrent!=='function')fail('PQ_INITIAL_BROADCAST_PERMISSION_REQUIRED');
  guard.assert();const plan=preparePQAccountInitialTransport(Buffer.from(original.wire,'base64url'),original.initialBinding);
  if(request.action!=='broadcast'||original.kind!=='pq-account-initial'||request.account!==guard.account||original.account!==guard.account||request.transportHash!==original.hash||request.abciTransactionHash!==original.abciTransactionHash||request.originalOperationId!==original.operationId||plan.transportHash!==request.transportHash)fail('PQ_INITIAL_BROADCAST_ORIGINAL_CHANGED');
  const current=()=>{guard.assertEffectCurrent();if(permission.assertCurrent()!==undefined)fail('PQ_INITIAL_BROADCAST_PERMISSION_REQUIRED');};
  let entered=false,submitted=false,returned=false,completed=false,failed=false,cause,callbackFailed=false,callbackCause;
  try{
   if(await permission.recheck()!==undefined)fail('PQ_INITIAL_BROADCAST_PERMISSION_REQUIRED');
   const marker=await intentStore.beginPQSubmission(guard.account,original.hash,()=>{guard.assert();permission.assertCurrent();});if(marker.created!==true)fail('PQ_INITIAL_ALREADY_SUBMITTED');entered=true;
   if(await permission.recheck()!==undefined||permission.enterBroadcast()!==undefined)fail('PQ_INITIAL_BROADCAST_PERMISSION_REQUIRED');guard.assert();
   await guard.submit(async()=>{
    try{current();submitted=true;const response=await transport.submitAccountInitial(plan.body,original.initialBinding,current);returned=true;
     // Capture inside the effect callback before any external late check.
     await intentStore.savePQAccountInitialSubmissionResult(guard.account,original.hash,response);
    }catch(error){callbackFailed=true;callbackCause=error;throw error;}
   });
   completed=true;if(permission.complete({outcome:'returned',transportHash:original.hash,abciTransactionHash:original.abciTransactionHash})!==undefined)fail('PQ_INITIAL_BROADCAST_COMPLETION_UNKNOWN');current();
   return intentStore.readPQProgress(guard.account,original.hash,current);
  }catch(error){failed=true;cause=callbackFailed?callbackCause:error;
   if(entered)try{await intentStore.savePQSubmissionFailure(guard.account,original.hash,cause);}catch{}
   if(submitted&&!completed)try{permission.complete({outcome:returned?'returned':'unknown',transportHash:original.hash,abciTransactionHash:original.abciTransactionHash});}catch{}
  }
  if(failed){if(submitted&&!returned)throw Object.assign(Error('PQ_INITIAL_SUBMISSION_UNKNOWN'),{code:'PQ_INITIAL_SUBMISSION_UNKNOWN',cause,data:{code:'PQ_INITIAL_SUBMISSION_UNKNOWN',transactionHash:original.hash,outcomeUnknown:true}});throw cause;}
 };
}
