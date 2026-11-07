// PRIVATE normal Node-only pre-proof custody. No public provider/Source setter.
// Native authenticates actualSelection and its independent Root/cap29/DEVICE/
// Node/project/current/TLS custody. This wrapper cannot recognize a DATA grant.
import {types} from 'node:util';
import {loadOriginalAuthIdentityNativeImage} from './original-auth-identity-fixed-native-image.js';
const error=code=>Object.assign(Error(code),{code});
const object=v=>v!==null&&['object','function'].includes(typeof v)&&!types.isProxy(v);
function method(v,name){if(!object(v))throw error('IDE_GET_TARGET_SOURCE_ABI');const d=Object.getOwnPropertyDescriptor(v,name);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')throw error('IDE_GET_TARGET_SOURCE_ABI');return d.value;}
function partial(e){if(!object(e))return null;const d=Object.getOwnPropertyDescriptor(e,'partial');return d&&Object.hasOwn(d,'value')?d.value:null;}
const captures=new WeakMap();
const names=['assertCurrent','readOriginalTargetScope','retire','join','close'];
/** Required Auth Native ABI; body/normal-image qualification remains separate.
 * Direct synchronous owner or thrown original partial; no Promise/DTO fallback.
 * The returned scope is the SAME opaque Native capture, never reconstructed.
 */
export function acquireOriginalIDEFiniteGETTargetSource(actualSelection){
 if(arguments.length!==1||!object(actualSelection))throw error('IDE_GET_TARGET_ORIGINAL_SELECTION_REQUIRED');
 const native=loadOriginalAuthIdentityNativeImage();
 let getter;try{getter=method(native,'acquireOriginalIDEFiniteGETTargetSource')}catch(cause){throw Object.assign(error('IDE_GET_PREPROOF_TARGET_SOURCE_NOT_SUPPLIED'),{cause});}
 let acquired=null,failurePresent=false,failure;
 try{acquired=Reflect.apply(getter,native,[actualSelection]);}catch(e){acquired=partial(e);failurePresent=true;failure=e;}
 // Adopt every nonnull original before reflecting ABI or entering current.
 const state={owner:acquired,methods:null,scope:null,retired:false,retireDone:false,closed:false,firstPresent:failurePresent,first:failure,closePromise:null,drainPromise:null};
 const remember=e=>{if(!state.firstPresent){state.firstPresent=true;state.first=e;}};
 const invoke=(name)=>Reflect.apply(state.methods[name],state.owner,[]);
 const zero=name=>{if(invoke(name)!==undefined)throw error('IDE_GET_TARGET_'+name.toUpperCase()+'_PENDING');};
 function retire(){state.retired=true;if(state.closed||state.retireDone)return;if(!state.methods)throw error('IDE_GET_TARGET_UNCLASSIFIED_OWNER_DEBT');try{zero('retire');state.retireDone=true;}catch(e){remember(e);throw e;}}
 function drainOriginal(){
  if(state.drainPromise)return state.drainPromise;
  // Publish BEFORE any foreign retire/join/close, including reentrant calls.
  state.drainPromise=Promise.resolve().then(async()=>{
   if(state.closed)return;retire();
   if(await invoke('join')!==undefined)throw error('IDE_GET_TARGET_JOIN_PENDING');
   // A rejected/pending join NEVER releases the same Target capture.
   if(await invoke('close')!==undefined)throw error('IDE_GET_TARGET_CLOSE_PENDING');state.closed=true;
  }).catch(e=>{remember(e);throw e;}).finally(()=>{state.drainPromise=null;});return state.drainPromise;
 }
 function close(){if(!state.closePromise)state.closePromise=Promise.resolve().then(drainOriginal);return state.closePromise;}
 function current(){if(state.retired||state.closed||state.firstPresent)throw state.firstPresent?state.first:error('IDE_GET_TARGET_RETIRED');try{zero('assertCurrent');if(state.retired||state.closed)throw error('IDE_GET_TARGET_RETIRED');}catch(e){remember(e);throw e;}}
 function scope(){current();let raw;try{raw=invoke('readOriginalTargetScope');if(!object(raw))throw error('IDE_GET_TARGET_OPAQUE_SCOPE_REQUIRED');if(state.scope!==null&&raw!==state.scope)throw error('IDE_GET_TARGET_CAPTURE_CHANGED');state.scope=raw;current();return raw;}catch(e){remember(e);throw e;}}
 const held=Object.freeze({assertCurrent:current,readOriginalTargetScope:scope,retire,close,drainOriginal,statusDATA:()=>Object.freeze({retired:state.retired,closed:state.closed,cleanupDebt:state.owner!==null&&state.owner!==undefined&&!state.closed,firstCausePresent:state.firstPresent,firstCause:state.first,RootAdmission:false,SourceAdmission:false,TargetAdmission:false})});
 try{if(acquired===null||acquired===undefined){if(failurePresent)throw failure;throw error('IDE_GET_PREPROOF_TARGET_SOURCE_NOT_SUPPLIED');}state.methods=Object.freeze(Object.fromEntries(names.map(n=>[n,method(acquired,n)])));if(failurePresent)throw failure;scope();captures.set(held,{native,selection:actualSelection});return held;}
 catch(cause){remember(cause);throw Object.assign(error('IDE_GET_PREPROOF_TARGET_ACQUISITION_FAILED'),{cause,originalFailurePresent:true,partial:held});}
}

/** Private initializer for the existing normal request controller. The distinct
 * Native export MUST validate the SAME target capture before key/proof access.
 * An old no-scope export is never called, even when it happens to be present.
 */
export function acquireOriginalIDECloudGETSourceWithTargetScope(actualSelection){
 if(arguments.length!==1)throw error('IDE_GET_TARGET_ORIGINAL_SELECTION_REQUIRED');
 const target=acquireOriginalIDEFiniteGETTargetSource(actualSelection);
 const capture=captures.get(target);let scope=null;
 let raw=null,refs=null,sourceRetired=false,sourceRetireDone=false,sourceClosed=false,unknownOwner=false;
 let firstPresent=false,first,closing=null;
 const remember=e=>{if(!firstPresent){firstPresent=true;first=e;}};
 const invoke=(n,...args)=>Reflect.apply(refs[n],raw,args);
 const targetCurrent=()=>{target.assertCurrent();if(target.readOriginalTargetScope()!==scope)throw error('IDE_GET_TARGET_CAPTURE_CHANGED');};
 function current(){if(firstPresent)throw first;if(sourceRetired||sourceClosed)throw error('IDE_GET_TARGET_RETIRED');targetCurrent();if(invoke('assertCurrent')!==undefined)throw error('IDE_GET_TARGET_SOURCE_CURRENT_RESULT');targetCurrent();}
 function retire(){let failed=false,cause;sourceRetired=true;
  if(raw!==null&&raw!==undefined&&!sourceClosed&&!sourceRetireDone){try{if(!refs)throw error('IDE_GET_TARGET_UNCLASSIFIED_SOURCE_DEBT');if(invoke('retire')!==undefined)throw error('IDE_GET_TARGET_SOURCE_RETIRE_PENDING');sourceRetireDone=true;}catch(e){remember(e);failed=true;cause=e;}}
  try{target.retire()}catch(e){remember(e);if(!failed){failed=true;cause=e;}}if(failed)throw cause;
 }
 async function join(){if(!sourceRetired)throw error('IDE_GET_TARGET_RETIRE_BEFORE_JOIN');if(raw!==null&&raw!==undefined&&!sourceClosed){if(!refs)throw error('IDE_GET_TARGET_UNCLASSIFIED_SOURCE_DEBT');if(await invoke('join')!==undefined)throw error('IDE_GET_TARGET_SOURCE_JOIN_PENDING');}}
 function close(){if(closing)return closing;closing=Promise.resolve().then(async()=>{
  retire();await join();
  if(raw!==null&&raw!==undefined&&!sourceClosed){if(await invoke('close')!==undefined)throw error('IDE_GET_TARGET_SOURCE_CLOSE_PENDING');sourceClosed=true;}
  // Target parent cannot close until its actual request-Source child drained.
  await target.drainOriginal();
 }).catch(e=>{remember(e);throw e;}).finally(()=>{closing=null;});return closing;}
 const owner=Object.freeze({assertCurrent:current,
  async recheck(){try{current();if(await invoke('recheck')!==undefined)throw error('IDE_GET_TARGET_SOURCE_RECHECK_RESULT');current();}catch(e){remember(e);throw e;}},
  captureOriginalGETRequest(request,sameContext){let child=null;try{current();child=invoke('captureOriginalGETRequest',request,sameContext);current();return child;}catch(cause){remember(cause);if(child!==null&&child!==undefined)throw Object.assign(error('IDE_GET_TARGET_CAPTURE_LATE_FAILURE'),{cause,originalFailurePresent:true,partial:child});throw cause;}},
  retire,join,close,
  statusDATA:()=>Object.freeze({sourceRetired,sourceClosed,unclassifiedSourceDebt:unknownOwner,firstCausePresent:firstPresent,firstCause:first,target:target.statusDATA(),RootAdmission:false,SourceAdmission:false,TargetAdmission:false})});
 try{
  scope=target.readOriginalTargetScope();
  const get=method(capture.native,'acquireOriginalIDECloudGETSourceWithTargetScope');targetCurrent();
  try{raw=Reflect.apply(get,capture.native,[capture.selection,scope]);}catch(e){raw=partial(e);throw e;}
  unknownOwner=raw!==null&&raw!==undefined;
  refs=Object.freeze(Object.fromEntries(['assertCurrent','recheck','captureOriginalGETRequest','retire','join','close'].map(n=>[n,method(raw,n)])));unknownOwner=false;
  current();return owner;
 }catch(cause){
  // A thrown native owner is retained before ABI/current/error interpretation.
  if(raw!==null&&raw!==undefined&&!refs){unknownOwner=true;try{refs=Object.freeze(Object.fromEntries(['assertCurrent','recheck','captureOriginalGETRequest','retire','join','close'].map(n=>[n,method(raw,n)])));unknownOwner=false;}catch{}}
  remember(cause);throw Object.assign(error('IDE_GET_TARGET_BOUND_SOURCE_ACQUISITION_FAILED'),{cause,originalFailurePresent:true,partial:owner});
 }
}
