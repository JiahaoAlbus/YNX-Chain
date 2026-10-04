import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verify,manifestPath} from '../scripts/verify-financial-ordinary-inputs-v2.mjs';
const original=JSON.parse(readFileSync(manifestPath,'utf8'));
test('archived immutable source identities pass custody, but never qualify as composed working bytes or release',()=>{
  const result=verify(original,{requireWorkingBytes:false});assert.equal(result.verifiedObjects,11);assert.equal(result.publicVerified,false);assert.equal(result.classification,'ARCHIVED_EXACT_SOURCE_NOT_CURRENT_RUNTIME');assert.throws(()=>verify(original),/working bytes/);
});
const cases={
  tree:m=>{m.sourceTree='0'.repeat(40);},
  duplicate:m=>{m.objects[1]=m.objects[0];},
  omission:m=>{m.objects.pop();},
  foreign:m=>{m.objects[0].path='packages/wallet-auth/src/index.js';},
  traversal:m=>{m.objects[0].path='../apps/finance/web/app.js';},
  blob:m=>{m.objects[0].blob='0'.repeat(40);},
  bytes:m=>{m.objects[0].bytes++;},
  hash:m=>{m.objects[0].sha256='0'.repeat(64);},
  unsafeBytes:m=>{m.objects[0].bytes=Number.MAX_SAFE_INTEGER+1;},
  promoted:m=>{m.truth.deployed=true;},
  emptyTruth:m=>{m.truth={};},
  mode:m=>{m.integrationMode='COPY_CHECKOUT';},
  fences:m=>{m.retainBaseStorageFences=false;}
};
for(const [name,mutate] of Object.entries(cases))test('reject '+name,()=>{const m=structuredClone(original);mutate(m);assert.throws(()=>verify(m,{requireWorkingBytes:false}));});
