import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {join} from 'node:path';
import {validateSDK35NativeComponent} from './sdk35-native-component.mjs';
const inputs=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
const producer=JSON.parse(await readFile(join(inputs.roots.native,inputs.nativeComponent.receipt.path)));
test('actual A35 metadata accepted without Native loading or authority upgrade',()=>{const before=JSON.stringify(producer);assert.equal(validateSDK35NativeComponent(producer,inputs),producer);assert.equal(JSON.stringify(producer),before);});
for(const [name,mutate] of [
 ['helper failure',r=>r.helperBuild.exitCodes=[1]],['helper pin',r=>r.helperBuild.inputFiles[0].sha256='0'.repeat(64)],
 ['helper installed',r=>r.helperBuild.installed=true],['helper output',r=>r.helperBuild.output.bytes++],
 ['Node command',r=>r.commands[0].argv.push('-DUNREVIEWED=1')],['missing Main source',r=>r.inputFiles.pop()],
 ['runtime projected as full',r=>r.runtimeUnion.files=9417],['Native admission',r=>r.runtimeUnion.NativeAdmission=true],
 ['source root',r=>r.sourceRoot+='/other'],['source inventory',r=>r.sourceInventory.bytes++],
 ['helper undefined symbol',r=>r.helperBuild.ownedUndefinedScan.ownedUndefined=['YNX_missing']],['duplicate input',r=>r.inputFiles[1]=r.inputFiles[0]]
])test('rejects repinned '+name,()=>{const r=structuredClone(producer),i=structuredClone(inputs);mutate(r);i.nativeComponent.executedRecordCanonicalSha256=createHash('sha256').update(JSON.stringify(r)).digest('hex');assert.throws(()=>validateSDK35NativeComponent(r,i),/SDK35 component/);});
