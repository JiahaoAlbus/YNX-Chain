import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {inspectR155ProducerMetadata,verifyOriginalR155Component,stageOriginalR155HelperBundle} from '../scripts/r155-native-component.mjs';
const bytes=name=>readFileSync(new URL('./fixtures/'+name,import.meta.url));
const recordBytes=bytes('r155-executed-producer-record.json'),intakeBytes=bytes('r155-original-source-intake.json'),inventoryBytes=bytes('sdk332-auth5-native62-helper5.json');
const original=JSON.parse(recordBytes),intake=JSON.parse(intakeBytes),inventory=JSON.parse(inventoryBytes),copy=v=>JSON.parse(JSON.stringify(v));
test('actual R155 metadata preserves external executed paths,11Node/10helper and four actual NAPI headers without relabeling',()=>{
 const value=inspectR155ProducerMetadata(original,intake,inventory);
 assert.equal(value.nodeInputFiles.length,62);assert.equal(value.inputs.length,67);assert.equal(value.artifacts[0].sha256,'ce81d7f0d3e832d491379235af9a3e274a68539735e6aea7f71b0b3e56a7e492');
 assert.equal(value.artifacts[1].sha256,'f83ff102eff416a70fbc511c2e523974068e96d9c3211e9b2cb03dd4f05ffc3d');
 assert.equal(value.metadataVerified,true);for(const key of ['sourceBytesVerified','artifactBytesVerified','nativeQualified','installed'])assert.equal(value[key],false);
});
test('missing actual client, altered frameworks/ABI/output and helper dynamic lookup reject',()=>{
 const mutations=[r=>r.nodeTUs.pop(),r=>r.helperTUs.splice(8,1),r=>r.steps[0].args.splice(r.steps[0].args.indexOf('ServiceManagement'),1),r=>r.steps[1].args.push('-undefined','dynamic_lookup'),r=>r.steps[0].args[r.steps[0].args.indexOf('-DNAPI_VERSION=8')]='-DNAPI_VERSION=9',r=>r.steps[0].args[r.steps[0].args.length-1]='/tmp/relabel.node',r=>r.steps[1].exit=1,r=>r.ownUndefined.push('original_missing_symbol')];
 for(const mutate of mutations){const r=copy(original);mutate(r);assert.throws(()=>inspectR155ProducerMetadata(r,intake,inventory),/record differs/)}
});
test('source/header substitution and qualified/install claims never pass as original compile provenance',()=>{
 for(const mutate of [r=>r.headerRefs.pop(),r=>r.headerRefs[0].sha256='ab'.repeat(32),r=>r.PUBLICSubstitutes=true,r=>r.Root=true,r=>r.installed=true,r=>r.loaded=true]){const r=copy(original);mutate(r);assert.throws(()=>inspectR155ProducerMetadata(r,intake,inventory),/record differs/)}
 const changed=copy(intake);changed.files[0].sha256='ab'.repeat(32);assert.throws(()=>inspectR155ProducerMetadata(original,changed,inventory),/record differs/);
 let hits=0;const getter=copy(original);Object.defineProperty(getter,'out',{enumerable:true,get(){hits++;throw Error('getter')}});assert.throws(()=>inspectR155ProducerMetadata(getter,intake,inventory),/record differs/);assert.equal(hits,0);
});
test('production wrapper requires exact original bytes and actual paired binaries before any source read',()=>{
 let reads=0;const input={recordBytes,intakeBytes,inventoryBytes,moduleBytes:Buffer.from('not a module'),helperBytes:Buffer.from('not a helper')};
 assert.throws(()=>verifyOriginalR155Component(input,()=>{reads++;return Buffer.alloc(0)}),/record differs/);assert.equal(reads,0);
 const changed=Buffer.from(recordBytes);changed[changed.length-1]^=1;
 assert.throws(()=>verifyOriginalR155Component({...input,recordBytes:changed},()=>{}),/record differs/);
});
test('auth6 keeps the exact paired Native source pins without reusing old55 component identity',()=>{
 const current=JSON.parse(bytes('sdk332-auth6-native62-helper5.json'));
 assert.deepEqual(current.NativeInputs,inventory.NativeInputs);assert.deepEqual(current.HelperInputs,inventory.HelperInputs);
 assert.equal(inspectR155ProducerMetadata(original,intake,current).inputs.length,67);
});
test('normal helper bundle assembly rejects substituted supplier bytes before creating candidate files',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'ynx-r155-bundle-negative-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const projectDir=path.join(root,'apps/wallet-desktop'),contents=path.join(root,'candidate/Contents');mkdirSync(path.join(projectDir,'native'),{recursive:true});mkdirSync(contents,{recursive:true});
 writeFileSync(path.join(projectDir,'native/YNXIdentityReceiver'),'not the original helper');
 assert.throws(()=>stageOriginalR155HelperBundle({contents,projectDir}),/record differs/);assert.equal(existsSync(path.join(contents,'Library')),false);
});
