// First-party address connection UI state only. The original SDK owns the
// real SignClient, URI generation, persistence, retirement and remote cleanup.
// No provider/request/signing surface escapes this controller.
import {readOriginalAddressObservation} from './walletconnect-address-observation.mjs';
export const ADDRESS_CONNECTION_ORIGIN='https://wallet.ynxweb4.com';
const phases=new Set(['initialization','relay','approval']);
const knownCodes=new Set(['YNX_PAIR_CANCELLED','YNX_PAIR_CONFIGURATION_INVALID','YNX_PAIR_SESSION_EXPIRED','YNX_PAIR_PEER_INVALID','YNX_PAIR_NAMESPACE_INVALID','YNX_PAIR_CHAIN_INVALID','YNX_PAIR_CONTEXT_CHANGED','YNX_PAIR_TRANSPORT_DRAINING','YNX_PAIR_CLEANUP_UNCONFIRMED','USER_REJECTED']);
for(const phase of ['INITIALIZATION','RELAY','APPROVAL','REQUEST','CLEANUP'])for(const suffix of ['TIMEOUT','UNAVAILABLE'])knownCodes.add(`YNX_PAIR_${phase}_${suffix}`);
const safeCode=error=>knownCodes.has(error?.code)?error.code:'WALLET_CONNECTION_UNAVAILABLE';

export function createAddressConnectionConsumer({origin,createConnection,onState=()=>{},onURI=()=>{},clearURI=()=>{}}){
 if(origin!==ADDRESS_CONNECTION_ORIGIN||typeof createConnection!=='function')throw Error('WALLET_CONNECTION_ORIGIN_REQUIRED');
 let connection=null,provider=null,epoch=0,pending=null,cleanup=null,uncertain=false;
 let attempt=0,localConnect='not-started',connectCode=null,localCleanup='not-started',cleanupKind=null,cleanupCode=null,reconnectBlocked=false,cleanupWitness=null;
 let approvedDisconnectEpoch=null,explicitDisconnectObserved=false;
 // Only observations of this controller's original calls. Settled local calls
 // do not establish remote session/pairing retirement. No SDK method is called
 // by this read; no URI, topic, provider or original Error object escapes it.
 const checkOriginal=()=>Object.freeze({attempt,connect:localConnect,connectCode,cleanup:localCleanup,cleanupKind,cleanupCode,remoteCleanup:uncertain?'unconfirmed':'not-established',reconnectBlocked,cleanupWitness,protocol:readOriginalAddressObservation(connection,safeCode)});
 let state=Object.freeze({phase:'idle',account:null,chainId:null,code:null,cleanupUnconfirmed:false,pendingOriginal:false,reconnectBlocked,original:checkOriginal()});
 const publish=(phase,fields={})=>{state=Object.freeze({...fields,phase,account:fields.account??null,chainId:fields.chainId??null,code:fields.code??null,cleanupUnconfirmed:uncertain,pendingOriginal:pending!==null,reconnectBlocked,original:checkOriginal()});onState(state);return state;};
 const changed=()=>{if(state.phase!=='connected')return;epoch++;provider=null;clearURI();publish('changed');};
 function original(){
  if(connection)return connection;
  connection=createConnection({origin:ADDRESS_CONNECTION_ORIGIN,methods:[]});
  for(const name of ['connect','cancel','disconnect','on'])if(typeof connection?.[name]!=='function')throw Error('WALLET_CONNECTION_INTERFACE_REQUIRED');
  connection.on('stage',value=>{if(pending&&!uncertain&&phases.has(state.phase)&&phases.has(value?.stage))publish(value.stage);});
  connection.on('cancelUnconfirmed',value=>{if(value?.current!==true)return;uncertain=true;provider=null;clearURI();publish('cleanup-unconfirmed',{code:state.code});});
  for(const name of ['accountsChanged','chainChanged'])connection.on(name,()=>{if(localCleanup==='pending')approvedDisconnectEpoch=null;changed();});
  connection.on('disconnect',value=>{
   if(localCleanup==='pending'&&cleanupKind==='disconnect'){
    if(approvedDisconnectEpoch===epoch&&value?.code===4900&&value?.message==='PAIR_EXPLICIT_DISCONNECT'&&value?.reason==='permission-revoked')explicitDisconnectObserved=true;
    else approvedDisconnectEpoch=null;
   }
   changed();
  });
  return connection;
 }
 function connect(){
  if(pending)return pending;
  if(uncertain||cleanup||reconnectBlocked)return Promise.resolve(state);
  if(state.phase==='connected')return Promise.resolve(state);
  const token=++epoch;attempt++;reconnectBlocked=true;cleanupWitness=null;localConnect='pending';connectCode=null;localCleanup='not-started';cleanupKind=null;cleanupCode=null;provider=null;clearURI();publish('initialization');
  const task=Promise.resolve().then(async()=>{
   // This gate runs BEFORE factory/SDK selection. An immediate local cancel
   // can prove zero SDK effect; cancellation after selection cannot do so.
   if(token!==epoch)return state;
   const selected=await original().connect({restore:false,onURI:uri=>{if(token===epoch&&!uncertain){publish('approval');onURI(uri);}}});
   localConnect='fulfilled';
   if(token!==epoch||uncertain)return state;
   const chainId=await selected.request({method:'eth_chainId'});if(token!==epoch||uncertain)return state;
   const accounts=await selected.request({method:'eth_accounts'});if(token!==epoch||uncertain)return state;
   if(chainId!=='0x1917'||!Array.isArray(accounts)||accounts.length!==1||typeof accounts[0]!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(accounts[0]))throw Error('WALLET_CONNECTION_SELECTION_INVALID');
   provider=selected;clearURI();return publish('connected',{account:accounts[0].toLowerCase(),chainId});
  }).catch(error=>{
   // Capture the original SDK rejection even when a prior cancel retired the
   // UI epoch. Errors in subsequent account/chain presentation reads do not
   // relabel an already fulfilled SDK connect call as a rejected one.
   if(localConnect==='pending'){localConnect='rejected';connectCode=safeCode(error);}
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
  if(!disconnect&&!connection&&pending){epoch++;localConnect='not-started';cleanupKind='cancel';cleanupWitness='cancelled-before-sdk-selection';reconnectBlocked=false;clearURI();publish('cancelled');return Promise.resolve(state);}
  if(uncertain||!connection||(!disconnect&&!pending))return Promise.resolve(state);
  // A completed original cleanup cannot be reissued to wash its first cause or
  // turn an earlier cancelled attempt into a session-disconnect witness.
  if(localCleanup!=='not-started')return Promise.resolve(state);
  const fromApproved=disconnect&&state.phase==='connected'&&localConnect==='fulfilled'&&connectCode===null;
  const token=++epoch;approvedDisconnectEpoch=fromApproved?token:null;explicitDisconnectObserved=false;localCleanup='pending';cleanupKind=disconnect?'disconnect':'cancel';cleanupCode=null;provider=null;clearURI();publish(disconnect?'disconnecting':'cancelling');
  const task=Promise.resolve().then(()=>disconnect?connection.disconnect():connection.cancel()).then(()=>{
   localCleanup='fulfilled';
   if(disconnect){
    const observed=readOriginalAddressObservation(connection,safeCode);
    // Existing SDK normal disconnect: original active-approved session, exact
    // local operation/event/epoch and fulfilled promise, no prior uncertainty.
    // This is LOCAL session retirement/accepted relay publication, NOT peer
    // acknowledgement or proof that all remote objects have disappeared.
    if(approvedDisconnectEpoch===token&&epoch===token&&explicitDisconnectObserved&&!uncertain&&observed.availability==='available'&&!observed.value.inFlight&&observed.value.cleanup!=='unknown'){
     reconnectBlocked=false;cleanupWitness='approved-session-local-disconnect';
    }else uncertain=true;
   }
   if(token===epoch&&!uncertain)publish(disconnect?'disconnected':'cancelled');else publish(uncertain?'cleanup-unconfirmed':state.phase,{...state,cleanupUnconfirmed:uncertain});return state;
  },error=>{localCleanup='rejected';cleanupCode=safeCode(error);uncertain=true;if(token===epoch)publish('cleanup-unconfirmed',{code:state.code??cleanupCode});else publish(state.phase,{...state});return state;}).finally(()=>{if(cleanup===task)cleanup=null;approvedDisconnectEpoch=null;});
  cleanup=task;return task;
 }
 return Object.freeze({connect,cancel:()=>end(false),disconnect:()=>end(true),checkOriginal,snapshot:()=>state});
}
