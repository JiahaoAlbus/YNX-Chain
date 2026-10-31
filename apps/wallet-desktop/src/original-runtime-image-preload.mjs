// Main owns this original admission lease until its Native consumers drain.
// The fixed SDK/Source module supplies authority; no path, Root, owner or loader
// callback can be installed through this controller.
import {types} from 'node:util';
const fail=code=>{throw Object.assign(Error(code),{code});};
const own=(value,key)=>{if(!value||types.isProxy(value))return;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
export function createOriginalRuntimeImagePreloadController(...args){
 if(args.length)fail('RUNTIME_IMAGE_PRELOAD_ZERO_INPUT');
 let module,owner,opening,retired=false,firstPresent=false,first,closing;
 const remember=cause=>{if(!firstPresent){firstPresent=true;first=cause;}return first;};
 const branded=()=>{const inspect=own(module,'assertOriginalAuthRuntimeImageAdmissionOwnerV1');if(typeof inspect!=='function'||inspect(owner)!==owner)fail('RUNTIME_IMAGE_PRELOAD_ORIGINAL_OWNER_REQUIRED');return owner;};
 const current=()=>{if(retired)fail('RUNTIME_IMAGE_PRELOAD_RETIRED');if(firstPresent)throw first;const assert=own(module,'assertOriginalAuthRuntimeImagePreLoadCurrentV1');if(!owner||typeof assert!=='function')fail('RUNTIME_IMAGE_PRELOAD_NOT_SUPPLIED');branded();if(assert()!==undefined)fail('RUNTIME_IMAGE_PRELOAD_CURRENT_REFUSED');};
 async function ensureCurrent(...inputs){
  if(inputs.length)fail('RUNTIME_IMAGE_PRELOAD_ZERO_INPUT');if(retired)fail('RUNTIME_IMAGE_PRELOAD_RETIRED');if(firstPresent)throw first;if(opening)return opening;
  const task=(async()=>{try{
   if(!owner){
    // Missing successor source remains a refusal. No legacy-image fallback.
    module=await import('../../../packages/wallet-auth/src/original-auth-runtime-image-source-v1.js');
    if(retired)fail('RUNTIME_IMAGE_PRELOAD_RETIRED');
    const acquire=own(module,'acquireOriginalAuthRuntimeImageAdmissionV1');if(typeof acquire!=='function')fail('RUNTIME_IMAGE_PRELOAD_NOT_SUPPLIED');
    let envelope;try{envelope=await acquire();}catch(cause){owner=own(cause,'partial');throw cause;}
    // Adopt the nonnull original BEFORE inspecting error or envelope shape.
    owner=own(envelope,'owner');
    const descriptors=envelope&&!types.isProxy(envelope)?Object.getOwnPropertyDescriptors(envelope):null;
    if(!descriptors||!Object.isFrozen(envelope)||Reflect.ownKeys(descriptors).length!==2||!descriptors.owner||!Object.hasOwn(descriptors.owner,'value')||!descriptors.error||!Object.hasOwn(descriptors.error,'value'))fail('RUNTIME_IMAGE_PRELOAD_ORIGINAL_ENVELOPE_REQUIRED');
    if(descriptors.error.value!==null)throw descriptors.error.value;
    if(!owner)fail('RUNTIME_IMAGE_PRELOAD_NOT_SUPPLIED');branded();
   }else if(await branded().recheck()!==undefined)fail('RUNTIME_IMAGE_PRELOAD_RECHECK_REFUSED');
   current();
  }catch(cause){throw remember(cause);}})();
  opening=task;try{await task;}finally{if(opening===task)opening=undefined;}
 }
 function assertCurrent(...inputs){if(inputs.length)fail('RUNTIME_IMAGE_PRELOAD_ZERO_INPUT');try{current();}catch(cause){throw remember(cause);}}
 function close(...inputs){
  if(inputs.length)fail('RUNTIME_IMAGE_PRELOAD_ZERO_INPUT');
  if(!closing)closing=(async()=>{
   retired=true;if(opening)try{await opening;}catch{}
   if(!owner)return;
   // Original brand check also applies to a nonnull failure partial. Retain
   // unknown cleanup; never retry an already selected close or replace owner.
   const held=branded();let failed=false,cause;
   try{if(held.retire()!==undefined)fail('RUNTIME_IMAGE_PRELOAD_RETIRE_REFUSED');}catch(error){failed=true;cause=error;}
   try{if(await held.join()!==undefined)fail('RUNTIME_IMAGE_PRELOAD_JOIN_PENDING');}catch(error){if(!failed){failed=true;cause=error;}throw cause;}
   try{if(await held.close()!==undefined)fail('RUNTIME_IMAGE_PRELOAD_CLOSE_UNKNOWN');}catch(error){if(!failed){failed=true;cause=error;}}
   if(failed)throw cause;
  })();
  return closing;
 }
 return Object.freeze({ensureCurrent,assertCurrent,close});
}
