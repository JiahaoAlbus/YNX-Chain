import {createRequire} from 'node:module';
import {assertContractRelayScope,assertSameContractRelayScope,assertOriginalContractRelayGuard,captureContractRelayExpectedScope,registerOriginalContractRelayGuard} from './original-ide-contract-relay-guard-core.js';
const require=createRequire(import.meta.url);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const readyOwners=new WeakMap();
const scopeData=scope=>Object.freeze({...scope,methods:Object.freeze([...scope.methods]),dataOnly:true,authorized:false,nativeAdmission:false});
/** Original Native current as of this call, not account identity or RPC approval.
 * Only a successfully acquired original owner can supply the scope. */
export function assertOriginalIDEContractRelayGuardCurrent(owner){
  const current=owner&&readyOwners.get(owner);
  if(typeof current!=='function')fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
  return current();
}
const names=['acquire','readScope','assertCurrent','observeRevocation','cancel','revoke','retire','join','close'];
const nativeNames={acquire:'acquireOriginalIDEContractRelayGuard',readScope:'readOriginalIDEContractRelayGuardScope',assertCurrent:'assertOriginalIDEContractRelayGuardCurrent',observeRevocation:'observeOriginalIDEContractRelayGuardRevocation',...Object.fromEntries(['cancel','revoke','retire','join','close'].map(n=>[n,`${n}OriginalIDEContractRelayGuard`]))};
/** Acquires only through the original peer. This does not supply a confirmation,
 * project authority, wallet approval or arbitrary network capability. */
export async function acquireOriginalIDEContractRelayGuard({serverModuleURL,expectedScope}={}){
  if(typeof serverModuleURL!=='string'||!serverModuleURL.startsWith('file:')||!expectedScope)fail('YNX_CONTRACT_RELAY_GUARD_SCOPE_INVALID');
  const expected=captureContractRelayExpectedScope(expectedScope,true);
  let native;try{native=require('../../../apps/wallet-desktop/native/original-auth-identity.node');}catch(cause){throw Object.assign(new Error('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE'),{code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE',cause});}
  if(names.some(n=>typeof native[nativeNames[n]]!=='function'))fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
  // Adopt immediately before any scope/current read: failed initialization still
  // leaves a caller-owned cleanup reference, never an invisible acquired owner.
  const ref=await native[nativeNames.acquire]({serverModuleURL,expectedScope:expected});
  if(!ref)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
  let closed=false,terminal=false,unknown=false,cleanupFlight,firstCause=null,capturedScope=null,nativeCurrentEntered=false,publicCurrentEntered=false;
  const actions=new Map();
  const remember=error=>{unknown=true;if(firstCause===null){const code=error&&Object.getOwnPropertyDescriptor(error,'code')?.value;firstCause=typeof code==='string'&&/^YNX_CONTRACT_RELAY_(?:CANCEL|REVOKE|CLEANUP)_UNKNOWN$/.test(code)?code:'UNCLASSIFIED';}return error;};
  const invoke=n=>native[nativeNames[n]](ref);
  const scope=()=>{const actual=assertContractRelayScope(invoke('readScope'),expected);if(capturedScope)assertSameContractRelayScope(actual,capturedScope);else capturedScope=actual;return actual;};
  const current=()=>{
    if(closed||terminal||nativeCurrentEntered)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
    nativeCurrentEntered=true;
    try{const result=invoke('assertCurrent');if(closed||terminal)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');return result;}
    finally{nativeCurrentEntered=false;}
  };
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
    // Local retained DATA only: no Native current/read/network call or grant.
    readScopeData:()=>capturedScope?scopeData(capturedScope):null,
    snapshot:()=>Object.freeze({scope:'local-only',closed,terminal,cleanup:unknown?'unknown':closed?'closed':'unobserved',firstCause:Object.freeze({present:firstCause!==null,code:firstCause}),remoteOutcome:'not-proven',replayAllowed:false}),
    cancel:()=>action('cancel'),
    revoke:()=>action('revoke'),
    close:cleanup,
  });
  registerOriginalContractRelayGuard(owner,{scope,current,cancel:owner.cancel,runtimeCheck:async()=>{const {verifyContractInitiatorRuntime}=await import('./walletconnect-contract-initiator-boundary-node.js');return verifyContractInitiatorRuntime();},observe:listener=>native[nativeNames.observeRevocation](ref,()=>{terminal=true;listener();})});
  try{scope();if(current()!==true)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');scope();}catch(cause){throw Object.assign(new Error('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE'),{code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE',cause,cleanupOwner:owner});}
  // A partial cleanupOwner is deliberately absent from this ready registry.
  readyOwners.set(owner,()=>{
    if(closed||terminal||publicCurrentEntered)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');
    publicCurrentEntered=true;
    try{const verified=assertOriginalContractRelayGuard(owner,expected);if(closed||terminal)fail('YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');return scopeData(verified);}
    finally{publicCurrentEntered=false;}
  });
  return owner;
}
