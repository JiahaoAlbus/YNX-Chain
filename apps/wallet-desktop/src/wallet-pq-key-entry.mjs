import {createPQKeyPreparationSource} from './wallet-pq-key-source.mjs';
import {createDualPQKeyPreparation} from './wallet-pq-key-preparation.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
/** Fixed normal-main composition. Renderer supplies no provider, network,
 * owner, private material or persistence receipt. Local custody is not chain
 * registration, backup export, approval, signing or broadcast authority. */
export function createPQKeyPreparationEntry({lifecycle,vault,sdk,networkId,id,onState=()=>{}}){
 if(typeof networkId!=='string'||! /^[a-f0-9]{64}$/.test(networkId))fail('PQ_KEY_BINDING_REQUIRED');
 const originals=new Map(),recoveredStates=new Map();
 const binding=()=>{const state=lifecycle.status();if(!state.account||! /^0x[0-9a-f]{40}$/.test(state.account))fail('PQ_KEY_BINDING_REQUIRED');return {account:state.account,network:networkId};};
 const scope=()=>Object.freeze({...binding(),revision:lifecycle.status().revision});
 function assertScope(original){const current=lifecycle.status();if(current.locked||current.authenticating||current.account!==original.account||current.revision!==original.revision)fail('PQ_KEY_PREPARATION_CANCELLED');}
 function selected(){
  const account=binding().account;
  if(!originals.has(account)){
   const source=createPQKeyPreparationSource({sdk,repository:{
    assertCanPrepare:input=>vault.reservePQPreparation(input),
    saveKeys:input=>vault.savePQKeys(input),readKeys:input=>vault.readPQKeys(input),verifySavedKeys:input=>vault.verifySavedPQKeys(input),
   },getOriginalNetwork:({account:owner})=>Object.freeze({chainId:networkId,owner}),
   // Portable restore needs the trusted original registered public binding,
   // not a renderer/backup preview. No restore route is exposed by this entry.
   getRegisteredBinding:()=>fail('PQ_REGISTERED_ORIGINAL_REQUIRED'),readRestoreInput:()=>fail('PQ_RECOVERY_INPUT_REQUIRED')});
   originals.set(account,createDualPQKeyPreparation({lifecycle,getBinding:binding,source,id,onState}));
  }
  return originals.get(account);
 }
 function status(){const state=selected().status(),recovered=recoveredStates.get(binding().account);return recovered&&(state.phase==='idle'||recovered.persisted&&!state.persisted)?Object.freeze({...state,...recovered,busy:state.busy,cleanupDebt:state.cleanupDebt||recovered.cleanupDebt}):state;}
 return Object.freeze({status,
  async generate(){
   const originalScope=scope();assertScope(originalScope);const recovered=recoveredStates.get(originalScope.account);
   if(recovered?.persisted||recovered?.preparationUnknown)fail('PQ_KEY_ORIGINAL_REQUIRES_RECOVERY');
   // Known existing keys/reservations are a refusal before the custody
   // controller enters preparation, not evidence of a new unknown KeyGen.
   // The durable reservation still checks again inside the real operation.
   await lifecycle.run(()=>vault.assertPQPreparationAvailable());assertScope(originalScope);
   return selected().generate();
  },reconcile:()=>selected().reconcile(),cancel:()=>selected().cancel(),
  async recover(){
   const originalScope=scope();assertScope(originalScope);
   const original=originals.get(originalScope.account),state=original?.status();
   if(state?.busy)fail('PQ_KEY_ORIGINAL_REQUIRES_RECOVERY');
   if(state?.persistenceAttempted&&!state.persisted&&!state.preparationUnknown){const result=await original.reconcile();assertScope(originalScope);return result;}
   const recovered=await lifecycle.run(()=>vault.readPQPreparationStatus({networkId}));assertScope(originalScope);
   // A missing disk result cannot erase an already entered live UNKNOWN or
   // cleanup debt. A verified stored result may advance, never replace it.
   if(state?.preparationUnknown&&!recovered.persisted)return Object.freeze({...recovered,...state});
   const value=Object.freeze({...recovered,...(state?.hasOriginal?{hasOriginal:true,keyRetired:state.keyRetired}:{}),cleanupDebt:recovered.cleanupDebt||state?.cleanupDebt===true});
   recoveredStates.set(originalScope.account,value);return value;
  }
 });
}
