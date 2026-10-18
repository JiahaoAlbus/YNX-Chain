import {originalWalletRuntimeObserverSelection} from './original-wallet-runtime-observer-native-selection.mjs';
import {createOriginalWalletServiceRuntimeObserver,assertOriginalWalletServiceRuntimeObserver,captureOriginalWalletServiceRuntimeObservation,assertOriginalWalletServiceRuntimeObservationCurrent,beginOriginalWalletRuntimeObserverAcquisition,closeOriginalWalletRuntimeObserverAcquisition} from '../src/original-wallet-service-runtime-observer.js';
import {captureOriginalRecoveryJSON} from '../src/original-operation-recovery-state.js';
import {exactFields} from '../src/canonical.js';
const runtimeLifetimes=new WeakMap();
// A same-copy lifetime proves the normal caller selected the original observer
// implementation. Its actual Source/current checks remain mandatory separately.
export function assertOriginalWalletRuntimeObserverLifetime(lifetime,host){
 const original=runtimeLifetimes.get(lifetime);
 if(!original||original.host!==host)throw Object.assign(Error('Original runtime lifetime required'),{code:'ORIGINAL_RUNTIME_LIFETIME_REQUIRED'});
 original.assertCurrent();
 const status=lifetime.status();
 if(!status.entered||!status.configured||status.retired||status.firstCausePresent||status.cleanupFailurePresent)throw Object.assign(Error('Original runtime source unavailable'),{code:'ORIGINAL_RUNTIME_NOT_CONFIGURED'});
 return undefined;
}
// Called only from the original daemon's actual listen callback, retaining the
// same Host brand and exact intrinsic listener. Null is NOT_CONFIGURED, not ready.
export function openOriginalWalletRuntimeObserverAfterListen(hostSource,server,acquisition){
 if(originalWalletRuntimeObserverSelection===null)return null;
 const selected=captureOriginalRecoveryJSON(originalWalletRuntimeObserverSelection);
 exactFields(selected,['instanceSource','roleBinding'],'Original daemon runtime selection');
 return createOriginalWalletServiceRuntimeObserver({hostSource,server,instanceSource:selected.instanceSource,roleBinding:selected.roleBinding,originalNow:()=>Date.now()},acquisition);
}

// One daemon-held lifetime for its actual same-process Host/Server; not a
// registry, provider installer, remote observer DTO or new admission grant.
export function createOriginalWalletRuntimeObserverLifetime(host,server){
 let observer=null,acquisition=null,entered=false,acquiring=false,retired=false,closing=null,first,firstPresent=false,cleanupCause,cleanupFailed=false;
 const fail=code=>{throw Object.assign(Error('Original runtime observer is unavailable'),{code});};
 const remember=cause=>{if(!firstPresent){first=cause;firstPresent=true;}};
 const current=()=>{if(retired)fail('ORIGINAL_RUNTIME_RETIRED');if(!observer)fail('ORIGINAL_RUNTIME_NOT_CONFIGURED');assertOriginalWalletServiceRuntimeObserver(observer);if(retired)fail('ORIGINAL_RUNTIME_RETIRED');};
 const lifetime=Object.freeze({
  afterListen(){
   if(retired)fail('ORIGINAL_RUNTIME_RETIRED');if(entered)fail('ORIGINAL_RUNTIME_ALREADY_ENTERED');entered=true;acquiring=true;
   try{
    if(originalWalletRuntimeObserverSelection===null)return null;
    acquisition=beginOriginalWalletRuntimeObserverAcquisition();
    if(typeof host?.captureOriginalWalletServiceRuntimeSource!=='function')fail('ORIGINAL_RUNTIME_HOST_CAPABILITY_NOT_SUPPLIED');
    const source=host.captureOriginalWalletServiceRuntimeSource();if(retired)fail('ORIGINAL_RUNTIME_RETIRED');
    const original=openOriginalWalletRuntimeObserverAfterListen(source,server,acquisition);
    observer=original; // Own exact returned original BEFORE any late fence.
    if(retired)fail('ORIGINAL_RUNTIME_RETIRED');current();return undefined;
   }catch(cause){remember(cause);retired=true;throw cause;}finally{acquiring=false;}
  },
  capture(sequence){current();try{const captured=captureOriginalWalletServiceRuntimeObservation(observer,sequence);current();return captured;}catch(cause){remember(cause);retired=true;throw cause;}},
  assertObservationCurrent(captured){current();try{assertOriginalWalletServiceRuntimeObservationCurrent(observer,captured);current();return undefined;}catch(cause){remember(cause);retired=true;throw cause;}},
  retire(cause){retired=true;if(arguments.length)remember(cause);return undefined;},
  join(){if(acquiring)fail('ORIGINAL_RUNTIME_ACQUISITION_INFLIGHT');return Promise.resolve();},
  close(){
   if(closing)return closing;retired=true;
   closing=Promise.resolve().then(async()=>{
    if(acquiring)fail('ORIGINAL_RUNTIME_ACQUISITION_INFLIGHT');
    if(acquisition!==null){if(await closeOriginalWalletRuntimeObserverAcquisition(acquisition)!==undefined)fail('ORIGINAL_RUNTIME_CLEANUP_INCOMPLETE');observer=null;}
    return undefined;
   }).catch(cause=>{cleanupCause=cause;cleanupFailed=true;remember(cause);throw cause;});return closing;
  },
  // Non-secret diagnostics only; no source/ref/raw exported to an IPC caller.
  status(){return Object.freeze({entered,retired,configured:observer!==null,firstCausePresent:firstPresent,cleanupFailurePresent:cleanupFailed});}
 });
 runtimeLifetimes.set(lifetime,{host,server,assertCurrent(){try{current();}catch(cause){remember(cause);retired=true;throw cause;}}});return lifetime;
}
