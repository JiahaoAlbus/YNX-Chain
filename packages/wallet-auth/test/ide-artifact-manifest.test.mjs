import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeIDEArtifactManifestData as encode,inspectIDEArtifactManifestData as inspect} from '../src/ide-artifact-manifest.js';
const te=new TextEncoder(),td=new TextDecoder();
const manifest=()=>({projectId:'项目/a',version:'1',contentDigest:'a'.repeat(64),publishPurpose:'release',targetEnvironment:'testnet',byteSize:7});
const bad=f=>assert.throws(f,{code:'IDE_ARTIFACT_MANIFEST_INVALID'});
test('canonical typed six matches original sorted JSON and inspection is frozen',()=>{
 const m=manifest(),raw=encode(m),expected='{"byteSize":7,"contentDigest":"'+'a'.repeat(64)+'","projectId":"项目/a","publishPurpose":"release","targetEnvironment":"testnet","version":"1"}';
 assert.equal(td.decode(raw),expected);const dto=inspect(raw);assert.deepEqual(dto,{byteSize:7,contentDigest:m.contentDigest,projectId:m.projectId,publishPurpose:m.publishPurpose,targetEnvironment:m.targetEnvironment,version:m.version});assert.ok(Object.isFrozen(dto));
 raw.fill(0);assert.equal(dto.projectId,'项目/a');assert.equal(td.decode(encode(m)),expected);
});
test('reject duplicate, escaped duplicate, spacing, ordering, slash escaping and numeric spellings',()=>{
 const canonical=td.decode(encode(manifest()));
 for(const text of [canonical.replace('{','{"byteSize":7,'),canonical.replace('{','{"\\u0062yteSize":7,'),' '+canonical,canonical.replace('7,','7.0,'),canonical.replace('项目/a','项目\\/a'),JSON.stringify(manifest()),canonical.replace('7,','7e0,')])bad(()=>inspect(te.encode(text)));
});
test('strict UTF8, raw bounds, ordinary copied storage only',()=>{
 for(const raw of [new Uint8Array(),new Uint8Array(16385),new Uint8Array([0xc0,0xaf]),new Uint8Array([0xef,0xbb,0xbf,...encode(manifest())]),new Uint8Array(new SharedArrayBuffer(8)),new Uint8Array(encode(manifest()).buffer,0,3)])bad(()=>inspect(raw));
 const raw=encode(manifest());Object.defineProperty(raw,'hidden',{value:1});bad(()=>inspect(raw));
 class Sub extends Uint8Array{}bad(()=>inspect(new Sub(encode(manifest()))));
 if(typeof ArrayBuffer.prototype.resize==='function')bad(()=>inspect(new Uint8Array(new ArrayBuffer(5,{maxByteLength:10}))));
});
test('exact own data fields never invoke value accessors; reject hidden/symbol/prototype',()=>{
 let calls=0;const m=manifest();Object.defineProperty(m,'version',{get(){calls++;throw Error('getter');},enumerable:true});bad(()=>encode(m));assert.equal(calls,0);
 const hidden=manifest();Object.defineProperty(hidden,'version',{value:'1',enumerable:false});bad(()=>encode(hidden));
 const extra=manifest();extra[Symbol('x')]=1;bad(()=>encode(extra));bad(()=>encode(Object.assign(Object.create({x:1}),manifest())));bad(()=>encode({...manifest(),extra:1}));
 const sparse=[];sparse.length=6;bad(()=>encode(sparse));
});
test('Native size/hash/text limits, scalar validity and no authority fields',()=>{
 for(const byteSize of [true,false,0,-1,1.5,67108865,NaN,Infinity,'7'])bad(()=>encode({...manifest(),byteSize}));
 assert.equal(inspect(encode({...manifest(),byteSize:67108864})).byteSize,67108864);
 for(const contentDigest of ['A'.repeat(64),'a'.repeat(63),'g'.repeat(64)])bad(()=>encode({...manifest(),contentDigest}));
 for(const key of ['projectId','version','publishPurpose','targetEnvironment']){
  for(const value of ['',true,' a','a\u0085','a\u0000b','a\u200db','\ud800','a'.repeat(257),'界'.repeat(86)])bad(()=>encode({...manifest(),[key]:value}));
  assert.equal(inspect(encode({...manifest(),[key]:'😀'.repeat(64)}))[key],'😀'.repeat(64));
 }
 bad(()=>encode({...manifest(),granted:true}));const changed=encode({...manifest(),version:'2'});assert.equal(inspect(changed).version,'2');assert.notDeepEqual(changed,encode(manifest()));
});
