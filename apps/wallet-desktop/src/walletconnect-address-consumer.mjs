// First-party address connection UI state only. The original SDK owns the
// real SignClient, URI generation, persistence, retirement and remote cleanup.
// No provider/request/signing surface escapes this controller.
export const ADDRESS_CONNECTION_ORIGIN='https://wallet.ynxweb4.com';
const phases=new Set(['initialization','relay','approval']);
const knownCodes=new Set(['YNX_PAIR_CANCELLED','YNX_PAIR_CONFIGURATION_INVALID','YNX_PAIR_SESSION_EXPIRED','YNX_PAIR_PEER_INVALID','YNX_PAIR_NAMESPACE_INVALID','YNX_PAIR_CHAIN_INVALID','YNX_PAIR_CONTEXT_CHANGED','YNX_PAIR_TRANSPORT_DRAINING','YNX_PAIR_CLEANUP_UNCONFIRMED','USER_REJECTED']);
for(const phase of ['INITIALIZATION','RELAY','APPROVAL','REQUEST','CLEANUP'])for(const suffix of ['TIMEOUT','UNAVAILABLE'])knownCodes.add(`YNX_PAIR_${phase}_${suffix}`);
const safeCode=error=>knownCodes.has(error?.code)?error.code:'WALLET_CONNECTION_UNAVAILABLE';

export function createAddressConnectionConsumer({origin,createConnection,onState=()=>{},onURI=()=>{},clearURI=()=>{}}){
 if(origin!==ADDRESS_CONNECTION_ORIGIN||typeof createConnection!=='function')throw Error('WALLET_CONNECTION_ORIGIN_REQUIRED');
 let connection=null,provider=null,epoch=0,pending=null,cleanup=null,uncertain=false;
 let state=Object.freeze({phase:'idle',account:null,chainId:null,code:null,cleanupUnconfirmed:false,pendingOriginal:false});
 const publish=(phase,fields={})=>{state=Object.freeze({phase,account:null,chainId:null,code:null,cleanupUnconfirmed:uncertain,pendingOriginal:pending!==null,...fields});onState(state);return state;};
 const changed=()=>{if(state.phase!=='connected')return;epoch++;provider=null;clearURI();publish('changed');};
 function original(){
  if(connection)return connection;
  connection=createConnection({origin:ADDRESS_CONNECTION_ORIGIN,methods:[]});
  for(const name of ['connect','cancel','disconnect','on'])if(typeof connection?.[name]!=='function')throw Error('WALLET_CONNECTION_INTERFACE_REQUIRED');
  connection.on('stage',value=>{if(pending&&!uncertain&&phases.has(state.phase)&&phases.has(value?.stage))publish(value.stage);});
  connection.on('cancelUnconfirmed',value=>{if(value?.current!==true)return;uncertain=true;provider=null;clearURI();publish('cleanup-unconfirmed');});
  for(const name of ['accountsChanged','chainChanged','disconnect'])connection.on(name,changed);
  return connection;
 }
 function connect(){
  if(pending)return pending;
  if(uncertain||cleanup)return Promise.resolve(state);
  if(state.phase==='connected')return Promise.resolve(state);
  const token=++epoch;provider=null;clearURI();publish('initialization');
  const task=Promise.resolve().then(async()=>{
   const selected=await original().connect({restore:false,onURI:uri=>{if(token===epoch&&!uncertain){publish('approval');onURI(uri);}}});
   if(token!==epoch||uncertain)return state;
   const chainId=await selected.request({method:'eth_chainId'});if(token!==epoch||uncertain)return state;
   const accounts=await selected.request({method:'eth_accounts'});if(token!==epoch||uncertain)return state;
   if(chainId!=='0x1917'||!Array.isArray(accounts)||accounts.length!==1||typeof accounts[0]!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(accounts[0]))throw Error('WALLET_CONNECTION_SELECTION_INVALID');
   provider=selected;clearURI();return publish('connected',{account:accounts[0].toLowerCase(),chainId});
  }).catch(error=>{
   // This is the same still-pending original: another connect cannot enter
   // until it settles. Explicit cleanup UNKNOWN survives an earlier cancel;
   // cancellation is not evidence that a partially initialized Core closed.
   if(error?.code==='YNX_PAIR_CLEANUP_UNCONFIRMED'){uncertain=true;provider=null;clearURI();publish('cleanup-unconfirmed',{code:safeCode(error)});}
   else if(token===epoch){provider=null;clearURI();publish(uncertain?'cleanup-unconfirmed':'failed',{code:safeCode(error)});}
   return state;
  }).finally(()=>{if(pending===task){pending=null;publish(state.phase,{...state,pendingOriginal:false});}});
  pending=task;return task;
 }
 function end(disconnect){
  if(cleanup)return cleanup;
  if(uncertain||!connection||(!disconnect&&!pending))return Promise.resolve(state);
  const token=++epoch;provider=null;clearURI();publish(disconnect?'disconnecting':'cancelling');
  const task=Promise.resolve().then(()=>disconnect?connection.disconnect():connection.cancel()).then(()=>{if(token===epoch&&!uncertain)publish(disconnect?'disconnected':'cancelled');return state;},()=>{uncertain=true;if(token===epoch)publish('cleanup-unconfirmed');return state;}).finally(()=>{if(cleanup===task)cleanup=null;});
  cleanup=task;return task;
 }
 return Object.freeze({connect,cancel:()=>end(false),disconnect:()=>end(true),snapshot:()=>state});
}
