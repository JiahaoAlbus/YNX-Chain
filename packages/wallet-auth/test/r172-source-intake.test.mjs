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
const version=JSON.parse(readFileSync(resolve(root,'packages/wallet-auth/package.json'))).version,r174=version==='1.3.0-pq.3.32-auth.18',r171=r174||version==='1.3.0-pq.3.32-auth.17';
const currentPin=r174?{"path":"apps/wallet-desktop/native/original-auth-identity-node.mm","bytes":81397,"sha256":"4e95b6e194be68140c172ecce961579395bb18c77c2e32548ec8e1a368de219b"}:pin;
const bindingPin={"path":"apps/wallet-desktop/native/original-ide-project-authority-binding.inc.mm","bytes":9156,"sha256":"bcba19edf40a0f908fafa2bc91cf71d8800781f5f5313f46a3cef543d0786504"};
const r171Pins=[{"path":"packages/wallet-auth/native/original-auth-identity-joint-owner.h","bytes":1131,"sha256":"b79289a6cd61804b76e8fc02b4235878b0de5f868d72a39a6d5a64c3bade655b"},{"path":"packages/wallet-auth/native/original-auth-identity-joint-owner.mm","bytes":11917,"sha256":"f8047587f8f3a92a125ed5642cec2eb002b00f006369b875c3fd78050456a911"},{"path":"packages/wallet-auth/native/original-auth-identity-native-release.h","bytes":2549,"sha256":"aee53add28936505ae171d34b0f8c0552ebddf6afd9868c2430ee4e46c28045c"},{"path":"packages/wallet-auth/native/original-auth-identity-source-authority.h","bytes":6781,"sha256":"b34ef92dc10e44b360190c27dd7b2775efd621b3bb977140a1ee36a60b2ebdc7"},{"path":"packages/wallet-auth/native/original-auth-identity-source-authority.mm","bytes":46433,"sha256":"d8c5ea1b8bc971642fdf192f4d6bfb57ea6ce0842acb9dcaa8170e25b3ed4b45"},{"path":"packages/wallet-auth/native/original-auth-identity-source-v2-verifier.mjs","bytes":23223,"sha256":"a73f04a1bdcf6f4bc55b36d3af886a5ddc27de2cfea099ecc7c57405078403ec"},{"path":"packages/wallet-auth/native/original-ide-project-authority-data.h","bytes":3689,"sha256":"870385db0eb9acaa370d1bb49addc5adb35bfc50fa37f4bdc27b43ec120232ff"},{"path":"packages/wallet-auth/native/original-ide-project-authority-source.inc.mm","bytes":9316,"sha256":"b3a69cf9725d3d523b24c047ec840865d240804239524617cc215984b852eff5"}];
const historical=p=>execFileSync('git',['show',parent+':'+p],{cwd:root});
// Source-only normal successor check. Original real2-worker SIGSEGV and new
// Native2 groups are reused from exact R172 H4614/e14e57d5, never reexecuted.
test('Inherited R172 main-thread entry and exact successor Source selection preserve original requirements',()=>{
 const {contract}=verifySDK332R140Source(root),previous=JSON.parse(historical('packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'));
 assert.ok(['1.3.0-pq.3.32-auth.16','1.3.0-pq.3.32-auth.17','1.3.0-pq.3.32-auth.18'].includes(contract.version));assert.equal(contract.NativeInputs.length,r174?75:r171?74:72);assert.equal(contract.HelperInputs.length,5);
 const expected=previous.NativeInputs.map(p=>p.path===relative?currentPin:r171?(r171Pins.find(x=>x.path===p.path)??p):p);if(r171)for(const p of r171Pins)if(!expected.some(x=>x.path===p.path))expected.push(p);if(r174)expected.push(bindingPin);assert.deepEqual(contract.NativeInputs,expected);assert.deepEqual(contract.HelperInputs,previous.HelperInputs);if(r174){assert.equal(contract.normalBuildTool.bytes,11989);assert.equal(contract.normalBuildTool.sha256,'218c73f9883ef9263181453a7e12049009ccc400ec313e85c29ece3848ebc4dc');}else if(r171){assert.equal(contract.normalBuildTool.bytes,11746);assert.equal(contract.normalBuildTool.sha256,'21bef980c60d2ae4729d6395b3ba37836e1e3d8ebb7f9136c0ac90642f97288c');}else assert.deepEqual(contract.normalBuildTool,previous.normalBuildTool);assert.deepEqual(contract.require,previous.require);assert.deepEqual(contract.pureDeploymentInputs,previous.pureDeploymentInputs);
 const raw=readFileSync(resolve(root,relative));assert.equal(raw.length,currentPin.bytes);assert.equal(sha(raw),currentPin.sha256);
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
 try{const paths=new Set(['packages/wallet-auth/package.json','packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',...[...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool].map(p=>p.path)]);for(const p of paths){const to=resolve(temporary,p);mkdirSync(dirname(to),{recursive:true});copyFileSync(resolve(root,p),to);}assert.equal(verifySDK332R140Source(temporary).contract.version,r174?'1.3.0-pq.3.32-auth.18':r171?'1.3.0-pq.3.32-auth.17':'1.3.0-pq.3.32-auth.16');const old=historical(relative);assert.equal(old.length,80978);assert.equal(sha(old),'7fd76fdc2f99c26f4c8a1e9e82c8c70d8e936f2c62c921dee268bdaab2eeb30e');writeFileSync(resolve(temporary,relative),old);assert.throws(()=>verifySDK332R140Source(temporary),e=>e.code==='SDK332_R140_NATIVE_INPUT_DIFFERS');}finally{rmSync(temporary,{recursive:true,force:true});}
});
