import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {declaredSDKRuntimeSources} from '../scripts/release-provenance.mjs';
const require=createRequire(new URL('../package.json',import.meta.url)),{FileMatcher}=require('app-builder-lib/out/fileMatcher'),asar=require('@electron/asar');
const meta=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))),prefix='node_modules/@ynx-chain/wallet-auth/';
function filter(root){return new FileMatcher(root,'/PUBLIC/output',value=>value,meta.build.files).createFilter();}
const regression='native/test-pq-catalog-source-contract.mjs';
test('real electron-builder matcher excludes only the known unselected SDK35 native test, not production or approved evidence',()=>{
 const root='/PUBLIC/source',selected=filter(root),stat={isDirectory:()=>false};assert.equal(selected(path.join(root,prefix,regression),stat),false);
 for(const name of ['native/original-pq-host-catalog-source-contract.mjs','native/original-auth-source-v2-dispatch.mjs','native/original-auth-identity-source-v2-verifier.mjs','src/ide-artifact-release-result.js','scripts/normal-runtime-materialization.mjs','native/original-auth-identity-source-authority.test.mjs','native/test-foreign.mjs'])assert.equal(selected(path.join(root,prefix,name),stat),true,name);
});
test('actual immutable A35 package does not declare the excluded test as a runtime source',{skip:!process.env.WALLET_ACTUAL_SOURCE_ROOT},()=>{
 const names=declaredSDKRuntimeSources(process.env.WALLET_ACTUAL_SOURCE_ROOT,'HEAD');assert(!names.includes('packages/wallet-auth/'+regression));assert(names.includes('packages/wallet-auth/native/original-pq-host-catalog-source-contract.mjs'));
});
test('the actual final runtime gate still rejects the known test if packed, and rejects foreign Native/script runtime assets',()=>{
 const raw=fs.readFileSync(new URL('../scripts/release-provenance.mjs',import.meta.url),'utf8'),start=raw.indexOf('  const allowed=new Set(names.filter'),end=raw.indexOf('  return { ...expected, packagedSourceVerified',start);assert(start>0&&end>start);
 const run=Function('names','receipt','packedRuntimePath',raw.slice(start,end)),runtime='packages/wallet-auth/native/original-pq-host-catalog-source-contract.mjs',packed=name=>'code/'+name;
 run([runtime],{after:[{path:packed(runtime),type:'file'}]},packed);
 for(const name of ['packages/wallet-auth/'+regression,'packages/wallet-auth/native/test-foreign.mjs','packages/wallet-auth/scripts/foreign-runtime.mjs'])assert.throws(()=>run([runtime],{after:[{path:packed(name),type:'file'}]},packed),/Unlisted packaged runtime member/);
});
test('real matcher plus actual ASAR writer retains runtime/evidence bytes and omits the known test without mutating its source',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-sdk35-pack-test-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const archive=path.join(root,'app.asar'),inputs=[regression,'native/original-pq-host-catalog-source-contract.mjs','native/original-auth-identity-source-authority.test.mjs','src/ide-artifact-release-result.js'];
 const bodies=new Map(inputs.map(name=>[prefix+name,Buffer.from('PUBLIC original bytes '+name)]));
 for(const[name,body]of bodies){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
 // Like the production relocation writer, wait for the original short-lived
 // ASAR child's real exit: this library resolves before final stream flush.
 const pkg=fileURLToPath(new URL('../package.json',import.meta.url)),code=`import{createRequire}from'node:module';import fs from'node:fs';import path from'node:path';import{Readable}from'node:stream';const r=createRequire(${JSON.stringify(pkg)}),a=r('@electron/asar'),{FileMatcher}=r('app-builder-lib/out/fileMatcher'),root=${JSON.stringify(root)},archive=${JSON.stringify(archive)},meta=JSON.parse(fs.readFileSync(${JSON.stringify(pkg)})),filter=new FileMatcher(root,'/PUBLIC/output',v=>v,meta.build.files).createFilter();const streams=${JSON.stringify([...bodies.keys()])}.filter(name=>filter(path.join(root,name),{isDirectory:()=>false})).map(name=>{const body=fs.readFileSync(path.join(root,name));return{path:name,type:'file',stat:{mode:0o644,size:body.length},streamGenerator:()=>Readable.from([body])}});await a.createPackageFromStreams(archive,streams);`;
 execFileSync(process.execPath,['--input-type=module','-e',code],{stdio:'pipe'});asar.uncache(archive);const names=asar.listPackage(archive);assert(!names.includes('/'+prefix+regression));
 for(const[name,body]of bodies){assert(fs.readFileSync(path.join(root,name)).equals(body));if(name!==prefix+regression)assert(asar.extractFile(archive,name).equals(body));}
});
