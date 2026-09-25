import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';

const root=resolve(import.meta.dirname,'..');
const activeBytes=readFileSync(resolve(root,'web/wallet-verifier-manifest.json'));
const candidateBytes=readFileSync(resolve(root,'evidence/wallet-verifier-manifest-workspace-9204e843-v7-20260925.json'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const changed=['app.js','endpoint-authority-entry.js','endpoint-authority-store.js','finance-locale.js','index.html','product-catalog.js','styles.css','wallet-auth.js'];

test('Finance workspace verifier candidate freezes only reviewed Web drift without activating the pin',()=>{
  assert.equal(sha256(activeBytes),'9cbc39d8b9e80345965d6e0b7768bd4c6582bbeff4ef0e8ba2a5224e3d2c46eb');
  assert.equal(candidateBytes.length,5892);
  assert.equal(sha256(candidateBytes),'2d465d08c767eb310bdfa1199a0d404a80ed4855526c491edced9f5378e6c178');
  const active=JSON.parse(activeBytes),candidate=JSON.parse(candidateBytes);
  assert.deepEqual({...candidate,files:active.files,sourceBundleRelation:active.sourceBundleRelation},active);
  assert.deepEqual(candidate.files.map(file=>file.path),active.files.map(file=>file.path));
  const observed=candidate.files.filter((file,index)=>JSON.stringify(file)!==JSON.stringify(active.files[index])).map(file=>file.path).sort();
  assert.deepEqual(observed,changed);
  for(const file of candidate.files){const bytes=readFileSync(resolve(root,'web',file.path));assert.equal(bytes.length,file.bytes,file.path);assert.equal(sha256(bytes),file.sha256,file.path)}
  assert.deepEqual(candidate.sourceBundleRelation,{...active.sourceBundleRelation,bytes:182014,sha256:'c6419bddc26227bf884583a79fa508b33e9321ee45201812263f38c9b455b63c'});
});

test('candidate generator reproduces the exact reviewed source snapshot and two Wallet rebuilds',()=>{
  const output=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/build-workspace-wallet-verifier-candidate.mjs')],{encoding:'utf8'}));
  assert.equal(output.status,'candidate-only-not-activated');
  assert.equal(output.cleanBuilds,2);
  assert.equal(output.sha256,sha256(candidateBytes));
  assert.deepEqual(output.changed,changed);
});
