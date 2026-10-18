import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {declaredSDKRuntimeSources} from '../scripts/release-provenance.mjs';
function fixture(t,declared,files){
 const root=mkdtempSync(path.join(os.tmpdir(),'ynx-sdk-declarations-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(name,body)=>{const target=path.join(root,'packages/wallet-auth',name);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,body)};
 put('package.json',JSON.stringify({files:declared}));for(const[name,body]of Object.entries(files))put(name,body);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','commit','-qm','PUBLIC fixture');
 return()=>declaredSDKRuntimeSources(root,git('rev-parse','HEAD'));
}
test('declared d.mts/types/native source exist but are not executable runtime',t=>{
 const run=fixture(t,['scripts','native/contract.d.mts','native/contract.d.ts','native/contract.d.cts','native/source.mm','native/source.h'],{'scripts/runtime.mjs':'export const PUBLIC=true;','native/contract.d.mts':'export declare const PUBLIC:true;','native/contract.d.ts':'export declare const PUBLIC:true;','native/contract.d.cts':'export declare const PUBLIC:true;','native/source.mm':'// PUBLIC source','native/source.h':'// PUBLIC source'});
 assert.deepEqual(run(),['packages/wallet-auth/scripts/runtime.mjs']);
});
test('missing declared type, native source or real runtime remains a hard refusal',t=>{
 for(const name of ['native/contract.d.mts','native/source.h','native/source.mm','native/runtime.mjs'])assert.throws(fixture(t,[name],{'src/sentinel.js':'export const PUBLIC=true;'}),/declared runtime source is missing/);
});
test('a native-source-only directory is not missing runtime, but a test-only runtime scope is rejected',t=>{
 assert.deepEqual(fixture(t,['native/source'],{'native/source/header.h':'// PUBLIC','native/source/implementation.mm':'// PUBLIC'})(),[]);
 assert.throws(fixture(t,['scripts'],{'scripts/only.test.mjs':'// PUBLIC fixture, not runtime'}),/declared runtime source is missing/);
});
