import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {types} from 'node:util';
import {posix} from 'node:path';
import {Buffer} from 'node:buffer';
const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const diagnosticSource=source('original-ide-contract-relay-diagnostics.js');
const guardSource=source('original-ide-contract-relay-guard-node.js');
const contract=JSON.parse(readFileSync(new URL('./fixtures/relay-guard-diagnostic-contract.json',import.meta.url),'utf8'));
const cause=(code='IDE_CONTRACT_RELAY_SOURCE_UNAVAILABLE')=>Object.assign(new Error('/PRIVATE/PATH sensitive message'),{code,secretPath:'/PRIVATE/PATH'});
async function model(options={}){
 const context=vm.createContext({});const state={calls:[],scopeCalls:0,currentCalls:0,registry:new WeakMap(),ref:Object.freeze({MODEL:'PUBLIC inert ref'}),scope:Object.freeze({methods:Object.freeze(['MODEL_READ']),project:'PUBLIC_PROJECT'}),...options};
 const error=state.error??cause();
 const native={
  async acquireOriginalIDEContractRelayGuard(){state.calls.push('acquire');if(state.stage==='NATIVE_ACQUIRE')throw error;if(state.stage==='NATIVE_ACQUIRE_EMPTY')return null;return state.ref;},
  readOriginalIDEContractRelayGuardScope(ref){assert.equal(ref,state.ref);++state.scopeCalls;state.calls.push('scope'+state.scopeCalls);if(state.stage==='SCOPE_INITIAL'&&state.scopeCalls===1||state.stage==='SCOPE_RECHECK'&&state.scopeCalls===2)throw error;return state.scope;},
  assertOriginalIDEContractRelayGuardCurrent(ref){assert.equal(ref,state.ref);++state.currentCalls;state.calls.push('current'+state.currentCalls);if(state.stage==='CURRENT_INITIAL'&&state.currentCalls===1||state.stage==='CURRENT_LIVE'&&state.currentCalls===2)throw error;return true;},
  observeOriginalIDEContractRelayGuardRevocation(){return ()=>{};},
 };
 for(const n of ['cancel','revoke','retire','join','close'])native[n+'OriginalIDEContractRelayGuard']=ref=>{assert.equal(ref,state.ref);state.calls.push(n);return true;};
 const synthetic=(name,exports)=>new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context,identifier:name});
 const modules=new Map();
 modules.set('node:util',synthetic('node:util',{types}));
 modules.set('node:path',synthetic('node:path',{posix}));
 modules.set('node:buffer',synthetic('node:buffer',{Buffer}));
 modules.set('node:module',synthetic('node:module',{createRequire:()=>specifier=>{assert.equal(specifier,'../../../apps/wallet-desktop/native/original-auth-identity.node');if(state.stage==='NATIVE_LOAD')throw error;return state.stage==='NATIVE_EXPORTS'?{}:native;}}));
 modules.set('./original-ide-contract-relay-guard-core.js',synthetic('PUBLIC:core-only-MODEL',{
  assertContractRelayScope(value){if(state.stage==='VALIDATE'&&state.scopeCalls===state.failRead)throw error;return value;},assertSameContractRelayScope(a,b){if(state.stage==='MATCH_CAPTURE')throw error;assert.equal(a,b);},captureContractRelayExpectedScope:v=>v,
  registerOriginalContractRelayGuard(owner,value){state.registry.set(owner,value);},
  assertOriginalContractRelayGuard(owner){const v=state.registry.get(owner);assert.ok(v);const s=v.scope();assert.equal(v.current(),true);return s;},
 }));
 const diagnostic=new vm.SourceTextModule(diagnosticSource,{context,identifier:'file:///PUBLIC/MODEL/original-ide-contract-relay-diagnostics.js'});
 modules.set('./original-ide-contract-relay-diagnostics.js',diagnostic);
 const guard=new vm.SourceTextModule(guardSource,{context,identifier:'file:///PUBLIC/MODEL/original-ide-contract-relay-guard-node.js'});
 const link=specifier=>{const m=modules.get(specifier);if(!m)throw Error('UNEXPECTED_MODEL_IMPORT '+specifier);return m;};
 await diagnostic.link(link);await diagnostic.evaluate();await guard.link(link);await guard.evaluate();
 const localContext=vm.runInContext("Object.freeze({workspace:'/PUBLIC/work',profile:'/PUBLIC/profile',id:'PUBLIC_1'})",context);
 return {state,error,diagnostic:diagnostic.namespace,guard:guard.namespace,acquire:()=>guard.namespace.acquireOriginalIDEContractRelayGuard({serverModuleURL:'file:///PUBLIC/server.mjs',localContext})};
}
const captured=async fn=>{try{await fn();assert.fail('MODEL expected rejection');}catch(e){return e;}};
function projection(e){const o={};for(const k of contract.fields){const d=Object.getOwnPropertyDescriptor(e,k);if(d&&Object.hasOwn(d,'value'))o[k]=d.value;}return o;}

for(const failRead of [1,2])for(const phase of ['NATIVE_READ','VALIDATE','MATCH_CAPTURE']){
 if(phase==='MATCH_CAPTURE'&&failRead===1)continue;
 test(`MODEL precise scope phase ${failRead}/${phase} retains first cause and cleanup`,async()=>{
  const error=cause('NOT_ALLOWLISTED_NATIVE_CODE');
  const stage=phase==='NATIVE_READ'?(failRead===1?'SCOPE_INITIAL':'SCOPE_RECHECK'):phase;
  const m=await model({stage,failRead,error});const e=await captured(m.acquire);
  assert.equal(e.relayGuardFailureStage,failRead===1?'SCOPE_INITIAL':'SCOPE_RECHECK');
  assert.equal(e.relayGuardScopePhase,phase);assert.equal(e.relayGuardCauseCode,'UNCLASSIFIED');assert.equal(e.cause,error);
  const owner=e.cleanupOwner;assert.ok(owner);assert.throws(()=>m.guard.assertOriginalIDEContractRelayGuardCurrent(owner));
  assert.equal(m.state.calls.filter(x=>x==='acquire').length,1);
  const calls=[...m.state.calls];await owner.close();await owner.close();assert.deepEqual(m.state.calls,[...calls,'retire','join','close']);
  assert.equal(owner.snapshot().closed,true);assert.equal(owner.snapshot().replayAllowed,false);
  assert.deepEqual(Object.keys(projection(e)).sort(),['relayGuardCauseCode','relayGuardFailureStage','relayGuardScopePhase'].sort());
  assert.ok(!JSON.stringify(projection(e)).includes('/PRIVATE/'));
 });
}
test('MODEL non-scope, invalid and absent phases emit no supplemental field',async()=>{
 const m=await model();for(const [stage,phase]of [['CURRENT_INITIAL','NATIVE_READ'],['SCOPE_INITIAL','PRIVATE_SECRET'],['SCOPE_RECHECK',undefined]]){
  const e={};assert.equal(m.diagnostic.markOriginalIDEContractRelayDiagnostic(e,stage,{},phase),e);assert.equal(Object.hasOwn(e,'relayGuardScopePhase'),false);
 }
});
test('MODEL first annotation and frozen original remain unchanged',async()=>{
 const m=await model();const e={};m.diagnostic.markOriginalIDEContractRelayDiagnostic(e,'SCOPE_INITIAL',{},'NATIVE_READ');
 m.diagnostic.markOriginalIDEContractRelayDiagnostic(e,'SCOPE_RECHECK',{},'VALIDATE');assert.equal(e.relayGuardScopePhase,'NATIVE_READ');
 const frozen=Object.freeze(cause());assert.equal(m.diagnostic.markOriginalIDEContractRelayDiagnostic(frozen,'SCOPE_INITIAL',frozen,'NATIVE_READ'),frozen);assert.equal(Object.hasOwn(frozen,'relayGuardScopePhase'),false);
});
