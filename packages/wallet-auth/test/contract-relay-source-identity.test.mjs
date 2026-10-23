import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {createHash} from 'node:crypto';
import {acquireOriginalIDEContractRelayGuard as acquire} from '../src/original-ide-contract-relay-guard-node.js';
import {assertOriginalContractRelayGuard,CONTRACT_RELAY_METHODS} from '../src/original-ide-contract-relay-guard-core.js';
import {createDeveloperContractConnection} from '../src/walletconnect-dapp-connection.js';
// All producers below are explicit PUBLIC Native seams, not live Native,
// identityPeerBinding, Root, confirmation, current grant or Relay/network I/O.
const methods=[...CONTRACT_RELAY_METHODS];
const expected=()=>({projectId:'public-project',projectGeneration:1,expiresMS:Date.now()+120000});
function shim(changes={},currentEffect){
 const expiry=Date.now()+60000,state={scope:{kind:'ide-contract-relay-v1',projectId:'public-project',projectGeneration:1,callerIdentity:'PUBLIC-native-nodeCodeIdentity',origin:'https://developer.ynxweb4.com',expiresMS:expiry,chainId:'eip155:6423',methods:[...methods],relayURL:'wss://relay.walletconnect.org',...changes},calls:[],ref:{},notify:null};
 const original=Module._load;
 const native={acquireOriginalIDEContractRelayGuard:async input=>{state.calls.push(['acquire',input]);return state.ref;},readOriginalIDEContractRelayGuardScope:ref=>{assert.equal(ref,state.ref);state.calls.push(['read']);return state.scope;},assertOriginalIDEContractRelayGuardCurrent:ref=>{assert.equal(ref,state.ref);state.calls.push(['current']);currentEffect?.(state);return true;},observeOriginalIDEContractRelayGuardRevocation:(ref,fn)=>{assert.equal(ref,state.ref);state.notify=fn;return()=>{};}};
 for(const verb of ['cancel','revoke','retire','join','close'])native[`${verb}OriginalIDEContractRelayGuard`]=async ref=>{assert.equal(ref,state.ref);state.calls.push([verb]);return true;};
 Module._load=function(name,...args){if(name==='../../../apps/wallet-desktop/native/original-auth-identity.node')return native;return original.call(this,name,...args);};
 state.restore=()=>{Module._load=original;};return state;
}
const get=scope=>acquire({serverModuleURL:'file:///public/original-server.mjs',expectedScope:scope});
test('PUBLIC caller omission adopts Native actual identity before current; readScopeData is detached DATA without current calls',async()=>{
 const f=shim();let owner;
 try{owner=await get(expected());assert.deepEqual(f.calls.slice(0,4).map(c=>c[0]),['acquire','read','current','read']);assert.equal('callerIdentity' in f.calls[0][1].expectedScope,false);
  const before=f.calls.length,a=owner.readScopeData(),b=owner.readScopeData();assert.equal(f.calls.length,before);assert.equal(a.callerIdentity,'PUBLIC-native-nodeCodeIdentity');assert.equal(a.expiresMS,f.scope.expiresMS);assert.ok(Object.isFrozen(a));assert.ok(Object.isFrozen(a.methods));assert.notEqual(a,b);assert.notEqual(a.methods,b.methods);assert.equal(a.authorized,false);assert.equal(a.nativeAdmission,false);assert.equal(a.dataOnly,true);
  assert.equal(assertOriginalContractRelayGuard(owner,{projectId:'public-project',projectGeneration:1}).callerIdentity,a.callerIdentity);
 }finally{await owner?.close();f.restore();}
});
test('PUBLIC expected caller must be omitted or exact/nonempty; missing actual caller retains partial owner',async()=>{
 for(const callerIdentity of ['',undefined,null,'fake-caller']){const f=shim();try{let partial;await assert.rejects(get({...expected(),callerIdentity}),e=>{partial=e.cleanupOwner;return /GUARD_SCOPE_INVALID|GUARD_UNAVAILABLE/.test(e.code);});if(partial)await partial.close();else assert.equal(f.calls.length,0);}finally{f.restore();}}
 for(const callerIdentity of ['',undefined,null]){const f=shim({callerIdentity});try{let partial;await assert.rejects(get(expected()),e=>{partial=e.cleanupOwner;return !!partial&&e.code==='YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE';});assert.equal(partial.readScopeData(),null);await partial.close();assert.deepEqual(f.calls.map(c=>c[0]),['acquire','read','retire','join','close']);}finally{f.restore();}}
 const f=shim();let owner;try{owner=await get({...expected(),callerIdentity:f.scope.callerIdentity});assert.equal(owner.readScopeData().callerIdentity,f.scope.callerIdentity);}finally{await owner?.close();f.restore();}
});
test('PUBLIC positive expiry is an upper bound; required project/gen/fixed scope cannot be loosened',async()=>{
 for(const change of [{expiresMS:0},{expiresMS:1.5},{expiresMS:undefined},{projectGeneration:0},{projectId:''},{kind:'other'},{origin:'https://social.ynxweb4.com'},{chainId:'eip155:1'},{relayURL:'wss://other.invalid'},{methods:[...methods,'personal_sign']},{expiresMSUpperBound:Date.now()+120000}]){const f=shim();try{await assert.rejects(get({...expected(),...change}),/GUARD_SCOPE_INVALID/);assert.equal(f.calls.length,0);}finally{f.restore();}}
 const f=shim();try{let partial;await assert.rejects(get({...expected(),expiresMS:f.scope.expiresMS-1}),e=>{partial=e.cleanupOwner;return !!partial;});assert.equal(partial.readScopeData(),null);await partial.close();}finally{f.restore();}
 for(const change of [{kind:'other'},{origin:'https://social.ynxweb4.com'},{chainId:'eip155:1'},{relayURL:'wss://other.invalid'},{methods:[...methods,'personal_sign']}]){const f=shim(change);try{let partial;await assert.rejects(get(expected()),e=>{partial=e.cleanupOwner;return !!partial;});await partial.close();}finally{f.restore();}}
});
test('PUBLIC same owner rejects identity/expiry drift and scope changes during Native current',async()=>{
 for(const field of ['callerIdentity','expiresMS']){const f=shim();let owner;try{owner=await get(expected());const kept=owner.readScopeData();f.scope[field]=field==='callerIdentity'?'PUBLIC-other-peer':f.scope.expiresMS+1;assert.throws(()=>assertOriginalContractRelayGuard(owner,{projectId:'public-project',projectGeneration:1}),/GUARD_SCOPE_INVALID/);assert.deepEqual(owner.readScopeData(),kept);}finally{await owner?.close();f.restore();}}
 const f=shim({},state=>{state.scope.callerIdentity='PUBLIC-post-current-peer';});try{let partial;await assert.rejects(get(expected()),e=>{partial=e.cleanupOwner;return !!partial;});assert.equal(partial.readScopeData().callerIdentity,'PUBLIC-native-nodeCodeIdentity');await partial.close();}finally{f.restore();}
 let changeAfterCurrent=false;const later=shim({},state=>{if(changeAfterCurrent)state.scope.expiresMS++;});let owner;try{owner=await get(expected());const retained=owner.readScopeData();changeAfterCurrent=true;assert.throws(()=>assertOriginalContractRelayGuard(owner,{projectId:'public-project',projectGeneration:1}),/GUARD_SCOPE_INVALID/);assert.deepEqual(owner.readScopeData(),retained);}finally{await owner?.close();later.restore();}
});
test('PUBLIC dedicated store partition uses actual Native caller, never omitted JS caller, and separates peers',async()=>{
 const partitions=[];
 for(const callerIdentity of ['PUBLIC-peer-A','PUBLIC-peer-B']){const f=shim({callerIdentity});let owner;try{owner=await get(expected());let io=0,opts;const connection=createDeveloperContractConnection({relayGuard:owner,relayContext:{projectId:'public-project',projectGeneration:1},clientFactory:async options=>{io++;opts=options;return {on(){}};}});assert.equal(io,0);await connection.initialize();assert.equal(io,1);const wanted='ynx-contract-'+createHash('sha256').update(JSON.stringify(['public-project',callerIdentity])).digest('hex');assert.equal(opts.storageOptions.database,wanted);partitions.push(wanted);
  const fake=createDeveloperContractConnection({relayGuard:owner,relayContext:{projectId:'public-project',projectGeneration:1,callerIdentity:'fake-caller'},clientFactory:async()=>{io++;return {on(){}};}});await assert.rejects(fake.initialize(),/GUARD_SCOPE_INVALID/);assert.equal(io,1);
 }finally{await owner?.close();f.restore();}}
 assert.notEqual(partitions[0],partitions[1]);
});
