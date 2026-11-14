import {loadBundledIdentitySDK} from '../../../desktop/identity-sdk-loader.mjs';
import {types} from 'node:util';
import { fault } from './central-identity.mjs';

const methods = ['acquireOriginalIDEProjectAuthority','readOriginalIDECurrentProject',
 'readOriginalIDECurrentServiceRegistration','readOriginalIDECurrentPublisher','closeOriginalIDEProjectAuthority'];
const principalFields=['account','deviceId','sessionRef','currentRef','accountGeneration','sessionGeneration'];
const projectFields=['projectId','ownerAccount','currentReference','projectRevision','catalogRevision','read','publish','runtime'];
const currentBinding=value=>JSON.stringify([
 ...principalFields.map(key=>value?.principal?.[key]),...projectFields.map(key=>value?.project?.[key]),
]);

// Backend-only composition. The production loader has no user-selected path,
// Source, issuer or Native owner. Tests may supply the original SDK surface at
// construction; HTTP/project bodies never choose it.
export function createOriginalProjectReader({originalSDK,loadSDK=()=>loadBundledIdentitySDK('original-ide-admission')}={}) {
 async function readCurrent(projectId,{publisherId,includeService=false}={}) {
  if(typeof projectId!=='string'||!projectId||Buffer.byteLength(projectId)>256||
   (publisherId!==undefined&&(typeof publisherId!=='string'||!publisherId||Buffer.byteLength(publisherId)>256))||typeof includeService!=='boolean')
   throw fault('An exact original project selection is required.','project_selection',400);
  const sdk=originalSDK??await loadSDK();
  if(methods.some(name=>typeof sdk?.[name]!=='function'))throw fault('Original project authority implementation is unavailable.','IDE_PROJECT_IMPLEMENTATION_NOT_SUPPLIED',503);
  // Retain the exact partial before attempting any current/read operation.
  const owner=sdk.acquireOriginalIDEProjectAuthority();
  if(owner===null||owner===undefined)throw fault('The original IDE project authority Source is unavailable.','IDE_PROJECT_DEDICATED_SOURCE_REQUIRED',503);
  let failed=false,firstCause,result;
  try {
   const project=sdk.readOriginalIDECurrentProject(owner,projectId);
   if(project?.project?.projectId!==projectId)throw fault('Original current project changed.','project_identity_changed',409);
   const service=includeService?sdk.readOriginalIDECurrentServiceRegistration(owner,projectId):undefined;
   const publisher=publisherId===undefined?undefined:sdk.readOriginalIDECurrentPublisher(owner,projectId,publisherId);
   const current=sdk.readOriginalIDECurrentProject(owner,projectId),binding=currentBinding(project);
   if(currentBinding(current)!==binding||(service&&currentBinding(service)!==binding)||(publisher&&currentBinding(publisher)!==binding)||
      (publisher&&publisher.publisher?.publisherId!==publisherId))throw fault('Project, device or publisher changed during the original read.','project_identity_changed',409);
   // These remain original DATA. No login, restored role, grant, signing or
   // deployment authorization is created from the returned booleans.
   result=Object.freeze({project:current,...(service?{service}:{}),...(publisher?{publisher}:{})});
  } catch(error) {failed=true;firstCause=error;}
  try {sdk.closeOriginalIDEProjectAuthority(owner);}
  catch(cleanupError) {
   if(failed)throw new AggregateError([firstCause,cleanupError],'Original project read and cleanup failed.');
   throw cleanupError;
  }
  if(failed)throw firstCause;
  return result;
 }
 async function readWorkspace(selection,{includeService=false}={}) {
  const fields=['workspaceCanonicalAbsolutePath','profileCanonicalAbsolutePath','localProjectID'];
  if(!selection||Object.keys(selection).sort().join(',')!==[...fields].sort().join(',')||fields.some(key=>typeof selection[key]!=='string'||!selection[key])||typeof includeService!=='boolean')
   throw fault('Use the original workspace and profile selection without a project override.','project_selection',400);
  // Capture before the first await; the UI may switch its mutable selection.
  const [workspace,profile,localProjectID]=fields.map(key=>selection[key]);
  const sdk=originalSDK??await loadSDK();
  const required=['acquireOriginalIDEWorkspaceProjectSelection','readOriginalIDEWorkspaceProjectSelection','closeOriginalIDEWorkspaceProjectSelection'];
  if(required.some(name=>typeof sdk?.[name]!=='function'))throw fault('Original workspace selection implementation is unavailable.','IDE_WORKSPACE_PROJECT_IMPLEMENTATION_NOT_SUPPLIED',503);
  const owner=sdk.acquireOriginalIDEWorkspaceProjectSelection(workspace,profile,localProjectID);
  if(owner===null||owner===undefined)throw fault('Original workspace selection is unavailable.','IDE_WORKSPACE_PROJECT_SOURCE_REQUIRED',503);
  let failed=false,firstCause,result;
  try {
   const selected=sdk.readOriginalIDEWorkspaceProjectSelection(owner);
   const binding=JSON.stringify([selected.projectId,selected.publisherId,selected.projectRevision,selected.catalogRevision]);
   const current=await createOriginalProjectReader({originalSDK:sdk}).readCurrent(selected.projectId,{
    includeService,...(selected.publisherId===null?{}:{publisherId:selected.publisherId}),
   });
   const latest=sdk.readOriginalIDEWorkspaceProjectSelection(owner);
   if(binding!==JSON.stringify([latest.projectId,latest.publisherId,latest.projectRevision,latest.catalogRevision])||
     current.project.project.projectRevision!==selected.projectRevision||current.project.project.catalogRevision!==selected.catalogRevision)
    throw fault('Original workspace mapping changed during the project read.','project_identity_changed',409);
   result=Object.freeze({selection:latest,...current});
  } catch(error) {failed=true;firstCause=error;}
  try {sdk.closeOriginalIDEWorkspaceProjectSelection(owner);}
  catch(cleanupError) {
   if(failed)throw new AggregateError([firstCause,cleanupError],'Original workspace read and cleanup failed.');
   throw cleanupError;
  }
  if(failed)throw firstCause;
  return result;
 }
 // Backend custody only. The same Native selection/project objects remain
 // private until every attached original Source has drained. DATA reads never
 // become the selector passed to an Auth/SDK producer.
 async function openWorkspace(selection,{includeService=false}={}) {
  const fields=['workspaceCanonicalAbsolutePath','profileCanonicalAbsolutePath','localProjectID'];
  if(!selection||Object.keys(selection).sort().join()!==[...fields].sort().join()||fields.some(key=>typeof selection[key]!=='string'||!selection[key])||typeof includeService!=='boolean')throw fault('Original workspace selection required.','project_selection',400);
  const args=fields.map(key=>selection[key]),sdk=originalSDK??await loadSDK();
  if([...methods,'acquireOriginalIDEWorkspaceProjectSelection','readOriginalIDEWorkspaceProjectSelection','closeOriginalIDEWorkspaceProjectSelection'].some(key=>typeof sdk?.[key]!=='function'))throw fault('Original retained project implementation unavailable.','IDE_PROJECT_IMPLEMENTATION_NOT_SUPPLIED',503);
  const fail=code=>Object.assign(Error(code),{code});
  let selector,project,selectionEntered=false,projectEntered=false,retired=false,closed=false,closing,continuing,baseline,firstPresent=false,firstCause,sourceSelected=false,sourceFactory,source;
  let projectCloseEntered=false,selectionCloseEntered=false,projectClosed=false,selectionClosed=false,projectCloseCause,selectionCloseCause;
  const flights=new Set(),loans=[];
  const remember=error=>{if(!firstPresent){firstPresent=true;firstCause=error;}};
  const active=signal=>{signal?.throwIfAborted();if(firstPresent)throw firstCause;if(retired||closed)throw fail('IDE_PROJECT_SELECTION_RETIRED');};
  function stop(row){
   if(row.retired)return;row.retired=true;
   if(!row.methods)throw fail('IDE_PROJECT_SOURCE_PARTIAL_UNCLASSIFIED');
   try{if(Reflect.apply(row.methods.retire,row.owner,[])!==undefined)throw fail('IDE_PROJECT_SOURCE_RETIRE_UNCONFIRMED');}catch(error){row.retireFailed=true;row.retireCause=error;throw error;}
  }
  function retire(){retired=true;for(const row of loans)try{stop(row);}catch(error){remember(error);}}
  function adopt(owner){
   if(owner===null||owner===undefined)return;
   const existing=loans.find(row=>row.owner===owner);if(existing)return existing;
   const row={owner,methods:null,retired:false,joined:false,closed:false};loans.push(row);
   if(!types.isProxy(owner)&&['object','function'].includes(typeof owner)){
    const ds=Object.fromEntries(['retire','join','close'].map(key=>[key,Object.getOwnPropertyDescriptor(owner,key)]));
    if(['retire','join','close'].every(key=>ds[key]&&Object.hasOwn(ds[key],'value')&&typeof ds[key].value==='function'))row.methods=Object.fromEntries(['retire','join','close'].map(key=>[key,ds[key].value]));
   }
   if(retired)try{stop(row);}catch(error){remember(error);}
   return row;
  }
  const originalPartial=error=>{if(error&&['object','function'].includes(typeof error)&&!types.isProxy(error)){const d=Object.getOwnPropertyDescriptor(error,'partial');if(d&&Object.hasOwn(d,'value'))return d.value;}};
  const adoptPartial=error=>{if(error&&['object','function'].includes(typeof error)&&!types.isProxy(error)){const d=Object.getOwnPropertyDescriptor(error,'partial');if(d&&Object.hasOwn(d,'value'))adopt(d.value);}};
  function tracked(work,signal,sourceEntered=()=>false){
   const pending=Promise.resolve().then(()=>{active(signal);return work();}).catch(error=>{if(!signal?.aborted||sourceEntered()){remember(error);retire();}throw error;}).finally(()=>flights.delete(pending));
   flights.add(pending);return pending;
  }
  function readOriginal(signal){
   active(signal);
   if(!selectionEntered){selectionEntered=true;try{selector=sdk.acquireOriginalIDEWorkspaceProjectSelection(...args);}catch(error){selector=originalPartial(error);throw error;}if(selector===null||selector===undefined)throw fail('IDE_WORKSPACE_PROJECT_SOURCE_REQUIRED');}
   const selected=sdk.readOriginalIDEWorkspaceProjectSelection(selector),selectionBinding=JSON.stringify([selected.projectId,selected.publisherId,selected.projectRevision,selected.catalogRevision]);
   if(!projectEntered){projectEntered=true;try{project=sdk.acquireOriginalIDEProjectAuthority();}catch(error){project=originalPartial(error);throw error;}if(project===null||project===undefined)throw fail('IDE_PROJECT_DEDICATED_SOURCE_REQUIRED');}
   const before=sdk.readOriginalIDECurrentProject(project,selected.projectId);
   const service=includeService?sdk.readOriginalIDECurrentServiceRegistration(project,selected.projectId):undefined;
   const publisher=selected.publisherId==null?undefined:sdk.readOriginalIDECurrentPublisher(project,selected.projectId,selected.publisherId);
   const after=sdk.readOriginalIDECurrentProject(project,selected.projectId),latest=sdk.readOriginalIDEWorkspaceProjectSelection(selector),binding=currentBinding(before);
   const actual=JSON.stringify([selectionBinding,binding]);
   if(before?.project?.projectId!==selected.projectId||currentBinding(after)!==binding||(service&&currentBinding(service)!==binding)||(publisher&&(currentBinding(publisher)!==binding||publisher.publisher?.publisherId!==selected.publisherId))||JSON.stringify([latest.projectId,latest.publisherId,latest.projectRevision,latest.catalogRevision])!==selectionBinding||after.project.projectRevision!==selected.projectRevision||after.project.catalogRevision!==selected.catalogRevision||baseline!==undefined&&baseline!==actual)throw fail('project_identity_changed');
   baseline??=actual;active(signal);return Object.freeze({selection:latest,project:after,...(service?{service}:{}),...(publisher?{publisher}:{})});
  }
  function read({signal}={}){return tracked(()=>readOriginal(signal),signal);}
  // This callback is backend composition, never accepted from an RPC body.
  // It receives the SAME opaque Native selector; it cannot derive authority
  // from a workspace path or the DATA returned by read(). No draft getter is
  // imported here. The formal SDK producer must still authenticate the owner.
  function retainOriginalChild(acquire,{signal}={}){let entered=false;return tracked(()=>{
   readOriginal(signal);
   if(typeof acquire!=='function')throw fail('IDE_PROJECT_SOURCE_FACTORY_REQUIRED');
   if(sourceSelected){if(acquire!==sourceFactory)throw fail('IDE_PROJECT_SOURCE_ALREADY_SELECTED');return source;}
   sourceSelected=true;sourceFactory=acquire;entered=true;
   let owned;
   try{owned=acquire(selector);}catch(error){adoptPartial(error);throw error;}
   if(types.isPromise(owned)){
    const late=owned.then(value=>{adopt(value);},error=>{adoptPartial(error);remember(error);}).finally(()=>flights.delete(late));flights.add(late);
    throw fail('IDE_PROJECT_SOURCE_SYNCHRONOUS_REQUIRED');
   }
   const row=adopt(owned);
   if(!row?.methods)throw fail('IDE_PROJECT_SOURCE_PARTIAL_UNCLASSIFIED');
   source=owned;readOriginal(signal);return source;
  },signal,()=>entered);}
  async function drain(explicit){
   await Promise.allSettled([...flights]);retire();
   for(const row of loans){
    if(!row.methods)throw firstPresent?firstCause:fail('IDE_PROJECT_SOURCE_PARTIAL_UNCLASSIFIED');
    if(row.retireFailed){
     if(!explicit)throw row.retireCause;
     // Explicit same-owner cleanup only. Never calls a Source factory or GET.
     if(Reflect.apply(row.methods.retire,row.owner,[])!==undefined)throw fail('IDE_PROJECT_SOURCE_RETIRE_UNCONFIRMED');
     row.retireFailed=false;
    }
    if(!row.joined){if(await Reflect.apply(row.methods.join,row.owner,[])!==undefined)throw fail('IDE_PROJECT_SOURCE_JOIN_UNCONFIRMED');row.joined=true;}
    if(!row.closed){if(await Reflect.apply(row.methods.close,row.owner,[])!==undefined)throw fail('IDE_PROJECT_SOURCE_CLOSE_UNCONFIRMED');row.closed=true;}
   }
   if(loans.some(row=>!row.closed))throw firstPresent?firstCause:fail('IDE_PROJECT_SOURCE_DRAIN_PENDING');
   if(project!==null&&project!==undefined&&!projectClosed){
    // A thrown Native parent close has no reconciliation ABI here. Its mere
    // entry must never let a later continuation skip to the selector.
    if(projectCloseEntered)throw projectCloseCause;
    projectCloseEntered=true;
    try{if(sdk.closeOriginalIDEProjectAuthority(project)!==undefined)throw fail('IDE_PROJECT_PARENT_CLOSE_UNCONFIRMED');projectClosed=true;}catch(error){projectCloseCause=error;throw error;}
   }
   if(selector!==null&&selector!==undefined&&!selectionClosed){
    if(selectionCloseEntered)throw selectionCloseCause;
    selectionCloseEntered=true;
    try{if(sdk.closeOriginalIDEWorkspaceProjectSelection(selector)!==undefined)throw fail('IDE_PROJECT_SELECTION_CLOSE_UNCONFIRMED');selectionClosed=true;}catch(error){selectionCloseCause=error;throw error;}
   }
   closed=true;
  }
  function close(){
   retire();return closing??=drain(false).then(()=>Object.freeze({complete:true})).catch(error=>{remember(error);throw error;});
  }
  function continueClose(){
   if(continuing)return continuing;
   // Keep the original close promise/failure intact. Only an explicit caller
   // may make one bounded pass through the SAME unresolved cleanup phases.
   const selected=(async()=>{if(!closing)close();await closing.catch(()=>{});if(!closed)await drain(true);return Object.freeze({cleanupComplete:closed,firstCausePresent:firstPresent,originalOperationRetried:false});})();
   continuing=selected;selected.then(()=>{if(continuing===selected)continuing=null;},error=>{remember(error);if(continuing===selected)continuing=null;});return selected;
  }
  return Object.freeze({read,retainOriginalChild,retire,close,continueClose,status:()=>Object.freeze({retired,closed,selectionRetained:selector!==null&&selector!==undefined,projectRetained:project!==null&&project!==undefined,activeOperations:flights.size,sourceLoans:loans.length,sourceDebt:loans.some(row=>!row.closed),firstCausePresent:firstPresent,RootAdmission:false,SourceAdmission:false,NativeAdmission:false})});
 }
 return Object.freeze({readCurrent,readWorkspace,openWorkspace});
}
