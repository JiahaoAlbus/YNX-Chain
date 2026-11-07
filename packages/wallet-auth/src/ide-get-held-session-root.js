import {loadOriginalAuthIdentityNativeImage} from './original-auth-identity-fixed-native-image.js';
import {holdCapturedOriginalIDEGETRead,assertOriginalIDEGETRequestContext} from './ide-get-held-session-owner-private.js';
const fail=code=>{throw Object.assign(new Error(code),{code});};
function partialOwner(native){let selected=false,result;return Object.freeze({retire(){native.retire();},status(){return native.status();},close(){if(!selected){selected=true;result=(async()=>{native.retire();if(await native.join()!==undefined)fail('IDE_HELD_SESSION_PARTIAL_JOIN_PENDING');if(await native.close()!==undefined)fail('IDE_HELD_SESSION_PARTIAL_CLOSE_UNKNOWN');})();}return result;}});}
/** Normal zero-input Source/store acquisition. No caller registry, session,
 * service, storage, device, abort, callback, current or provider is accepted. */
export async function acquireOriginalIDEHeldSessionReadForOriginalGET(...args){
 if(args.length!==1)fail('IDE_GET_ORIGINAL_CONTEXT_REQUIRED');
 const originalRequestContext=assertOriginalIDEGETRequestContext(args[0]);
 if(originalRequestContext.signal.aborted)return Object.freeze({owner:null,error:originalRequestContext.signal.reason,failed:true,errorPresent:true,cleanupOnly:true});
 let image;try{image=loadOriginalAuthIdentityNativeImage();}catch(error){return Object.freeze({owner:null,error,failed:true,errorPresent:true,cleanupOnly:true});}
 const d=Object.getOwnPropertyDescriptor(image,'acquireOriginalIDEHeldSessionReadCapture');
 if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'){const error=Object.assign(new Error('IDE_HELD_SESSION_NATIVE_CAPTURE_NOT_SUPPLIED'),{code:'IDE_HELD_SESSION_NATIVE_CAPTURE_NOT_SUPPLIED'});return Object.freeze({owner:null,error,failed:true,errorPresent:true,cleanupOnly:true});}
 let native=null;
 try{native=d.value.call(image);}catch(error){
  if(error!==null&&(typeof error==='object'||typeof error==='function')&&Object.hasOwn(error,'partial'))native=error.partial;
  return Object.freeze({owner:native?partialOwner(native):null,error,failed:true,errorPresent:true,cleanupOnly:true});
 }
 if(native===null||native===undefined){const error=Object.assign(new Error('IDE_HELD_SESSION_NATIVE_CAPTURE_NOT_SUPPLIED'),{code:'IDE_HELD_SESSION_NATIVE_CAPTURE_NOT_SUPPLIED'});return Object.freeze({owner:null,error,failed:true,errorPresent:true,cleanupOnly:true});}
 // Native selected metadata is DATA from actual Root-pinned registry/store.
 // Native Current rechecks real Source-v2 + physical store on each boundary.
 let metadata;
 try{metadata=native.readMetadata();}catch(error){return Object.freeze({owner:partialOwner(native),error,failed:true,errorPresent:true,cleanupOnly:true});}
 try{
 const root=Object.freeze({assertCurrent:()=>native.assertCurrent(),retire:()=>native.retire(),join:()=>native.join(),close:()=>native.close()});
 const storageOwner=Object.freeze({securityLevel:metadata.securityLevel,assertCurrent:()=>native.assertCurrent(),readOriginal:key=>native.readOriginal(key),revocationRequested:()=>native.revocationRequested(),retire:()=>native.retireStore(),join:()=>native.joinStore(),close:()=>native.closeStore()});
 let selected=false;
 const acquireStage=()=>{
  if(selected)fail('IDE_HELD_SESSION_STAGE_ONCE');selected=true;native.acquireStage();
  // Same actual ProductDeviceV4SourceOwner; no second acquisition/Source or
  // expected(sessionBinding) discovery. Original SDK held/abort checks remain.
  return Object.freeze({device:Object.freeze({version:'4',algorithm:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',readContext:()=>native.readContext(),produceHTTPProof:(...v)=>native.produceHTTPProof(...v)}),deviceCurrent:Object.freeze({readCurrent:(...v)=>native.readCurrent(...v),assertCurrent:(...v)=>native.assertDeviceCurrent(...v),readRegistrationOriginal:(...v)=>native.readRegistrationOriginal(...v),readSessionOriginal:(...v)=>native.readSessionOriginal(...v)}),retire:()=>native.retireStage(),join:()=>native.joinStage(),close:()=>native.closeStage()});
 };
 return await holdCapturedOriginalIDEGETRead({root,storageOwner,acquireStage,registry:metadata.registry,productId:metadata.productId,platform:metadata.platform,storageKey:metadata.storageKey,gatewayTimeoutMs:metadata.gatewayTimeoutMs},originalRequestContext);
 }catch(error){return Object.freeze({owner:partialOwner(native),error,failed:true,errorPresent:true,cleanupOnly:true});}
}
