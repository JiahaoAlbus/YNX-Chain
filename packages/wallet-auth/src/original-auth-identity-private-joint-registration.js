import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
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
export function retireOriginalAuthIdentityJointConfiguration(ref){const s=state(ref);s.retired=true;return undefined;}
export function joinOriginalAuthIdentityJointConfiguration(ref){const s=state(ref);return Promise.resolve().then(async()=>{while(s.entered.size)await Promise.allSettled([...s.entered]);return undefined;});}
export function closeOriginalAuthIdentityJointConfiguration(ref){
 const s=state(ref);if(s.closing)return s.closing;s.retired=true;debt.add(s);
 s.closing=Promise.resolve().then(async()=>{
  while(s.entered.size)await Promise.allSettled([...s.entered]);
  let failed=false,cause;
  const cleanup=async operation=>{try{if(await operation()!==undefined)throw failure('AUTH_IDENTITY_CLEANUP_INCOMPLETE');}catch(error){if(!failed){failed=true;cause=error;}}};
  if(s.joint)await cleanup(async()=>{if(s.binding.retireOriginalJoint(s.joint)!==undefined)throw failure('AUTH_IDENTITY_CLEANUP_INCOMPLETE');if(await s.binding.joinOriginalJoint(s.joint)!==undefined)throw failure('AUTH_IDENTITY_CLEANUP_INCOMPLETE');return s.binding.closeOriginalJoint(s.joint);});
  if(s.local)await cleanup(()=>s.local.close());
  if(s.administration)await cleanup(async()=>{if(s.binding.retireOriginalAdministrationProfile(s.administration)!==undefined)throw failure('AUTH_IDENTITY_CLEANUP_INCOMPLETE');if(await s.binding.joinOriginalAdministrationProfile(s.administration)!==undefined)throw failure('AUTH_IDENTITY_CLEANUP_INCOMPLETE');return s.binding.closeOriginalAdministrationProfile(s.administration);});
  if(failed)throw cause;s.cleanupComplete=true;if(!s.unknown)debt.delete(s);return undefined;
 }).catch(cause=>{s.cleanupFailurePresent=true;first(s,cause);throw cause;});return s.closing;
}
export function originalAuthIdentityJointOutcome(ref){const s=state(ref);return Object.freeze({result:s.result,unknown:s.unknown,firstCausePresent:s.firstPresent,cleanupFailurePresent:s.cleanupFailurePresent});}
export function originalAuthIdentityStartupUnresolved(vault){
 if(vault===null)return false;assertOriginalAdmissionVault(vault);const startup=startups.get(vault);
 return startup?[...startup.acquisitions].some(ref=>{const s=state(ref);return !s.cleanupComplete&&(s.retired||s.unknown)||s.unknown||s.cleanupFailurePresent;}):false;
}
