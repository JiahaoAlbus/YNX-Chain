import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdtempSync,mkdirSync,unlinkSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifySDK332R140Source,sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
// Exact AuthR164 H9576/476902f3 source selection only. Original13refs and
// source-unit17/math1/real-addon5 evidence are reused, never reexecuted here.
const supplierPins=[{"path":"packages/wallet-auth/native/original-auth-identity-source-authority.h","bytes":6035,"sha256":"ce8645d7bffd55bc74b9eabd16d3b49b01f5be763e3084055eb63ac47570fa16"},{"path":"packages/wallet-auth/native/original-auth-identity-source-authority.mm","bytes":45318,"sha256":"0a4384cd537a56ff0cfcf067a013deef6bcef671c9092e67e272c65547dd468f"},{"path":"packages/wallet-auth/native/original-auth-identity-source-v2-verifier.mjs","bytes":17635,"sha256":"a79c8c36f2b876c989865969f216afc87a7ff0dac527ca6f3b1b2be156c66c03"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-owner.h","bytes":877,"sha256":"a76d20b0b3085c8046161351b24f4316fb0bcd7447757e449e3ad1dbe728a9bf"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-owner.mm","bytes":8020,"sha256":"bab0cc73cc6d75930b53258767fc06f84f4c963c12e8ff342286be474b8cb392"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-peer.h","bytes":1388,"sha256":"2daeacd6f51cf7a40c3a2f8f726cdc1a01d7f5480440a70fc4a8e99d99a50a6e"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-source.inc.mm","bytes":7659,"sha256":"9c73962a5c532c866dee7bc4e2c9d26b9361a360c3c3edf328f5500685e90678"},{"path":"apps/wallet-desktop/native/original-auth-identity-node.mm","bytes":80613,"sha256":"208f88b06818eb60b3d856c8a83d2da23ec1e6f557f2656d8f8ee3f129173b8d"},{"path":"apps/wallet-desktop/native/original-ide-contract-relay-binding.inc.mm","bytes":14543,"sha256":"aaaa51ef521e924ee931ed6057100093ebacdb6894f135beb200c6acf4a82a2d"}];
const read=path=>readFileSync(resolve(root,path));
const proof='packages/wallet-auth/native/original-ide-auth-proof-source.inc.mm';
test('R164 normal inventory consumes exact nine supplier leaves and unchanged R162 proof in 69+5 closure',()=>{
 const {contract}=verifySDK332R140Source(root);assert.equal(contract.version,'1.3.0-pq.3.32-auth.12');assert.equal(contract.NativeInputs.length,69);assert.equal(contract.HelperInputs.length,5);assert.equal(new Set([...contract.NativeInputs,...contract.HelperInputs].map(p=>p.path)).size,74);
 for(const expected of supplierPins){const actual=read(expected.path),pin=contract.NativeInputs.find(p=>p.path===expected.path);assert.deepEqual(pin,expected);assert.equal(actual.length,expected.bytes);assert.equal(sha(actual),expected.sha256);}
 assert.equal(sha(read(proof)),'5c4a4ebd3251de6862763a40ea48e48123503b789f0438e06b96a50e5bb95826');
 assert.equal(contract.require.translationUnits,13);assert.equal(contract.require.helperTranslationUnits,11);assert.equal(contract.supplierR164.handoff.bytes,9576);assert.equal(contract.supplierR164.handoff.sha256,'476902f30d86ebd5b9df9904983fd38879f1fcc4b1f7714a4a1ecb5e3880de24');assert.deepEqual(contract.supplierR164.sourceLeaves,supplierPins);
 assert.equal(contract.supplierR164.sourceTestArtifactCopied,false);assert.equal(contract.supplierR164.normalNativeBuild,false);assert.equal(contract.supplierR164.actualSourceRoot,false);assert.equal(contract.supplierR164.networkActivated,false);assert.equal(contract.supplierR164.platformVerifyEgressQualified,false);assert.equal(contract.supplierR164.activationFence,'YNX_CONTRACT_RELAY_INITIATOR_ROLE_BOUNDARY_UNQUALIFIED');
});
test('R164 normal Node links unique owner TU13 while helper stays11 with same Source include closure',async()=>{
 const selected=await sdk332R140NativePlan(root,'/original/pinned/headers','arm64'),owner=resolve(root,'packages/wallet-auth/native/original-ide-contract-relay-owner.mm');
 assert.equal(selected.plan.sources.length,13);assert.equal(new Set(selected.plan.sources).size,13);assert.equal(selected.plan.sources.filter(p=>p===owner).length,1);assert.equal(selected.helperPlan.sources.length,11);assert.equal(selected.helperPlan.sources.includes(owner),false);
 for(const plan of [selected.plan,selected.helperPlan])assert.equal(plan.sources.filter(p=>p.endsWith('/original-auth-identity-source-authority.mm')).length,1);
 assert.equal(selected.plan.sources.filter(p=>p.endsWith('.inc.mm')).length,0);assert.ok(selected.helperPlan.sources.some(p=>p.endsWith('/original-ide-auth-request-source.inc.mm')));
 assert.equal(selected.plan.sources.some(p=>p.endsWith('/original-ide-contract-relay-source.inc.mm')),false);assert.equal(selected.helperPlan.sources.some(p=>p.endsWith('/original-ide-contract-relay-source.inc.mm')),false);
 assert.equal(selected.plan.commands[0].argv.includes('-DNAPI_VERSION=8'),true);assert.equal(selected.plan.commands[0].argv.includes('-lbsm'),true);
 assert.equal(selected.rebuildRequired,true);assert.equal(selected.prebuiltR140ModuleAllowed,false);assert.equal(selected.NativeBuild,false);assert.equal(selected.contractRelayProducerQualified,false);assert.equal(selected.grant,false);
});
async function isolated(run){const {contract}=verifySDK332R140Source(root),temporary=mkdtempSync(join(tmpdir(),'ynx-r164-source-'));try{
 const files=new Set(['packages/wallet-auth/package.json','packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json','apps/wallet-desktop/package.json','apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs',...[...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool].map(p=>p.path)]);
 for(const path of files){const to=resolve(temporary,path);mkdirSync(dirname(to),{recursive:true});copyFileSync(resolve(root,path),to);}
 assert.equal(verifySDK332R140Source(temporary).contract.NativeInputs.length,69);
 const build=await import(pathToFileURL(resolve(temporary,contract.normalBuildTool.path)).href);await run(temporary,build);
 }finally{rmSync(temporary,{recursive:true,force:true});}}
test('R164 missing relay owner cannot fall back to12; missing Source include refuses both Node/helper recipes',async()=>{
 await isolated(async(dir,b)=>{unlinkSync(resolve(dir,'packages/wallet-auth/native/original-ide-contract-relay-owner.mm'));assert.throws(()=>b.originalAuthNativeBuildPlan('arm64','/original/headers'),/AUTH_NATIVE_CONTRACT_RELAY_SOURCE_SELECTION_INCOMPLETE/);assert.equal(b.originalIDEHelperBuildPlan('arm64').sources.length,11);});
 await isolated(async(dir,b)=>{unlinkSync(resolve(dir,'packages/wallet-auth/native/original-ide-contract-relay-source.inc.mm'));assert.throws(()=>b.originalAuthNativeBuildPlan('arm64','/original/headers'),/AUTH_NATIVE_CONTRACT_RELAY_SOURCE_SELECTION_INCOMPLETE/);assert.throws(()=>b.originalIDEHelperBuildPlan('arm64'),/AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE/);});
});
test('R164 selector rejects reverted source bytes and stale recipe requirements without compiling',async()=>{
 await isolated(async(dir)=>{const target=resolve(dir,'packages/wallet-auth/native/original-ide-contract-relay-owner.mm');writeFileSync(target,Buffer.concat([readFileSync(target),Buffer.from('\n// changed')]));assert.throws(()=>verifySDK332R140Source(dir),e=>e.code==='SDK332_R140_NATIVE_INPUT_DIFFERS');});
 await isolated(async(dir)=>{const file=resolve(dir,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'),m=JSON.parse(readFileSync(file));m.require.translationUnits=12;writeFileSync(file,JSON.stringify(m));assert.throws(()=>verifySDK332R140Source(dir),e=>e.code==='SDK332_R140_NORMAL_REQUIREMENTS_INVALID');});
});
