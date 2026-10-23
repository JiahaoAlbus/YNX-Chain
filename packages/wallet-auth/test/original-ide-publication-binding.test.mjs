// PUBLIC fixed-module seam only. No real tagged artifact, Source, Native effect,
// current publisher, approval, signature, raw private key or network is produced.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url),'utf8');
const selection=readFileSync(new URL('../scripts/original-ide-service-admission-native-selection.mjs',import.meta.url),'utf8');
function run(nativeBody,checks,{suffixBody}={}){
 const root=mkdtempSync(join(tmpdir(),'ynx-PUBLIC-publication-binding-'));
 try{
  for(const dir of ['packages/wallet-auth/src','packages/wallet-auth/scripts','apps/wallet-desktop/native','Resources'])mkdirSync(join(root,dir),{recursive:true});
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  // Only this isolated copy's original fixed Native file operand becomes CJS.
  writeFileSync(join(root,'packages/wallet-auth/src/original-ide-admission-parent-delivery.js'),source.replaceAll('../../../apps/wallet-desktop/native/original-auth-identity.node','../../../apps/wallet-desktop/native/original-auth-identity.cjs'));
  writeFileSync(join(root,'packages/wallet-auth/scripts/original-ide-service-admission-native-selection.mjs'),selection);
  if(nativeBody!==null)writeFileSync(join(root,'apps/wallet-desktop/native/original-auth-identity.cjs'),nativeBody);
  if(suffixBody!==undefined)writeFileSync(join(root,'apps/wallet-desktop/native/original-auth-identity.cjs.js'),suffixBody);
  const server=join(root,'Resources/server.mjs');
  writeFileSync(server,`import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';import * as api from '../packages/wallet-auth/src/original-ide-admission-parent-delivery.js';const require=createRequire(import.meta.url),entry=pathToFileURL(process.argv[1]).href;\n${checks}\n`);
  const result=spawnSync(process.execPath,[server],{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr||result.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
}
const names=['captureOriginalIDEPublicationArtifact','readOriginalIDEPublicationArtifactManifest','closeOriginalIDEPublicationArtifact','acquireOriginalIDEProtectedPublicationKeyCall'];
test('PUBLIC four publication callees are available on the existing private module without constructing/invoking',()=>run(`throw Error('PUBLIC_NATIVE_MUST_NOT_LOAD_ON_IMPORT');`,`
for(const name of ${JSON.stringify(names)})assert.equal(typeof api[name],'function');
`));
test('PUBLIC capture/typed constructor pass exact operands and preserve same unread partial owner',()=>run(`
const ref=new Proxy(Object.freeze({}),{get(){throw Error('PUBLIC_REF_MUST_NOT_READ');}}),owner=new Proxy(Object.freeze({}),{get(){throw Error('PUBLIC_PARTIAL_MUST_NOT_INSPECT');}}),calls=[];
module.exports={ref,owner,calls,captureOriginalIDEPublicationArtifact(manifest,bytes){assertArgs(arguments,2);calls.push(['capture',manifest,bytes]);return ref;},readOriginalIDEPublicationArtifactManifest(value){assertArgs(arguments,1);if(value!==ref)throw Error('PUBLIC_WRONG_REF');calls.push(['read',value]);return calls[0][1];},closeOriginalIDEPublicationArtifact(value){assertArgs(arguments,1);if(value!==ref)throw Error('PUBLIC_WRONG_REF');calls.push(['close',value]);return true;},acquireOriginalIDEProtectedPublicationKeyCall(entry,manifest,value){assertArgs(arguments,3);if(value!==ref)throw Error('PUBLIC_WRONG_REF');calls.push(['construct',entry,manifest,value]);return owner;}};
function assertArgs(a,n){if(a.length!==n)throw Error('PUBLIC_ARGC');}
`,`
const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs'),manifest='{"PUBLIC":"\\u0061","x":"é"}',bytes=new Uint8Array([1,2,3]);
const ref=api.captureOriginalIDEPublicationArtifact(manifest,bytes);assert.equal(ref,native.ref);assert.equal(native.calls.length,1);assert.equal(native.calls[0][1],manifest);assert.equal(native.calls[0][2],bytes);
const partial=api.acquireOriginalIDEProtectedPublicationKeyCall(entry,manifest,ref);assert.equal(partial,native.owner);assert.equal(native.calls.length,2);assert.equal(native.calls[1][1],entry);assert.equal(native.calls[1][2],manifest);assert.equal(native.calls[1][3],ref);
assert.equal(api.readOriginalIDEPublicationArtifactManifest(ref),manifest);assert.equal(api.closeOriginalIDEPublicationArtifact(ref),true);assert.deepEqual(native.calls.map(c=>c[0]),['capture','construct','read','close']);
`));
test('PUBLIC capture/read/close require no running-entry qualification for DATA',()=>run(`module.exports={captureOriginalIDEPublicationArtifact(){return {};},readOriginalIDEPublicationArtifactManifest(){return 'PUBLIC original DATA';},closeOriginalIDEPublicationArtifact(){return true;}};`,`
process.argv[1]='/PUBLIC/unrelated-script.mjs';const ref=api.captureOriginalIDEPublicationArtifact('PUBLIC manifest',new Uint8Array(1));assert.equal(typeof ref,'object');assert.equal(api.readOriginalIDEPublicationArtifactManifest(ref),'PUBLIC original DATA');assert.equal(api.closeOriginalIDEPublicationArtifact(ref),true);
`));
test('PUBLIC strict argument count rejects before loading any Native resource',()=>run(`throw Error('PUBLIC_NATIVE_MUST_NOT_LOAD');`,`
for(const args of [[],['x'],['x',new Uint8Array(1),'extra']])assert.throws(()=>api.captureOriginalIDEPublicationArtifact(...args),{code:'IDE_PUBLICATION_ARTIFACT_ARGUMENTS'});
for(const name of ['readOriginalIDEPublicationArtifactManifest','closeOriginalIDEPublicationArtifact'])for(const args of [[],[{},'extra']])assert.throws(()=>api[name](...args),{code:'IDE_PUBLICATION_ARTIFACT_ARGUMENTS'});
for(const args of [[],[entry,'x'],[entry,'x',{},'provider']])assert.throws(()=>api.acquireOriginalIDEProtectedPublicationKeyCall(...args),{code:'IDE_PUBLICATION_ARTIFACT_ARGUMENTS'});
`));
test('PUBLIC constructor checks original running server before Native loading',()=>run(`throw Error('PUBLIC_NATIVE_MUST_NOT_LOAD');`,`
for(const invalid of [null,42,'https://example.test/server.mjs','file://host/server.mjs',entry+'?x=1',entry+'#x',entry.replace('server.mjs','other.mjs')])assert.throws(()=>api.acquireOriginalIDEProtectedPublicationKeyCall(invalid,'PUBLIC',{}),{code:'IDE_ADMISSION_RUNNING_ENTRY_MISMATCH'});
`));
test('PUBLIC missing module/callees return unavailable only for capture/constructor; read/close throw',()=>{
 for(const body of [null,'module.exports={};'])run(body,`
assert.equal(api.captureOriginalIDEPublicationArtifact('PUBLIC',new Uint8Array(1)),null);assert.equal(api.acquireOriginalIDEProtectedPublicationKeyCall(entry,'PUBLIC',{}),null);
for(const name of ['readOriginalIDEPublicationArtifactManifest','closeOriginalIDEPublicationArtifact'])assert.throws(()=>api[name]({}),{code:'IDE_PUBLICATION_ARTIFACT_IMPLEMENTATION_NOT_SUPPLIED'});
`);
});
test('PUBLIC fixed loader refuses Native extension fallback and never selects a provider path',()=>run(null,`
process.env.YNX_ORIGINAL_NATIVE_MODULE='/PUBLIC/unrelated-provider.cjs';assert.equal(api.captureOriginalIDEPublicationArtifact('PUBLIC',new Uint8Array(1)),null);assert.equal(api.acquireOriginalIDEProtectedPublicationKeyCall(entry,'PUBLIC',{}),null);
`,{suffixBody:`throw Error('PUBLIC_EXTENSION_FALLBACK_MUST_NOT_LOAD');`}));
test('PUBLIC every direct Native callee preserves the original arbitrary falsy thrown cause',()=>{
 for(const literal of ['undefined','null','false','0',"''"])run(`module.exports=Object.fromEntries(${JSON.stringify(names)}.map(name=>[name,function(){throw ${literal};}]));`,`
const operands=[['PUBLIC',new Uint8Array(1)],[{}],[{}],[entry,'PUBLIC',{}]];for(const [i,name]of ${JSON.stringify(names)}.entries()){let caught=false;try{api[name](...operands[i]);}catch(cause){caught=true;assert.equal(cause,${literal});}assert.equal(caught,true);}
`);
});
test('PUBLIC original module load/getter/transitive failure is never hidden as unavailable',()=>{
 run(`throw Object.assign(Error('PUBLIC_NATIVE_LOAD_FAILURE'),{code:'ERR_DLOPEN_FAILED'});`,`assert.throws(()=>api.captureOriginalIDEPublicationArtifact('PUBLIC',new Uint8Array(1)),{code:'ERR_DLOPEN_FAILED'});`);
 run(`require('./PUBLIC_missing_dependency.cjs');`,`assert.throws(()=>api.acquireOriginalIDEProtectedPublicationKeyCall(entry,'PUBLIC',{}),{code:'MODULE_NOT_FOUND'});`);
 run(`Object.defineProperty(module.exports,'readOriginalIDEPublicationArtifactManifest',{get(){throw 0;}});`,`let caught=false;try{api.readOriginalIDEPublicationArtifactManifest({});}catch(cause){caught=true;assert.equal(cause,0);}assert.equal(caught,true);`);
});
