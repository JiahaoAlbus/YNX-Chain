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
  for(const item of candidate.exactInputs){const body=readFileSync(resolve(root,item.path));assert.equal(body.length,item.bytes,item.path);assert.equal(sha256(body),item.sha256,item.path)}
});

test('nested candidate generator rechecks exact source and two builds of both bundles',()=>{
  const output=JSON.parse(execFileSync(process.execPath,[resolve(root,'apps/finance/scripts/build-workspace-evm-read-candidate.mjs')],{encoding:'utf8'}));
  assert.equal(output.status,'candidate-only-not-activated');
  assert.equal(output.sha256,sha256(bytes));
  assert.equal(output.bundleCount,2);
  assert.equal(output.cleanBuildsPerBundle,2);
});
