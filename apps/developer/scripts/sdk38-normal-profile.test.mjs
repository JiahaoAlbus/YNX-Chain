import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonicalInputs,verifyCanonicalNativeSourceSelection,verifyCanonicalIdentityAdmissionSource} from './package-identity-admission-source.mjs';
import {canonicalSDK38ProjectionData,validateSDK38ProjectionContract} from './sdk38-projection-contract.mjs';
import {sdk38ProductLayout} from './sdk38-product-layout.mjs';
import {inspectSDK38CanonicalRuntimeManifest} from './sdk38-canonical-runtime-manifest.mjs';
const record=await canonicalInputs();
const receipt=JSON.parse(await readFile(new URL('../../../'+record.productProjection.receipt.source,import.meta.url)));
const policy=JSON.parse(await readFile(new URL('../../../'+record.productProjection.finitePolicy.source,import.meta.url)));
const metadata=JSON.parse(await readFile(join(process.env.YNX_DEVELOPER_CANONICAL_SDK_ROOT||record.roots.sdk,'package.json')));
test('production reader accepts exact SDK38 source profile, retaining SDK37 only as history',()=>{assert.equal(record.files.length,408);assert.equal(record.dependencies.length,9177);assert.equal(record.nativeComponent,null);assert.equal(record.helperComponent,null);assert.equal(record.nativeSourceCommit,null);assert.equal(record.roots.native,null);assert.equal(record.retainedSDK37NativeSelection.sdkCommit,'7bb0e17d2bd1aa6d4bde96f45c14774fcc4ccff9');});
test('actual SDK38 product closure includes new issuance entry',()=>{const p=sdk38ProductLayout(record);assert.equal(p.files.length,393);assert.equal(p.runtimeClosure.Auth.files,557);assert.equal(p.runtimeClosure.contractRelay.files,9418);assert.ok(p.files.some(p=>p.path==='src/original-auth-source-issuance-v2.js'));});
test('missing matching SDK38 component refuses before Native path access',async()=>{await assert.rejects(verifyCanonicalNativeSourceSelection('/does-not-exist-sdk38'),/SDK38_MATCHING_NATIVE_COMPONENT_NOT_SUPPLIED/);});
for(const [name,mutate] of [
 ['stale identity',d=>d.handoff.versionSDK='1.3.0-pq.3.32-auth.37'],
 ['inherited admission',d=>d.receipt.oldSDK37IdentityOrAdmissionInherited=true],
 ['duplicate selection',d=>d.selection.files[1]=d.selection.files[0]],
 ['changed leaf',d=>d.selection.files[0].sha256='0'.repeat(64)],
 ['redirected CLI',d=>d.metadata.bin['ynx-auth-source-issue']='scripts/other.mjs'],
 ['false unchanged graph',d=>d.receipt.existingJSSourceGraphUnchanged=true],
 ['implied release configuration',d=>d.handoff.normalCallee.releaseSelection='CONFIGURED'],
 ['enrollment as authority',d=>d.handoff.normalCallee.sourceEnrollmentType='NativeAdmission']
])test('production profile rejects '+name,()=>{const d=structuredClone(canonicalSDK38ProjectionData(record,receipt,policy,metadata));mutate(d);assert.throws(()=>validateSDK38ProjectionContract(d),/SDK38/);});
test('actual product runtime manifest canonical bytes accepted; appended newline rejected',async()=>{const p=record.productProjection.generated[0],raw=await readFile(new URL('../../../'+p.source,import.meta.url));assert.equal(inspectSDK38CanonicalRuntimeManifest(raw,557).files.length,557);assert.throws(()=>inspectSDK38CanonicalRuntimeManifest(Buffer.concat([raw,Buffer.from('\n')]),557),/canonical runtime manifest/);});
test('production early pin gate rejects corrupt product before dependency scan',async()=>{const root=await mkdtemp(join(tmpdir(),'ynx-sdk38-'));try{await mkdir(join(root,'native'));await writeFile(join(root,record.productProjection.generated[0].destination),'{}');await assert.rejects(verifyCanonicalIdentityAdmissionSource(root,join(root,'missing-deps')),/SDK38 early runtime manifest pin differs/);}finally{await rm(root,{recursive:true,force:true});}});
