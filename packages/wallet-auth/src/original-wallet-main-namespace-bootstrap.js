// Synchronous custody attempt. Actual fixed Native owner/Root port, no setter.
import {types} from 'node:util';
import {acquireOriginalAuthRuntimeImageAdmissionV1,assertOriginalAuthRuntimeImagePreLoadCurrentV1} from './original-auth-runtime-image-source-v1.js';
import {loadOriginalAuthIdentityNativeImage} from './original-auth-identity-fixed-native-image.js';
import {captureOriginalWalletMainNamespaceLoaderBindingV1,startOriginalWalletMainNamespaceNodeLoadV1} from './original-wallet-main-namespace-node-loader-private.js';
const failure=code=>Object.assign(Error(code),{code});
let selected;
export function initializeOriginalWalletMainNamespaceV1(...args){
 if(args.length)throw failure('WALLET_MAIN_BOOTSTRAP_ZERO_INPUT');
 if(!selected)selected=createAttempt();return selected;
}
function captureNative(){
 const image=loadOriginalAuthIdentityNativeImage();
 if(!image||types.isProxy(image))throw failure('WALLET_MAIN_NATIVE_EXPORTS_NOT_SUPPLIED');
 const names={initialize:'initializeOriginalWalletMainNamespaceV1',isOwner:'isOriginalWalletMainNamespaceOwnerV1',retire:'retireOriginalWalletMainNamespaceV1',join:'joinOriginalWalletMainNamespaceV1',close:'closeOriginalWalletMainNamespaceV1',open:'openOriginalWalletMainNamespaceLoaderV1'},native={image};
 for(const [key,name]of Object.entries(names)){const d=Object.getOwnPropertyDescriptor(image,name);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))throw failure('WALLET_MAIN_NATIVE_EXPORTS_NOT_SUPPLIED');native[key]=d.value;}
 const loader=captureOriginalWalletMainNamespaceLoaderBindingV1();
 if(loader.image!==image||loader.open!==native.open)throw failure('WALLET_MAIN_NATIVE_IMAGE_CHANGED');
 return Object.freeze(native);
}
function createAttempt(){
 let retired=false,admission=null,acquisitionComplete=false,native=null,nativeOwner;
 let nativeInitializationEntered=false,nativeOwnerPresent=false,nativeOwnerRecognized=false,nativeCustodyUnknown=false;
 let nativeRetireSelected=false,nativeJoinSelected=false,nativeJoinComplete=false,nativeCloseSelected=false,nativeCloseComplete=false;
 let loadAttempt=null,loadResult=null,startupErrorPresent=false,startupError,identityErrorPresent=false,identityError;
 let cleanupErrorPresent=false,cleanupError,parentRetireSelected=false,joinPromise,closePromise,joinComplete=false,closeComplete=false;
 const cleanupFailure=cause=>{if(!cleanupErrorPresent){cleanupErrorPresent=true;cleanupError=cause;}};
 function callNative(key){const value=Reflect.apply(native[key],native.image,[nativeOwner]);if(value!==undefined)throw failure('WALLET_MAIN_NATIVE_'+key.toUpperCase()+'_RESULT_INVALID');}
 function retireParent(){if(!admission||parentRetireSelected)return;parentRetireSelected=true;try{admission.retire();}catch(cause){cleanupFailure(cause);throw cause;}}
 function retireNative(){if(!nativeOwnerPresent||nativeRetireSelected)return;nativeRetireSelected=true;try{callNative('retire');}catch(cause){cleanupFailure(cause);throw cause;}}
 function lower(){
  if(loadAttempt)loadAttempt.retire();
  if(nativeOwnerPresent)retireNative();
  // Never retire/close the parent underneath an entered unresolved Native child.
  else if(!nativeInitializationEntered)retireParent();
 }
 function autoDrain(){void selectClose().catch(()=>{});}
 function retire(){retired=true;try{lower();}finally{autoDrain();}}
 async function drainNative(){
  if(loadAttempt){loadAttempt.retire();await loadAttempt.join();}
  if(nativeCustodyUnknown)throw failure('WALLET_MAIN_NATIVE_STARTUP_CUSTODY_UNKNOWN');
  if(!nativeOwnerPresent)return;
  retireNative();if(cleanupErrorPresent)throw cleanupError;
  if(!nativeJoinSelected){nativeJoinSelected=true;callNative('join');nativeJoinComplete=true;}
  if(!nativeJoinComplete)throw failure('WALLET_MAIN_NATIVE_JOIN_RETAINED');
  if(!nativeCloseSelected){nativeCloseSelected=true;callNative('close');nativeCloseComplete=true;}
  if(!nativeCloseComplete)throw failure('WALLET_MAIN_NATIVE_CLOSE_RETAINED');
 }
 function selectJoin(){
  if(!joinPromise)joinPromise=Promise.resolve().then(async()=>{
   await completion;
   try{await drainNative();retireParent();if(cleanupErrorPresent)throw cleanupError;if(admission)await admission.join();joinComplete=true;}
   catch(cause){cleanupFailure(cause);throw cause;}
  });return joinPromise;
 }
 function selectClose(){
  if(!closePromise)closePromise=Promise.resolve().then(async()=>{
   await selectJoin();try{if(admission)await admission.close();closeComplete=true;}catch(cause){cleanupFailure(cause);throw cause;}
  });return closePromise;
 }
 function join(){retired=true;try{lower();}catch{}autoDrain();return selectJoin();}
 function close(){retired=true;try{lower();}catch{}return selectClose();}
 function adopt(value){nativeOwner=value;nativeOwnerPresent=value!==null&&value!==undefined;if(!nativeOwnerPresent||types.isPromise(value))nativeCustodyUnknown=true;}
 function adoptPartial(cause){
  if(cause&&(typeof cause==='object'||typeof cause==='function')&&!types.isProxy(cause)){
   const d=Object.getOwnPropertyDescriptor(cause,'partial');if(d&&Object.hasOwn(d,'value')){adopt(d.value);return;}
  }nativeCustodyUnknown=true;
 }
 async function acquire(){
  try{
   if(retired)throw failure('WALLET_MAIN_STARTUP_RETIRED');
   const acquired=await acquireOriginalAuthRuntimeImageAdmissionV1();admission=acquired.owner;
   if(retired)try{lower();}catch{}
   if(acquired.error!==null)throw acquired.error;
   if(retired)throw failure('WALLET_MAIN_STARTUP_RETIRED');
   assertOriginalAuthRuntimeImagePreLoadCurrentV1();native=captureNative();
   let initErrorPresent=false,initError;
   nativeInitializationEntered=true;
   try{adopt(Reflect.apply(native.initialize,native.image,[]));}catch(cause){adoptPartial(cause);initErrorPresent=true;initError=cause;}
   // SAME returned/partial candidate is retained before any recognition/guard.
   if(retired)try{lower();}catch{}
   if(nativeOwnerPresent&&!nativeCustodyUnknown){
    try{const yes=Reflect.apply(native.isOwner,native.image,[nativeOwner]);if(typeof yes!=='boolean'||!yes)throw failure('WALLET_MAIN_NATIVE_OWNER_INVALID');nativeOwnerRecognized=true;}
    catch(cause){identityErrorPresent=true;identityError=cause;}
   }
   if(initErrorPresent)throw initError;
   if(identityErrorPresent)throw identityError;
   if(nativeCustodyUnknown)throw failure('WALLET_MAIN_NATIVE_SYNC_OWNER_REQUIRED');
   if(retired)throw failure('WALLET_MAIN_STARTUP_RETIRED');
   loadAttempt=startOriginalWalletMainNamespaceNodeLoadV1(nativeOwner);
   loadResult=await loadAttempt.completion; // Retain original namespace/port first.
   if(loadResult.errorPresent)throw loadResult.error;
   if(retired)throw failure('WALLET_MAIN_STARTUP_RETIRED');
  }catch(cause){startupErrorPresent=true;startupError=cause;retired=true;try{lower();}catch{}}
  finally{acquisitionComplete=true;if(retired)autoDrain();}
  return Object.freeze({admission,nativeOwner,nativeOwnerPresent,loadResult,errorPresent:startupErrorPresent,error:startupError,SourceAdmission:false,NativeAdmission:false,MainRegistered:false});
 }
 const completion=Promise.resolve().then(acquire);
 return Object.freeze({completion,retire,join,close,statusDATA(){return Object.freeze({retired,acquisitionComplete,admissionPresent:admission!==null,parentRetireSelected,nativeInitializationEntered,nativeOwnerPresent,nativeOwnerRecognized,nativeCustodyUnknown,nodeLoadSelected:loadAttempt!==null,nodeLoadComplete:loadResult!==null,nativeRetireSelected,nativeJoinSelected,nativeJoinComplete,nativeCloseSelected,nativeCloseComplete,joinSelected:!!joinPromise,joinComplete,closeSelected:!!closePromise,closeComplete,startupErrorPresent,startupError,identityErrorPresent,identityError,cleanupErrorPresent,cleanupError,dataOnly:true,SourceAdmission:false,NativeAdmission:false,MainRegistered:false});}});
}
