import {randomUUID,createHash} from 'node:crypto';
import {createContractScopeFence} from './contract-relay-scope.mjs';
import {contractBroadcastReferenceId} from './wallet-contract-reference-journal.mjs';
const fail=()=>Object.assign(Error('Review the current project contract call again.'),{code:'IDE_CONTRACT_EXECUTION_REVIEW_REQUIRED'});
// Project-owned request orchestration only. The canonical SDK owns payload
// encoding; the original Wallet separately approves signing and broadcasting.
export function createProjectContractExecution({relayAuthority,loadExecutionCodec,now=Date.now}){
 const scopeCurrent=createContractScopeFence({relayAuthority,now});let retired=false,busy=false,draft;
 async function current(){if(retired)throw fail();await scopeCurrent();if(retired)throw fail();}
 async function exclusive(work){if(busy)throw fail();busy=true;try{return await work();}finally{busy=false;}}
 return Object.freeze({
  preview(payload){return exclusive(async()=>{
   draft=undefined;await current();const codec=await loadExecutionCodec();await current();
   if(typeof codec?.encodePQNativeActionPayload!=='function'||typeof codec?.decodePQNativeActionPayload!=='function')throw fail();
   // SDK rejects extra owner/nonce/signer/transport fields and unknown targets.
   // Encode before awaiting anything else, then retain only its decoded copy.
   const wire=codec.encodePQNativeActionPayload('contract_execute',payload);
   const normalized=codec.decodePQNativeActionPayload('contract_execute',wire);
   await current();
   draft={id:randomUUID(),referenceId:randomUUID(),payload:normalized,entered:false,prepared:false};
   return {draftId:draft.id,referenceId:draft.referenceId,broadcastReferenceId:contractBroadcastReferenceId(draft.referenceId),review:{...structuredClone(normalized),kind:'contract_execute',fee:'2',payloadSHA256:createHash('sha256').update(wire).digest('hex')},authorized:false,submitted:false};
  });},
  prepare(draftId,client){return exclusive(async()=>{await current();const selected=draft;if(!selected||selected.id!==draftId||selected.entered||typeof client?.prepareExecution!=='function')throw fail();selected.entered=true;
   const result=await client.prepareExecution({referenceId:selected.referenceId,payload:structuredClone(selected.payload)});await current();if(draft!==selected)throw fail();selected.prepared=true;return result;
  });},
  broadcast(referenceId,client){return exclusive(async()=>{await current();const selected=draft;if(!selected||selected.referenceId!==referenceId||!selected.prepared||typeof client?.broadcastExecution!=='function')throw fail();const result=await client.broadcastExecution(referenceId);await current();return result;});},
  close(){retired=true;draft=undefined;},
 });
}
