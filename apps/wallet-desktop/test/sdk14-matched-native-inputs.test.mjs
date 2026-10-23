import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {WALLET_PUBLISHER_NATIVE_INPUTS,walletNativeSourceProfile} from '../scripts/wallet-publisher-native-build.mjs';
import {FIXED_SDK_RUNTIME_IDENTITIES} from '../scripts/release-provenance.mjs';
test('SDK14 explicit tool/inventory/runtime pins retain SDK13 separately and reject unfrozen successors',()=>{
 const p=walletNativeSourceProfile('1.3.0-pq.3.32-auth.14');assert.equal(p.supplierNodeInputs,71);assert.equal(p.tool.bytes,10932);assert.equal(p.tool.sha256,'c532946f53a6314d9c0ecb2ffb3afd2044f9ffb1961afbfe0b8ec32444f71461');
 assert.equal(p.inventory.bytes,34752);assert.equal(p.inventory.sha256,'feafd827a9d42cea65af17b94944e6c565b8ef4b1e6eb56c938709811cc1eadf');
 assert(Object.isFrozen(p.inventory));assert.equal(walletNativeSourceProfile('1.3.0-pq.3.32-auth.13').supplierNodeInputs,69);
 assert.throws(()=>walletNativeSourceProfile('1.3.0-pq.3.32-auth.15'));
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES[p.version],{bytes:67464,sha256:'82d3ad0b1d8538d5f75fe62b21a8589344c2e3c3e88f0de1988c173159e050b7'});
});
test('SDK14 requires71 original SDK inputs plus2 Wallet inputs without accepting a parent13 record',()=>{
 const raw=readFileSync(new URL('./fixtures/auth14-native-inventory.json',import.meta.url)),v=JSON.parse(raw),rows=[...v.NativeInputs,...WALLET_PUBLISHER_NATIVE_INPUTS];
 const names=[...rows.map(p=>p.path),...v.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],receipt=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 const result=canonicalNativeInputSelection(v.version,names,raw,receipt);
 assert.equal(result.inputs.length,73);assert.equal(result.supplierNodeInputCount,71);assert.equal(result.pairedInputCount,76);assert.equal(result.helperInputs.length,5);assert.deepEqual(result.walletInputs,WALLET_PUBLISHER_NATIVE_INPUTS);
 const old=readFileSync(new URL('./fixtures/auth13-native-inventory.json',import.meta.url));
 for(const [n,r,p]of [[names,old,receipt],[names,raw,receipt.slice(0,71)],[names.slice(1),raw,receipt]])assert.throws(()=>canonicalNativeInputSelection(v.version,n,r,p),/inventory differs/);
 const changed=structuredClone(receipt);changed[0].sha256='0'.repeat(64);assert.throws(()=>canonicalNativeInputSelection(v.version,names,raw,changed),/inventory differs/);
});
test('normal package lock selects an explicitly matched SDK profile without changing application dependencies',()=>{
 const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url))),metadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
 assert.equal(walletNativeSourceProfile(lock.packages['../../packages/wallet-auth'].version).version,lock.packages['../../packages/wallet-auth'].version);
 assert.deepEqual(lock.packages[''].dependencies,metadata.dependencies);
});
