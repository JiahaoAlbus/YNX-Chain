import {createRequire} from 'node:module';
import{types}from'node:util';
import {fileURLToPath} from 'node:url';
import{assertOriginalAuthRuntimeImagePreLoadCurrentV1,assertOriginalWPRHostPreLoadCurrentV1,retainOriginalWPRHostPreloadChildV1}from'./original-auth-runtime-image-source-v1.js';
// One fixed implementing image, shared by joint and device consumers.
// No provider, endpoint, path input or public loader setter.
const requireOriginal=createRequire(import.meta.url);
const requireFixedOriginalNativeImage=()=>requireOriginal(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)));
export const loadOriginalAuthIdentityNativeImage=()=>{
 // The actual zero-input Source must already be acquired/rechecked by normal
 // Main. This synchronous fence never starts asynchronous work or loads on a
 // missing/expired/retired Source; no legacy unguarded fallback exists.
 assertOriginalAuthRuntimeImagePreLoadCurrentV1();
 return requireFixedOriginalNativeImage();
};
const failure=code=>Object.assign(new Error(code),{code});
export function acquireOriginalProductSessionDeviceV4SourceStage(...args){
 if(args.length)throw failure('PRODUCT_DEVICE_V4_SOURCE_ARGUMENTS_INVALID');
 let native;try{native=loadOriginalAuthIdentityNativeImage();}catch(cause){throw Object.assign(failure('PRODUCT_DEVICE_V4_NATIVE_SOURCE_STAGE_NOT_SUPPLIED'),{cause});}
 const descriptor=Object.getOwnPropertyDescriptor(native,'acquireOriginalProductSessionDeviceV4Source');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')throw failure('PRODUCT_DEVICE_V4_NATIVE_SOURCE_STAGE_NOT_SUPPLIED');
 // Do not translate Native failure: preserve SAME error and its actual partial.
 return descriptor.value.call(native);
}
// Same fixed image and independent provisioning Source; never a keygen or
// approval alias for the original registered-device HTTP Source above.
export function acquireOriginalProductSessionDeviceV4ProvisioningSourceStage(...args){
 if(args.length)throw failure('DEVICE_PROVISIONING_SOURCE_ZERO_INPUT');
 let native;try{native=loadOriginalAuthIdentityNativeImage();}catch(cause){throw Object.assign(failure('DEVICE_PROVISIONING_NATIVE_SOURCE_STAGE_NOT_SUPPLIED'),{cause});}
 const descriptor=Object.getOwnPropertyDescriptor(native,'acquireOriginalProductSessionDeviceV4ProvisioningSource');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')throw failure('DEVICE_PROVISIONING_NATIVE_SOURCE_STAGE_NOT_SUPPLIED');
 // Preserve SAME Native error/partial: no fallback, retry, or DTO adapter.
 return descriptor.value.call(native);
}
// Independent cold-query Source. No creation terms, approval, registration,
// network recovery, provider input or writable journal capability is accepted.
export function acquireOriginalProductSessionDeviceV4QuerySourceStage(...args){
 if(args.length)throw failure('DEVICE_QUERY_SOURCE_ZERO_INPUT');
 let native;try{native=loadOriginalAuthIdentityNativeImage();}catch(cause){throw Object.assign(failure('DEVICE_QUERY_NATIVE_SOURCE_STAGE_NOT_SUPPLIED'),{cause});}
 const descriptor=Object.getOwnPropertyDescriptor(native,'acquireOriginalProductSessionDeviceV4QuerySource');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')throw failure('DEVICE_QUERY_NATIVE_SOURCE_STAGE_NOT_SUPPLIED');
 // Retain the exact thrown value and its partial; never translate a Native
 // Source failure into ABSENT, regenerate a device, or reopen the Source.
 return descriptor.value.call(native);
}

// WPR has its OWN completed asynchronous normal Host pre-load. This private
// stage shares only the one fixed require implementation, never the installed
// consumer's Source gate or an HTTPv5/finalization permission.
function wprDescriptors(v){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)throw failure('WPR_NATIVE_ENTRY_MODEL');return Object.getOwnPropertyDescriptors(v);}
function wprValues(d,keys){if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')))throw failure('WPR_NATIVE_ENTRY_MODEL');return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
const wprMethods=['readCapturedPublicOriginals','readIndependentMaterializationOriginals','assertCurrent','recheck','retire','join','close','isClosed'];
// A synchronous Native acquisition returning Promise violates this ABI. Its
// potential late native owner is UNKNOWN: preserve actual Promise+parent loan,
// do not make the parent closable by dropping it or automatically reacquire.
const wprUnresolvedAcquisitions=new Set();
function keepWPRNativeChild(raw,child){
 const refs={};let first,modelError,closed=false,busy=false,wrapped;
 try{const d=wprDescriptors(raw);wprValues(d,wprMethods);for(const n of wprMethods){if(typeof d[n].value!=='function')throw failure('WPR_NATIVE_ENTRY_MODEL');refs[n]=d[n].value}}catch(e){modelError=e;try{const d=wprDescriptors(raw);for(const n of wprMethods)if(typeof d[n]?.value==='function')refs[n]=d[n].value}catch{}}
 const remember=e=>{first??={cause:e};return first.cause;};
 const same=self=>{if(self!==wrapped)throw failure('WPR_NATIVE_ENTRY_SAME_OWNER');};
 function observeClosed(){if(closed)return true;if(typeof refs.isClosed!=='function')return false;const v=Reflect.apply(refs.isClosed,raw,[]);if(typeof v!=='boolean')throw failure('WPR_NATIVE_ENTRY_MODEL');if(v){closed=true;child.release()}return closed;}
 function call(name,cleanup){if(busy)throw failure('WPR_NATIVE_ENTRY_BUSY');busy=true;let value,errorPresent=false,error,physicalDone=false;
  try{if(!cleanup){if(first)throw first.cause;child.current()}if(typeof refs[name]!=='function')throw modelError??failure('WPR_NATIVE_ENTRY_MODEL');
   let result;try{result=Reflect.apply(refs[name],raw,[]);if(types.isPromise(result)){Promise.prototype.then.call(result,()=>{},()=>{});throw failure('WPR_NATIVE_ENTRY_SYNC_REQUIRED')}const d=wprDescriptors(result);if(d.value&&Object.hasOwn(d.value,'value'))value=d.value.value;const v=wprValues(d,['value','errorPresent','error','physicalDone']);if(typeof v.errorPresent!=='boolean'||typeof v.physicalDone!=='boolean')throw failure('WPR_NATIVE_ENTRY_MODEL');value=v.value;if(v.physicalDone){closed=true;physicalDone=true;child.release()}if(v.errorPresent){errorPresent=true;error=remember(v.error)}}catch(e){errorPresent=true;error=remember(e)}
   if(!cleanup)try{child.current()}catch(e){if(!errorPresent){errorPresent=true;error=remember(e)}}
   if(cleanup&&!closed)try{physicalDone=observeClosed()}catch(e){if(!errorPresent){errorPresent=true;error=remember(e)}}
  }catch(e){errorPresent=true;error=remember(e)}finally{busy=false}
  return Object.freeze({value:value??null,errorPresent,error:errorPresent?error:null,physicalDone:closed||physicalDone});
 }
 wrapped=Object.freeze(Object.fromEntries(wprMethods.map(n=>[n,n==='isClosed'?function(){same(this);if(arguments.length)throw failure('WPR_NATIVE_ENTRY_ZERO_ARGUMENTS');return observeClosed()}:function(){same(this);if(arguments.length)throw failure('WPR_NATIVE_ENTRY_ZERO_ARGUMENTS');return call(n,['retire','join','close'].includes(n))}])));
 return{owner:wrapped,remember,modelError};
}
export function acquireOriginalWPRMaterializationNativeStageV1(...args){
 if(args.length)throw failure('WPR_NATIVE_ENTRY_ZERO_ARGUMENTS');let child,held,raw,errorPresent=false,error,uncertain=false;
 try{
  assertOriginalWPRHostPreLoadCurrentV1();child=retainOriginalWPRHostPreloadChildV1();
  const image=requireFixedOriginalNativeImage();child.current();
  const descriptor=Object.getOwnPropertyDescriptor(image,'acquireOriginalWPRMaterializationLoanV1');
  if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')throw failure('WPR_NATIVE_EXPORT_NOT_SUPPLIED');
  const acquire=descriptor.value;raw=Reflect.apply(acquire,image,[]);
  if(types.isPromise(raw)){uncertain=true;const debt={promise:raw,child,settled:false,reply:null,errorPresent:false,error:null};wprUnresolvedAcquisitions.add(debt);Promise.prototype.then.call(raw,value=>{debt.settled=true;debt.reply=value},cause=>{debt.settled=true;debt.errorPresent=true;debt.error=cause});throw failure('WPR_NATIVE_ENTRY_SYNC_REQUIRED')}
  const d=wprDescriptors(raw);if(d.owner&&Object.hasOwn(d.owner,'value')&&d.owner.value!=null)held=keepWPRNativeChild(d.owner.value,child);
  const value=wprValues(d,['owner','errorPresent','error']);if(typeof value.errorPresent!=='boolean')throw failure('WPR_NATIVE_ENTRY_MODEL');
  if(value.errorPresent){errorPresent=true;error=value.error;if(held)held.remember(error)}
  else if(!held||held.modelError)throw held?.modelError??failure('WPR_NATIVE_ENTRY_MODEL');
  try{child.current()}catch(e){if(!errorPresent){errorPresent=true;error=e;if(held)held.remember(e)}}
 }catch(e){errorPresent=true;error=e;if(held)held.remember(e)}
 if(!held&&!uncertain)child?.release();
 return Object.freeze({owner:held?.owner??null,errorPresent,error:errorPresent?error:null});
}
