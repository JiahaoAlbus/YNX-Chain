import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {assertOriginalAdmissionVault,captureOriginalServiceRoleLocalCurrentSource} from '../../../apps/wallet-desktop/src/password-wallet-vault.mjs';

// Fixed packaged implementing module. No path/provider/callback option and no
// public setter. These exports are an implementation dependency, NOT existing
// Native qualification proved by JavaScript or by a .node type tag.
const requireOriginal=createRequire(import.meta.url);
const loadOriginalNative=()=>requireOriginal(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)));
const startups=new WeakMap(),owned=new WeakMap(),debt=new Set();
const failure=code=>Object.assign(new Error(code),{code});
const methods=['acquireOriginalAdministrationProfile','readOriginalAdministrationProfile','assertOriginalAdministrationProfileCurrent','retireOriginalAdministrationProfile','joinOriginalAdministrationProfile','closeOriginalAdministrationProfile','reserveOriginalJointRegistration','commitOriginalJointRegistration','readOriginalJointRegistration','assertOriginalJointCurrent','assertOriginalJointExecutorChild','assertOriginalJointSuccession','retireOriginalJoint','joinOriginalJoint','closeOriginalJoint'];
function state(ref){const s=owned.get(ref);if(!s)throw failure('AUTH_IDENTITY_ORIGINAL_JOINT_OWNER_REQUIRED');return s;}
function first(s,cause){if(!s.firstPresent){s.firstPresent=true;s.firstCause=cause;}}
function live(s){if(s.retired)throw s.firstPresent?s.firstCause:failure('AUTH_IDENTITY_JOINT_RETIRED');}
export function initializeOriginalAuthIdentityPrivateStartup(vault){
 assertOriginalAdmissionVault(vault);if(startups.has(vault))throw failure('AUTH_IDENTITY_STARTUP_ALREADY_SELECTED');
 const entry={binding:null,firstPresent:false,firstCause:undefined,acquisitions:new Set()};startups.set(vault,entry);
 try{const binding=loadOriginalNative();if(methods.some(name=>typeof binding?.[name]!=='function'))throw failure('AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED');entry.binding=binding;return undefined;}
 catch(cause){entry.firstPresent=true;entry.firstCause=cause;throw failure('AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED');}
}
export function originalAuthIdentityStartupStatus(vault){
 assertOriginalAdmissionVault(vault);const entry=startups.get(vault);
 return Object.freeze({initialized:!!entry,implementingModuleAvailable:!!entry?.binding,nativeQualified:false,resourceSupplied:false});
}
function current(s){
 try{
 live(s);s.guard.assert();
 if(s.binding.assertOriginalAdministrationProfileCurrent(s.administration)!==undefined)throw failure('AUTH_IDENTITY_ADMINISTRATION_CHANGED');
 s.local.assertObservationCurrent(s.localOriginal);
 if(s.binding.assertOriginalJointCurrent(s.joint,s.localOriginal)!==undefined)throw failure('AUTH_IDENTITY_JOINT_CHANGED');
 s.guard.assert();live(s);return undefined;
 }catch(cause){first(s,cause);s.retired=true;s.unknown=true;debt.add(s);throw cause;}
}
export async function acquireOriginalAuthIdentityJointConfiguration(vault,guard){
 assertOriginalAdmissionVault(vault);if(debt.size)throw failure('AUTH_IDENTITY_JOINT_UNRESOLVED');guard.assert();
 const startup=startups.get(vault);if(!startup?.binding)throw failure('AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED');
 const s={binding:startup.binding,vault,guard,administration:null,local:null,localOriginal:null,joint:null,result:null,retired:false,firstPresent:false,firstCause:undefined,unknown:false,closing:null,entered:new Set(),cleanupFailurePresent:false};
 const ref=Object.freeze({});owned.set(ref,s);debt.add(s);startup.acquisitions.add(ref);
 const acquisition=Promise.resolve().then(async()=>{
  // Native reads its original protected administration/profile, not caller JSON.
  s.administration=await s.binding.acquireOriginalAdministrationProfile();
  if(s.administration===null)throw failure('AUTH_IDENTITY_ORIGINAL_PROFILE_NOT_SUPPLIED');guard.assert();
  const selected=s.binding.readOriginalAdministrationProfile(s.administration);
  if(s.binding.assertOriginalAdministrationProfileCurrent(s.administration)!==undefined)throw failure('AUTH_IDENTITY_ADMINISTRATION_CHANGED');
  const localRef=await vault.acquireOriginalServiceRoleLocalCurrentSource(selected.expectedLocalCurrent,guard);
  s.local=captureOriginalServiceRoleLocalCurrentSource(localRef);s.localOriginal=await s.local.read();guard.assert();
  const association=selected.association;
  if(!association||['account','clientId','productId','platform','applicationId','deviceId'].some(k=>typeof association[k]!=='string'||!association[k])||association.account!==s.localOriginal.account)throw failure('AUTH_IDENTITY_ASSOCIATION_MISMATCH');
  // Reservation/commit/readback are executed by the same protected Native
  // owner. This JS inventory retains custody; it never supplies the approval.
  if(s.local.vault!==vault)throw failure('AUTH_IDENTITY_ORIGINAL_VAULT_MISMATCH');
  s.joint=await s.binding.reserveOriginalJointRegistration(s.administration,s.localOriginal,s.local.vault);
  if(!s.joint)throw failure('AUTH_IDENTITY_ORIGINAL_JOINT_NOT_SUPPLIED');
  s.unknown=true;
  s.result=await s.binding.commitOriginalJointRegistration(s.joint);
  guard.assert();s.local.assertObservationCurrent(s.localOriginal);
  const installed=s.binding.readOriginalJointRegistration(s.joint,s.result);
  s.installed=installed; // original returned readback captured before last fences
  if(!installed||installed.vault!==vault||!installed.association||installed.association.account!==association.account||['clientId','productId','platform','applicationId','deviceId'].some(k=>installed.association[k]!==association[k])||!installed.raw||!installed.executor||!installed.observer)throw failure('AUTH_IDENTITY_REGISTERED_ASSOCIATION_MISMATCH');
  s.installed=installed;current(s);s.unknown=false;debt.delete(s);return ref;
 });s.entered.add(acquisition);void acquisition.then(()=>s.entered.delete(acquisition),()=>s.entered.delete(acquisition));
 try{return await acquisition;}catch(cause){first(s,cause);void closeOriginalAuthIdentityJointConfiguration(ref).catch(()=>{});throw cause;}
}
export function readOriginalAuthIdentityJointConfiguration(ref){const s=state(ref);current(s);return Object.freeze({vault:s.vault,raw:s.installed.raw,executor:s.installed.executor,observer:s.installed.observer});}
export function assertOriginalAuthIdentityJointCurrent(ref){return current(state(ref));}
export function assertOriginalAuthIdentityJointExecutorChild(ref,executor,child){const s=state(ref);current(s);if(executor!==s.installed.executor||s.binding.assertOriginalJointExecutorChild(s.joint,executor,child)!==undefined)throw failure('AUTH_IDENTITY_EXECUTOR_CHILD_MISMATCH');return current(s);}
export function assertOriginalAuthIdentityJointSuccession(ref,request){const s=state(ref);current(s);if(s.binding.assertOriginalJointSuccession(s.joint,request)!==undefined)throw failure('AUTH_IDENTITY_SUCCESSION_MISMATCH');return current(s);}
export function retireOriginalAuthIdentityJointConfiguration(ref){
 const s=state(ref);s.retired=true;let failed=false,cause;
 for(const host of s.ideHosts??[])try{host.retire();}catch(error){if(!failed){failed=true;cause=error;}}
 if(failed)throw cause;return undefined;
}
export function joinOriginalAuthIdentityJointConfiguration(ref){const s=state(ref);return Promise.resolve().then(async()=>{while(s.entered.size)await Promise.allSettled([...s.entered]);return undefined;});}
export function closeOriginalAuthIdentityJointConfiguration(ref){
 const s=state(ref);if(s.closing)return s.closing;s.retired=true;debt.add(s);
 s.closing=Promise.resolve().then(async()=>{
  while(s.entered.size)await Promise.allSettled([...s.entered]);
  let failed=false,cause;
  const cleanup=async operation=>{try{if(await operation()!==undefined)throw failure('AUTH_IDENTITY_CLEANUP_INCOMPLETE');}catch(error){if(!failed){failed=true;cause=error;}}};
  for(const host of s.ideHosts??[])await cleanup(()=>host.close());
  if(s.joint){await cleanup(()=>s.binding.retireOriginalJoint(s.joint));await cleanup(()=>s.binding.joinOriginalJoint(s.joint));await cleanup(()=>s.binding.closeOriginalJoint(s.joint));}
  if(s.local)await cleanup(()=>s.local.close());
  if(s.administration){await cleanup(()=>s.binding.retireOriginalAdministrationProfile(s.administration));await cleanup(()=>s.binding.joinOriginalAdministrationProfile(s.administration));await cleanup(()=>s.binding.closeOriginalAdministrationProfile(s.administration));}
  if(failed)throw cause;s.cleanupComplete=true;if(!s.unknown)debt.delete(s);return undefined;
 }).catch(cause=>{s.cleanupFailurePresent=true;first(s,cause);throw cause;});return s.closing;
}
export function originalAuthIdentityJointOutcome(ref){const s=state(ref);return Object.freeze({result:s.result,unknown:s.unknown,firstCausePresent:s.firstPresent,cleanupFailurePresent:s.cleanupFailurePresent});}
export function originalAuthIdentityStartupUnresolved(vault){
 if(vault===null)return false;assertOriginalAdmissionVault(vault);const startup=startups.get(vault);
 return startup?[...startup.acquisitions].some(ref=>{const s=state(ref);return !s.cleanupComplete&&(s.retired||s.unknown)||s.unknown||s.cleanupFailurePresent;}):false;
}

// Original-main transport custody only, never an IDE guard or a public factory.
// The only input is an existing private SDK joint ref; the original Native joint
// and intent remain inside this module. No descriptor/path/Source can be injected.
const ideMethods=['reserveOriginalIDEParentIntent','readOriginalIDEParentIntent','beginOriginalIDEParentPrelude','takeOriginalIDEParentSenderDescriptor','readOriginalIDEParentInstalledFrame','assertOriginalIDEParentAcknowledgement','assertOriginalIDEParentIntentCurrent','retireOriginalIDEParentIntent','joinOriginalIDEParentIntent','closeOriginalIDEParentIntent'];
export function reserveOriginalAuthIdentityIDEParentHost(ref){
 const parent=state(ref);current(parent);
 if(parent.ideHostSelected)throw failure('AUTH_IDENTITY_IDE_HOST_ALREADY_SELECTED');
 parent.ideHostSelected=true;
 if(ideMethods.some(name=>typeof parent.binding[name]!=='function'))throw failure('AUTH_IDENTITY_IDE_IMPLEMENTATION_NOT_SUPPLIED');
 const h={native:null,retired:false,unknown:false,firstPresent:false,first:undefined,cleanupPresent:false,cleanup:undefined,retireSelected:false,retireFailed:false,retireCause:undefined,beginSelected:false,beginPromise:null,preludeComplete:false,senderSelected:false,frameSelected:false,ackSelected:false,joining:null,closing:null,closed:false};
 const remember=cause=>{
  h.retired=true;h.unknown=true;if(!h.firstPresent){h.firstPresent=true;h.first=cause;}
  first(parent,cause);parent.unknown=true;parent.retired=true;debt.add(parent);
 };
 const invoke=(name,...args)=>parent.binding[name](h.native,...args);
 const assertCurrent=()=>{
  try{
   if(h.retired||h.closed)throw h.firstPresent?h.first:failure('AUTH_IDENTITY_IDE_HOST_RETIRED');
   current(parent);if(!h.native||invoke('assertOriginalIDEParentIntentCurrent')!==undefined)throw failure('AUTH_IDENTITY_IDE_INTENT_NOT_CURRENT');
   current(parent);if(h.retired||h.closed)throw h.firstPresent?h.first:failure('AUTH_IDENTITY_IDE_HOST_RETIRED');return undefined;
  }catch(cause){remember(cause);throw cause;}
 };
 const call=(name,...args)=>{try{assertCurrent();return invoke(name,...args);}catch(cause){remember(cause);throw cause;}};
 const retire=()=>{
  h.retired=true;if(h.retireSelected){if(h.retireFailed)throw h.retireCause;return undefined;}h.retireSelected=true;
  try{if(!h.native){if(h.firstPresent)throw h.first;return undefined;}if(invoke('retireOriginalIDEParentIntent')!==undefined)throw failure('AUTH_IDENTITY_IDE_RETIRE_INCOMPLETE');return undefined;}
  catch(cause){h.retireFailed=true;h.retireCause=cause;remember(cause);throw cause;}
 };
 const join=()=>{
  if(h.joining)return h.joining;
  if(!h.retireSelected)throw failure('AUTH_IDENTITY_IDE_INTENT_NOT_RETIRED');
  h.joining=Promise.resolve().then(async()=>{
   if(!h.native){if(h.firstPresent)throw h.first;return undefined;}
   const result=invoke('joinOriginalIDEParentIntent');
   if(!types.isPromise(result)||await result!==undefined)throw failure('AUTH_IDENTITY_IDE_JOIN_INCOMPLETE');return undefined;
  });void h.joining.catch(()=>{});return h.joining;
 };
 const close=()=>{
  if(h.closing)return h.closing;
  h.retired=true;
  // Reserve the pass before any Native retire hook can synchronously reenter.
  h.closing=Promise.resolve().then(async()=>{
   let failed=false,cause;
   const cleanup=async operation=>{try{if(await operation()!==undefined)throw failure('AUTH_IDENTITY_IDE_CLEANUP_INCOMPLETE');}catch(error){if(!failed){failed=true;cause=error;}}};
   await cleanup(retire);await cleanup(join);
   await cleanup(async()=>{
    if(!h.native){if(h.firstPresent)throw h.first;return undefined;}
    const result=invoke('closeOriginalIDEParentIntent');
    if(!types.isPromise(result)||await result!==undefined)throw failure('AUTH_IDENTITY_IDE_CLOSE_INCOMPLETE');return undefined;
   });
   if(failed){h.cleanupPresent=true;h.cleanup=cause;remember(cause);throw cause;}
   h.closed=true;return undefined;
  });void h.closing.catch(()=>{});return h.closing;
 };
 const api=Object.freeze({
  assertCurrent,
  readPending:()=>call('readOriginalIDEParentIntent'),
  beginPrelude(){
   try{
    assertCurrent();if(h.beginSelected)throw failure('AUTH_IDENTITY_IDE_PRELUDE_ALREADY_SELECTED');h.beginSelected=true;
    // Enter Native now, without a microtask/await, so its worker can service
    // the caller's immediately following real spawn and inherited fd4.
    const result=invoke('beginOriginalIDEParentPrelude');
    if(!types.isPromise(result))throw failure('AUTH_IDENTITY_IDE_PRELUDE_PROMISE_REQUIRED');
    h.beginPromise=result.then(value=>{if(value!==undefined)throw failure('AUTH_IDENTITY_IDE_PRELUDE_INCOMPLETE');assertCurrent();h.preludeComplete=true;return undefined;}).catch(cause=>{remember(cause);throw cause;});
    void h.beginPromise.catch(()=>{});return h.beginPromise;
   }catch(cause){remember(cause);throw cause;}
  },
  takeSenderDescriptor(){
   try{assertCurrent();if(!h.preludeComplete||h.senderSelected)throw failure('AUTH_IDENTITY_IDE_SENDER_NOT_AVAILABLE');h.senderSelected=true;
    // Native transfers this exact duplicate to caller custody. No post-call
    // JS fence may throw and discard it before the caller captures ownership.
    return invoke('takeOriginalIDEParentSenderDescriptor');
   }catch(cause){remember(cause);throw cause;}
  },
  readInstalledFrame(){
   try{assertCurrent();if(!h.preludeComplete||!h.senderSelected||h.frameSelected)throw failure('AUTH_IDENTITY_IDE_FRAME_NOT_AVAILABLE');h.frameSelected=true;return invoke('readOriginalIDEParentInstalledFrame');}
   catch(cause){remember(cause);throw cause;}
  },
  acknowledge(raw){
   try{assertCurrent();if(!h.frameSelected||h.ackSelected)throw failure('AUTH_IDENTITY_IDE_ACK_NOT_AVAILABLE');h.ackSelected=true;
    if(invoke('assertOriginalIDEParentAcknowledgement',raw)!==undefined)throw failure('AUTH_IDENTITY_IDE_ACK_INCOMPLETE');return assertCurrent();
   }catch(cause){remember(cause);throw cause;}
  },
  retire,join,close,
  outcome:()=>Object.freeze({nativeIntentRetained:h.native!==null,preludeStarted:h.beginSelected,preludeComplete:h.preludeComplete,senderTaken:h.senderSelected,retired:h.retired,unknown:h.unknown,firstCausePresent:h.firstPresent,firstCause:h.first,cleanupCausePresent:h.cleanupPresent,cleanupCause:h.cleanup,cleanupComplete:h.closed}),
 });
 (parent.ideHosts??=new Set()).add(api);
 try{h.native=parent.binding.reserveOriginalIDEParentIntent(parent.joint);if(!h.native)throw failure('AUTH_IDENTITY_IDE_ORIGINAL_INTENT_NOT_SUPPLIED');}
 catch(cause){remember(cause);} // Return exact partial SDK custody for cleanup.
 return api;
}
