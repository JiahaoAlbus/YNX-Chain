import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const originalNative=process.env.WALLET_CONTROL_ORIGINAL_NATIVE;
test('new control binding parses against original supplier TU/types, not only PUBLIC doubles',{skip:process.platform!=='darwin'||!originalNative},async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),source=path.resolve(originalNative,'../../..'),relative='apps/wallet-desktop/native/original-auth-identity-node.mm',tu=path.join(source,relative),record=JSON.parse(await fs.readFile(path.join(source,'apps/wallet-desktop/native/original-auth-identity-build.json'),'utf8')),pin=record.inputFiles.find(p=>p.relative===relative),b=await fs.readFile(tu);
 assert.equal(b.length,pin.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),pin.sha256);
 const run=spawnSync('/usr/bin/clang++',['-std=c++17','-fobjc-arc','-fsyntax-only','-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL=1','-DYNX_CONTROL_ORIGINAL_MAIN_TU='+JSON.stringify(tu),'-I'+record.headerRoot,'-I'+originalNative,path.join(root,'test/native/project-control-original-tu-syntax.mm')],{encoding:'utf8',timeout:30000});assert.equal(run.status,0,run.stderr);
});
test('actual Native decision journal uses create-only protected reservations and retains UNKNOWN',{skip:process.platform!=='darwin'},async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),temp=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-control-journal-public-'));
 try{
  const binary=path.join(temp,'public-journal');
  const build=spawnSync('/usr/bin/clang++',['-std=c++17','-fobjc-arc','-DYNX_CONTROL_JOURNAL_PUBLIC_TEST=1','-framework','Foundation','-framework','Security','-framework','LocalAuthentication',path.join(root,'native/original-project-control-journal.mm'),path.join(root,'test/native/project-control-journal-public.mm'),'-o',binary],{encoding:'utf8',timeout:30000});
  assert.equal(build.status,0,build.stderr);const run=spawnSync(binary,[],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);
  assert.deepEqual(JSON.parse(run.stdout),{cases:10,systemKeychainCalls:0,SourceQualified:false,signing:false});
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('actual Native capture/decision body retains original choice across retirement and uncertain save',{skip:process.platform!=='darwin'||!originalNative},async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),temp=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-control-review-public-'));
 try{
  const binary=path.join(temp,'public-review');const build=spawnSync('/usr/bin/clang++',['-std=c++17','-fobjc-arc','-DYNX_CONTROL_JOURNAL_PUBLIC_TEST=1','-DYNX_CONTROL_REVIEW_PUBLIC_TEST=1','-I'+originalNative,'-framework','Foundation','-framework','Security','-framework','LocalAuthentication','-framework','AppKit',path.join(root,'native/original-project-control-journal.mm'),path.join(root,'native/original-project-control-review.mm'),path.join(root,'test/native/project-control-review-public.mm'),'-o',binary],{encoding:'utf8',timeout:30000});assert.equal(build.status,0,build.stderr);
  const run=spawnSync(binary,[],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),{cases:5,systemKeychainCalls:0,SourceQualified:false,signing:false});
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
