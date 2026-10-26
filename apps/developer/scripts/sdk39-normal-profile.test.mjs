import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateCanonicalNativeBuildReceipt} from './package-identity-admission-source.mjs';
import {sdk39RegressionInputs,sdk39RegressionJSON} from './sdk39-regression-inputs.mjs';
import {canonicalSDK39ProjectionData,validateSDK39ProjectionContract as validate} from './sdk39-projection-contract.mjs';
import {sdk39ProductLayout} from './sdk39-product-layout.mjs';
const record=sdk39RegressionInputs;
const receipt=await sdk39RegressionJSON(record.productProjection.receipt);
const policy=await sdk39RegressionJSON(record.productProjection.finitePolicy);
const metadata=await sdk39RegressionJSON({...record.files.find(r=>r.path==='package.json'),path:join(record.roots.sdk,'package.json')});
function data(){return structuredClone(canonicalSDK39ProjectionData(record,receipt,policy,metadata));}
test('production reader consumes exact SDK39 normal receive source and finite projection',()=>{const r=validate(data());assert.equal(record.sdkVersion,'1.3.0-pq.3.32-auth.39');assert.equal(r.selected.length,9568);assert.equal(record.files.length,408);assert.equal(r.SourceAdmission,false);assert.equal(r.NativeAdmission,false);});
for(const [name,mutate] of [
 ['catalog substituted for normal purpose',d=>d.handoff.normalCallee.normalSourcePurposeNowImplemented='wallet-pq-host-catalog-source-v1'],
 ['purposes conflated',d=>d.handoff.normalCallee.fixedSourcePurposes=['AUTH-IDENTITY-RECEIVE']],
 ['unsupplied roles asserted',d=>d.handoff.normalCallee.normalSourceRealRoleAndApprovalSupplied=true],
 ['Native changes hidden',d=>d.handoff.sourceRoles.changedNativeInputs=1],
 ['old component relabeled',d=>d.handoff.sourceRoles.old38RecordMayBeRelabeled=true],
 ['four-delta closure truncated',d=>d.handoff.normalPrefix.fourProductionDelta.pop()],
 ['SDK38 admission inherited',d=>d.receipt.oldSDK38IdentityOrAdmissionInherited=true]
])test('SDK39 rejects '+name,()=>{const d=data();mutate(d);assert.throws(()=>validate(d),/SDK39/);});
test('matching actual component remains source custody without runtime admission',async()=>{assert.equal(record.nativeBuildQualification.state,'ACTUAL_EXECUTED_SDK39_RECORD');assert.equal(record.nativeBuildQualification.NativeQualified,false);assert.equal(record.nativeBuildQualification.SourceQualified,false);assert.equal(record.requiredBuild.normalPlans.node.sources.length,18);const raw=await sdk39RegressionJSON(record.nativeComponent.receipt);const missing=structuredClone(record);missing.nativeBuildQualification.state='NOT_SUPPLIED';assert.throws(()=>validateCanonicalNativeBuildReceipt(raw,missing,'arm64'),/actual matching record qualification differs/);});
test('product manifests and actual new issuer pin remain selected',()=>{const p=sdk39ProductLayout(record);assert.equal(p.files.length,393);assert.equal(p.runtimeClosure.Auth.files,557);assert.equal(p.runtimeClosure.contractRelay.files,9418);const issuer=p.files.find(x=>x.path==='src/original-auth-source-issuance-v2.js');assert.equal(issuer.bytes,15729);assert.equal(issuer.sha256,'b4ce5ef5cc1d1afc8d27b6d6ac18fdb3418c53fcce3c63b3f2ac0f1b3c49b7fd');});
