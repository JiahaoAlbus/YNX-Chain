// A synchronous custody controller, NOT a Source, Native brand or Main setter.
import {acquireOriginalAuthRuntimeImageAdmissionV1,assertOriginalAuthRuntimeImagePreLoadCurrentV1} from './original-auth-runtime-image-source-v1.js';
const failure=code=>Object.assign(Error(code),{code});
let selected;
export function initializeOriginalWalletMainNamespaceV1(...args){
 if(args.length)throw failure('WALLET_MAIN_BOOTSTRAP_ZERO_INPUT');
 if(!selected)selected=createAttempt();
 return selected;
}
function createAttempt(){
 let retired=false,admission=null,acquisitionComplete=false;
 let startupErrorPresent=false,startupError;
 let cleanupErrorPresent=false,cleanupError;
 let parentRetireSelected=false,joinPromise,closePromise,joinComplete=false,closeComplete=false;
 const cleanupFailure=cause=>{if(!cleanupErrorPresent){cleanupErrorPresent=true;cleanupError=cause;}};
 function retireParent(){
  if(!admission||parentRetireSelected)return;
  parentRetireSelected=true; // Set before invoking a possibly reentrant method.
  try{admission.retire();}catch(cause){cleanupFailure(cause);throw cause;}
 }
 function autoDrain(){void selectClose().catch(()=>{});}
 function retire(){
  retired=true;
  try{retireParent();}finally{autoDrain();}
 }
 function selectJoin(){
  if(!joinPromise)joinPromise=Promise.resolve().then(async()=>{
   await completion;
   try{retireParent();if(cleanupErrorPresent)throw cleanupError;if(admission)await admission.join();joinComplete=true;}
   catch(cause){cleanupFailure(cause);throw cause;}
  });
  return joinPromise;
 }
 function selectClose(){
  if(!closePromise)closePromise=Promise.resolve().then(async()=>{
   await selectJoin();
   // No Native child is entered until its real owned-attempt ABI is supplied.
   // Future child integration MUST successfully join+close before this parent.
   try{if(admission)await admission.close();closeComplete=true;}
   catch(cause){cleanupFailure(cause);throw cause;}
  });
  return closePromise;
 }
 function join(){retired=true;try{retireParent();}catch{}autoDrain();return selectJoin();}
 function close(){retired=true;try{retireParent();}catch{}return selectClose();}
 async function acquire(){
  try{
   if(retired)throw failure('WALLET_MAIN_STARTUP_RETIRED');
   const acquired=await acquireOriginalAuthRuntimeImageAdmissionV1();
   admission=acquired.owner; // Adopt SAME late partial before error/lateguard.
   if(retired)try{retireParent();}catch{} // Exact cleanup cause retained separately.
   if(acquired.error!==null)throw acquired.error;
   if(retired)throw failure('WALLET_MAIN_STARTUP_RETIRED');
   assertOriginalAuthRuntimeImagePreLoadCurrentV1();
   // Auth has not frozen the Native owned-handle/partial/lifecycle ABI. Do not
   // call a guessed bare-Promise initializer or methods on unknown returned DATA.
   throw failure('WALLET_MAIN_NATIVE_ATTEMPT_ABI_NOT_SUPPLIED');
  }catch(cause){startupErrorPresent=true;startupError=cause;}
  finally{acquisitionComplete=true;if(retired)autoDrain();}
  return Object.freeze({admission,errorPresent:startupErrorPresent,error:startupError,
   nativeOwnerPresent:false,SourceAdmission:false,NativeAdmission:false,MainRegistered:false});
 }
 // Microtask starts only after the immutable attempt is handed to Main.
 const completion=Promise.resolve().then(acquire);
 return Object.freeze({completion,retire,join,close,statusDATA(){return Object.freeze({
  retired,acquisitionComplete,admissionPresent:admission!==null,parentRetireSelected,
  joinSelected:!!joinPromise,joinComplete,closeSelected:!!closePromise,closeComplete,
  startupErrorPresent,startupError,cleanupErrorPresent,cleanupError,
  nativeOwnerPresent:false,dataOnly:true,SourceAdmission:false,NativeAdmission:false,MainRegistered:false});}});
}
