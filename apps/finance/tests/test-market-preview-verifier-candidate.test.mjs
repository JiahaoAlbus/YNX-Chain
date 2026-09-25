import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';

const financeRoot=resolve(import.meta.dirname,'..');
const activePath=resolve(financeRoot,'web/wallet-verifier-manifest.json');
const candidatePath=resolve(financeRoot,'evidence/wallet-verifier-manifest-test-market-preview-6d7ebb4d-v1-20260925.json');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('review candidate changes exactly two Finance page bindings without activating the Wallet pin',()=>{
  const activeBytes=readFileSync(activePath),candidateBytes=readFileSync(candidatePath);
  assert.equal(sha256(activeBytes),'9cbc39d8b9e80345965d6e0b7768bd4c6582bbeff4ef0e8ba2a5224e3d2c46eb');
  assert.equal(sha256(candidateBytes),'efe0952ad4431fa1be0960f1f72c098891756930be345abd132a8974a0318522');
  const active=JSON.parse(activeBytes),candidate=JSON.parse(candidateBytes);
  assert.deepEqual({...candidate,files:active.files},active);
  assert.deepEqual(candidate.files.map((entry,index)=>entry.path===active.files[index].path?entry.path:null).filter(Boolean),active.files.map(entry=>entry.path));
  const changed=candidate.files.filter((entry,index)=>JSON.stringify(entry)!==JSON.stringify(active.files[index])).map(entry=>entry.path);
  assert.deepEqual(changed,['finance-locale.js','product-catalog.js']);
  for(const entry of candidate.files){
    const bytes=readFileSync(resolve(financeRoot,'web',entry.path));
    assert.equal(bytes.length,entry.bytes,entry.path);
    assert.equal(sha256(bytes),entry.sha256,entry.path);
  }
  const output=JSON.parse(execFileSync(process.execPath,[resolve(financeRoot,'scripts/build-test-market-preview-verifier-candidate.mjs')],{encoding:'utf8'}));
  assert.equal(output.status,'candidate-only-not-activated');
  assert.equal(output.unchangedEntries,29);
  assert.equal(output.cleanBuildCount,2);
});
