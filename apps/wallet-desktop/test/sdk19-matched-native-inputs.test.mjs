import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {walletNativeSourceProfile,WALLET_PUBLISHER_NATIVE_INPUTS} from '../scripts/wallet-publisher-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {canonicalNativeEvidencePlan} from '../scripts/canonical-native-evidence.mjs';
import {SDK14_RUNTIME_UNION,SDK19_RUNTIME_UNION,sdkRuntimeUnionProfile,verifySDKRuntimeUnion} from '../scripts/sdk14-runtime-union.mjs';
import {FIXED_SDK_RUNTIME_IDENTITIES} from '../scripts/release-provenance.mjs';
const version='1.3.0-pq.3.32-auth.19',bytes=readFileSync(new URL('./fixtures/auth19-native-inventory.json',import.meta.url)),inventory=JSON.parse(bytes);
test('SDK19 is selected by its exact original inventory/tool pins, not by a version range or old14 recipe',()=>{
 const profile=walletNativeSourceProfile(version);
 assert.equal(profile.supplierNodeInputs,76);assert.equal(profile.inventory.bytes,48913);assert.equal(profile.inventory.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(profile.tool,{bytes:12230,sha256:'06b86ae2cb60cd750623e790214a2698671315987c67ce4603871b413d5debdc'});
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES[version],{bytes:67464,sha256:'b968e5fee531b65449234d833a2aec91dd38b701257f167c7c7a7dfb544f934f'});
 assert.notDeepEqual(profile.inventory,walletNativeSourceProfile('1.3.0-pq.3.32-auth.14').inventory);
 for(const unselected of ['1.3.0-pq.3.32-auth.16','1.3.0-pq.3.32-auth.17','1.3.0-pq.3.32-auth.20'])assert.throws(()=>walletNativeSourceProfile(unselected));
});
test('SDK19 requires76 original Node inputs plus2 Wallet inputs and the unchanged closed evidence pair',()=>{
 const rows=[...inventory.NativeInputs,...WALLET_PUBLISHER_NATIVE_INPUTS],helper=inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path);
 const names=[...rows.map(p=>p.path),...helper,...CANONICAL_NATIVE_EVIDENCE_TESTS],receipt=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 const selected=canonicalNativeInputSelection(version,names,bytes,receipt);
 assert.equal(names.length,83);assert.equal(selected.inputs.length,78);assert.equal(selected.pairedInputCount,81);assert.equal(selected.helperInputs.length,5);assert.equal(selected.supplierNodeInputCount,76);
 for(const bad of [names.slice(1),names.filter(p=>p!==CANONICAL_NATIVE_EVIDENCE_TESTS[0]),[...names,names[0]],[...names,'packages/wallet-auth/native/foreign.mm']])assert.throws(()=>canonicalNativeInputSelection(version,bad,bytes,receipt),/inventory differs/);
 assert.throws(()=>canonicalNativeInputSelection(version,names,bytes,receipt.slice(0,76)),/inventory differs/);
 const older=readFileSync(new URL('./fixtures/auth14-native-inventory.json',import.meta.url));assert.throws(()=>canonicalNativeInputSelection(version,names,older,receipt),/inventory differs/);
 const parent18=readFileSync(new URL('./fixtures/auth18-native-inventory.json',import.meta.url));assert.throws(()=>canonicalNativeInputSelection(version,names,parent18,receipt),/inventory differs/);
 const changed=structuredClone(receipt);changed.at(-1).sha256='0'.repeat(64);assert.throws(()=>canonicalNativeInputSelection(version,names,bytes,changed),/inventory differs/);
 const seen=[];assert.equal(canonicalNativeEvidencePlan(version,p=>{seen.push(p);return Buffer.from('// PUBLIC evidence DATA')}).rows.length,2);assert.deepEqual(seen,CANONICAL_NATIVE_EVIDENCE_TESTS);
});
test('SDK19 runtime union has an independent fixed identity and cannot borrow the14 or17 closure',()=>{
 assert.deepEqual(sdkRuntimeUnionProfile(version),SDK19_RUNTIME_UNION);assert.equal(SDK19_RUNTIME_UNION.files,9335);assert.equal(SDK19_RUNTIME_UNION.totalBytes,77265325);assert.notEqual(SDK19_RUNTIME_UNION.sha256,SDK14_RUNTIME_UNION.sha256);
 assert.throws(()=>sdkRuntimeUnionProfile('1.3.0-pq.3.32-auth.17'));
 assert.throws(()=>verifySDKRuntimeUnion(version,'/PUBLIC/not-a-runtime',Buffer.from('{}')));
});
test('normal lock selects exact SDK19 while application dependency declarations remain unchanged',()=>{
 const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url))),app=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
 assert.equal(lock.packages['../../packages/wallet-auth'].version,version);assert.deepEqual(lock.packages[''].dependencies,app.dependencies);
});
