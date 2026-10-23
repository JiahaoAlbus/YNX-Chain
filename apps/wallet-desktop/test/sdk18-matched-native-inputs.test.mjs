import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {walletNativeSourceProfile,WALLET_PUBLISHER_NATIVE_INPUTS} from '../scripts/wallet-publisher-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {canonicalNativeEvidencePlan} from '../scripts/canonical-native-evidence.mjs';
import {SDK14_RUNTIME_UNION,SDK18_RUNTIME_UNION,sdkRuntimeUnionProfile,verifySDKRuntimeUnion} from '../scripts/sdk14-runtime-union.mjs';
import {FIXED_SDK_RUNTIME_IDENTITIES} from '../scripts/release-provenance.mjs';
const version='1.3.0-pq.3.32-auth.18',bytes=readFileSync(new URL('./fixtures/auth18-native-inventory.json',import.meta.url)),inventory=JSON.parse(bytes);
test('SDK18 is selected by its exact original inventory/tool pins, not by a version range or old14 recipe',()=>{
 const profile=walletNativeSourceProfile(version);
 assert.equal(profile.supplierNodeInputs,75);assert.equal(profile.inventory.bytes,45891);assert.equal(profile.inventory.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(profile.tool,{bytes:11989,sha256:'218c73f9883ef9263181453a7e12049009ccc400ec313e85c29ece3848ebc4dc'});
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES[version],{bytes:67464,sha256:'2294be8c02b5470ce6d4ac0bcf1e71f29790043ed266d5dc3e4cdac08353678b'});
 assert.notDeepEqual(profile.inventory,walletNativeSourceProfile('1.3.0-pq.3.32-auth.14').inventory);
 for(const unselected of ['1.3.0-pq.3.32-auth.16','1.3.0-pq.3.32-auth.17','1.3.0-pq.3.32-auth.19'])assert.throws(()=>walletNativeSourceProfile(unselected));
});
test('SDK18 requires75 original Node inputs plus2 Wallet inputs and the unchanged closed evidence pair',()=>{
 const rows=[...inventory.NativeInputs,...WALLET_PUBLISHER_NATIVE_INPUTS],helper=inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path);
 const names=[...rows.map(p=>p.path),...helper,...CANONICAL_NATIVE_EVIDENCE_TESTS],receipt=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 const selected=canonicalNativeInputSelection(version,names,bytes,receipt);
 assert.equal(names.length,82);assert.equal(selected.inputs.length,77);assert.equal(selected.pairedInputCount,80);assert.equal(selected.helperInputs.length,5);assert.equal(selected.supplierNodeInputCount,75);
 for(const bad of [names.slice(1),names.filter(p=>p!==CANONICAL_NATIVE_EVIDENCE_TESTS[0]),[...names,names[0]],[...names,'packages/wallet-auth/native/foreign.mm']])assert.throws(()=>canonicalNativeInputSelection(version,bad,bytes,receipt),/inventory differs/);
 assert.throws(()=>canonicalNativeInputSelection(version,names,bytes,receipt.slice(0,75)),/inventory differs/);
 const older=readFileSync(new URL('./fixtures/auth14-native-inventory.json',import.meta.url));assert.throws(()=>canonicalNativeInputSelection(version,names,older,receipt),/inventory differs/);
 const changed=structuredClone(receipt);changed.at(-1).sha256='0'.repeat(64);assert.throws(()=>canonicalNativeInputSelection(version,names,bytes,changed),/inventory differs/);
 const seen=[];assert.equal(canonicalNativeEvidencePlan(version,p=>{seen.push(p);return Buffer.from('// PUBLIC evidence DATA')}).rows.length,2);assert.deepEqual(seen,CANONICAL_NATIVE_EVIDENCE_TESTS);
});
test('SDK18 runtime union has an independent fixed identity and cannot borrow the14 or17 closure',()=>{
 assert.deepEqual(sdkRuntimeUnionProfile(version),SDK18_RUNTIME_UNION);assert.equal(SDK18_RUNTIME_UNION.files,9335);assert.equal(SDK18_RUNTIME_UNION.totalBytes,77260211);assert.notEqual(SDK18_RUNTIME_UNION.sha256,SDK14_RUNTIME_UNION.sha256);
 assert.throws(()=>sdkRuntimeUnionProfile('1.3.0-pq.3.32-auth.17'));
 assert.throws(()=>verifySDKRuntimeUnion(version,'/PUBLIC/not-a-runtime',Buffer.from('{}')));
});
test('normal lock selects exact SDK18 while application dependency declarations remain unchanged',()=>{
 const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url))),app=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
 assert.equal(lock.packages['../../packages/wallet-auth'].version,version);assert.deepEqual(lock.packages[''].dependencies,app.dependencies);
});
