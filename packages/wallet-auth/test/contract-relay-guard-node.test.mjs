import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {acquireOriginalIDEContractRelayGuard} from '../src/original-ide-contract-relay-guard-node.js';
import {assertOriginalContractRelayGuard} from '../src/original-ide-contract-relay-guard-core.js';
const expectedScope={kind:'ide-contract-relay-v1',projectId:'public-project',projectGeneration:1,callerIdentity:'public-peer',origin:'https://developer.ynxweb4.com',expiresMS:Date.now()+60000,chainId:'eip155:6423',methods:['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'],relayURL:'wss://relay.walletconnect.org'};
function shim({wrongScope=false,join=true,results={}}={}){
  // Explicit PUBLIC Native seam. Intercept only the original fixed require; no
  // real addon is loaded, no registered peer/current/confirmation is produced.
  const calls=[],ref={},original=Module._load;
  const native={acquireOriginalIDEContractRelayGuard:async input=>{calls.push(['acquire',input]);return ref;},readOriginalIDEContractRelayGuardScope:r=>{assert.equal(r,ref);return {...expectedScope,...(wrongScope?{projectId:'other'}:{})};},assertOriginalIDEContractRelayGuardCurrent:r=>{assert.equal(r,ref);return true;},observeOriginalIDEContractRelayGuardRevocation:(r,f)=>()=>{}};
  for(const verb of ['cancel','revoke','retire','join','close'])native[`${verb}OriginalIDEContractRelayGuard`]=async r=>{assert.equal(r,ref);calls.push([verb]);if(Object.hasOwn(results,verb)){if(results[verb] instanceof Error)throw results[verb];return results[verb];}return verb==='join'?join:true;};
  Module._load=function(name,...args){if(name==='../../../apps/wallet-desktop/native/original-auth-identity.node')return native;return original.call(this,name,...args);};
  return {calls,native,restore:()=>{Module._load=original;}};
}
test('PUBLIC fixed-addon ABI unavailable is fail closed before Native acquisition',async()=>{
  const f=shim();delete f.native.assertOriginalIDEContractRelayGuardCurrent;
  try{await assert.rejects(acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///public/server.mjs',localContext:{workspace:'/PUBLIC/workspace',profile:'/PUBLIC/profile',id:'PUBLIC-project'},expectedScope}),/GUARD_UNAVAILABLE/);assert.deepEqual(f.calls,[]);}finally{f.restore();}
});
test('PUBLIC partial acquired owner survives scope failure and normal retire/join/close drains once',async()=>{
  const f=shim({wrongScope:true});
  try{
    let retained;await assert.rejects(acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///public/server.mjs',localContext:{workspace:'/PUBLIC/workspace',profile:'/PUBLIC/profile',id:'PUBLIC-project'},expectedScope}),error=>{retained=error.cleanupOwner;return error.code==='YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE'&&!!retained;});
    assert.equal(retained.snapshot().closed,false);await retained.close();await retained.close();assert.equal(retained.snapshot().closed,true);
    assert.deepEqual(f.calls.map(v=>v[0]),['acquire','retire','join','close']);
  }finally{f.restore();}
});
test('PUBLIC failed retire preserves first cause, does not join/close or replay cleanup',async()=>{
  for(const retire of [false,undefined,0,Error('PUBLIC_RETIRE_FAILURE')]){
    const f=shim({results:{retire}});
    try{const owner=await acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///public/server.mjs',localContext:{workspace:'/PUBLIC/workspace',profile:'/PUBLIC/profile',id:'PUBLIC-project'},expectedScope});
      await assert.rejects(owner.close(),/CLEANUP_UNKNOWN|PUBLIC_RETIRE_FAILURE/);await assert.rejects(owner.close(),/CLEANUP_UNKNOWN|PUBLIC_RETIRE_FAILURE/);
      assert.equal(owner.snapshot().closed,false);assert.equal(owner.snapshot().cleanup,'unknown');assert.equal(owner.snapshot().firstCause.present,true);
      assert.deepEqual(f.calls.map(v=>v[0]),['acquire','retire']);assert.throws(()=>assertOriginalContractRelayGuard(owner,expectedScope),/GUARD_UNAVAILABLE/);
    }finally{f.restore();}
  }
});
test('PUBLIC false cancel/revoke remain UNKNOWN, preserve first cause and never repeat effects',async()=>{
  for(const verb of ['cancel','revoke'])for(const value of [false,undefined,0]){
    const f=shim({results:{[verb]:value,retire:false}});
    try{const owner=await acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///public/server.mjs',localContext:{workspace:'/PUBLIC/workspace',profile:'/PUBLIC/profile',id:'PUBLIC-project'},expectedScope});
      await assert.rejects(owner[verb](),new RegExp(`${verb.toUpperCase()}_UNKNOWN`));
      await assert.rejects(owner[verb](),new RegExp(`${verb.toUpperCase()}_UNKNOWN`));
      const first=owner.snapshot().firstCause;await assert.rejects(owner.close(),/CLEANUP_UNKNOWN/);
      assert.deepEqual(owner.snapshot().firstCause,first);assert.equal(owner.snapshot().cleanup,'unknown');assert.equal(owner.snapshot().closed,false);
      assert.deepEqual(f.calls.map(v=>v[0]),['acquire',verb,'retire']);
    }finally{f.restore();}
  }
});
test('PUBLIC unconfirmed join preserves UNKNOWN owner and refuses current without close',async()=>{
  const f=shim({join:false});
  try{const owner=await acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///public/server.mjs',localContext:{workspace:'/PUBLIC/workspace',profile:'/PUBLIC/profile',id:'PUBLIC-project'},expectedScope});assert.equal(assertOriginalContractRelayGuard(owner,expectedScope).projectId,expectedScope.projectId);
    await assert.rejects(owner.close(),/CLEANUP_UNKNOWN/);assert.equal(owner.snapshot().cleanup,'unknown');assert.equal(owner.snapshot().closed,false);assert.deepEqual(f.calls.map(v=>v[0]),['acquire','retire','join']);assert.throws(()=>assertOriginalContractRelayGuard(owner,expectedScope),/GUARD_UNAVAILABLE/);
  }finally{f.restore();}
});
