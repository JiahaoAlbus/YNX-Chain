import {createOriginalIDEHeldRead} from '../services/codeoss-service/src/original-held-session-read.mjs';
import {createOriginalProjectReader} from '../services/codeoss-service/src/original-project-reader.mjs';
import projectProtocol from '../runtime/ynx-workbench/lib/project-services-channel.js';
import {types} from 'node:util';
const fail=code=>Object.assign(new Error(code),{code});
const binding=value=>JSON.stringify([value.selection,value.project]);
// SDK bounded diagnostic V1. Values are diagnostics only, never authority.
const relayStages=new Set(["NATIVE_LOAD", "NATIVE_EXPORTS", "NATIVE_ACQUIRE", "NATIVE_ACQUIRE_EMPTY", "SCOPE_INITIAL", "CURRENT_INITIAL", "SCOPE_RECHECK", "CURRENT_LIVE"]);
const relayScopePhases=new Set(['NATIVE_READ','VALIDATE','MATCH_CAPTURE']);
// Exact joint-owner codes from Native CPP 3c9ead1f, not an AUTH_* prefix grant.
const relayNativeCustodyCauses=[
 'AUTH_IDENTITY_HELD_SOURCE_CHANGED','AUTH_IDENTITY_SOURCE_READ_INCOMPLETE',
 'AUTH_IDENTITY_IDE_ACTUAL_PARENT_ENTRY_UNAVAILABLE','AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED',
 'AUTH_IDENTITY_IDE_EXTERNAL_ORIGINALS_NOT_PROTECTED','AUTH_IDENTITY_ROOT_CUSTODY_CHANGED',
 'AUTH_IDENTITY_PROFILE_CURRENT_NOT_SUPPLIED','AUTH_IDENTITY_ORIGINAL_RETIRED',
 'AUTH_IDENTITY_IDE_ACTUAL_PARENT_ENTRY_CHANGED','AUTH_IDENTITY_IDE_EXTERNAL_ORIGINALS_CHANGED',
 'AUTH_IDENTITY_ORIGINAL_CURRENT_CHANGED',
];
const relayCauses=new Set(["ERR_DLOPEN_FAILED", "ERR_REQUIRE_ASYNC_MODULE", "ERR_REQUIRE_ESM", "IDE_CONTRACT_RELAY_ACQUIRE_UNKNOWN", "IDE_CONTRACT_RELAY_ACTUAL_ENTRY_REQUIRED", "IDE_CONTRACT_RELAY_CALLER_IDENTITY_MISMATCH", "IDE_CONTRACT_RELAY_CLOSE_UNKNOWN", "IDE_CONTRACT_RELAY_CODE_BINDING_CHANGED", "IDE_CONTRACT_RELAY_JOIN_PENDING", "IDE_CONTRACT_RELAY_KERNEL_OR_RESOURCE_CHANGED", "IDE_CONTRACT_RELAY_LOCAL_DIRECTORY_IDENTITY_MISMATCH", "IDE_CONTRACT_RELAY_LOCAL_DIRECTORY_UNAVAILABLE", "IDE_CONTRACT_RELAY_LOCAL_NOT_CURRENT", "IDE_CONTRACT_RELAY_LOCAL_PROJECT_CURRENT_CHANGED", "IDE_CONTRACT_RELAY_LOCAL_PROJECT_LAUNCH_MISMATCH", "IDE_CONTRACT_RELAY_LOCAL_UNKNOWN", "IDE_CONTRACT_RELAY_OBSERVER_REFUSED", "IDE_CONTRACT_RELAY_OBSERVER_UNKNOWN", "IDE_CONTRACT_RELAY_ORIGINAL_ENDPOINT_REQUIRED", "IDE_CONTRACT_RELAY_PEER_CHANGED", "IDE_CONTRACT_RELAY_PEER_LINEAGE_REQUIRED", "IDE_CONTRACT_RELAY_PEER_REQUIRED", "IDE_CONTRACT_RELAY_POST_CURRENT_REFUSED", "IDE_CONTRACT_RELAY_PRIVATE_PROFILE_REQUIRED", "IDE_CONTRACT_RELAY_PROCESS_OR_CAPACITY_REQUIRED", "IDE_CONTRACT_RELAY_PROJECT_CURRENT_CHANGED", "IDE_CONTRACT_RELAY_PROJECT_SOURCE_REQUIRED", "IDE_CONTRACT_RELAY_RUNTIME_CURRENT_CHANGED", "IDE_CONTRACT_RELAY_RUNTIME_NOT_QUALIFIED", "IDE_CONTRACT_RELAY_SOURCE_UNAVAILABLE", "IDE_CONTRACT_RELAY_THREAD_REQUIRED", "MODULE_NOT_FOUND", "UNCLASSIFIED", "YNX_CONTRACT_RELAY_ARGUMENTS_INVALID", "YNX_CONTRACT_RELAY_CANCEL_UNKNOWN", "YNX_CONTRACT_RELAY_CAPACITY", "YNX_CONTRACT_RELAY_CAPTURE_UNKNOWN", "YNX_CONTRACT_RELAY_CLEANUP_PENDING", "YNX_CONTRACT_RELAY_GUARD_SCOPE_INVALID", "YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE", "YNX_CONTRACT_RELAY_INITIATOR_ROLE_BOUNDARY_UNQUALIFIED", "YNX_CONTRACT_RELAY_NATIVE_UNKNOWN", "YNX_CONTRACT_RELAY_NOT_RETIRED", "YNX_CONTRACT_RELAY_OBSERVER_INVALID", "YNX_CONTRACT_RELAY_OBSERVER_UNKNOWN", "YNX_CONTRACT_RELAY_ORIGINAL_REQUIRED", "YNX_CONTRACT_RELAY_PROJECT_MISMATCH", "YNX_CONTRACT_RELAY_RETIRED"]);
for(const code of relayNativeCustodyCauses)relayCauses.add(code);
const ownData=(value,key)=>value&&['object','function'].includes(typeof value)&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
// Private Resource/server composition. Context comes from localProjectContext,
// not an RPC body. A local UUID/path never supplies canonical project authority.
export function createProjectServicesHost(context,{assertPathCurrent,heldRead=createOriginalIDEHeldRead(),projectReader=createOriginalProjectReader(),cloudCaller=null,contracts=null,reportFailure=event=>console.warn('YNX_PROJECT_SERVICE_FAILURE '+JSON.stringify(event))}={}){
 if(typeof assertPathCurrent!=='function'||!context?.id||!context.workspace||!context.profile)throw fail('IDE_PROJECT_CONTEXT_REQUIRED');
 const selected=Object.freeze({workspaceCanonicalAbsolutePath:context.workspace,profileCanonicalAbsolutePath:context.profile,localProjectID:context.id});
 let retired=false,closing,continuing,contractClose,projectOpening,projectLease,firstPresent=false,firstCause;const active=new Set();
 const reported=new Set();
 function diagnose(action,input,error){
  // Local diagnostics only. Never log request DATA, raw error messages or
  // project/account/session identifiers. Logging must not replace the cause.
  try{
   const rawCode=ownData(error,'code');
   const code=typeof rawCode==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(rawCode)?rawCode:'UNCLASSIFIED';
   const stage=ownData(error,'relayGuardFailureStage'),cause=ownData(error,'relayGuardCauseCode');
   const relay=action==='contract'&&relayStages.has(stage)?{relayGuardFailureStage:stage,relayGuardCauseCode:relayCauses.has(cause)?cause:'UNCLASSIFIED'}:{};
   if(action==='contract'&&(stage==='SCOPE_INITIAL'||stage==='SCOPE_RECHECK')){
    const phase=ownData(error,'relayGuardScopePhase');
    if(relayScopePhases.has(phase))relay.relayGuardScopePhase=phase;
   }
   const operation=action==='contract'?input.action:action==='project'?'read':'observe',key=JSON.stringify([action,operation,code,relay]);
   if(reported.size>=32||reported.has(key))return;reported.add(key);
   reportFailure(Object.freeze({service:action,operation,code,...relay}));
  }catch{} // The original failure and its cleanup custody remain authoritative.
 }
 const fence=signal=>{signal?.throwIfAborted();if(retired)throw fail('IDE_PROJECT_SERVICES_RETIRED');};
 async function current(signal){
  fence(signal);await assertPathCurrent();fence(signal);
  await heldRead.assertCurrent();fence(signal);
  if(!projectOpening)projectOpening=Promise.resolve().then(()=>{
   fence(signal);if(typeof projectReader.openWorkspace!=='function')throw fail('IDE_RETAINED_PROJECT_SELECTION_NOT_SUPPLIED');
   return projectReader.openWorkspace(selected,{includeService:true});
  }).then(owner=>{projectLease=owner;if(retired)owner.retire();return owner;});
  const lease=await projectOpening;fence(signal);let project;
  try{project=await lease.read({signal});}catch(error){if(error?.code==='project_identity_changed')throw fail('IDE_PROJECT_IDENTITY_CHANGED');throw error;}

  fence(signal);await assertPathCurrent();await heldRead.assertCurrent();fence(signal);
  return project;
 }
 function read(action,input={},signal){
  fence(signal);
  if(!projectProtocol.valid(action,input))throw fail('IDE_PROJECT_SERVICE_REQUEST_INVALID');
  const captured=structuredClone(input);
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const row={controller,promise:null};
  row.promise=Promise.resolve().then(async()=>{
   if(action==='contract'){
    // Independent original contract guard, not the Product Session/Cloud parent.
    // Local context and path are fixed by the owning launch, never by the RPC.
    fence(controller.signal);await assertPathCurrent();fence(controller.signal);
    if(!contracts||typeof contracts.call!=='function')throw fail('IDE_CONTRACT_SERVICE_UNAVAILABLE');
    const result=await contracts.call(captured.action,captured.body,controller.signal);
    fence(controller.signal);await assertPathCurrent();fence(controller.signal);return result;
   }
   const before=await current(controller.signal),identity=binding(before);let result;
   if(action==='project')result=before;
   else {
    // Wallet V4 held reads are not Cloud V5 deployment authority. Only the
    // already composed original same-journal V2 caller may do this query.
    if(!cloudCaller||typeof cloudCaller.observe!=='function')throw fail('IDE_CLOUD_ORIGINAL_V5_READ_SOURCE_NOT_SUPPLIED');
    // This is the owning backend's one per-read cancellation context, not
    // frontend DATA or an authority token. The original SDK/Native sender must
    // receive this SAME frozen object for all callbacks belonging to this read.
    const originalRequestContext=Object.freeze({signal:controller.signal});
    result=await cloudCaller.observe(Object.freeze({originalWorkspace:selected,originalProject:before}),captured,{signal:controller.signal,projectLease,originalRequestContext});
   }
   const after=await current(controller.signal);if(binding(after)!==identity)throw fail('IDE_PROJECT_IDENTITY_CHANGED');
   fence(controller.signal);return result;
  }).catch(error=>{if(!firstPresent){firstPresent=true;firstCause=error;}diagnose(action,captured,error);throw error;}).finally(()=>{signal?.removeEventListener('abort',abort);active.delete(row);});
  active.add(row);return row.promise;
 }
 function retire(){if(retired)return;retired=true;for(const row of active)row.controller.abort(fail('IDE_PROJECT_SERVICES_RETIRED'));projectLease?.retire();if(contracts){try{contractClose=Promise.resolve(contracts.close());}catch(error){contractClose=Promise.reject(error);}contractClose.catch(()=>{});}}
 function close(){retire();return closing??=(async()=>{
  if(projectOpening)await projectOpening.catch(()=>{});
  await Promise.allSettled([...active].map(row=>row.promise));
  // Original GET Source/HTTP children drain inside the retained project lease.
  // A failure keeps the exact Native selection and admitted parent alive.
  const results=await Promise.allSettled([projectLease?.close(),contractClose]);
  const failed=results.filter(row=>row.status==='rejected');
  if(failed.length===1)throw failed[0].reason;
  if(failed.length)throw new AggregateError(failed.map(row=>row.reason),'Original project service cleanup remains uncertain.');
  heldRead.retire();await heldRead.close();return Object.freeze({complete:true});
 })().catch(error=>{if(!firstPresent){firstPresent=true;firstCause=error;}throw error;});}
 function continueCleanup(){
  if(continuing)return continuing;
  const selected=(async()=>{
   if(!closing)close();await closing.catch(()=>{});
   if(projectLease){const result=await projectLease.continueClose();if(result?.cleanupComplete!==true)throw fail('IDE_PROJECT_SOURCE_DRAIN_PENDING');}
   // Independent contract debt must not be inferred resolved from Cloud drain.
   await contractClose;
   heldRead.retire();await heldRead.close();
   return Object.freeze({cleanupComplete:true,firstCausePresent:firstPresent,originalOperationRetried:false});
  })();
  continuing=selected;selected.then(()=>{if(continuing===selected)continuing=null;},()=>{if(continuing===selected)continuing=null;});return selected;
 }
 return Object.freeze({read,retire,close,continueCleanup,status:()=>Object.freeze({retired,active:active.size,firstCausePresent:firstPresent,projectSelection:projectLease?.status()??null,heldRead:heldRead.status(),RootAdmission:false,SourceAdmission:false,NativeAdmission:false})});
}
