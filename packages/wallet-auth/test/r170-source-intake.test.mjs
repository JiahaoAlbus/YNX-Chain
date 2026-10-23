import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdtempSync,mkdirSync,unlinkSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifySDK332R140Source,sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
const pins=[{"path":"apps/wallet-desktop/native/original-auth-identity-node.mm","bytes":80978,"sha256":"7fd76fdc2f99c26f4c8a1e9e82c8c70d8e936f2c62c921dee268bdaab2eeb30e"},{"path":"apps/wallet-desktop/native/original-ide-auth-identity-owners.inc.mm","bytes":23367,"sha256":"63af0b267cad6940c7497ee76bcf0a6a0b8435aac9777114d72eb4f478b3e43a"},{"path":"apps/wallet-desktop/native/original-ide-auth-request-source.h","bytes":2299,"sha256":"aca773d655a8c9e6bd388454f345f71cff00b716a13e2b624733177e4228273f"},{"path":"apps/wallet-desktop/native/original-ide-publication-artifact-binding.inc.mm","bytes":5592,"sha256":"6e2722920afa7e25188b7d368476dc11986f0767a734664a7d8415816270cd49"}];
// R170 H7871/90f09d0e supplied complete successor includes R167 carrier.
// Only source-selection checks here; original normal3/PUBLIC5 Native evidence
// is reused, not rebuilt/reexecuted or treated as approval/publication.
const selectedVersion=JSON.parse(readFileSync(resolve(root,'packages/wallet-auth/package.json'))).version,r171=selectedVersion==='1.3.0-pq.3.32-auth.17',r172=r171||selectedVersion==='1.3.0-pq.3.32-auth.16';
const r172NodePin={"path":"apps/wallet-desktop/native/original-auth-identity-node.mm","bytes":81282,"sha256":"579e2756a755d3b759a39ead2811549bc13961dc8cd864354b6f4af02d2188d2"};
const currentPins=r172?pins.map(p=>p.path===r172NodePin.path?r172NodePin:p):pins;
test('Inherited R170 complete source pins retain original provenance with explicit selected Node successor',()=>{
 const {contract}=verifySDK332R140Source(root);assert.ok(['1.3.0-pq.3.32-auth.15','1.3.0-pq.3.32-auth.16','1.3.0-pq.3.32-auth.17'].includes(contract.version));assert.equal(contract.NativeInputs.length,r171?74:72);assert.equal(contract.HelperInputs.length,5);assert.equal(new Set([...contract.NativeInputs,...contract.HelperInputs].map(p=>p.path)).size,r171?79:77);
 for(const p of currentPins){const actual=readFileSync(resolve(root,p.path));assert.equal(actual.length,p.bytes);assert.equal(sha(actual),p.sha256);assert.deepEqual(contract.NativeInputs.find(pin=>pin.path===p.path),p);}
 const supplier=contract.supplierR170;assert.equal(supplier.handoff.bytes,7871);assert.equal(supplier.handoff.sha256,'90f09d0e248c2e5be2b9285c53ae071399e7598ab6f9779a0e791ddb1ce9d616');assert.deepEqual(supplier.sourceLeaves,pins);if(r172)assert.deepEqual(contract.supplierR172.sourceLeaves,[r172NodePin]);assert.equal(supplier.R167SourceAppliedSeparately,false);assert.equal(supplier.parents[0].bytes,3840);assert.equal(supplier.parents[0].sha256,'b8cce9b811b20e215d8b5a31256676d479c1cd5846461e27820669c42d37e098');assert.equal(supplier.parents[1].sha256,'523c9081c00d26f375fc7138ad0025afcbe0a2e1f7adb9db20d09b99332de2f2');
 for(const flag of ['sourceTestArtifactCopied','normalNativeBuild','matchingApp','genuineSource','currentPublisher','MainApprovalEffect','actualApproval','signature','publication'])assert.equal(supplier[flag],false);
 assert.equal(contract.supplierR166.handoff.sha256,'54609d7d3035c8445adf3460c021d121caa6b0be8fd51952c77d80de66974241');
});
test('R170 typed publication stays in user addon same13 TUs and helper11 gains no user addon source',async()=>{
 const selected=await sdk332R140NativePlan(root,'/original/pinned/headers','arm64');assert.equal(selected.plan.sources.length,13);assert.equal(selected.helperPlan.sources.length,11);
 for(const plan of [selected.plan,selected.helperPlan])assert.equal(plan.sources.some(p=>p.endsWith('/original-ide-publication-artifact-binding.inc.mm')),false);
 assert.equal(selected.rebuildRequired,true);assert.equal(selected.NativeBuild,false);assert.equal(selected.grant,false);assert.equal(selected.contractRelayProducerQualified,false);
});
async function isolated(run){const {contract}=verifySDK332R140Source(root),temporary=mkdtempSync(join(tmpdir(),'ynx-r170-source-'));try{
 const paths=new Set(['packages/wallet-auth/package.json','packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json','apps/wallet-desktop/package.json','apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs',...[...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool].map(p=>p.path)]);
 for(const p of paths){const to=resolve(temporary,p);mkdirSync(dirname(to),{recursive:true});copyFileSync(resolve(root,p),to);}
 assert.equal(verifySDK332R140Source(temporary).contract.NativeInputs.length,r171?74:72);const build=await import(pathToFileURL(resolve(temporary,contract.normalBuildTool.path)).href);await run(temporary,build);
 }finally{rmSync(temporary,{recursive:true,force:true});}}
test('R170 missing typed carrier binding rejects Node recipe while helper remains independent',async()=>{
 await isolated(async(dir,build)=>{unlinkSync(resolve(dir,'apps/wallet-desktop/native/original-ide-publication-artifact-binding.inc.mm'));assert.throws(()=>build.originalAuthNativeBuildPlan('arm64','/original/headers'),/AUTH_NATIVE_PUBLICATION_BINDING_SOURCE_SELECTION_INCOMPLETE/);assert.equal(build.originalIDEHelperBuildPlan('arm64').sources.length,11);});
});
test('R170 normal selector refuses original frozen14 Node entry without compiling or dropping historical source',async()=>{
 await isolated(async(dir)=>{const p='apps/wallet-desktop/native/original-auth-identity-node.mm',old=execFileSync('git',['show','f250f6af67639268eef5a8f948f8f380b7870dcc:'+p],{cwd:root});assert.equal(sha(old),'208f88b06818eb60b3d856c8a83d2da23ec1e6f557f2656d8f8ee3f129173b8d');writeFileSync(resolve(dir,p),old);assert.throws(()=>verifySDK332R140Source(dir),e=>e.code==='SDK332_R140_NATIVE_INPUT_DIFFERS');});
});
