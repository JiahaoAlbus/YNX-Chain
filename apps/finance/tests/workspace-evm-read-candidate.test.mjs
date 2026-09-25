import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';

const root=resolve(import.meta.dirname,'../../..');
const path='apps/finance/evidence/evm-read-runtime-verifier-candidate-workspace-2627b209-v5-20260925.json';
const prior=JSON.parse(readFileSync(resolve(root,'apps/finance/evidence/evm-read-runtime-verifier-candidate-final-ui-01130b50-v4-20260925.json')));
const bytes=readFileSync(resolve(root,path));
const candidate=JSON.parse(bytes);
const sha256=value=>createHash('sha256').update(value).digest('hex');

test('nested Finance EVM read candidate freezes exactly three changed runtime inputs',()=>{
  assert.equal(bytes.length,6059);
  assert.equal(sha256(bytes),'e6740a5312449f9e3d933892e61796dfc509d306e0fb1172bf0676e4f204673d');
  assert.equal(candidate.reviewedOwnerSource.commit,'2627b20938828b24dc1cefd8a334668033d7a07e');
  assert.equal(candidate.reviewedOwnerSource.tree,'321cf666466f7f6a903758810d57d9c8aa398f70');
  assert.equal(candidate.existingVerifierPin.pinChanged,false);
  assert.deepEqual(candidate.sourceBundleRelations,prior.sourceBundleRelations);
  assert.deepEqual(candidate.truth,prior.truth);
  const changed=candidate.exactInputs.filter((item,index)=>JSON.stringify(item)!==JSON.stringify(prior.exactInputs[index])).map(item=>item.path);
  assert.deepEqual(changed,['apps/finance/web/index.html','apps/finance/scripts/finance-nonregressive-runtime.mjs','internal/finance/server.go']);
  for(const item of candidate.exactInputs){const body=execFileSync('git',['show',`${candidate.reviewedOwnerSource.commit}:${item.path}`],{cwd:root});assert.equal(body.length,item.bytes,item.path);assert.equal(sha256(body),item.sha256,item.path)}
});

test('historical candidate generator rejects the changed current HTML before replaying its old review',()=>{
  assert.throws(()=>execFileSync(process.execPath,[resolve(root,'apps/finance/scripts/build-workspace-evm-read-candidate.mjs')],{encoding:'utf8',stdio:'pipe'}));
  assert.equal(candidate.exactInputs.find(item=>item.path==='apps/finance/web/index.html').sha256,'d974c4c2a4a5aabe7559db6885b34918c5fd83d10d974849d47d345fa86006da');
  assert.notEqual(sha256(readFileSync(resolve(root,'apps/finance/web/index.html'))),'d974c4c2a4a5aabe7559db6885b34918c5fd83d10d974849d47d345fa86006da');
});
