const createOriginalIDEHeldRead=()=>{throw Error('PUBLIC fixture requires supplied original heldRead')};
import {createOriginalProjectReader} from './ide-cloud-continued-p03.fixture.mjs';
const contractProtocol={valid(){throw Error('PUBLIC fixture never invokes independent contract branch')}};
const fail=code=>Object.assign(new Error(code),{code});
const binding=value=>JSON.stringify([value.selection,value.project]);
// Private Resource/server composition. Context comes from localProjectContext,
// not an RPC body. A local UUID/path never supplies canonical project authority.
export function createProjectServicesHost(context,{assertPathCurrent,heldRead=createOriginalIDEHeldRead(),projectReader=createOriginalProjectReader(),cloudCaller=null,contracts=null}={}){
 if(typeof assertPathCurrent!=='function'||!context?.id||!context.workspace||!context.profile)throw fail('IDE_PROJECT_CONTEXT_REQUIRED');
 const selected=Object.freeze({workspaceCanonicalAbsolutePath:context.workspace,profileCanonicalAbsolutePath:context.profile,localProjectID:context.id});
 let retired=false,closing,continuing,contractClose,projectOpening,projectLease,firstPresent=false,firstCause;const active=new Set();
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
  if(!['project','cloud-observation','contract'].includes(action)||!input||Object.getPrototypeOf(input)!==Object.prototype||action==='project'&&Object.keys(input).length)throw fail('IDE_PROJECT_SERVICE_REQUEST_INVALID');
  if(action==='contract'&&(Object.keys(input).sort().join()!=='action,body'||!contractProtocol.valid(input.action,input.body)))throw fail('IDE_PROJECT_SERVICE_REQUEST_INVALID');
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
    result=await cloudCaller.observe(Object.freeze({originalWorkspace:selected,originalProject:before}),captured,{signal:controller.signal,projectLease});
   }
   const after=await current(controller.signal);if(binding(after)!==identity)throw fail('IDE_PROJECT_IDENTITY_CHANGED');
   fence(controller.signal);return result;
  }).catch(error=>{if(!firstPresent){firstPresent=true;firstCause=error;}throw error;}).finally(()=>{signal?.removeEventListener('abort',abort);active.delete(row);});
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
