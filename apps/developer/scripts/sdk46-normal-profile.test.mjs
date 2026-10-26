import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalInputs,verifyCanonicalNativeSourceSelection,validateCanonicalNativeBuildReceipt} from './package-identity-admission-source.mjs';
import {sdk46ProductLayout} from './sdk46-product-layout.mjs';
const record=await canonicalInputs();
test('normal profile retains exact SDK46 source and product runtime without admission',()=>{
 assert.equal(record.sdkVersion,'1.3.0-pq.3.32-auth.46');assert.equal(record.sdkCommit,'59a3797ea3421129171565e37870568e424ec085');
 assert.equal(record.files.length,413);assert.equal(record.nativeSources.length,125);assert.equal(record.dependencies.length,9177);
 const p=sdk46ProductLayout(record);assert.equal(p.files.length,398);assert.equal(p.runtimeClosure.Auth.files,562);assert.equal(p.runtimeClosure.contractRelay.files,9423);
 assert.equal(p.productProjection.SourceAdmission,false);assert.equal(p.productProjection.NativeAdmission,false);
 assert.ok(p.files.some(r=>r.path==='src/original-auth-source-issuance-v2.js'));
});
test('normal package requires actual matching SDK46 Native and paired Helper',async()=>{
 const selected=await verifyCanonicalNativeSourceSelection();
 assert.equal(selected.sourceLeaves,125);assert.equal(selected.buildInputLeaves,113);
 assert.equal(record.nativeBuildQualification.state,'ACTUAL_EXECUTED_SDK46_RECORD');
 assert.equal(record.nativeBuildQualification.NativeQualified,false);assert.equal(record.nativeBuildQualification.SourceQualified,false);
 assert.equal(record.helperComponent.registered,false);assert.equal(record.requiredBuild.helperInputs.length,105);
 const raw=JSON.parse(await readFile(join(process.env.YNX_DEVELOPER_CANONICAL_NATIVE_ROOT||record.roots.native,record.nativeComponent.receipt.path)));
 assert.equal(validateCanonicalNativeBuildReceipt(raw,record,'arm64'),raw);
 const missing=structuredClone(record);missing.nativeBuildQualification.state='NOT_SUPPLIED';
 assert.throws(()=>validateCanonicalNativeBuildReceipt(raw,missing,'arm64'),/actual matching record qualification differs/);
});

