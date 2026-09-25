import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,posix} from 'node:path';
import test from 'node:test';

const root=resolve(import.meta.dirname,'..');
const historical='f8e936d30766be94762e389455642f2dd66e4826';
const activeBytes=execFileSync('git',['show',`${historical}:apps/finance/web/wallet-verifier-manifest.json`],{cwd:resolve(root,'../..')});
const candidateBytes=readFileSync(resolve(root,'evidence/wallet-verifier-manifest-workspace-2627b209-v8-20260925.json'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const changed=['../evidence/evm-read-runtime-verifier-candidate-workspace-2627b209-v5-20260925.json','app.js','endpoint-authority-entry.js','endpoint-authority-store.js','finance-locale.js','index.html','product-catalog.js','styles.css','wallet-auth.js'];

test('historical v8 candidate froze reviewed Web drift without activating the prior pin',()=>{
  assert.equal(sha256(activeBytes),'9cbc39d8b9e80345965d6e0b7768bd4c6582bbeff4ef0e8ba2a5224e3d2c46eb');
  assert.equal(candidateBytes.length,5894);
  assert.equal(sha256(candidateBytes),'fc61b774e045dc5cc0d72ac04eea2f89c3df904da697c9d37830c72b78da2fae');
  const active=JSON.parse(activeBytes),candidate=JSON.parse(candidateBytes);
  assert.deepEqual({...candidate,files:active.files,sourceBundleRelation:active.sourceBundleRelation,evmRead:active.evmRead},active);
  assert.deepEqual(candidate.files.map((file,index)=>file.path===changed[0]?active.files[index].path:file.path),active.files.map(file=>file.path));
  const observed=candidate.files.filter((file,index)=>JSON.stringify(file)!==JSON.stringify(active.files[index])).map(file=>file.path).sort();
  assert.deepEqual(observed,changed);
  for(const file of candidate.files){const name=posix.normalize(`apps/finance/web/${file.path}`),bytes=execFileSync('git',['show',`${historical}:${name}`],{cwd:resolve(root,'../..')});assert.equal(bytes.length,file.bytes,file.path);assert.equal(sha256(bytes),file.sha256,file.path)}
  assert.deepEqual(candidate.sourceBundleRelation,{...active.sourceBundleRelation,bytes:182014,sha256:'c6419bddc26227bf884583a79fa508b33e9321ee45201812263f38c9b455b63c'});
  assert.deepEqual(candidate.evmRead,{candidatePath:changed[0],candidateBytes:6059,candidateSha256:'e6740a5312449f9e3d933892e61796dfc509d306e0fb1172bf0676e4f204673d'});
});

test('activated v9 manifest differs from reviewed v8 only in the nested verifier input',()=>{
  const activated=readFileSync(resolve(root,'web/wallet-verifier-manifest.json'));
  const versioned=readFileSync(resolve(root,'evidence/wallet-verifier-manifest-workspace-2627b209-v9-20260925.json'));
  assert.deepEqual(activated,versioned);
  assert.equal(sha256(activated),'462ae0743b1bb7ea641ff5be28de9a1bd4df0cd145ae5c7b669418ed02112865');
  const old=JSON.parse(candidateBytes),next=JSON.parse(activated);
  assert.deepEqual({...next,files:old.files},old);
  assert.deepEqual(next.files.filter((file,index)=>JSON.stringify(file)!==JSON.stringify(old.files[index])).map(file=>file.path),['verify-evm-read-candidate.mjs']);
  const output=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/build-workspace-wallet-verifier-activation.mjs')],{encoding:'utf8'}));
  assert.equal(output.sha256,sha256(activated));
  assert.equal(output.walletBuilds,2);
});

test('superseded v7 candidate remains an immutable historical snapshot',()=>{
  const historical=readFileSync(resolve(root,'evidence/wallet-verifier-manifest-workspace-9204e843-v7-20260925.json'));
  assert.equal(historical.length,5892);
  assert.equal(sha256(historical),'2d465d08c767eb310bdfa1199a0d404a80ed4855526c491edced9f5378e6c178');
  const manifest=JSON.parse(historical);
  const oldApp=execFileSync('git',['show','9204e84304f5bb088db3012c63c654b061b12622:apps/finance/web/app.js'],{cwd:resolve(root,'../..')});
  const entry=manifest.files.find(file=>file.path==='app.js');
  assert.deepEqual({bytes:entry.bytes,sha256:entry.sha256},{bytes:oldApp.length,sha256:sha256(oldApp)});
});
