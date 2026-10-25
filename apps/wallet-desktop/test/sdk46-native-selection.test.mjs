import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {walletNativeSourceProfile,walletPublisherNativeInputs,composeWalletPublisherNativeBuildPlan,SDK32_NODE_TRANSLATION_UNITS} from '../scripts/wallet-publisher-native-build.mjs';
import {sdkRuntimeUnionProfile} from '../scripts/sdk14-runtime-union.mjs';
import {PQ_NATIVE_ARCHIVE,pqNativeSupplierInputs} from '../scripts/wallet-pq-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
const version='1.3.0-pq.3.32-auth.46';
test('SDK46 selects only the exact supplied Native100 inventory, new original tool and full9432 runtime',()=>{
 const p=walletNativeSourceProfile(version);assert.equal(p.supplierNodeInputs,100);assert.deepEqual(p.inventory,{bytes:84691,sha256:'653b1ec3d1d8aac77fd599245de57501864072536a3af7fade722f449b09389e'});assert.deepEqual(p.tool,{bytes:15553,sha256:'332bfa52666aa59b1d1d5c39eb5d11c0d539e57411a2371ccea65a4685357622'});
 assert.deepEqual(sdkRuntimeUnionProfile(version),{bytes:1467130,sha256:'71a388f8459ac084ebdd3c94743536fe333c02fcb95d37a683eec0f31e71c075',files:9432,totalBytes:77901936});assert.throws(()=>walletNativeSourceProfile('1.3.0-pq.3.32-auth.47'));assert.throws(()=>sdkRuntimeUnionProfile('1.3.0-pq.3.32-auth.47'));
});
test('canonical SDK46 Native100 selection verifies exact inventory and full overlay, never old or altered pins',()=>{
 const bytes=readFileSync(new URL('./fixtures/auth46-native-inventory.json',import.meta.url));assert.equal(bytes.length,84691);assert.equal(createHash('sha256').update(bytes).digest('hex'),'653b1ec3d1d8aac77fd599245de57501864072536a3af7fade722f449b09389e');
 const inventory=JSON.parse(bytes),wallet=walletPublisherNativeInputs(100,true,true,true,true),selected=pqNativeSupplierInputs(inventory.NativeInputs,true),rows=[...selected,...wallet],names=[...rows.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],pins=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 assert.equal(inventory.NativeInputs.length,100);assert.equal(inventory.HelperInputs.length,5);assert.equal(canonicalNativeInputSelection(version,names,bytes,pins).inputs.length,rows.length);
 const altered=Buffer.from(bytes);altered[0]^=1;assert.throws(()=>canonicalNativeInputSelection(version,names,altered,pins));const missing=names.filter(p=>!p.endsWith('/original-ide-service-registration-data.h'));assert.notEqual(missing.length,names.length);assert.throws(()=>canonicalNativeInputSelection(version,missing,bytes,pins));const legacy=structuredClone(pins);legacy[0].sha256=inventory.NativeInputs[0].sha256;assert.throws(()=>canonicalNativeInputSelection(version,names,bytes,legacy));
});
test('SDK46 Native100 keeps the original translation units and exactly one safe744 archive',()=>{
 const root='/PUBLIC/sdk46-source',output=root+'/apps/wallet-desktop/native/original-auth-identity.node',sources=SDK32_NODE_TRANSLATION_UNITS.map(p=>root+'/'+p),base={minimumSystemVersion:'13.0',sources,output,outputs:[output],commands:[{tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min=13.0','-I/PUBLIC/headers','-I'+root+'/packages/wallet-auth/native','-framework','Foundation','-framework','Security','-framework','AppKit','-framework','ServiceManagement','-framework','LocalAuthentication','-lbsm','-arch','arm64',...sources,'-o',output]}]};
 const plan=composeWalletPublisherNativeBuildPlan(base,root,100,true,true,true,true),last=plan.commands.at(-1);assert.equal(last.tool,'/usr/bin/xcrun');assert.equal(last.argv[0],'swiftc');assert.deepEqual(last.argv.filter(a=>a.endsWith('.a')),[root+'/'+PQ_NATIVE_ARCHIVE.path]);assert.equal(plan.commands.length,20);assert.equal(plan.intermediateOutputs.length,19);assert.equal(plan.walletInputFiles.filter(p=>p.path.endsWith('.a')).length,1);assert.throws(()=>walletPublisherNativeInputs(101,true,true,true,true));
});
