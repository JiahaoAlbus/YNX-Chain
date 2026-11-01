import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import * as api from '@ynx-chain/wallet-auth/original-ide-contract-relay-guard';
import {createDeveloperContractConnection} from '@ynx-chain/wallet-auth/walletconnect-dapp-connection';

// PUBLIC proposed Native successor seams, not actual Source/admission evidence.
// The normal matching Native supplier must be independently delivered first.
const methods=['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
const local=()=>({workspace:'/PUBLIC/workspace',profile:'/PUBLIC/profile',id:'PUBLIC-local-project-locator'});
function fixture(change={}){
 const original=Module._load,s={calls:[],input:null,ref:{},current:true,hook:null,scope:{kind:'ide-contract-relay-v1',origin:'https://developer.ynxweb4.com',chainId:'eip155:6423',relayURL:'wss://relay.walletconnect.org',methods:[...methods],projectId:'PUBLIC-signed-canonical-project',projectGeneration:42,callerIdentity:'PUBLIC-signed-node-identity',expiresMS:Date.now()+60000,...change}};
 const native={acquireOriginalIDEContractRelayGuard:async input=>{s.calls.push('acquire');s.input=input;return s.ref;},readOriginalIDEContractRelayGuardScope:ref=>{assert.equal(ref,s.ref);s.calls.push('read');return s.scope;},assertOriginalIDEContractRelayGuardCurrent:ref=>{assert.equal(ref,s.ref);s.calls.push('current');s.hook?.();if(s.current instanceof Error)throw s.current;return s.current;},observeOriginalIDEContractRelayGuardRevocation:()=>()=>{}};
 for(const action of ['cancel','revoke','retire','join','close'])native[`${action}OriginalIDEContractRelayGuard`]=async ref=>{assert.equal(ref,s.ref);s.calls.push(action);return true;};
 Module._load=function(name,...args){if(name==='../../../apps/wallet-desktop/native/original-auth-identity.node')return native;return original.call(this,name,...args);};
 s.acquire=input=>api.acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///PUBLIC/server.mjs',localContext:local(),...input});s.restore=()=>{Module._load=original;};return s;
}
test('omitted expectations send only actual server URL and local DATA and adopt signed scope without local defaults',async()=>{
 const s=fixture();let owner;try{owner=await s.acquire();assert.deepEqual(Object.keys(s.input),['serverModuleURL','localContext']);assert.deepEqual(s.input.localContext,local());assert.deepEqual(s.calls,['acquire','read','current','read']);
  const scope=api.assertOriginalIDEContractRelayGuardCurrent(owner);assert.equal(scope.projectId,s.scope.projectId);assert.equal(scope.projectGeneration,42);assert.equal(scope.callerIdentity,s.scope.callerIdentity);assert.equal(scope.expiresMS,s.scope.expiresMS);assert.equal(scope.authorized,false);assert.equal(scope.nativeAdmission,false);
 }finally{await owner?.close();s.restore();}
});
test('explicit undefined is omitted; provided expectations stay comparisons and invalid expectations never acquire',async()=>{
 const s=fixture();let owner;try{owner=await s.acquire({expectedScope:undefined});assert.deepEqual(Object.keys(s.input),['serverModuleURL','localContext']);}finally{await owner?.close();s.restore();}
 for(const value of [null,{},false,{projectId:'PUBLIC-project',projectGeneration:1}]){const f=fixture();try{await assert.rejects(f.acquire({expectedScope:value}),/GUARD_SCOPE_INVALID/);assert.equal(f.calls.length,0);}finally{f.restore();}}
 const f=fixture();let partial;try{await assert.rejects(f.acquire({expectedScope:{projectId:'PUBLIC-other',projectGeneration:42,expiresMS:f.scope.expiresMS+1000}}),e=>{partial=e.cleanupOwner;return !!partial;});assert.equal(f.input.expectedScope.projectId,'PUBLIC-other');assert.equal(f.calls.includes('current'),false);await partial.close();}finally{f.restore();}
});
test('local launch context is required immutable DATA, never a getter or canonical project input',async()=>{
 const s=fixture();try{
  for(const value of [undefined,null,{}, {...local(),id:''},{...local(),workspace:'/bad\0path'},{...local(),projectId:'forged'}])await assert.rejects(s.acquire({localContext:value}),/GUARD_SCOPE_INVALID/);
  let reads=0;await assert.rejects(s.acquire({localContext:{...local(),get workspace(){reads++;return '/PUBLIC/other';}}}),/GUARD_SCOPE_INVALID/);assert.equal(reads,0);assert.equal(s.calls.length,0);
  const input=local(),pending=s.acquire({localContext:input});input.workspace='/PUBLIC/replaced';const owner=await pending;
  try{assert.deepEqual(s.input.localContext,local());assert.ok(Object.isFrozen(s.input.localContext));assert.equal(api.assertOriginalIDEContractRelayGuardCurrent(owner).projectId,'PUBLIC-signed-canonical-project');assert.notEqual(s.scope.projectId,input.id);}finally{await owner.close();}
 }finally{s.restore();}
});
test('local context shape enforces exact Native path/text bounds without pretending to verify directories',async()=>{
 const s=fixture();try{
  for(const change of [{workspace:'relative/path'},{workspace:'/'},{workspace:'/PUBLIC//workspace'},{workspace:'/PUBLIC/../workspace'},{workspace:'/PUBLIC/workspace/'},{workspace:'/PUBLIC/\u200eworkspace'},{workspace:'/'+ 'x'.repeat(4096)},{profile:'/PUBLIC/\ud800'},{id:'id.with.dot'},{id:'x'.repeat(129)},{id:'汉字'}])await assert.rejects(s.acquire({localContext:{...local(),...change}}),/GUARD_SCOPE_INVALID/);
  assert.equal(s.calls.length,0);
  const context={workspace:'/'+ '汉'.repeat(1365),profile:'/'+ 'x'.repeat(4095),id:'x'.repeat(128)};
  assert.equal(Buffer.byteLength(context.workspace),4096);let owner;try{owner=await s.acquire({localContext:context});assert.deepEqual(s.input.localContext,context);}finally{await owner?.close();}
 }finally{s.restore();}
});
test('autonomous acquisition still rejects malformed actual fixed scope before Native current, retaining cleanup',async()=>{
 for(const change of [{kind:'other'},{origin:'https://other.invalid'},{chainId:'eip155:1'},{relayURL:'wss://other.invalid'},{methods:['personal_sign']},{projectId:''},{projectGeneration:0},{callerIdentity:''},{expiresMS:1},{extra:true}]){
  const s=fixture(change);let partial;try{await assert.rejects(s.acquire(),e=>{partial=e.cleanupOwner;return !!partial;});assert.equal(s.calls.includes('current'),false);assert.throws(()=>api.assertOriginalIDEContractRelayGuardCurrent(partial),/GUARD_UNAVAILABLE/);await partial.close();assert.equal(s.calls.filter(v=>v==='acquire').length,1);}finally{s.restore();}
 }
});
test('actual identity or expiry drift during Native current cannot turn an autonomous partial ready',async()=>{
 for(const field of ['callerIdentity','expiresMS']){const s=fixture();s.hook=()=>{s.scope[field]=field==='callerIdentity'?'PUBLIC-other':s.scope.expiresMS+1;};let partial;
  try{await assert.rejects(s.acquire(),e=>{partial=e.cleanupOwner;return !!partial;});assert.throws(()=>api.assertOriginalIDEContractRelayGuardCurrent(partial),/GUARD_UNAVAILABLE/);assert.equal(s.calls.filter(v=>v==='acquire').length,1);await partial.close();}finally{s.restore();}
 }
});
test('original activation refusal stays the first cause and cannot be promoted by later PUBLIC current',async()=>{
 const s=fixture(),cause=Object.assign(Error('PUBLIC activation refused'),{code:'YNX_CONTRACT_RELAY_INITIATOR_ROLE_BOUNDARY_UNQUALIFIED'});s.current=cause;let partial;
 try{await assert.rejects(s.acquire(),e=>{partial=e.cleanupOwner;return !!partial&&e.cause===cause;});s.current=true;const n=s.calls.length;assert.throws(()=>api.assertOriginalIDEContractRelayGuardCurrent(partial),/GUARD_UNAVAILABLE/);assert.equal(s.calls.length,n);await partial.close();}finally{s.restore();}
});
test('dedicated caller takes project coordinates from checked actual scope and checks current before any factory',async()=>{
 const s=fixture();let owner;try{owner=await s.acquire();const scope=api.assertOriginalIDEContractRelayGuardCurrent(owner);let factories=0;
  const client=createDeveloperContractConnection({relayGuard:owner,relayContext:{projectId:scope.projectId,projectGeneration:scope.projectGeneration},clientFactory:async()=>{factories++;return{on(){}};}});
  s.current=false;await assert.rejects(client.initialize(),/GUARD_UNAVAILABLE/);assert.equal(factories,0);s.current=true;await client.initialize();assert.equal(factories,1);
 }finally{await owner?.close();s.restore();}
});
