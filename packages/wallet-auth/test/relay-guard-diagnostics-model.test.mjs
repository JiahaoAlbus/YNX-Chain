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
  assertContractRelayScope(value){return value;},assertSameContractRelayScope(a,b){assert.equal(a,b);},captureContractRelayExpectedScope:v=>v,
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
for(const stage of contract.stageAllowlist){test('MODEL branch '+stage+' bounded annotation / original error and cleanup',async()=>{
 const m=await model({stage,error:cause(stage==='NATIVE_LOAD'?'ERR_DLOPEN_FAILED':'IDE_CONTRACT_RELAY_SOURCE_UNAVAILABLE')});
 let owner,err;if(stage==='CURRENT_LIVE'){owner=await m.acquire();err=await captured(()=>m.guard.assertOriginalIDEContractRelayGuardCurrent(owner));assert.equal(err,m.error);}else err=await captured(m.acquire);
 assert.equal(err.relayGuardFailureStage,stage);
 assert.equal(err.relayGuardCauseCode,stage==='NATIVE_EXPORTS'||stage==='NATIVE_ACQUIRE_EMPTY'?'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE':stage==='NATIVE_LOAD'?'ERR_DLOPEN_FAILED':'IDE_CONTRACT_RELAY_SOURCE_UNAVAILABLE');
 if(stage==='NATIVE_LOAD'||stage.startsWith('SCOPE_')||stage==='CURRENT_INITIAL')assert.equal(err.cause,m.error);
 if(stage==='NATIVE_ACQUIRE')assert.equal(err,m.error);
 const partial=err.cleanupOwner;
 if(['SCOPE_INITIAL','CURRENT_INITIAL','SCOPE_RECHECK'].includes(stage)){
  assert.ok(partial);assert.throws(()=>m.guard.assertOriginalIDEContractRelayGuardCurrent(partial),e=>e.code==='YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');await partial.close();assert.deepEqual(m.state.calls.slice(-3),['retire','join','close']);assert.equal(partial.snapshot().closed,true);assert.throws(()=>m.guard.assertOriginalIDEContractRelayGuardCurrent(partial));
 }
 if(owner)await owner.close();
 const logged=JSON.stringify(projection(err));assert.ok(!logged.includes('/PRIVATE/')&&!logged.includes('sensitive message')&&!logged.includes('stack')&&!logged.includes('secretPath'));
 });}
test('MODEL primitive0 Native acquisition cause is thrown unchanged and never annotated or ready',async()=>{const m=await model({stage:'NATIVE_ACQUIRE',error:0});const e=await captured(m.acquire);assert.equal(e,0);assert.deepEqual(m.state.calls,['acquire']);});
test('MODEL supplied acquisition partial cleanup owner is preserved on same error',async()=>{const order=[];const partial=Object.freeze({async close(){for(const n of ['retire','join','close'])order.push(n);}});const error=Object.assign(cause(),{cleanupOwner:partial});const m=await model({stage:'NATIVE_ACQUIRE',error});const e=await captured(m.acquire);assert.equal(e,error);assert.equal(e.cleanupOwner,partial);await e.cleanupOwner.close();assert.deepEqual(order,['retire','join','close']);assert.throws(()=>m.guard.assertOriginalIDEContractRelayGuardCurrent(partial));});
test('MODEL Proxy errors and causes trigger zero reflection traps including revoked proxy',async()=>{const m=await model();let traps=0;const handler=new Proxy({},{get(){return()=>{++traps;throw Error('TRAP');};}});const proxy=new Proxy({},handler);assert.equal(m.diagnostic.markOriginalIDEContractRelayDiagnostic(proxy,'NATIVE_LOAD'),proxy);const target={};m.diagnostic.markOriginalIDEContractRelayDiagnostic(target,'NATIVE_LOAD',proxy);assert.equal(target.relayGuardCauseCode,'UNCLASSIFIED');const rev=Proxy.revocable({},{});rev.revoke();assert.equal(m.diagnostic.markOriginalIDEContractRelayDiagnostic(rev.proxy,'NATIVE_LOAD'),rev.proxy);assert.equal(traps,0);});
test('MODEL own code/cause/stage accessors never execute',async()=>{const m=await model();let gets=0;const c={get code(){++gets;return 'ERR_DLOPEN_FAILED';},get cause(){++gets;return {code:'ERR_DLOPEN_FAILED'};}};const e={};m.diagnostic.markOriginalIDEContractRelayDiagnostic(e,'NATIVE_LOAD',c);assert.equal(e.relayGuardCauseCode,'UNCLASSIFIED');const pre={get relayGuardFailureStage(){++gets;return 'raw';}};assert.equal(m.diagnostic.markOriginalIDEContractRelayDiagnostic(pre,'NATIVE_LOAD',c),pre);assert.equal(gets,0);});
test('MODEL frozen cause preserved and frozen original target is not replaced',async()=>{const m=await model();const c=Object.freeze(cause('ERR_REQUIRE_ESM'));const e={cause:c};assert.equal(m.diagnostic.markOriginalIDEContractRelayDiagnostic(e,'NATIVE_LOAD',c),e);assert.equal(e.cause,c);assert.equal(e.relayGuardCauseCode,'ERR_REQUIRE_ESM');const frozen=Object.freeze(cause('ERR_DLOPEN_FAILED'));assert.equal(m.diagnostic.markOriginalIDEContractRelayDiagnostic(frozen,'NATIVE_LOAD'),frozen);assert.equal(Object.getOwnPropertyDescriptor(frozen,'relayGuardFailureStage'),undefined);});
test('MODEL cycle and depth4 bounded; fifth cause code remains unclassified',async()=>{const m=await model();const cycle={code:'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE'};cycle.cause=cycle;const e={};m.diagnostic.markOriginalIDEContractRelayDiagnostic(e,'NATIVE_LOAD',cycle);assert.equal(e.relayGuardCauseCode,'YNX_CONTRACT_RELAY_GUARD_UNAVAILABLE');const chain=n=>{let c={code:'ERR_DLOPEN_FAILED'};for(let i=1;i<n;i++)c={cause:c};return c;};const four={},five={};m.diagnostic.markOriginalIDEContractRelayDiagnostic(four,'NATIVE_LOAD',chain(4));m.diagnostic.markOriginalIDEContractRelayDiagnostic(five,'NATIVE_LOAD',chain(5));assert.equal(four.relayGuardCauseCode,'ERR_DLOPEN_FAILED');assert.equal(five.relayGuardCauseCode,'UNCLASSIFIED');});
test('MODEL first bounded stage sticks; unknown raw path/message/code never enters fields',async()=>{const m=await model();const e={};m.diagnostic.markOriginalIDEContractRelayDiagnostic(e,'SCOPE_INITIAL',cause('ERR_DLOPEN_FAILED'));m.diagnostic.markOriginalIDEContractRelayDiagnostic(e,'CURRENT_LIVE',cause('ERR_REQUIRE_ESM'));assert.equal(e.relayGuardFailureStage,'SCOPE_INITIAL');assert.equal(e.relayGuardCauseCode,'ERR_DLOPEN_FAILED');const raw=Object.assign(new Error('/PRIVATE/PATH secret'),{code:'/PRIVATE/KEY',stack:'PRIVATE STACK',path:'/PRIVATE/PATH'});const out={};m.diagnostic.markOriginalIDEContractRelayDiagnostic(out,'NATIVE_LOAD',raw);assert.deepEqual(Object.keys(out).sort(),contract.fields.slice().sort());assert.equal(out.relayGuardCauseCode,'UNCLASSIFIED');assert.ok(!JSON.stringify(out).includes('PRIVATE'));const unknown={};m.diagnostic.markOriginalIDEContractRelayDiagnostic(unknown,'PRIVATE_STAGE',raw);assert.deepEqual(unknown,{});});
test('MODEL contract exact8 stages and48 cause codes; all approved codes remain bounded',async()=>{const m=await model();assert.equal(contract.stageAllowlist.length,8);assert.equal(contract.causeCodeAllowlist.length,48);for(const code of contract.causeCodeAllowlist){const e={};m.diagnostic.markOriginalIDEContractRelayDiagnostic(e,'NATIVE_LOAD',{code});assert.equal(e.relayGuardCauseCode,code);assert.equal(e.relayGuardFailureStage,'NATIVE_LOAD');}});
