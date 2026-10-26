import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {walletNativeComponentBuildPlan} from '../scripts/build-wallet-native-component.mjs';
import {originalIDEHelperBuildPlan} from '../scripts/build-original-auth-identity-native.mjs';
import {walletPublisherNativeInputs,walletNativeSourceProfile,SDK48_H6_MAIN_INPUTS} from '../scripts/wallet-publisher-native-build.mjs';
import {pqNativeSupplierInputs,PQ_NATIVE_ARCHIVE} from '../scripts/wallet-pq-native-build.mjs';
import {deviceV4PQSupplierInputs,DEVICE_V4_PQ_PROTOCOL_INPUTS} from '../scripts/wallet-device-v4-pq-role.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {assertSelectedProofVerifierForSDK} from '../scripts/proof-verifier-source-policy.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url)),version='1.3.0-pq.3.32-auth.49';
test('SDK49 Mac preflight retains the independent signed4afc verifier source fence without changing old46',()=>{
 for(const v of ['1.3.0-pq.3.32-auth.46',version]){
  assertSelectedProofVerifierForSDK(v,{sourceCommit:'4afc29656ee0f60c6eda9ae62387e6797552aa3e'});
  for(const receipt of [null,{}, {sourceCommit:'0'.repeat(40)}])assert.throws(()=>assertSelectedProofVerifierForSDK(v,receipt),/4AFC_SIGNED_VERIFIER_REQUIRED/);
 }
});
test('actual SDK49 normal producer explicitly plans combined role with exact source141/helper122 closure and no compiler execution',()=>{
 const inventoryBytes=fs.readFileSync(root+'/packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'),inventory=JSON.parse(inventoryBytes),profile=walletNativeSourceProfile(version);
 assert.equal(inventory.version,version);assert.equal(profile.inventory.bytes,inventoryBytes.length);
 const node=walletNativeComponentBuildPlan('arm64','/PUBLIC-plan-only-headers',true,true,true,true,false,true),helper=originalIDEHelperBuildPlan('arm64');
 assert.equal(node.sources.length,21);assert.equal(node.commands.length,23);assert.equal(node.supplierNodeInputCount,117);assert.equal(node.walletInputFiles.length,24);assert.equal(helper.sources.length,11);assert.equal(helper.commands.length,1);
 const native=deviceV4PQSupplierInputs(inventory.NativeInputs),all=[...native,...inventory.HelperInputs,...node.walletInputFiles];
 for(const pin of all){const raw=fs.readFileSync(path.join(root,pin.path));assert.equal(raw.length,pin.bytes,pin.path);assert.equal(createHash('sha256').update(raw).digest('hex'),pin.sha256,pin.path);}
 assert.equal(new Set(all.map(p=>p.path)).size,146);
 const receiptInputs=[...native,...node.walletInputFiles].map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 const names=[...inventory.NativeInputs.map(p=>p.path),...node.walletInputFiles.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS];
 const selected=canonicalNativeInputSelection(version,names,inventoryBytes,receiptInputs);assert.equal(selected.walletInputs.length,24);assert.equal(selected.pairedInputCount,122);assert.equal(receiptInputs.length,141);
 const links=node.commands.filter(c=>c.argv.includes(path.join(root,DEVICE_V4_PQ_PROTOCOL_INPUTS[0].path)));assert.equal(links.length,1);assert.equal(links[0].tool,'/usr/bin/xcrun');assert.equal(node.nativeGrant,false);assert.equal(node.approval,false);
});
test('49 requires explicit full versioned role; count102 never broadens frozen48 or borrows its Main13',()=>{
 assert.throws(()=>walletPublisherNativeInputs(102,true,true,true,true),/WALLET_SDK48_H6_FROZEN_ROLE_REQUIRED/);
 assert.equal(walletPublisherNativeInputs(102,true,true,true,false),SDK48_H6_MAIN_INPUTS);
 for(const unknown of ['1.3.0-pq.3.32-auth.50','1.3.0-pq.3.32-auth.46'])assert.throws(()=>walletPublisherNativeInputs(102,true,true,true,true,unknown),/WALLET_NATIVE_MATCHED_SDK_REQUIRED/);
 for(const flags of [[false,true,true,true],[true,false,true,true],[true,true,false,true],[true,true,true,false]])assert.throws(()=>walletPublisherNativeInputs(117,...flags,version),/WALLET_SDK49_FULL_PQ_ROLE_REQUIRED/);
 assert.throws(()=>walletNativeComponentBuildPlan('x64','/PUBLIC-plan-only-headers',true,true,true,true,false,true),/WALLET_DEVICE_V4_EXPLICIT_FULL_ROLE_REQUIRED/);
 const wallet=walletPublisherNativeInputs(117,true,true,true,true,version);assert.equal(wallet.find(r=>r.path.endsWith('original-artifact-publisher-store.h')).bytes,7531);assert.equal(wallet.find(r=>r.path.endsWith('libynx_artifact_release.a')).sha256,DEVICE_V4_PQ_PROTOCOL_INPUTS[0].sha256);
});
