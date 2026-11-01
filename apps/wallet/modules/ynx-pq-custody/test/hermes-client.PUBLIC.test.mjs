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
