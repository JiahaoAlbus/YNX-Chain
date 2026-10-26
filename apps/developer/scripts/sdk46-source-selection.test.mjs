import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareCanonicalSDK46Source} from './sdk46-source-selection.mjs';
const b='/Volumes/西部数据/YNX-large-work/';
const stage=b+'ide-wallet-contract-consumer-20261024/ide-sdk46-canonical-successor-20261026/';
const options={
 handoff:b+'wallet-auth-owned-ci-20261026/sdk46-migration-proof/SDK46_MIGRATION_POSSESSION_RUNTIME_HANDOFF.json',
 previousInputs:b+'original-a-builds/ide-pq-current-project-source-20261025/source/apps/developer/scripts/canonical-identity-inputs.json',
 nativeBaseRoot:b+'ide-wallet-contract-consumer-20261024/sdk39-component-positive/selection/complete-source',
 ideRoot:b+'original-a-builds/ide-pq-current-project-source-20261025/source',
 outputRoot:process.env.YNX_SDK46_SOURCE_TEST_ROOT||stage+'selection-r2'
};
test('source request cannot inherit an old executed component or qualification',async()=>{
 const r=JSON.parse(await readFile(options.outputRoot+'/SDK46_SOURCE_SELECTION_REQUEST.json'));
 assert.equal(r.sdkCommit,'59a3797ea3421129171565e37870568e424ec085');
 assert.equal(r.nativeSources.length,125);assert.equal(r.nativeBuildInputs.length,113);
 assert.equal(r.nativeComponent,null);assert.equal(r.helperComponent,null);
 assert.equal(r.requiredBuild.normalPlans,null);
 assert.equal(r.requiredBuild.normalPlanSourceRoot,null);
 assert.equal(r.requiredBuild.helperInputs.length,105);
 assert.ok(r.requiredBuild.helperInputs.some(p=>p.path==='packages/wallet-auth/native/original-ide-service-registration-data.h'));
 for(const k of ['NativeQualified','SourceQualified','executed','packaged','oldComponentInherited'])assert.equal(r[k],false,k);
});
test('reject changed supplier bytes before materialization',async()=>{
 await assert.rejects(prepareCanonicalSDK46Source({...options,handoff:options.previousInputs}),/Original SDK46 role bytes differ/);
});
test('reject relative output root',async()=>{
 await assert.rejects(prepareCanonicalSDK46Source({...options,outputRoot:'selection'}),/Absolute declared source roots required/);
});
test('refuse replacing existing source selection',async()=>{
 const before=await readFile(options.outputRoot+'/SDK46_SOURCE_SELECTION_REQUEST.json');
 await assert.rejects(prepareCanonicalSDK46Source(options),/Refusing to overwrite source selection/);
 assert.deepEqual(await readFile(options.outputRoot+'/SDK46_SOURCE_SELECTION_REQUEST.json'),before);
});

