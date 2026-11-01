// Original same-image pending Source caller. This module grants no Source,
// identity or signing authority and accepts no provider/owner/key/JSON setter.
import {types} from 'node:util';
import {loadOriginalAuthIdentityNativeImage} from './original-auth-identity-fixed-native-image.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const sourceMethods=['readOriginalReview','produceRegistrationProof','produceChallengeProof','assertCurrent','retire','join','close'];
const operationMethods=['readOriginalMember','assertCurrent','retire','join','close','readOriginalStatus'];
function method(original,name){
 if(!original||types.isProxy(original))fail('PENDING_DEVICE_V4_ORIGINAL_ABI_REQUIRED');
 const d=Object.getOwnPropertyDescriptor(original,name);
 if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('PENDING_DEVICE_V4_ORIGINAL_ABI_REQUIRED');
 return d.value;
}
function call(original,name,...args){return method(original,name).call(original,...args);}
function voidResult(result){
 if(result!==undefined)throw Object.assign(new Error('PENDING_DEVICE_V4_LIFECYCLE_RESULT_INVALID'),{code:'PENDING_DEVICE_V4_LIFECYCLE_RESULT_INVALID',originalResult:result});
}
function noArgs(args){if(args.length)fail('PENDING_DEVICE_V4_EXACT_ARGUMENTS');}
function context(value){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype||!Object.isFrozen(value)||Reflect.ownKeys(value).length!==1)fail('PENDING_DEVICE_V4_ORIGINAL_ABORT_CONTEXT_REQUIRED');
 const d=Object.getOwnPropertyDescriptor(value,'signal');
 if(!d||!Object.hasOwn(d,'value'))fail('PENDING_DEVICE_V4_ORIGINAL_ABORT_CONTEXT_REQUIRED');
 let stopped;try{stopped=aborted.call(d.value);}catch{fail('PENDING_DEVICE_V4_ORIGINAL_ABORT_CONTEXT_REQUIRED');}
 if(stopped)fail('PENDING_DEVICE_V4_CALLER_ABORTED');
 return value; // SAME original frozen context and signal, never a clone.
}

/** Zero input, fixed original addon, distinct pending-purpose acquisition.
 * Native acquisition errors are rethrown unchanged. Their original .partial
 * owner stays with the caller and must be retained/drained, including UNKNOWN.
 */
export async function openOriginalProductSessionDeviceV4PendingProofClient(...args){
 noArgs(args);
 const native=loadOriginalAuthIdentityNativeImage();
 const d=Object.getOwnPropertyDescriptor(native,'acquireOriginalProductSessionDeviceV4PendingSource');
 if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('PENDING_DEVICE_V4_NATIVE_ENTRY_NOT_SUPPLIED');
 const owner=d.value.call(native); // SAME owner; Native exceptions/partial unchanged.
 try{for(const name of sourceMethods)method(owner,name);}
 catch(error){Object.defineProperty(error,'partial',{value:owner});throw error;}

 let selected=false,operation,retired=false,retireFailure,retireFailed=false;
 let boundaryFailed=false,boundaryCause;
 let sourceFailed=false,sourceCause;
 let joining,closing,sourceRetained=true,closed=false,cleanupFailed=false,cleanupCause;
 const remember=cause=>{if(!cleanupFailed){cleanupFailed=true;cleanupCause=cause;}};
 const boundary=cause=>{if(!boundaryFailed){boundaryFailed=true;boundaryCause=cause;}};
 const alive=()=>{if(retired||closing)fail('PENDING_DEVICE_V4_CLIENT_RETIRED');if(sourceFailed)throw sourceCause;};
 function sourceRead(name){
  try{const value=call(owner,name);if(name==='assertCurrent')voidResult(value);return value;}
  catch(cause){sourceFailed=true;sourceCause=cause;boundary(cause);throw cause;}
 }
 async function produce(name,args){
  if(args.length!==1)fail('PENDING_DEVICE_V4_EXACT_ARGUMENTS');
  alive();const original=context(args[0]);
  if(selected)fail('PENDING_DEVICE_V4_CLIENT_ONCE');
  // Select before crossing the original Native boundary. A thrown/falsy
  // outcome never re-arms this client or silently retries an uncertain effect.
  selected=true;
  try{
   operation=call(owner,name,original); // Adopt BEFORE any ABI/error inspection.
  }catch(cause){
   // A Native throw may already own a held child. Adopt its original partial
   // before interpreting any error/status; close must drain it before parent.
   if(cause!==null&&(typeof cause==='object'||typeof cause==='function')&&!types.isProxy(cause)){
    const d=Object.getOwnPropertyDescriptor(cause,'partial');if(d&&Object.hasOwn(d,'value'))operation=d.value;
   }
   boundary(cause);throw cause;
  }
  try{for(const key of operationMethods)method(operation,key);}
  catch(error){
   // This is our own ABI refusal, not a translated Native exception. Preserve
   // the SAME entered partial for public readback; cleanup remains this client.
   Object.defineProperty(error,'partial',{value:operation});boundary(error);throw error;
  }
  // Return the SAME original operation before assertCurrent can expose a late
  // error. Native owns the member/status/partial; the client retains cleanup.
  return operation;
 }
 function retire(...args){
  noArgs(args);
  if(!retired){retired=true;try{if(operation)voidResult(call(operation,'retire'));}catch(cause){retireFailed=true;retireFailure=cause;remember(cause);}}
  if(retireFailed)throw retireFailure;
 }
 function join(...args){
  noArgs(args);
  if(!retired)return Promise.reject(Object.assign(new Error('PENDING_DEVICE_V4_CLIENT_NOT_RETIRED'),{code:'PENDING_DEVICE_V4_CLIENT_NOT_RETIRED'}));
  if(!joining)joining=Promise.resolve().then(async()=>{if(operation)voidResult(await call(operation,'join'));}).catch(cause=>{remember(cause);throw cause;});
  // Joining must not select close or release the parent while its child lives.
  return joining;
 }
 function close(...args){
  noArgs(args);
  if(!closing)closing=Promise.resolve().then(async()=>{
   const attempt=async work=>{try{voidResult(await work());return true;}catch(cause){remember(cause);return false;}};
   await attempt(()=>retire());
   await attempt(()=>join());
   const childClosed=operation?await attempt(()=>call(operation,'close')):true;
   await attempt(()=>call(owner,'retire'));
   // UNKNOWN child custody is still retained. Do not select parent close or
   // pretend that a partial operation was successfully drained.
   if(childClosed){
    await attempt(()=>call(owner,'join'));
    if(await attempt(()=>call(owner,'close'))){sourceRetained=false;closed=true;}
   }
   if(cleanupFailed)throw cleanupCause;
  });
  return closing; // Exact first close Promise/result, including falsy failures.
 }
 return Object.freeze({
  capabilities:Object.freeze({kind:'original-native-device-v4-pending-proof-client',identityGrant:false,nativeAdmission:false,connected:false,newSession:false,management:false}),
  readOriginalReview(...args){noArgs(args);alive();return sourceRead('readOriginalReview');},
  assertCurrent(...args){noArgs(args);alive();sourceRead('assertCurrent');},
  produceRegistrationProof(...args){return produce('produceRegistrationProof',args);},
  produceChallengeProof(...args){return produce('produceChallengeProof',args);},
  retire,join,close,
  status(...args){noArgs(args);return Object.freeze({selected,retired,operationRetained:operation!==undefined,sourceRetained,closed,unknown:cleanupFailed||boundaryFailed,boundaryFailurePresent:boundaryFailed,firstBoundaryCause:boundaryCause,sourceFailurePresent:sourceFailed,cleanupFailurePresent:cleanupFailed,firstCleanupCause:cleanupCause,proofOutcome:'not-inspected'});},
 });
}
