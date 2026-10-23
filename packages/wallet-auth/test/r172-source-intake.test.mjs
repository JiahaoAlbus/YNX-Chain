import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {verifySDK332R140Source,sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
const parent='d4ad9d2094b74cc729615c2c651a305a967670d5',relative='apps/wallet-desktop/native/original-auth-identity-node.mm';
const pin={path:relative,bytes:81282,sha256:'579e2756a755d3b759a39ead2811549bc13961dc8cd864354b6f4af02d2188d2'};
const historical=p=>execFileSync('git',['show',parent+':'+p],{cwd:root});
// Source-only normal successor check. Original real2-worker SIGSEGV and new
// Native2 groups are reused from exact R172 H4614/e14e57d5, never reexecuted.
test('R172 changes only exact Node entry in normal72+5 inventory and preserves original builder/requirements',()=>{
 const {contract}=verifySDK332R140Source(root),previous=JSON.parse(historical('packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'));
 assert.equal(contract.version,'1.3.0-pq.3.32-auth.16');assert.equal(contract.NativeInputs.length,72);assert.equal(contract.HelperInputs.length,5);
 assert.deepEqual(contract.NativeInputs,previous.NativeInputs.map(p=>p.path===relative?pin:p));assert.deepEqual(contract.HelperInputs,previous.HelperInputs);assert.deepEqual(contract.normalBuildTool,previous.normalBuildTool);assert.deepEqual(contract.require,previous.require);assert.deepEqual(contract.pureDeploymentInputs,previous.pureDeploymentInputs);
 const raw=readFileSync(resolve(root,relative));assert.equal(raw.length,pin.bytes);assert.equal(sha(raw),pin.sha256);
 const supplier=contract.supplierR172;assert.equal(supplier.handoff.bytes,4614);assert.equal(supplier.handoff.sha256,'e14e57d57093298eb03f22e6db576dac058d1f8f22968707331b3f7ca6bd31c6');assert.deepEqual(supplier.sourceLeaves,[pin]);assert.equal(supplier.originalWorkerSignal,'SIGSEGV');assert.equal(supplier.originalWorkerCount,2);assert.equal(supplier.newNativeEvidenceReused.newGroups,2);assert.equal(supplier.newNativeEvidenceReused.oldGreenRerun,false);
 for(const flag of ['normalNativeBuild','NativeTestsReexecuted','sourceTestArtifactCopied','matchingApp','SourceGrant','installedOrPublic','approval','sign','transaction'])assert.equal(supplier[flag],false);
});
test('R172 exact main-thread rejection is first Register statement before any callback or cleanup registration',()=>{
 const source=readFileSync(resolve(root,relative),'utf8'),start='static napi_value Register(napi_env env,napi_value exports){',offset=source.indexOf(start);assert.ok(offset>=0);
 const body=source.slice(offset+start.length,source.indexOf('NAPI_MODULE(NODE_GYP_MODULE_NAME,Register)',offset));
 const uncommented=body.replace(/^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, '');
 const guard='if(!pthread_main_np())return Error(env,"AUTH_IDENTITY_ADDON_MAIN_THREAD_REQUIRED");';
 assert.ok(uncommented.startsWith(guard));
 const first=body.indexOf(guard);assert.ok(first>=0);for(const callback of ['napi_define_properties','RegisterOriginalIDEIdentityPeerBinding','RegisterOriginalIDEContractRelayBinding','RegisterOriginalIDEPublicationArtifactBinding','RegisterOriginalIDEAuthIdentityBinding'])assert.ok(body.indexOf(callback)>first);
});
test('R172 normal plans retain same Node13/helper11 and reject actual frozen15 entry without executing Native',async()=>{
 const selected=await sdk332R140NativePlan(root,'/original/pinned/headers','arm64');assert.equal(selected.plan.sources.length,13);assert.equal(selected.helperPlan.sources.length,11);assert.equal(selected.NativeBuild,false);assert.equal(selected.grant,false);assert.equal(selected.rebuildRequired,true);
 const {contract}=verifySDK332R140Source(root),temporary=mkdtempSync(join(tmpdir(),'ynx-r172-source-'));
 try{const paths=new Set(['packages/wallet-auth/package.json','packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',...[...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool].map(p=>p.path)]);for(const p of paths){const to=resolve(temporary,p);mkdirSync(dirname(to),{recursive:true});copyFileSync(resolve(root,p),to);}assert.equal(verifySDK332R140Source(temporary).contract.version,'1.3.0-pq.3.32-auth.16');const old=historical(relative);assert.equal(old.length,80978);assert.equal(sha(old),'7fd76fdc2f99c26f4c8a1e9e82c8c70d8e936f2c62c921dee268bdaab2eeb30e');writeFileSync(resolve(temporary,relative),old);assert.throws(()=>verifySDK332R140Source(temporary),e=>e.code==='SDK332_R140_NATIVE_INPUT_DIFFERS');}finally{rmSync(temporary,{recursive:true,force:true});}
});
