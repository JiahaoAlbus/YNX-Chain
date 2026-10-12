import {admissionCanonical} from './original-admission-broker.mjs';
import {bindOriginalAdmissionParentSelection} from './original-admission-parent-source.mjs';
const failure=code=>Object.assign(new Error(code),{code});
const selections=new WeakMap(),unresolved=new Set();
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function release(state){
  if(state.closing)return state.closing;
  state.closing=Promise.resolve().then(async()=>{
    const api=state.original;
    if(['retireOriginalAdmissionConfiguration','joinOriginalAdmissionConfiguration','closeOriginalAdmissionConfiguration'].some(k=>typeof api[k]!=='function'))throw failure('ADMISSION_CONFIGURATION_CLEANUP_NOT_SUPPLIED');
    if(api.retireOriginalAdmissionConfiguration(state.configured)!==undefined)throw failure('ADMISSION_CONFIGURATION_CLEANUP_UNKNOWN');
    if(await api.joinOriginalAdmissionConfiguration(state.configured)!==undefined)throw failure('ADMISSION_CONFIGURATION_CLEANUP_UNKNOWN');
    if(await api.closeOriginalAdmissionConfiguration(state.configured)!==undefined)throw failure('ADMISSION_CONFIGURATION_CLEANUP_UNKNOWN');
    state.closed=true;
    // Known resource completion does not discard a late returned original.
    if(!state.operationCausePresent)unresolved.delete(state);
  });
  void state.closing.catch(error=>{state.cleanupCause=error;state.cleanupFailed=true;unresolved.add(state);});
  return state.closing;
}
export function originalAdmissionSelectionUnresolved(){return unresolved.size!==0;}
export function closeOriginalAdmissionSupply(supply){
  const state=selections.get(supply);if(!state)throw failure('ADMISSION_CONFIGURATION_OWNER_REQUIRED');
  return release(state);
}
export async function openOriginalAdmissionSupply(vault,guard){
  // Selection is made only inside an explicit original-main reviewed run.
  // Optional namespace lookup keeps the standalone Wallet usable while Auth's
  // genuine fixed producer is absent. A missing producer is not an empty vault.
  if(!guard||typeof guard.assert!=='function')throw failure('WALLET_LOCKED');
  if(unresolved.size)throw failure('ADMISSION_CONFIGURATION_UNRESOLVED');
  guard.assert();
  const original=await import('./original-admission-custodian.mjs');
  guard.assert();
  if(typeof original.acquireOriginalAdmissionConfiguration!=='function')throw failure('ADMISSION_CONFIGURATION_PRODUCER_NOT_IMPLEMENTED');
  const configured=await original.acquireOriginalAdmissionConfiguration(vault,guard);
  if(configured===null){guard.assert();return null;}
  const state={original,configured,closing:null,closed:false,cleanupFailed:false,cleanupCause:null,operationCause:null,operationCausePresent:false};
  unresolved.add(state); // Exact returned custody captured before any fence.
  try{
    guard.assert();
    if(configured.vault!==vault||['assertCurrent','assertExecutorCurrent','assertAdmissionSuccession'].some(k=>typeof configured[k]!=='function'))throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');
    if(['retireOriginalAdmissionConfiguration','joinOriginalAdmissionConfiguration','closeOriginalAdmissionConfiguration'].some(k=>typeof original[k]!=='function'))throw failure('ADMISSION_CONFIGURATION_CLEANUP_NOT_SUPPLIED');
    if(configured.assertCurrent()!==undefined||configured.assertExecutorCurrent(configured.executor,null)!==undefined)throw failure('ADMISSION_CURRENT_INVALID');
    const raw=freeze(JSON.parse(admissionCanonical(configured.raw))),executor=freeze(JSON.parse(admissionCanonical(configured.executor)));
    const assertCurrent=()=>{if(state.closed||state.closing)throw failure('ADMISSION_CONFIGURATION_RETIRED');return configured.assertCurrent();};
    const assertExecutorCurrent=(value,child)=>{assertCurrent();return configured.assertExecutorCurrent(value,child);};
    const supply=Object.freeze({vault,raw,executor,observer:configured.observer,assertCurrent,assertExecutorCurrent,assertAdmissionSuccession:request=>{assertCurrent();return configured.assertAdmissionSuccession(request);},assertOriginalServiceAdmissionProductionOwner:original.assertOriginalServiceAdmissionProductionOwner,publishOriginalServiceAdmissionProduction:original.publishOriginalServiceAdmissionProduction,closeOriginalServiceAdmissionProductionOwner:original.closeOriginalServiceAdmissionProductionOwner,completeOriginalServiceAdmissionProductionClose:original.completeOriginalServiceAdmissionProductionClose,selectOriginalServiceAdmissionProductionOutcome:original.selectOriginalServiceAdmissionProductionOutcome,enterOriginalServiceAdmissionDelivery:original.enterOriginalServiceAdmissionDelivery,acknowledgeOriginalServiceAdmissionDelivery:original.acknowledgeOriginalServiceAdmissionDelivery,markOriginalServiceAdmissionDeliveryUnknown:original.markOriginalServiceAdmissionDeliveryUnknown});
    bindOriginalAdmissionParentSelection(assertExecutorCurrent,{vault,raw,executor,assertCurrent,originalConfiguration:configured});
    selections.set(supply,state);guard.assert();
    if(supply.assertCurrent()!==undefined)throw failure('ADMISSION_CURRENT_INVALID');
    unresolved.delete(state);return supply;
  }catch(error){state.operationCause=error;state.operationCausePresent=true;try{await release(state);}catch{/* Preserve original cause and retained custody. */}throw error;}
}

// SAME-Vault producer summary; never send a raw catalog or read-by-nonce result.
export function projectOriginalAdmissionSummary(summary,account){
  if(!summary||summary.account!==account||!Array.isArray(summary.records)||summary.records.length>32||!Array.isArray(summary.runtimeRecords)||summary.runtimeRecords.length>64)throw failure('ADMISSION_SUMMARY_INVALID');
  const nonce=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
  const records=[],runtimeRecords=[],seen=new Set();
  for(const record of summary.records){
    if(!record||!nonce(record.requestNonce)||seen.has(record.requestNonce)||!['pending','UNKNOWN','signed'].includes(record.state)||![null,'entered','UNKNOWN','acknowledged'].includes(record.deliveryState)||record.state!=='signed'&&record.deliveryState!==null)throw failure('ADMISSION_SUMMARY_INVALID');
    seen.add(record.requestNonce);records.push(Object.freeze({requestNonce:record.requestNonce,state:record.state,deliveryState:record.deliveryState}));
  }
  seen.clear();
  for(const record of summary.runtimeRecords){
    if(!record||!nonce(record.nonce)||seen.has(record.nonce)||!['pending','UNKNOWN','signed'].includes(record.state))throw failure('ADMISSION_SUMMARY_INVALID');
    seen.add(record.nonce);runtimeRecords.push(Object.freeze({nonce:record.nonce,state:record.state}));
  }
  const unresolved=records.some(r=>r.state!=='signed'||r.deliveryState!=='acknowledged')||runtimeRecords.some(r=>r.state!=='signed'||!records.some(a=>a.requestNonce===r.nonce&&a.deliveryState==='acknowledged'));
  return Object.freeze({state:'read',account,records:Object.freeze(records),runtimeRecords:Object.freeze(runtimeRecords),unresolved});
}
export async function readOriginalAdmissionSummary(vault,guard){
  guard.assert();
  if(typeof vault?.readOriginalServiceAdmissionSummary!=='function')return Object.freeze({state:'not-supplied',account:guard.account,records:null,runtimeRecords:null,unresolved:null});
  const summary=await vault.readOriginalServiceAdmissionSummary(guard);
  guard.assert();return projectOriginalAdmissionSummary(summary,guard.account);
}
