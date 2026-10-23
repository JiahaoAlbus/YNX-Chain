import {createRequire} from 'node:module';
import {assertContractRelayScope,registerOriginalContractRelayGuard} from './original-ide-contract-relay-guard-core.js';
const require=createRequire(import.meta.url);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const names=['acquire','readScope','assertCurrent','observeRevocation','cancel','revoke','retire','join','close'];
const nativeNames={acquire:'acquireOriginalIDEContractRelayGuard',readScope:'readOriginalIDEContractRelayGuardScope',assertCurrent:'assertOriginalIDEContractRelayGuardCurrent',observeRevocation:'observeOriginalIDEContractRelayGuardRevocation',...Object.fromEntries(['cancel','revoke','retire','join','close'].map(n=>[n,`${n}OriginalIDEContractRelayGuard`]))};
/** Acquires only through the original peer. This does not supply a confirmation,
 * project authority, wallet approval or arbitrary network capability. */
export async function acquireOriginalIDEContractRelayGuard({serverModuleURL,expectedScope}={}){
  if(typeof serverModuleURL!=='string'||!serverModuleURL.startsWith('file:')||!expectedScope)fail('YNX_CONTRACT_RELAY_GUARD_SCOPE_INVALID');
  let native;try{native=require('../../../apps/wallet-desktop/native/original-auth-identity.node');}catch(cause){throw Object.assign(new Error('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE'),{code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE',cause});}
  if(names.some(n=>typeof native[nativeNames[n]]!=='function'))fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
  const expected=Object.freeze({...expectedScope,methods:Array.isArray(expectedScope.methods)?Object.freeze([...expectedScope.methods]):expectedScope.methods});
  // Adopt immediately before any scope/current read: failed initialization still
  // leaves a caller-owned cleanup reference, never an invisible acquired owner.
  const ref=await native[nativeNames.acquire]({serverModuleURL,expectedScope:expected});
  if(!ref)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
  let closed=false,terminal=false,unknown=false,cleanupFlight,firstCause=null;
  const actions=new Map();
  const remember=error=>{unknown=true;if(firstCause===null){const code=error&&Object.getOwnPropertyDescriptor(error,'code')?.value;firstCause=typeof code==='string'&&/^YNX_CONTRACT_RELAY_(?:CANCEL|REVOKE|CLEANUP)_UNKNOWN$/.test(code)?code:'UNCLASSIFIED';}return error;};
  const invoke=n=>native[nativeNames[n]](ref);
  const scope=()=>assertContractRelayScope(invoke('readScope'),expected);
  const current=()=>{if(closed||terminal)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');return invoke('assertCurrent');};
  const cleanup=()=>cleanupFlight??=(async()=>{
    terminal=true;
    for(const n of ['retire','join','close'])try{if(await invoke(n)!==true)fail('YNX_CONTRACT_RELAY_CLEANUP_UNKNOWN');if(n==='close')closed=true;}catch(error){throw remember(error);}
  })();
  const action=name=>{
    terminal=true;
    if(!actions.has(name))actions.set(name,(async()=>{try{if(await invoke(name)!==true)fail(`YNX_CONTRACT_RELAY_${name.toUpperCase()}_UNKNOWN`);return true;}catch(error){throw remember(error);}})());
    return actions.get(name);
  };
  const owner=Object.freeze({
    snapshot:()=>Object.freeze({scope:'local-only',closed,terminal,cleanup:unknown?'unknown':closed?'closed':'unobserved',firstCause:Object.freeze({present:firstCause!==null,code:firstCause}),remoteOutcome:'not-proven',replayAllowed:false}),
    cancel:()=>action('cancel'),
    revoke:()=>action('revoke'),
    close:cleanup,
  });
  registerOriginalContractRelayGuard(owner,{scope,current,cancel:owner.cancel,observe:listener=>native[nativeNames.observeRevocation](ref,()=>{terminal=true;listener();})});
  try{if(current()!==true)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');scope();}catch(cause){throw Object.assign(new Error('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE'),{code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE',cause,cleanupOwner:owner});}
  return owner;
}
