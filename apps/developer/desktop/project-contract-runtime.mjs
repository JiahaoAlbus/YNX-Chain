import {openProjectContractClient} from './wallet-contract-client.mjs';
import {createProjectContractDeployment} from './project-contract-deployment.mjs';
const retired=()=>Object.assign(Error('The project contract owner is unavailable.'),{code:'IDE_CONTRACT_RETIRED'});
// Private per-project custody. Adopt the Source owner before any journal/file
// await, and keep it even when the caller's initialization subsequently fails.
export function createProjectContractRuntime({context,acquireAuthority,loadMaterialBuilder}){
 const local=Object.freeze({id:context.id,profile:context.profile,workspace:context.workspace});
 const fresh=()=>({owner:null,acquiring:null,closed:false,cleanup:null});
 let closed=false,attempt=fresh();
 const current=selected=>{if(closed||selected.closed||selected!==attempt)throw retired();};
 const sameProject=value=>{if(!value||Object.keys(local).some(key=>value[key]!==local[key]))throw retired();};
 async function supply(selected){
  current(selected);
  selected.acquiring ||= Promise.resolve().then(()=>{current(selected);return acquireAuthority(local);}).then(owner=>{selected.owner=owner;return owner;},error=>{selected.owner=error?.cleanupOwner;throw error;});
  const owner=await selected.acquiring;current(selected);return owner;
 }
 function facade(selected){return Object.freeze({
  async assertCurrent(){const owner=await supply(selected);const value=await owner.assertCurrent();current(selected);return value;},
  createConnection(){current(selected);if(!selected.owner)throw retired();return selected.owner.createConnection();},
 });}
 function closeAttempt(selected){selected.closed=true;return selected.cleanup ||= (async()=>{await selected.acquiring?.catch(()=>{});const owner=selected.owner;if(owner)await owner.close();})();}
 return Object.freeze({
  async openClient(project){sameProject(project);const selected=attempt;current(selected);const client=await openProjectContractClient({context:local,relayAuthority:facade(selected),createConnection:()=>facade(selected).createConnection()});if(closed||selected.closed||selected!==attempt){await client.close();throw retired();}return client;},
  openDeployment(project){sameProject(project);const selected=attempt;current(selected);return createProjectContractDeployment({context:local,relayAuthority:facade(selected),loadMaterialBuilder});},
  async assertNetworkApproved(){const selected=attempt;await facade(selected).assertCurrent();current(selected);},
  async reset(){const selected=attempt;await closeAttempt(selected);if(!closed&&selected===attempt)attempt=fresh();},
  close(){closed=true;return closeAttempt(attempt);},
 });
}
