// Actual original Service.effect -> same SQLite once/budget -> original
// registered executor -> exact receipt verification -> same transaction CAS.
// No network destination, raw input or caller context is accepted as approval.
import {OriginalTaskGrantAuthorityServiceKernel} from './original-task-grant-service.js';
import {bindGrantBytesDATA} from './original-bound-grant-policy.js';
import {encodeBoundGrant,encodeGrantEffect} from '@ynx-chain/open-protocol/bound-grant';
import{canonicalJSON}from'./canonical.js';const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const fail=c=>{throw Object.assign(Error(c),{code:c})};
const codec=Object.freeze({encodeBoundGrant,encodeGrantEffect});
const method=(v,n)=>{if(!v||typeof v[n]!=='function')fail('TASK_EFFECT_ORIGINAL_CALLEE_'+n);return v[n].bind(v);};
async function checked(v,n,...a){if(await method(v,n)(...a)!==undefined)fail('TASK_EFFECT_VERIFIER_RESULT');}
function syncChecked(v,n,...a){if(method(v,n)(...a)!==undefined)fail('TASK_EFFECT_SYNC_FENCE_REQUIRED');}
async function cleanupOriginalEffectTransport(v,operation){
 try{const result=await method(v,operation)();
  if(!result||typeof result.physicalDone!=='boolean'||typeof result.errorPresent!=='boolean')return{physicalDone:null,errorPresent:true,error:Object.assign(Error('TASK_EFFECT_TRANSPORT_CLOSE_STATUS_REQUIRED'),{code:'TASK_EFFECT_TRANSPORT_CLOSE_STATUS_REQUIRED'})};
  return{physicalDone:result.physicalDone,errorPresent:result.errorPresent,error:result.error};
 }catch(error){
  // Never infer physical closure from exception DATA. Only this SAME trusted
  // owner may independently witness it; preserve the exact thrown 0/null.
  let physicalDone=null;try{const witness=operation==='join'?'isJoined':'isClosed';if(typeof v[witness]==='function')physicalDone=v[witness]()===true;}catch{}
  return{physicalDone,errorPresent:true,error};
 }
}

// Constructed only from the actual original authority acquisition. This is a
// private normal service composition, NOT a Source registration endpoint.
export function createOriginalTaskEffectOrchestrator(inputs,current,clock=Date.now){
 const ledger=inputs?.store?.taskGrants;if(!ledger)fail('TASK_EFFECT_ORIGINAL_SQLITE_REQUIRED');
 if(inputs.store.taskGrantClockContract!=='ORIGINAL_SOURCE_LOCKED_CLOCK_V1')fail('TASK_EFFECT_ORIGINAL_LOCKED_CLOCK_REQUIRED');
 let retired=false;const alive=()=>{if(retired)fail('TASK_EFFECT_ORCHESTRATOR_RETIRED');};
 async function authorizeAtEffect(ctx,body){
  alive();await current();let actualOperation;
  const perCallerSource={
   async assertTaskCaller(c,...a){alive();if(c!==ctx)fail('TASK_EFFECT_ORIGINAL_CALLER_REFERENCE');await checked(inputs.source,'assertTaskCaller',c,...a);await current();},
   async acquireGrantEffect(g){
    let base=await method(inputs.source,'acquireGrantEffect')(g),inputOwner,input,prepared,scope,transportDebt;
    const refresh=async()=>{alive();await checked(base,'assertCurrent');await current();const c=await method(base,'readCurrent')();const db=ledger.budgetForTaskEffect({grant:g,step:g.binding,amount:c.budget.requested,at:clock()});return {...c,budget:db};};
    const close=async()=>{let first;for(const f of[()=>inputOwner?checked(inputOwner,'retire'):undefined,()=>inputOwner?checked(inputOwner,'join'):undefined,()=>inputOwner?checked(inputOwner,'close'):undefined,()=>{if(transportDebt)fail('TASK_EFFECT_TRANSPORT_CHILD_RETAINED');return checked(base,'close');}])try{await f();}catch(cause){first??={cause};}if(first)throw first.cause;};
    return {
     fenceKind:'EGRESS_FENCE_ONLY',readCurrent:refresh,assertCurrent:()=>checked(base,'assertCurrent'),verifyGrantProof:(...a)=>method(base,'verifyGrantProof')(...a),verifyHolderProof:(...a)=>method(base,'verifyHolderProof')(...a),verifyDisclosureAtEffect:(...a)=>method(base,'verifyDisclosureAtEffect')(...a),
     async commitAtEffectFence(expected,finalCheck){
      const c=await refresh();
      const reserveOriginal=()=>ledger.reserveTaskEffect({grant:g,step:g.binding,amount:c.budget.requested,inputBinding:g.binding.input,at:clock(),assertCurrent(){alive();syncChecked(base,'assertGrantAuthorityAtCommit',{issuerEpoch:c.issuer.epoch,holderEpoch:c.holder.epoch,task:c.task.ref,generation:c.task.generation,session:c.session.binding,policyRevision:c.policyRevision});finalCheck(c);}});
      // Persistence can narrow this request to recovery, never create authority.
      // Do not read protected input again for an already-owned/UNKNOWN slot.
      if(c.budget.ownState!==null){
       const old=reserveOriginal();actualOperation=old.operationId;scope='egress-only';
       if(!old.recoveryOnly){ledger.markEffectUnknown(old.ticket,clock());fail('TASK_EFFECT_RECOVERY_SLOT_CHANGED_UNKNOWN');}
       return {state:old.state,scope,effectRef:actualOperation,original:old.original,recoveryOnly:true};
      }
      // The raw original input is obtained from actual protected caller IO.
      // Registered protected-file input reader is one concrete implementation.
      const opened=await method(inputs.source,'readOriginalTaskEffectInput')(ctx,g,body.holderProof);inputOwner=opened?.owner;if(!opened||typeof opened.errorPresent!=='boolean')fail('TASK_EFFECT_INPUT_ACQUIRE_STATUS');if(opened.errorPresent)throw opened.error;
      input=Buffer.from(opened.bytes??[]);if(!same(bindGrantBytesDATA(input),g.binding.input))fail('TASK_EFFECT_RAW_INPUT_BINDING');await checked(inputOwner,'assertCurrent');
      const entries=inputs.registeredTaskExecutors;if(!Array.isArray(entries))fail('TASK_EFFECT_REGISTERED_EXECUTOR_UNAVAILABLE');const selected=entries.filter(v=>v&&same(v.target,g.binding.target));if(selected.length!==1)fail('TASK_EFFECT_REGISTERED_EXECUTOR_UNAVAILABLE');const executor=selected[0];
      // At the original same-SQL reserve transaction: verify original current
      // and invoke the shared policy's single final checker, not an HTTP bool.
      const reserved=reserveOriginal();
      actualOperation=reserved.operationId;scope='egress-only';
      if(reserved.recoveryOnly)return {state:reserved.state,scope,effectRef:actualOperation,original:reserved.original,recoveryOnly:true};
      let transport,returned,result,first,continuation,transportJoin,transportClose,settled=false;
      try{
       alive();await current();await checked(base,'assertCurrent');await checked(inputOwner,'assertCurrent');
       continuation=ledger.openOriginalTaskEffectContinuation(reserved.ticket,{grant:g,step:g.binding,operationId:actualOperation,amount:c.budget.requested,inputBinding:g.binding.input,at:clock(),assertCurrent(){alive();syncChecked(base,'assertGrantAuthorityAtCommit',{issuerEpoch:c.issuer.epoch,holderEpoch:c.holder.epoch,task:c.task.ref,generation:c.task.generation,session:c.session.binding,policyRevision:c.policyRevision});}});
       // The third PRIVATE operand is the SAME recognized in-memory owner.
       // It is not part of request DATA/JSON or reconstructed from query.
       // The registered backend must pair it with SAME base Source/caller;
       // only the final resource fence may claim it, never a read Current.
       returned=await method(executor,'executeOriginalTaskEffect')(ctx,{grant:g,step:g.binding,operationId:actualOperation,rawInput:input,holderProof:body.holderProof,expectedGrantRevision:g.rev},continuation);transport=returned?.owner;
       if(!returned||typeof returned.errorPresent!=='boolean')fail('TASK_EFFECT_EXECUTOR_STATUS_REQUIRED');if(returned.errorPresent)throw returned.error;
       const receipt=returned.result;if(!receipt||receipt.operationId!==actualOperation||!['COMMITTED','FAILED'].includes(receipt.state)||typeof receipt.original!=='string'||!receipt.original||Buffer.byteLength(receipt.original)>1048576)fail('TASK_EFFECT_ACTUAL_RECEIPT_UNRESOLVED');
       await checked(transport,'assertCurrent');await checked(base,'assertCurrent');await current();
       result=ledger.settleTaskEffect(reserved.ticket,{state:receipt.state,original:receipt.original,at:clock(),assertOriginalReceipt(expected){alive();syncChecked(inputs.source,'assertOriginalTaskEffectReceiptAtCommit',ctx,{...expected,grant:g});}});settled=true;
      }catch(cause){first={cause};if(!settled)try{ledger.markEffectUnknown(reserved.ticket,clock());}catch(error){first.persistenceError=error;}}
      if(transport){
       try{await checked(transport,'retire');}catch(cause){first??={cause};}
       transportJoin=await cleanupOriginalEffectTransport(transport,'join');
       if(transportJoin.errorPresent)first??={cause:transportJoin.error};
       transportClose=await cleanupOriginalEffectTransport(transport,'close');
       if(transportClose.errorPresent)first??={cause:transportClose.error};
       if(transportClose.physicalDone!==true){transportDebt=transport;first??={cause:Object.assign(Error('TASK_EFFECT_TRANSPORT_CLOSE_PENDING'),{code:'TASK_EFFECT_TRANSPORT_CLOSE_PENDING'})};}
      }
      if(continuation)try{if(transportDebt)ledger.retireOriginalTaskEffectContinuation(continuation);else ledger.closeOriginalTaskEffectContinuation(continuation);}catch(cause){first??={cause};}
      if(!first)try{alive();await checked(base,'assertCurrent');await current();if(BigInt(clock())>=BigInt(g.expires)||BigInt(clock())>=BigInt(c.expires))fail('TASK_EFFECT_POST_COMPLETION_EXPIRED');}catch(cause){first={cause};}
      if(first)throw Object.assign(Error('TASK_EFFECT_COMMIT_UNKNOWN'),{code:'TASK_EFFECT_COMMIT_UNKNOWN',cause:first.cause,persistenceError:first.persistenceError,partial:result??returned?.result??null,originalOp:actualOperation,recoverOnly:true,transportPhysicalDone:transportClose?.physicalDone??null,transportJoinPhysicalDone:transportJoin?.physicalDone??null,transportCleanupErrorPresent:transportClose?.errorPresent??false,transportCleanupError:transportClose?.error,cleanupOwner:transportDebt??null});
      return {state:result.state,scope,effectRef:actualOperation,original:result.original,recoveryOnly:false};
     },retire:()=>method(base,'retire')(),join:()=>method(base,'join')(),close
    };
   }
  };
  const service=new OriginalTaskGrantAuthorityServiceKernel(perCallerSource,inputs.store,codec,clock);const result=await service.authorizeAtEffect(ctx,body);
  if(!result.ok&&result.code==='UNKNOWN'){const {originalOp,...rest}=result;return Object.freeze({...rest,...(actualOperation?{originalOp:actualOperation}:{})});}
  return result;
 }
 return Object.freeze({authorizeAtEffect,retire(){retired=true;}});
}
