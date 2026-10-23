import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
const bytes=readFileSync(new URL('./fixtures/sdk332-auth3-native55.json',import.meta.url)),inventory=JSON.parse(bytes),version=inventory.version;
const pins=()=>inventory.NativeInputs.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
const names=()=>[...inventory.NativeInputs.map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS];
test('auth3 independently selects production55 from the actual57 source list and retains both tests as Git-bound evidence',()=>{
 const plan=canonicalNativeInputSelection(version,names(),bytes,pins());
 assert.equal(names().length,57);assert.equal(plan.inputs.length,55);
 assert.deepEqual(plan.evidenceAssets,CANONICAL_NATIVE_EVIDENCE_TESTS);
 assert.equal(plan.inputs.some(n=>n.endsWith('.test.mjs')),false);
 assert.equal(plan.inventory.sha256,'3600874dc48acc5032540ad8b8df39f34381cf85bd6b96f9fbe000e2da4da0ee');
});
test('auth3 rejects missing or foreign source leaves rather than filtering broad extensions',()=>{
 for(const list of [names().slice(1),[...names(),'packages/wallet-auth/native/foreign.mm'],[...names(),names()[0]],names().filter(n=>!n.endsWith('.test.mjs'))])assert.throws(()=>canonicalNativeInputSelection(version,list,bytes,pins()),/inventory differs/);
});
test('auth3 receipt cannot select its own inputs or substitute a single production hash',()=>{
 const bad=pins();bad[0].sha256='0'.repeat(64);
 for(const rows of [bad,pins().slice(1),[...pins(),{relative:CANONICAL_NATIVE_EVIDENCE_TESTS[0],bytes:1,sha256:'0'.repeat(64)}]])assert.throws(()=>canonicalNativeInputSelection(version,names(),bytes,rows),/inventory differs/);
 const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
 assert.throws(()=>canonicalNativeInputSelection(version,names(),changed,pins()),/inventory differs/);
 assert.throws(()=>canonicalNativeInputSelection(version,names(),null,pins()),/inventory differs/);
});
test('historical Native receipt input sets are retained without substituting auth3 inventory',()=>{
 const historical=['apps/wallet-desktop/native/original-auth-identity-node.mm',...CANONICAL_NATIVE_EVIDENCE_TESTS];
 const plan=canonicalNativeInputSelection('1.3.0-pq.3.18',historical,null,[]);
 assert.deepEqual(plan.inputs,historical);assert.deepEqual(plan.evidenceAssets,CANONICAL_NATIVE_EVIDENCE_TESTS);
});
