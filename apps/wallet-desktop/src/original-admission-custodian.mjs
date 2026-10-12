// Private original-Vault owner refs. No renderer DTO, serialized reference,
// PID, descriptor or standalone caller can recover an owner from these refs.
import {captureOriginalAdmissionProductionContext,assertOriginalAdmissionVault} from './password-wallet-vault.mjs';
const owners=new WeakMap();
const failure=code=>Object.assign(new Error(code),{code});
// Fixed private source slot. No public installation/registration operation.
// The independently admitted configuration/executor is genuinely unavailable.
const originalConfigurationSource=null;
const configurations=new WeakMap(),configurationDebt=new Set(),retainedConfigurationOutcomes=new Set();
function configuration(ref){const state=configurations.get(ref);if(!state)throw failure('ADMISSION_CONFIGURATION_OWNER_REQUIRED');return state;}
function configurationCurrent(state){if(state.retired||state.closed)throw state.hasFirst?state.first:failure('ADMISSION_CONFIGURATION_RETIRED');}
function configurationFirst(state,cause){if(!state.hasFirst){state.first=cause;state.hasFirst=true;}}
export async function acquireOriginalAdmissionConfiguration(vault,guard){
  assertOriginalAdmissionVault(vault);
  if(!guard||typeof guard.assert!=='function')throw failure('WALLET_LOCKED');
  if(configurationDebt.size||retainedConfigurationOutcomes.size)throw failure('ADMISSION_CONFIGURATION_UNRESOLVED');
  guard.assert();await vault.assertOriginalServiceAdmissionConfigurationCurrent(guard);guard.assert();
  if(originalConfigurationSource===null)return null;
  // Only an independently implemented original source may inhabit this slot.
  // Capture a returned selection before post-current checks; no DTO registration.
  const source=originalConfigurationSource;
  const original=await source.acquire(vault,guard);
  if(original===null){guard.assert();return null;}
  const state={source,original,retired:false,closed:false,first:null,hasFirst:false,retireFailed:false,retireCause:null,entered:new Set(),joining:null,closing:null};
  configurationDebt.add(state);
  const ref={};
  configurations.set(ref,state);
  try{
    guard.assert();
    state.raw=original.raw;state.executor=original.executor;state.observer=original.observer;
    Object.assign(ref,{vault,raw:state.raw,executor:state.executor,observer:state.observer,
      assertCurrent:()=>{configurationCurrent(state);guard.assert();const result=source.assertCurrent(original,vault,guard);configurationCurrent(state);guard.assert();return result;},
      assertExecutorCurrent:(executor,child)=>{configurationCurrent(state);guard.assert();const result=source.assertExecutorCurrent(original,executor,child);configurationCurrent(state);guard.assert();return result;},
      assertAdmissionSuccession:request=>{configurationCurrent(state);guard.assert();const result=source.assertAdmissionSuccession(original,request);configurationCurrent(state);guard.assert();return result;}});
    Object.freeze(ref);
    if(original.vault!==vault||ref.assertCurrent()!==undefined||ref.assertExecutorCurrent(state.executor,null)!==undefined)throw failure('ADMISSION_CURRENT_INVALID');
    configurationDebt.delete(state);return ref;
  }
  catch(cause){configurationFirst(state,cause);try{await closeOriginalAdmissionConfiguration(ref);}catch{}throw cause;}
}
export function retireOriginalAdmissionConfiguration(ref){
  const state=configuration(ref);if(state.retired)return undefined;
  state.retired=true;configurationDebt.add(state);
  try{if(state.source.retire(state.original)!==undefined)throw failure('ADMISSION_CONFIGURATION_CLEANUP_UNKNOWN');}
  catch(cause){state.retireFailed=true;state.retireCause=cause;configurationFirst(state,cause);throw cause;}return undefined;
}
export function joinOriginalAdmissionConfiguration(ref){
  const state=configuration(ref);if(!state.retired)throw failure('ADMISSION_CONFIGURATION_NOT_RETIRED');
  if(state.joining)return state.joining;
  state.joining=Promise.resolve().then(async()=>{
    while(state.entered.size)await Promise.allSettled([...state.entered]);
    if(await state.source.join(state.original)!==undefined)throw failure('ADMISSION_CONFIGURATION_CLEANUP_UNKNOWN');return undefined;
  });return state.joining;
}
export function closeOriginalAdmissionConfiguration(ref){
  const state=configuration(ref);if(state.closing)return state.closing;
  // Promise assigned before the first foreign hook: same ref, same close once.
  state.closing=Promise.resolve().then(async()=>{
    retireOriginalAdmissionConfiguration(ref);await joinOriginalAdmissionConfiguration(ref);
    if(state.retireFailed)throw state.retireCause;
    if(await state.source.close(state.original)!==undefined)throw failure('ADMISSION_CONFIGURATION_CLEANUP_UNKNOWN');
    state.closed=true;
    if(state.hasFirst)retainedConfigurationOutcomes.add(state);
    configurationDebt.delete(state);return undefined;
  }).catch(cause=>{configurationFirst(state,cause);configurationDebt.add(state);throw cause;});
  return state.closing;
}
function owned(ref){const state=owners.get(ref);if(!state)throw failure('ADMISSION_ORIGINAL_OWNER_REQUIRED');return state;}
function retainFirst(state,error){if(!state.hasFirst){state.first=error;state.hasFirst=true;}}
function retire(state,error){state.retired=true;retainFirst(state,error);}
function current(state){if(state.retired||state.closed)throw state.hasFirst?state.first:failure('ADMISSION_OPERATION_RETIRED');}
function track(state,operation){
  const promise=Promise.resolve().then(operation);
  state.entered.add(promise);
  void promise.then(()=>state.entered.delete(promise),()=>state.entered.delete(promise));
  return promise;
}
/** Called only by the same Vault after its genuine resources were verified.
 * Hooks close over that actual Vault; this helper itself grants no ROLE. */
export function retainOriginalAdmissionCustodian(context){
  const {assertCurrent,publish,dispose,enterDelivery,acknowledgeDelivery,unknownDelivery}=captureOriginalAdmissionProductionContext(context);
  if([assertCurrent,publish,dispose].some(fn=>typeof fn!=='function'))throw failure('ADMISSION_CUSTODIAN_INVALID');
  const ref=Object.freeze({});
  owners.set(ref,{assertCurrent,publish,dispose,enterDelivery,acknowledgeDelivery,unknownDelivery,entered:new Set(),checking:false,publishing:false,attempted:false,retired:false,closed:false,first:null,hasFirst:false,partial:null,result:null,closing:null,delivery:'not-entered',deliveryBusy:false});
  return ref;
}
export async function assertOriginalServiceAdmissionProductionOwner(ref){
  const state=owned(ref);current(state);
  if(state.checking){const error=failure('ADMISSION_CUSTODIAN_REENTRY');retire(state,error);throw error;}
  state.checking=true;
  try{return await track(state,async()=>{current(state);if(await state.assertCurrent()!==undefined)throw failure('ADMISSION_CURRENT_INVALID');current(state);return undefined;});}
  catch(error){retire(state,error);throw error;}finally{state.checking=false;}
}
export async function publishOriginalServiceAdmissionProduction(ref){
  const state=owned(ref);current(state);
  // Reserve before entering any original/foreign callback. UNKNOWN is sticky;
  // even a failed pre-sign attempt is not a new publication permission.
  if(state.publishing||state.attempted){const error=failure('ADMISSION_PUBLICATION_ALREADY_ENTERED');retire(state,error);throw error;}
  state.attempted=true;state.publishing=true;
  const partial={phase:'entered',runtimeNonce:null,requestNonce:null,runtime:null,publication:null,installed:null};state.partial=partial;
  try{return await track(state,async()=>{
    await assertOriginalServiceAdmissionProductionOwner(ref);current(state);
    const result=await state.publish(partial,()=>current(state));
    state.result=result; // original returned result is retained before fencing
    current(state);return result;
  });}catch(error){retire(state,error);throw error;}finally{state.publishing=false;}
}
/** Immediately revoke business. Join entered calls, then source-defined
 * disposal. This Promise resolves undefined ONLY when cleanup completed.
 * It never invokes the retired business guard. Failure retains ref/partial/
 * first cause; calling close again observes the SAME Promise, no retry. */
export function closeOriginalServiceAdmissionProductionOwner(ref){
  const state=owned(ref);retire(state,failure('ADMISSION_OPERATION_RETIRED'));
  if(state.closing)return state.closing;
  state.closing=(async()=>{
    await Promise.allSettled([...state.entered]);
    const result=await state.dispose();
    if(result!==undefined)throw failure('ADMISSION_CLEANUP_INCOMPLETE');
    state.closed=true;return undefined;
  })().catch(error=>{retainFirst(state,error);throw error;});
  return state.closing;
}
/** Explicit selected-source completion ABI, not arbitrary Promise adoption. */
export async function completeOriginalServiceAdmissionProductionClose(ref,result){
  const state=owned(ref);
  if(!state.closing||result!==state.closing||!state.retired)throw failure('ADMISSION_CLOSE_RESULT_UNKNOWN');
  if(await state.closing!==undefined||!state.closed)throw failure('ADMISSION_CLEANUP_INCOMPLETE');
  return undefined;
}
/** Trusted original-main observation of PUBLIC returned originals only.
 * Resource disposal may finish without discarding these original bytes.
 * Observation does not call business-current or restore any authority. The
 * caller must retain this same ref; snapshots cannot register a new owner. */
export function selectOriginalServiceAdmissionProductionOutcome(ref,observer){
  const state=owned(ref);
  if(typeof observer!=='function')throw failure('ADMISSION_RECOVERY_OBSERVER_INVALID');
  return observer(Object.freeze({partial:state.partial?Object.freeze({...state.partial}):null,result:state.result,firstCause:state.first,firstCausePresent:state.hasFirst,retired:state.retired,resourcesClosed:state.closed}));
}
async function deliveryStep(ref,kind,cause){
  const state=owned(ref);current(state);
  if(!state.result||state.deliveryBusy||kind==='enter'&&state.delivery!=='not-entered'||kind!=='enter'&&state.delivery!=='entered')throw failure('ADMISSION_DELIVERY_STATE_UNKNOWN');
  state.deliveryBusy=true;
  // Reserve before callbacks; lost persistence/ACK leaves original unresolved.
  if(kind==='enter')state.delivery='entered';
  try{return await track(state,async()=>{
    await assertOriginalServiceAdmissionProductionOwner(ref);current(state);
    const hook=kind==='enter'?state.enterDelivery:kind==='ack'?state.acknowledgeDelivery:state.unknownDelivery;
    if(typeof hook!=='function')throw failure('ADMISSION_DELIVERY_NOT_SUPPLIED');
    if(await hook(state.result,cause)!==undefined)throw failure('ADMISSION_DELIVERY_STATE_UNKNOWN');
    current(state);if(kind==='ack')state.delivery='acknowledged';if(kind==='unknown')state.delivery='UNKNOWN';return undefined;
  });}catch(error){retire(state,error);throw error;}finally{state.deliveryBusy=false;}
}
export function enterOriginalServiceAdmissionDelivery(ref){return deliveryStep(ref,'enter');}
export function acknowledgeOriginalServiceAdmissionDelivery(ref){return deliveryStep(ref,'ack');}
export function markOriginalServiceAdmissionDeliveryUnknown(ref,cause){return deliveryStep(ref,'unknown',cause);}
