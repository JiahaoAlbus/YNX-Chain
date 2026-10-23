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
test('auth4 selects its own exact inventory while retaining all55 original Native inputs',()=>{
 const raw=readFileSync(new URL('./fixtures/sdk332-auth4-native55.json',import.meta.url)),current=JSON.parse(raw);
 assert.deepEqual(current.NativeInputs,inventory.NativeInputs);
 const plan=canonicalNativeInputSelection(current.version,names(),raw,pins());
 assert.equal(plan.inputs.length,55);assert.equal(plan.inventory.sha256,'e1955ad13cd5187ef4672c34619a48c94bc12120dda393ed950ba19adcb47bf7');
 assert.throws(()=>canonicalNativeInputSelection(current.version,names(),bytes,pins()),/inventory differs/);
 assert.throws(()=>canonicalNativeInputSelection(version,names(),raw,pins()),/inventory differs/);
});
test('auth5 distinguishes62 Node inputs from3 helper Native leaves and2 preserved evidence tests',()=>{
 const raw=readFileSync(new URL('./fixtures/sdk332-auth5-native62-helper5.json',import.meta.url)),current=JSON.parse(raw),pins=current.NativeInputs.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 const node=current.NativeInputs.map(p=>p.path),helper=current.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),wide=[...node,...helper,...CANONICAL_NATIVE_EVIDENCE_TESTS];
 assert.equal(wide.length,67);assert.equal(helper.length,3);
 const plan=canonicalNativeInputSelection(current.version,wide,raw,pins);assert.equal(plan.inputs.length,62);assert.equal(plan.helperInputs.length,5);assert.equal(plan.pairedInputCount,67);assert.deepEqual(plan.evidenceAssets,CANONICAL_NATIVE_EVIDENCE_TESTS);
 for(const bad of [node,[...wide,'packages/wallet-auth/native/foreign.mm'],wide.slice(1)])assert.throws(()=>canonicalNativeInputSelection(current.version,bad,raw,pins),/inventory differs/);
 assert.throws(()=>canonicalNativeInputSelection(current.version,wide,raw,pins.slice(0,55)),/inventory differs/);
 assert.throws(()=>canonicalNativeInputSelection(current.version,wide,bytes,pins),/inventory differs/);
});
test('auth6 selects its independent inventory with the unchanged62+5 source graph',()=>{
 const raw=readFileSync(new URL('./fixtures/sdk332-auth6-native62-helper5.json',import.meta.url)),v=JSON.parse(raw),helper=v.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),list=[...v.NativeInputs.map(p=>p.path),...helper,...CANONICAL_NATIVE_EVIDENCE_TESTS];
 const result=canonicalNativeInputSelection(v.version,list,raw,v.NativeInputs.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})));
 assert.equal(result.inputs.length,62);assert.equal(result.helperInputs.length,5);assert.equal(result.inventory.sha256,'cd7dd07ddd14d37e76b897fc179c5582cd739029a834a7134b0f8d9c9fe857f8');
});
