import test from 'node:test';import assert from 'node:assert/strict';
import {canonicalJSON} from '../../packages/wallet-auth/src/canonical.js';
import {serializeAuth36NormalManifestData as encode,inspectAuth36NormalManifestData as inspect} from './auth36-normal-manifest-serialization.mjs';
const auth='original-auth-runtime-manifest.json',union='original-ide-contract-relay-runtime-manifest.json',version='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1';
const fixture=()=>({version,files:[{sha256:'a'.repeat(64),path:'package.json',bytes:3},{path:'src/entry.js',bytes:7,sha256:'b'.repeat(64)}]});
const rejects=fn=>assert.throws(fn,{code:'AUTH36_NORMAL_MANIFEST_INVALID'});
test('new normal producer reuses canonicalJSON exact key order and emits no LF',()=>{
 const input=fixture(),raw=encode(auth,input);assert.deepEqual(raw,Buffer.from(canonicalJSON(input)));assert.equal(raw.at(-1),125);
 const body=inspect(auth,raw);assert.equal(JSON.stringify(body),raw.toString());assert.deepEqual(Object.keys(body),['files','version']);assert.deepEqual(Object.keys(body.files[0]),['bytes','path','sha256']);assert(Object.isFrozen(body)&&Object.isFrozen(body.files)&&Object.isFrozen(body.files[0]));assert.deepEqual(encode(auth,body),raw);
});
test('strict DATA byte inspector rejects LF, pretty, reordered keys and duplicate JSON key',()=>{
 const raw=encode(auth,fixture()),body=JSON.parse(raw);
 for(const bad of [Buffer.concat([raw,Buffer.from('\n')]),Buffer.from(JSON.stringify(body,null,2)),Buffer.from(JSON.stringify({version,files:body.files})),Buffer.from(JSON.stringify({files:body.files.map(r=>({path:r.path,bytes:r.bytes,sha256:r.sha256})),version})),Buffer.from(raw.toString().replace('"bytes":3','"bytes":3,"bytes":3'))])rejects(()=>inspect(auth,bad));
});
test('producer refuses unsorted, duplicate and malformed rows without silently sorting them',()=>{
 const patches=[{bytes:true},{bytes:1.5},{bytes:-1},{bytes:16777217},{sha256:'A'.repeat(64)},{path:'../outside'},{path:'/absolute'},{path:'a\\b'},{path:'a//b'},{path:'native/original-ide-auth-runtime-manifest.json'},{extra:true}];
 for(const patch of patches){const b=fixture();b.files[0]={...b.files[0],...patch};rejects(()=>encode(auth,b));}
 const reversed=fixture();reversed.files.reverse();rejects(()=>encode(auth,reversed));const duplicate=fixture();duplicate.files[1].path=duplicate.files[0].path;rejects(()=>encode(auth,duplicate));const hole=fixture();delete hole.files[0];rejects(()=>encode(auth,hole));
});
test('exact known manifest roles retain union empty files and refuse schema or self-row drift',()=>{
 const empty={files:[{bytes:0,path:'node_modules/pino/.nojekyll',sha256:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}],version};assert.equal(inspect(union,encode(union,empty)).files[0].bytes,0);rejects(()=>encode(auth,empty));empty.files[0].sha256='a'.repeat(64);rejects(()=>encode(union,empty));
 rejects(()=>encode('walletconnect-runtime-manifest.json',fixture()));rejects(()=>encode(auth,{...fixture(),version:'foreign'}));rejects(()=>encode(auth,{...fixture(),extra:false}));const self=fixture();self.files=[{...self.files[0],path:'native/original-ide-contract-relay-runtime-manifest.json'}];rejects(()=>encode(union,self));
});
test('inert DATA capture rejects getters/hidden rows and never invokes getters',()=>{
 let calls=0;const b=fixture();Object.defineProperty(b,'files',{enumerable:true,get(){calls++;return []}});rejects(()=>encode(auth,b));assert.equal(calls,0);const row=fixture();Object.defineProperty(row.files[0],'hidden',{value:true});rejects(()=>encode(auth,row));
});
test('PUBLIC supplied35 and full36 parent DATA preserve every row byte identity while repairing only serialization',()=>{
 const supplied35=encode(auth,fixture()),full36Data=JSON.parse(supplied35);full36Data.files.push({path:'src/new36.js',bytes:9,sha256:'c'.repeat(64)});
 const legacy36=Buffer.from(canonicalJSON(full36Data)+'\n');rejects(()=>inspect(auth,legacy36));const repaired36=encode(auth,JSON.parse(legacy36));assert.deepEqual(repaired36,legacy36.subarray(0,-1));assert.deepEqual(inspect(auth,repaired36).files,full36Data.files);assert.deepEqual(supplied35,encode(auth,JSON.parse(supplied35)));
});
