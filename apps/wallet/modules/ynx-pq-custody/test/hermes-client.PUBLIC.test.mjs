import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
// PUBLIC installer seam exercises ONLY Hermes-safe client selection, never
// the authenticity of an Auth capture or a native signed result.
const require=createRequire(import.meta.url);
const ts=require(process.env.YNX_TYPESCRIPT_MODULE);
const source=readFileSync(new URL('../index.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(installer,api){
 const exports={},sandbox={exports,require:name=>{assert.equal(name,'react-native');return {NativeModules:{YNXPQCustody:installer}};},__ynxPQCustodyV1:api};
 vm.runInNewContext(js,sandbox,{filename:'actual-Hermes-client.js'});return exports;
}
test('missing original module and denied install fail closed without fetch, keys or SDK',()=>{
 for(const installer of [undefined,{install:()=>false}])assert.throws(()=>fixture(installer).preparePQOperation({reference:'PUBLIC',mode:'transaction'}),/PQ_MOBILE_NATIVE_NOT_SUPPLIED/);
});
test('approval bool, numeric owner, backup and credential are refused before native selection',()=>{
 let calls=0;const client=fixture({install(){calls++;return true;}},{prepare(){calls++;}});
 for(const extra of [{approved:true},{owner:17},{credential:'PUBLIC-placeholder'},{encryptedBackup:'PUBLIC-placeholder'}])assert.throws(()=>client.preparePQOperation({reference:'PUBLIC',mode:'transaction',...extra}),/PQ_MOBILE_SELECTION_INVALID/);
 assert.equal(calls,0);
});
test('bad reference/mode cannot become a signing or restore selector',()=>{
 const client=fixture({install(){throw Error('MUST_NOT_INSTALL');}});
 for(const selection of [{reference:'',mode:'transaction'},{reference:'x\0y',mode:'transaction'},{reference:17,mode:'transaction'},{reference:'PUBLIC',mode:'birth'},{reference:'PUBLIC',mode:'classic'}])assert.throws(()=>client.preparePQOperation(selection),/PQ_MOBILE_SELECTION_INVALID/);
});
test('native held object is returned unchanged; prepare never automatically signs or submits',async()=>{
 const held=Object.freeze({PUBLIC:true}),calls=[];
 const client=fixture({install:()=>true},{prepare(reference,mode){calls.push([reference,mode]);return Promise.resolve(held);}});
 for(const mode of ['transaction','registered-restore','original-query'])assert.equal(await client.preparePQOperation({reference:'PUBLIC-ref',mode}),held);
 assert.deepEqual(calls,[['PUBLIC-ref','transaction'],['PUBLIC-ref','registered-restore'],['PUBLIC-ref','original-query']]);
});
const rawStatus=(extra={})=>({version:1,runtime:'ready',heldOperations:3,heldCoreUncertain:1,heldOSUncertain:1,heldOSRecorded:1,heldCleanupFaults:1,workerBusy:false,...extra});
test('passive status never touches installer, prepare or a fabricated reference',()=>{
 let reads=0;const module={readPublicStatus(){reads++;return rawStatus();}};
 Object.defineProperty(module,'install',{get(){throw Error('MUST_NOT_READ_INSTALL');}});
 const client=fixture(module,{prepare(){throw Error('MUST_NOT_PREPARE');}}),value=client.readPQPublicStatus();
 assert.equal(reads,1);assert.equal(value.nativeLink,'native-reported');assert.equal(value.runtime,'ready');
 assert.equal(value.held.operations,3);assert.equal(value.held.osUncertain,1);assert.equal(value.held.osRecorded,1);
 assert.equal(value.inventoryScope,'current-process-held-only');assert.equal(value.snapshot,'last-completed-job');
 for(const field of ['authority','durableInventory','osProtection','keyHealth'])assert.equal(value[field],'not-inspected');
 for(const field of ['canSign','canRestore','canSubmit'])assert.equal(value[field],false);
 assert.equal(value.protectedSelection,'not-supplied');assert(Object.isFrozen(value)&&Object.isFrozen(value.held));
});
test('missing, boolean, permission and reference DTOs cannot become native status',()=>{
 for(const module of [undefined,{}, {install(){throw Error('MUST_NOT_INSTALL');}}]){
  const value=fixture(module).readPQPublicStatus();assert.equal(value.nativeLink,'not-observed');assert.equal(value.statusReason,'native-status-not-supplied');
 }
 for(const raw of [true,{approved:true},{reference:'PUBLIC'},rawStatus({approved:true}),rawStatus({heldOperations:65}),rawStatus({heldCoreUncertain:-1}),rawStatus({heldOSRecorded:3}),rawStatus({runtime:'authorized'}),rawStatus({runtime:'not-installed'})]){
  const value=fixture({readPublicStatus:()=>raw}).readPQPublicStatus();assert.equal(value.nativeLink,'not-observed');assert.equal(value.held,null);assert.equal(value.canSign,false);
 }
});
test('status read failures and accessors expose no original exception or private DATA',()=>{
 const value=fixture({readPublicStatus(){throw Error('PRIVATE-NATIVE-DATA');}}).readPQPublicStatus();
 assert.equal(value.statusReason,'native-status-read-failed');assert(!JSON.stringify(value).includes('PRIVATE-NATIVE-DATA'));
 let invoked=0;const raw=rawStatus();Object.defineProperty(raw,'runtime',{enumerable:true,get(){invoked++;return 'ready';}});
 const invalid=fixture({readPublicStatus:()=>raw}).readPQPublicStatus();assert.equal(invoked,0);assert.equal(invalid.statusReason,'native-status-invalid');
});
test('runtime and busy observations never inspect cold inventory or grant effects',()=>{
 for(const runtime of ['not-installed','initializing','ready','retaining']){
  const value=fixture({readPublicStatus:()=>rawStatus({runtime,heldOperations:0,heldCoreUncertain:0,heldOSUncertain:0,heldOSRecorded:0,heldCleanupFaults:0,workerBusy:runtime==='retaining'})}).readPQPublicStatus();
  assert.equal(value.runtime,runtime);assert.equal(value.durableInventory,'not-inspected');assert.equal(value.canRestore,false);assert.equal(value.canSubmit,false);
 }
});
test('reading passive status does not initialize the explicit operation path',async()=>{
 let installs=0,prepares=0;const held=Object.freeze({PUBLIC:true}),client=fixture({install(){installs++;return true;},readPublicStatus:()=>rawStatus()},{prepare(){prepares++;return Promise.resolve(held);}});
 client.readPQPublicStatus();client.readPQPublicStatus();assert.equal(installs,0);assert.equal(prepares,0);
 assert.equal(await client.preparePQOperation({reference:'PUBLIC-original',mode:'original-query'}),held);assert.equal(installs,1);assert.equal(prepares,1);
});
