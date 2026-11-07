// PRIVATE same-parent composition. Not a package export, authority, Cloud
// client or accepted HTTP proof. Called once under P03's retained selector.
import{types}from'node:util';
import{acquireOriginalIDECloudGETRequestController}from'./original-ide-cloud-get-request.js';
const fail=code=>Object.assign(Error(code),{code});
function ownPartial(error){if(!error||!['object','function'].includes(typeof error)||types.isProxy(error))return null;const d=Object.getOwnPropertyDescriptor(error,'partial');return d&&Object.hasOwn(d,'value')?d.value:null;}
function methods(owner){if(!owner||types.isProxy(owner))return null;const out={};for(const n of['retire','join','close']){const d=Object.getOwnPropertyDescriptor(owner,n);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')return null;out[n]=d.value;}return out;}
export function captureOriginalIDECloudRetainedGETPrivate(lookupResult,originalSelector){
 const lookup=lookupResult.owner;
 if(lookupResult.failed){const e=fail('IDE_CLOUD_PROJECT_LOOKUP_ACQUISITION_FAILED');e.cause=lookupResult.error;e.originalFailurePresent=true;e.partial=lookup;throw e;}
 let controller=null,partial=null,partialMethods=null,partialRetired=false,partialRetireFailed=false,partialRetireCause,partialJoined=false,partialClosed=false,partialCloseSelected=false,partialCloseFailure=false,partialCloseCause;
 let retired=false,closed=false,firstPresent=false,first,closing=null;
 const remember=e=>{if(!firstPresent){firstPresent=true;first=e;}};
 function retire(){retired=true;let failed=false,cause;const run=f=>{try{if(f()!==undefined)throw fail('IDE_CLOUD_COMPOSITION_RETIRE_PENDING')}catch(e){remember(e);if(!failed){failed=true;cause=e}}};if(controller)run(()=>controller.retire());if(partial&&!partialRetired){if(!partialMethods)run(()=>{throw fail('IDE_CLOUD_COMPOSITION_UNCLASSIFIED_PARTIAL')});else{partialRetired=true;run(()=>{try{if(Reflect.apply(partialMethods.retire,partial,[])!==undefined)throw fail('IDE_CLOUD_COMPOSITION_RETIRE_PENDING')}catch(e){partialRetireFailed=true;partialRetireCause=e;throw e}});}}run(()=>lookup.retire());if(failed)throw cause;}
 async function join(){if(!retired)throw fail('IDE_CLOUD_COMPOSITION_NOT_RETIRED');
  if(controller){await controller.join();if(controller.status().cleanupDebt)throw fail('IDE_CLOUD_COMPOSITION_GET_DEBT');}
  if(partial&&!partialClosed){if(partialRetireFailed)throw partialRetireCause;if(!partialMethods)throw fail('IDE_CLOUD_COMPOSITION_UNCLASSIFIED_PARTIAL');if(!partialJoined){if(await Reflect.apply(partialMethods.join,partial,[])!==undefined)throw fail('IDE_CLOUD_COMPOSITION_JOIN_PENDING');partialJoined=true;}if(partialCloseSelected){if(partialCloseFailure)throw partialCloseCause;}else{partialCloseSelected=true;try{if(await Reflect.apply(partialMethods.close,partial,[])!==undefined)throw fail('IDE_CLOUD_COMPOSITION_CLOSE_PENDING');partialClosed=true;}catch(e){partialCloseFailure=true;partialCloseCause=e;remember(e);throw e;}}}
  if(lookup.join()!==undefined)throw fail('IDE_CLOUD_COMPOSITION_JOIN_PENDING');
 }
 function close(){return closing??=(async()=>{if(closed)return;retire();await join();if(lookup.close()!==undefined)throw fail('IDE_CLOUD_COMPOSITION_CLOSE_PENDING');closed=true;})().catch(e=>{remember(e);throw e}).finally(()=>{closing=null});}
 const live=()=>{if(retired||closed||firstPresent)throw firstPresent?first:fail('IDE_CLOUD_COMPOSITION_RETIRED');lookup.assertCurrent();};
 const owner=Object.freeze({
  assertCurrent:live,readOriginalMappingDATA(){live();return lookup.readOriginalMappingDATA()},
  prepareOriginalGETRequest(r,c){live();const ticket=controller.prepareOriginalGETRequest(r,c);live();return ticket},
  readOriginalRequestDATA(t){return controller.readOriginalRequestDATA(t)},
  async recheckOriginalGETRequest(t){live();const out=await controller.recheckOriginalGETRequest(t);live();return out},
  // Completion/cleanup observes the same original even after cancel/retire.
  // Do not call live(), replace signal, reacquire Source or create new proof.
  finishOriginalGETRequest(t){if(!controller)throw fail('IDE_CLOUD_COMPOSITION_GET_NOT_SUPPLIED');return controller.finishOriginalGETRequest(t)},
  drainOriginalGETRequest(t){if(!controller)throw fail('IDE_CLOUD_COMPOSITION_GET_NOT_SUPPLIED');return controller.drainOriginalGETRequest(t)},
  getDeploymentRequestHeaders(...args){live();return controller.getDeploymentRequestHeaders(...args)},retire,join,close,
  statusDATA(){return Object.freeze({retired,closed,firstCausePresent:firstPresent,firstCause:first,GET:controller?.status()??null,partialDebt:partial!==null&&!partialClosed,lookup:lookup.statusDATA(),RootAdmission:false,SourceAdmission:false,NativeAdmission:false,CloudGETProof:false})}
 });
 try{lookup.assertCurrent();controller=acquireOriginalIDECloudGETRequestController(originalSelector);live();return owner;}
 catch(error){partial=ownPartial(error);partialMethods=partial?methods(partial):null;remember(error);const e=fail('IDE_CLOUD_RETAINED_GET_ACQUISITION_FAILED');e.cause=error;e.originalFailurePresent=true;e.partial=owner;throw e;}
}
