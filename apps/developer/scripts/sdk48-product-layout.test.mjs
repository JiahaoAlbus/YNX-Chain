import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sdk48ProductLayout,validateSDK48ProjectionRecord} from './sdk48-product-layout.mjs';
const record=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
const sourceOnly=JSON.parse(await readFile(new URL('./fixtures/sdk48-source-only-selection.json',import.meta.url)));
const receipt=JSON.parse(await readFile(record.productProjection.receipt.path));
const policy=JSON.parse(await readFile(record.productProjection.finitePolicy.path));
const metadata={name:'@ynx-chain/wallet-auth',version:record.sdkVersion};
const validate=(r=record,p=receipt,e=policy)=>validateSDK48ProjectionRecord(r,p,e,metadata);
test('full SDK48 projects to exact product source and runtime DATA',()=>{
 validate(sourceOnly);const r=sdk48ProductLayout(sourceOnly);
 assert.equal(r.files.length,400);assert.equal(r.runtimeClosure.Auth.files,564);assert.equal(r.runtimeClosure.contractRelay.files,9425);
 assert.equal(r.nativeComponent,null);assert.equal(r.runtimeClosure.contractRelay.nativeQualified,false);
});
test('actual component metadata survives the SDK48 source projection without granting runtime admission',()=>{
 validate();const r=sdk48ProductLayout(record);
 assert.ok(record.nativeComponent&&record.helperComponent,'The current positive tuple must contain the actual paired components');
 assert.equal(r.nativeComponent,record.nativeComponent);assert.equal(r.helperComponent,record.helperComponent);
 assert.equal(r.nativeBuildQualification,record.nativeBuildQualification);
 assert.equal(r.nativeBuildQualification.state,'ACTUAL_EXECUTED_SDK48_RECORD');
 assert.equal(r.nativeBuildQualification.NativeQualified,false);assert.equal(r.nativeBuildQualification.SourceQualified,false);
 assert.equal(r.sourceOnly,true);assert.equal(r.productProjection.NativeAdmission,false);assert.equal(r.productProjection.SourceAdmission,false);
 assert.equal(r.runtimeClosure.contractRelay.nativeQualified,false);assert.equal(r.helperComponent.installed,false);assert.equal(r.helperComponent.registered,false);
});
test('foreign source version is rejected',()=>{
 const r=structuredClone(record);r.sdkCommit='74a44b86f27456685f4a153dfdd8f4e51aaa0cc8';assert.throws(()=>validate(r),/identity differs/);
});
test('excluded source cannot reenter product under altered projection',()=>{
 const r=structuredClone(record);r.productProjection.files[0]={...r.buildOnlySDKFiles[0]};assert.throws(()=>validate(r));
});
test('product manifest cannot reuse full-runtime bytes',()=>{
 const r=structuredClone(record),p=r.productProjection;
 const target=p.files.find(x=>x.path==='native/original-ide-auth-runtime-manifest.json');target.sha256=r.runtimeClosure.Auth.manifest.sha256;assert.throws(()=>validate(r),/differs from source custody/);
});
test('duplicate product row is rejected',()=>{
 const r=structuredClone(record);r.productProjection.files[1]=r.productProjection.files[0];assert.throws(()=>validate(r),/differs from source custody/);
});
test('source metadata cannot claim installed, published or native qualification',()=>{
 for(const k of ['installed','published','NativeModuleBuilt','SourceQualified']){const r=structuredClone(receipt);r[k]=true;assert.throws(()=>validate(record,r),/identity differs/);}
});
test('finite exclusions must retain original source byte identity',()=>{
 const p=structuredClone(policy);p.excluded[0].sha256='0'.repeat(64);assert.throws(()=>validate(record,receipt,p),/excluded row differs/);
});

