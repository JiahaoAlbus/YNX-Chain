// Main-only local completion of an independently registered SAME device.
// No creation, key, registration, signer, transport or Source override exists.
import {types} from 'node:util';
import {loadOriginalAuthIdentityNativeImage} from '../../../packages/wallet-auth/src/original-auth-identity-fixed-native-image.js';
import {parseProductSessionRequest} from '@ynx-chain/wallet-auth';
import {productPlatformBinding} from '../../../packages/wallet-auth/src/product-session-registry.js';
import {PRODUCT_SESSION_REGISTRY} from './wallet-auth-contract.mjs';
import {captureOriginalDeviceV4RegisteredFinalizationSelection,readOriginalDeviceV4RegisteredFinalizationForNative} from './original-policy-supplier/device-registered-finalization-selection.mjs';
import {createOriginalRuntimeImagePreloadController} from './original-runtime-image-preload.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const descriptor=(value,key)=>value&&['object','function'].includes(typeof value)&&!types.isProxy(value)?Object.getOwnPropertyDescriptor(value,key):null;
const own=(value,key)=>{const d=descriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
function call(owner,key,...args){const fn=own(owner,key);if(typeof fn!=='function')fail('DEVICE_FINALIZATION_ORIGINAL_NATIVE_ABI');return fn.call(owner,...args);}
function empty(owner,key){if(call(owner,key)!==undefined)fail('DEVICE_FINALIZATION_ORIGINAL_NATIVE_ABI');}
const safeCode=cause=>{const code=own(cause,'code');return typeof code==='string'&&/^[A-Z0-9_]{1,96}$/.test(code)?code:'DEVICE_FINALIZATION_ORIGINAL_FAILURE';};
const outcomeKeys=['state','originalGeneration','originalCreationOperation','originalRegistrationOperation','localAssociationFinalized','SourceAdmission','newSession','connected','keyGenerated','registrationResent'];
function project(value){
 if(!value||types.isProxy(value)||!Object.isFrozen(value))fail('DEVICE_FINALIZATION_ORIGINAL_OUTCOME_REQUIRED');
 const d=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(d).length!==outcomeKeys.length||outcomeKeys.some(k=>!d[k]||!Object.hasOwn(d[k],'value')))fail('DEVICE_FINALIZATION_ORIGINAL_OUTCOME_REQUIRED');
 if(!['FINALIZED_LOCAL_ASSOCIATION','ALREADY_FINALIZED_SAME_ORIGINAL','UNKNOWN','EVIDENCE_NOT_SUPPLIED'].includes(value.state)||
   typeof value.originalGeneration!=='string'||typeof value.originalCreationOperation!=='string'||value.originalRegistrationOperation!==null&&typeof value.originalRegistrationOperation!=='string'||
   typeof value.localAssociationFinalized!=='boolean'||outcomeKeys.slice(5).some(k=>value[k]!==false))fail('DEVICE_FINALIZATION_ORIGINAL_OUTCOME_REQUIRED');
 return Object.freeze(Object.fromEntries(outcomeKeys.map(k=>[k,value[k]])));
}
export function createOriginalDeviceFinalizationController({vault,networkId,...extra}){
 if(Object.keys(extra).length||!vault?.authorization||!/^[a-f0-9]{64}$/.test(networkId??''))fail('DEVICE_FINALIZATION_MAIN_COMPOSITION_REQUIRED');
 let active=null,closed=false;const imagePreload=createOriginalRuntimeImagePreloadController();
 const remember=(r,cause)=>{if(!r.firstPresent){r.firstPresent=true;r.first=cause;}};
 const cleanupFailure=(r,cause)=>{if(!r.cleanupFailure){r.cleanupFailure=true;r.cleanupFirst=cause;}remember(r,cause);};
 const retain=(r,value)=>{if(!r.rawRetained)r.firstRawOutcome=value;r.rawOutcome=value;r.rawRetained=true;r.view=project(value);if(!r.firstView)r.firstView=r.view;};
 const readOutcome=r=>{if(r.child&&r.effectEntered)try{retain(r,call(r.child,'readOriginalOutcomeDATA'));}catch(cause){if(!r.outcomeReadFailed){r.outcomeReadFailed=true;r.outcomeReadCause=cause;}}};
 function retire(r){
  r.retired=true;readOutcome(r);
  for(const key of ['child','source'])if(r[key]&&!r.cleanup[key].retired){r.cleanup[key].retired=true;try{empty(r[key],'retire');}catch(cause){cleanupFailure(r,cause);}}
  readOutcome(r);r.peer?.retire();
 }
 async function drain(r){
  retire(r);
  for(const key of ['child','source']){
   if(key==='source'&&r.child&&!r.cleanup.child.closed)break;
   const owner=r[key],step=r.cleanup[key];if(!owner)continue;
   try{
    if(!step.joined){if(await call(owner,'join')!==undefined)fail('DEVICE_FINALIZATION_ORIGINAL_JOIN_PENDING');step.joined=true;}
    if(!step.closeSelected){step.closeSelected=true;if(await call(owner,'close')!==undefined)fail('DEVICE_FINALIZATION_ORIGINAL_CLOSE_UNKNOWN');step.closed=true;}
   }catch(cause){cleanupFailure(r,cause);break;}
  }
  r.cleanupDebt=Boolean(r.child&&!r.cleanup.child.closed||r.source&&!r.cleanup.source.closed);
  if(!r.cleanupDebt){r.unsubscribe?.();r.peer?.close();r.selected?.close();}
  if(r.cleanupFailure)throw r.cleanupFirst;
  if(r.cleanupDebt)fail('DEVICE_FINALIZATION_ORIGINAL_CLEANUP_UNRESOLVED');
 }
 function current(r){
  if(closed||r.retired)fail('DEVICE_FINALIZATION_RETIRED');vault.authorization.current().assert();
  const s=vault.authorization.status();if(s.account!==r.security.account||s.revision!==r.security.revision)fail('DEVICE_FINALIZATION_SELECTED_SESSION_CHANGED');
  r.selected?.assertCurrent();if(r.source)empty(r.source,'assertCurrent');if(r.child)empty(r.child,'assertCurrent');
 }
 const status=()=>Object.freeze({account:active?.security.account??null,phase:active?.phase??'idle',effectEntered:active?.effectEntered??false,
  originalOutcomeRetained:active?.rawRetained??false,originalOutcome:active?.firstView??null,outcome:active?.view??null,cleanupUnresolved:active?.cleanupDebt??false,cleanupFailureRetained:active?.cleanupFailure??false,
  SourceAdmission:false,newSession:false,connected:false,keyGenerated:false,registrationResent:false,
  ...(active?.firstPresent?{firstCauseCode:safeCode(active.first)}:{})});
 async function finalizeOriginal(originalRequest){
  if(arguments.length!==1)fail('DEVICE_FINALIZATION_ORIGINAL_REQUEST_REQUIRED');if(closed)fail('DEVICE_FINALIZATION_RETIRED');
  if(active?.inFlight||active?.effectEntered||active?.cleanupDebt)fail('DEVICE_FINALIZATION_ORIGINAL_QUERY_ONLY');
  const request=parseProductSessionRequest(PRODUCT_SESSION_REGISTRY,originalRequest,new Date());if(request.version!=='4')fail('DEVICE_FINALIZATION_ORIGINAL_V4_REQUEST_REQUIRED');
  vault.authorization.current().assert();const r={security:vault.authorization.status(),phase:'acquiring-source',cleanup:{child:{},source:{}},effectEntered:false,firstPresent:false};active=r;
  r.unsubscribe=vault.authorization.subscribe(s=>{if(s.locked||s.account!==r.security.account||s.revision!==r.security.revision)retire(r);});
  const task=(async()=>{let failed=false,cause;
   try{
    await imagePreload.ensureCurrent();current(r);imagePreload.assertCurrent();
    const native=loadOriginalAuthIdentityNativeImage(),fn=own(native,'acquireOriginalProductSessionDeviceV4RegisteredFinalizationSource');
    if(typeof fn!=='function')fail('DEVICE_FINALIZATION_NATIVE_SOURCE_NOT_SUPPLIED');
    let envelope;
    try{envelope=fn.call(native);}catch(error){r.source=own(error,'partial');throw error;}
    // Retain the actual nonnull owner BEFORE interpreting any error/shape.
    r.source=own(envelope,'owner');const descriptors=envelope&&!types.isProxy(envelope)?Object.getOwnPropertyDescriptors(envelope):null;
    if(!descriptors||!Object.isFrozen(envelope)||Reflect.ownKeys(descriptors).length!==2||!descriptors.owner||!Object.hasOwn(descriptors.owner,'value')||!descriptors.error||!Object.hasOwn(descriptors.error,'value'))fail('DEVICE_FINALIZATION_ORIGINAL_ENVELOPE_REQUIRED');
    if(descriptors.error.value!==null)throw descriptors.error.value;
    if(r.source===null||r.source===undefined)fail('DEVICE_FINALIZATION_NATIVE_SOURCE_NOT_SUPPLIED');
    current(r);r.selected=await vault.captureSelectedPQAccountPublic(networkId);current(r);
    r.originalReview=call(r.source,'readOriginalReviewDATA');current(r);
    const binding=productPlatformBinding(PRODUCT_SESSION_REGISTRY,request.productId,request.platform);
    const app=Object.fromEntries(['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'].map(k=>[k,binding[k]]));
    for(const[k,v]of Object.entries(app))if(request[k]!==v)fail('DEVICE_FINALIZATION_APPLICATION_CHANGED');
    r.peer=captureOriginalDeviceV4RegisteredFinalizationSelection(r.originalReview,r.selected,app);current(r);
    r.selection=readOriginalDeviceV4RegisteredFinalizationForNative(r.peer);
    if(r.selection.identityBinding.deviceId!==request.deviceId)fail('DEVICE_FINALIZATION_ORIGINAL_DEVICE_CHANGED');
    try{r.child=call(r.source,'captureOriginalFinalization',r.peer);}catch(error){r.child=own(error,'partial');throw error;}
    current(r);await call(r.child,'recheck');current(r);r.phase='completing-original-local-association';r.effectEntered=true;
    try{retain(r,call(r.child,'commitOriginalRegisteredAssociation'));}catch(error){readOutcome(r);throw error;}
    current(r);
    for(const key of ['originalGeneration','originalCreationOperation','originalRegistrationOperation'])if(r.view[key]!==r.selection[key])fail('DEVICE_FINALIZATION_ORIGINAL_RESULT_CHANGED');
    if(!['FINALIZED_LOCAL_ASSOCIATION','ALREADY_FINALIZED_SAME_ORIGINAL'].includes(r.view.state)||r.view.localAssociationFinalized!==true)fail('DEVICE_FINALIZATION_ORIGINAL_RESULT_UNKNOWN');
    r.phase='original-local-association-retained';
   }catch(error){failed=true;cause=error;remember(r,error);readOutcome(r);r.phase=r.effectEntered?'original-local-finalization-unknown':'failed-before-local-effect';}
   finally{try{await drain(r);}catch(error){remember(r,error);if(!failed){failed=true;cause=error;}}}
   if(failed)throw cause;
  })();r.inFlight=task;try{await task;}finally{r.inFlight=null;}return status();
 }
 async function close(){closed=true;if(active){retire(active);if(active.inFlight)try{await active.inFlight;}catch{}await drain(active);}await imagePreload.close();}
 return Object.freeze({finalizeOriginal,readStatusDATA:status,close});
}
