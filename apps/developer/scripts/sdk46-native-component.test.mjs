import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateSDK39NativeComponent} from './sdk39-native-component.mjs';
import {validateSDK46NativeComponent} from './sdk46-native-component.mjs';
const old=JSON.parse(await readFile('/Volumes/西部数据/YNX-large-work/original-a-builds/ide-pq-current-project-source-20261025/source/apps/developer/scripts/canonical-identity-inputs.json'));
const held=old.nativeComponent.originalExecutedReceipt;
const raw=await readFile(held.path);
assert.equal(raw.length,held.bytes);
assert.equal(createHash('sha256').update(raw).digest('hex'),held.sha256);
const actualOld=JSON.parse(raw);
const current=JSON.parse(await readFile(new URL('./fixtures/sdk46-canonical-source.json',import.meta.url)));
test('original executed SDK39 receipt remains a valid SDK39 record only',()=>{
 assert.equal(validateSDK39NativeComponent(actualOld,old),actualOld);
 assert.throws(()=>validateSDK46NativeComponent(actualOld,current),/actual matching record qualification differs/);
});
test('relabeling old receipt qualification cannot supply new source inputs',()=>{
 const r=structuredClone(current);
 r.nativeBuildQualification={...old.nativeBuildQualification,state:'ACTUAL_EXECUTED_SDK46_RECORD'};
 r.nativeComponent=structuredClone(old.nativeComponent);r.helperComponent=structuredClone(old.helperComponent);
 r.requiredBuild.normalPlanSourceRoot=old.requiredBuild.normalPlanSourceRoot;
 r.requiredBuild.normalPlans=structuredClone(old.requiredBuild.normalPlans);
 assert.throws(()=>validateSDK46NativeComponent(actualOld,r),/input count differs/);
});
test('SDK46 requires paired helper input table',()=>{
 const r=structuredClone(current);r.nativeBuildQualification={...old.nativeBuildQualification,state:'ACTUAL_EXECUTED_SDK46_RECORD'};
 r.requiredBuild.helperInputs=old.requiredBuild.helperInputs;
 assert.throws(()=>validateSDK46NativeComponent(actualOld,r),/paired source count differs/);
});
test('unexecuted source-only selection cannot inherit original build plans',()=>{
 const r=structuredClone(current);r.nativeBuildQualification={...old.nativeBuildQualification,state:'ACTUAL_EXECUTED_SDK46_RECORD'};
 r.nativeComponent={...old.nativeComponent};
 assert.throws(()=>validateSDK46NativeComponent(actualOld,r),/original executed producer not supplied/);
});

