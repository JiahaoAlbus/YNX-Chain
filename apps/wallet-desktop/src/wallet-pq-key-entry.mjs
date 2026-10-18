import {createPQKeyPreparationSource} from './wallet-pq-key-source.mjs';
import {createDualPQKeyPreparation} from './wallet-pq-key-preparation.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
/** Fixed normal-main composition. Renderer supplies no provider, network,
 * owner, private material or persistence receipt. Local custody is not chain
 * registration, backup export, approval, signing or broadcast authority. */
export function createPQKeyPreparationEntry({lifecycle,vault,sdk,networkId,id,onState=()=>{}}){
 if(typeof networkId!=='string'||! /^[a-f0-9]{64}$/.test(networkId))fail('PQ_KEY_BINDING_REQUIRED');
 const originals=new Map();
 const binding=()=>{const state=lifecycle.status();if(!state.account||! /^0x[0-9a-f]{40}$/.test(state.account))fail('PQ_KEY_BINDING_REQUIRED');return {account:state.account,network:networkId};};
 function selected(){
  const account=binding().account;
  if(!originals.has(account)){
   const source=createPQKeyPreparationSource({sdk,repository:{
    assertCanPrepare:()=>vault.assertPQPreparationAvailable(),
    saveKeys:input=>vault.savePQKeys(input),readKeys:input=>vault.readPQKeys(input),verifySavedKeys:input=>vault.verifySavedPQKeys(input),
   },getOriginalNetwork:({account:owner})=>Object.freeze({chainId:networkId,owner}),
   // Portable restore needs the trusted original registered public binding,
   // not a renderer/backup preview. No restore route is exposed by this entry.
   getRegisteredBinding:()=>fail('PQ_REGISTERED_ORIGINAL_REQUIRED'),readRestoreInput:()=>fail('PQ_RECOVERY_INPUT_REQUIRED')});
   originals.set(account,createDualPQKeyPreparation({lifecycle,getBinding:binding,source,id,onState}));
  }
  return originals.get(account);
 }
 return Object.freeze({status:()=>selected().status(),generate:()=>selected().generate(),reconcile:()=>selected().reconcile(),cancel:()=>selected().cancel()});
}
