import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import * as api from '@ynx-chain/wallet-auth/original-ide-contract-relay-guard';

// The public SDK export with explicit PUBLIC Native seams only. No real addon,
// project admission, Relay, account, filesystem journal or approval is used.
const methods=['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
function fixture(){
 const original=Module._load;
 const s={calls:[],ref:{},current:true,hook:null,cleanup:true,scope:{kind:'ide-contract-relay-v1',projectId:'PUBLIC-project',projectGeneration:7,callerIdentity:'PUBLIC-nodeCodeIdentity',origin:'https://developer.ynxweb4.com',expiresMS:Date.now()+60000,chainId:'eip155:6423',methods:[...methods],relayURL:'wss://relay.walletconnect.org'}};
 const native={
  acquireOriginalIDEContractRelayGuard:async()=>{s.calls.push('acquire');return s.ref;},
  readOriginalIDEContractRelayGuardScope:ref=>{assert.equal(ref,s.ref);s.calls.push('read');return s.scope;},
  assertOriginalIDEContractRelayGuardCurrent:ref=>{assert.equal(ref,s.ref);s.calls.push('current');s.hook?.();return s.current;},
  observeOriginalIDEContractRelayGuardRevocation:()=>{s.calls.push('observe');return()=>{};},
 };
 for(const action of ['cancel','revoke','retire','join','close'])native[`${action}OriginalIDEContractRelayGuard`]=async ref=>{assert.equal(ref,s.ref);s.calls.push(action);return s.cleanup;};
 Module._load=function(name,...args){if(name==='../../../apps/wallet-desktop/native/original-auth-identity.node')return native;return original.call(this,name,...args);};
 s.acquire=()=>api.acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///PUBLIC/server.mjs',expectedScope:{projectId:s.scope.projectId,projectGeneration:7,expiresMS:s.scope.expiresMS+10000}});
 s.restore=()=>{Module._load=original;};return s;
}
const current=owner=>api.assertOriginalIDEContractRelayGuardCurrent(owner);
test('public current export performs original current between same-scope reads, returning only frozen scope DATA',async()=>{
 assert.equal(typeof api.assertOriginalIDEContractRelayGuardCurrent,'function');
 const s=fixture();let owner;
 try{owner=await s.acquire();const before=s.calls.length,a=current(owner),b=current(owner);
  assert.deepEqual(s.calls.slice(before),['read','current','read','read','current','read']);
  assert.equal(a.projectId,s.scope.projectId);assert.equal(a.projectGeneration,7);assert.equal(a.callerIdentity,s.scope.callerIdentity);assert.equal(a.expiresMS,s.scope.expiresMS);
  assert.equal(a.dataOnly,true);assert.equal(a.authorized,false);assert.equal(a.nativeAdmission,false);
  assert.ok(Object.isFrozen(a));assert.ok(Object.isFrozen(a.methods));assert.notEqual(a,b);assert.notEqual(a.methods,b.methods);
  for(const key of ['owner','account','workspace','workspaceOwner','identityReference','sessionId'])assert.equal(Object.hasOwn(a,key),false);
  const n=s.calls.length;owner.readScopeData();assert.equal(s.calls.length,n);
 }finally{await owner?.close();s.restore();}
});
test('public current rejects forged/copied owners and initialization partials without promoting or replaying them',async()=>{
 const s=fixture();let owner,partial;
 try{owner=await s.acquire();for(const value of [null,{},Object.freeze({...owner})]){const n=s.calls.length;assert.throws(()=>current(value),/GUARD_UNAVAILABLE/);assert.equal(s.calls.length,n);}
  s.current=false;await assert.rejects(s.acquire(),e=>{partial=e.cleanupOwner;return !!partial;});s.current=true;
  const n=s.calls.length;assert.throws(()=>current(partial),/GUARD_UNAVAILABLE/);assert.equal(s.calls.length,n);await partial.close();
 }finally{await owner?.close();s.restore();}
});
test('public current refuses drift, expiry, false Native current and terminal owners',async()=>{
 for(const key of ['callerIdentity','projectGeneration','expiresMS']){const s=fixture();let owner;try{owner=await s.acquire();s.scope[key]=key==='callerIdentity'?'PUBLIC-other':s.scope[key]+1;assert.throws(()=>current(owner),/GUARD_SCOPE_INVALID/);}finally{await owner?.close();s.restore();}}
 const s=fixture();let owner;try{owner=await s.acquire();s.current=false;assert.throws(()=>current(owner),/GUARD_UNAVAILABLE/);s.current=true;
  const now=Date.now;try{Date.now=()=>s.scope.expiresMS;assert.throws(()=>current(owner),/GUARD_SCOPE_INVALID/);}finally{Date.now=now;}
  await owner.close();const n=s.calls.length;assert.throws(()=>current(owner),/GUARD_UNAVAILABLE/);assert.equal(s.calls.length,n);
 }finally{await owner?.close();s.restore();}
});
test('public current catches synchronous terminal change inside Native current and blocks reentry',async()=>{
 const s=fixture();let owner;try{owner=await s.acquire();s.hook=()=>{void owner.revoke();};const n=s.calls.length;
  assert.throws(()=>current(owner),/GUARD_UNAVAILABLE/);assert.deepEqual(s.calls.slice(n),['read','current','revoke']);
 }finally{await owner?.close();s.restore();}
 const r=fixture();let other;try{other=await r.acquire();r.hook=()=>current(other);const n=r.calls.length;
  assert.throws(()=>current(other),/GUARD_UNAVAILABLE/);assert.deepEqual(r.calls.slice(n),['read','current']);r.hook=null;assert.equal(current(other).callerIdentity,r.scope.callerIdentity);
 }finally{await other?.close();r.restore();}
 const drift=fixture();let held;try{held=await drift.acquire();drift.hook=()=>{drift.scope.callerIdentity='PUBLIC-post-current-peer';};
  assert.throws(()=>current(held),/GUARD_SCOPE_INVALID/);
 }finally{await held?.close();drift.restore();}
});
test('public current never clears cleanup UNKNOWN or retries terminal cleanup',async()=>{
 const s=fixture();let owner;try{owner=await s.acquire();s.cleanup=false;await assert.rejects(owner.close(),/CLEANUP_UNKNOWN/);const before=owner.snapshot(),n=s.calls.length;
  assert.throws(()=>current(owner),/GUARD_UNAVAILABLE/);await assert.rejects(owner.close(),/CLEANUP_UNKNOWN/);
  assert.equal(s.calls.length,n);assert.deepEqual(owner.snapshot(),before);assert.equal(before.cleanup,'unknown');assert.equal(before.replayAllowed,false);
 }finally{s.restore();}
});
