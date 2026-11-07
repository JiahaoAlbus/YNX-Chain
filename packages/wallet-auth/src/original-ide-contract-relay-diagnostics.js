// Bounded diagnostics only. No Native call, Source acquisition or authorization.
import {types} from 'node:util';
const stages=new Set(["NATIVE_LOAD", "NATIVE_EXPORTS", "NATIVE_ACQUIRE", "NATIVE_ACQUIRE_EMPTY", "SCOPE_INITIAL", "CURRENT_INITIAL", "SCOPE_RECHECK", "CURRENT_LIVE"]);
const codes=new Set(["ERR_DLOPEN_FAILED", "ERR_REQUIRE_ASYNC_MODULE", "ERR_REQUIRE_ESM", "IDE_CONTRACT_RELAY_ACQUIRE_UNKNOWN", "IDE_CONTRACT_RELAY_ACTUAL_ENTRY_REQUIRED", "IDE_CONTRACT_RELAY_CALLER_IDENTITY_MISMATCH", "IDE_CONTRACT_RELAY_CLOSE_UNKNOWN", "IDE_CONTRACT_RELAY_CODE_BINDING_CHANGED", "IDE_CONTRACT_RELAY_JOIN_PENDING", "IDE_CONTRACT_RELAY_KERNEL_OR_RESOURCE_CHANGED", "IDE_CONTRACT_RELAY_LOCAL_DIRECTORY_IDENTITY_MISMATCH", "IDE_CONTRACT_RELAY_LOCAL_DIRECTORY_UNAVAILABLE", "IDE_CONTRACT_RELAY_LOCAL_NOT_CURRENT", "IDE_CONTRACT_RELAY_LOCAL_PROJECT_CURRENT_CHANGED", "IDE_CONTRACT_RELAY_LOCAL_PROJECT_LAUNCH_MISMATCH", "IDE_CONTRACT_RELAY_LOCAL_UNKNOWN", "IDE_CONTRACT_RELAY_OBSERVER_REFUSED", "IDE_CONTRACT_RELAY_OBSERVER_UNKNOWN", "IDE_CONTRACT_RELAY_ORIGINAL_ENDPOINT_REQUIRED", "IDE_CONTRACT_RELAY_PEER_CHANGED", "IDE_CONTRACT_RELAY_PEER_LINEAGE_REQUIRED", "IDE_CONTRACT_RELAY_PEER_REQUIRED", "IDE_CONTRACT_RELAY_POST_CURRENT_REFUSED", "IDE_CONTRACT_RELAY_PRIVATE_PROFILE_REQUIRED", "IDE_CONTRACT_RELAY_PROCESS_OR_CAPACITY_REQUIRED", "IDE_CONTRACT_RELAY_PROJECT_CURRENT_CHANGED", "IDE_CONTRACT_RELAY_PROJECT_SOURCE_REQUIRED", "IDE_CONTRACT_RELAY_RUNTIME_CURRENT_CHANGED", "IDE_CONTRACT_RELAY_RUNTIME_NOT_QUALIFIED", "IDE_CONTRACT_RELAY_SOURCE_UNAVAILABLE", "IDE_CONTRACT_RELAY_THREAD_REQUIRED", "MODULE_NOT_FOUND", "UNCLASSIFIED", "YNX_CONTRACT_RELAY_ARGUMENTS_INVALID", "YNX_CONTRACT_RELAY_CANCEL_UNKNOWN", "YNX_CONTRACT_RELAY_CAPACITY", "YNX_CONTRACT_RELAY_CAPTURE_UNKNOWN", "YNX_CONTRACT_RELAY_CLEANUP_PENDING", "YNX_CONTRACT_RELAY_GUARD_SCOPE_INVALID", "YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE", "YNX_CONTRACT_RELAY_INITIATOR_ROLE_BOUNDARY_UNQUALIFIED", "YNX_CONTRACT_RELAY_NATIVE_UNKNOWN", "YNX_CONTRACT_RELAY_NOT_RETIRED", "YNX_CONTRACT_RELAY_OBSERVER_INVALID", "YNX_CONTRACT_RELAY_OBSERVER_UNKNOWN", "YNX_CONTRACT_RELAY_ORIGINAL_REQUIRED", "YNX_CONTRACT_RELAY_PROJECT_MISMATCH", "YNX_CONTRACT_RELAY_RETIRED"]);
const scopePhases=new Set(['NATIVE_READ','VALIDATE','MATCH_CAPTURE']);
const generic='YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE';
const object=v=>v!==null&&(typeof v==='object'||typeof v==='function');
function originalCode(cause){
 const seen=new Set();let fallback='UNCLASSIFIED';
 for(let n=0;n<4&&object(cause)&&!types.isProxy(cause)&&!seen.has(cause);n++){
  seen.add(cause);
  const code=Object.getOwnPropertyDescriptor(cause,'code');
  if(code&&Object.hasOwn(code,'value')&&typeof code.value==='string'&&codes.has(code.value)){
   if(code.value!==generic)return code.value;fallback=generic;
  }
  const next=Object.getOwnPropertyDescriptor(cause,'cause');
  if(!next||!Object.hasOwn(next,'value'))break;cause=next.value;
 }
 return fallback;
}
export function markOriginalIDEContractRelayDiagnostic(error,stage,cause=error,scopePhase){
 if(!stages.has(stage)||!object(error)||types.isProxy(error))return error;
 try{
  // First bounded annotation survives subsequent wrappers and cleanup.
  if(Object.getOwnPropertyDescriptor(error,'relayGuardFailureStage'))return error;
  Object.defineProperties(error,{relayGuardFailureStage:{value:stage,enumerable:true},relayGuardCauseCode:{value:originalCode(cause),enumerable:true},...((stage==='SCOPE_INITIAL'||stage==='SCOPE_RECHECK')&&scopePhases.has(scopePhase)?{relayGuardScopePhase:{value:scopePhase,enumerable:true}}:{})});
 }catch{} // Frozen original failures stay the SAME failure, without new effects.
 return error;
}
