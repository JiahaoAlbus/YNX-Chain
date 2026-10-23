import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,copyFileSync,mkdtempSync,mkdirSync,unlinkSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifySDK332R140Source,sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>readFileSync(resolve(root,p));
// Exact R166 H11222/54609d7d; source selection only. Original Node/launch/math/
// runtime results and all21reference readbacks are reused, not reexecuted here.
const pins=[{"path":"packages/wallet-auth/native/original-auth-identity-joint-owner.h","bytes":1054,"sha256":"dfcd81d7f9fb09c1b43f78e2b8f00fb935442aa5016aa7ff69ab672767cc8fda"},{"path":"packages/wallet-auth/native/original-auth-identity-joint-owner.mm","bytes":11357,"sha256":"b0d83d3be525d2944925f308e69b941b2696f14a5f6ab9330084e0fbe5a6aa25"},{"path":"packages/wallet-auth/native/original-auth-identity-native-release.h","bytes":2333,"sha256":"4c4a14c71173aa25faa7e80db7675dfe40a79b26d7081397b2944898a9df9eb6"},{"path":"packages/wallet-auth/native/original-auth-identity-source-authority.h","bytes":6319,"sha256":"1139a49d836fc3d41b7d737c0bd3a9e6e4397917b4803921c2289fae49441544"},{"path":"packages/wallet-auth/native/original-auth-identity-source-authority.mm","bytes":45981,"sha256":"1793d8399fdd8e6f7cc941b459321c9be2e9b3a3be6a2383b8d8a11f48ece978"},{"path":"packages/wallet-auth/native/original-auth-identity-source-v2-verifier.mjs","bytes":18691,"sha256":"c811ec9ed87aca54ff6d54c339adbd5f2cbf7b90704ea0db9fa596d052acd250"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-launch.h","bytes":3097,"sha256":"a33a170977d1781f57d63c10c7b841d73e9962f158257e18396dca75bd923720"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-owner.h","bytes":999,"sha256":"1183251898b1934a9c39e380553ad4f71fedb12c859e9b82607b64a93bdcf4f8"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-owner.mm","bytes":11263,"sha256":"d4d8afaf85fae14201de2ee051b48f0ce1db8c246c192ebe9fee3916ffee1a29"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-peer.h","bytes":1388,"sha256":"2daeacd6f51cf7a40c3a2f8f726cdc1a01d7f5480440a70fc4a8e99d99a50a6e"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-runtime.inc.mm","bytes":9676,"sha256":"b4a53966bdce69526980e78cf4996fcf0e945d10aaee57119df202b826eb6a16"},{"path":"packages/wallet-auth/native/original-ide-contract-relay-source.inc.mm","bytes":9070,"sha256":"8f8d4f7e0e3df9dfa04e4d5ee724f2de079760b3d993fe056a473f05dace78b3"},{"path":"apps/wallet-desktop/native/original-auth-identity-node.mm","bytes":80613,"sha256":"208f88b06818eb60b3d856c8a83d2da23ec1e6f557f2656d8f8ee3f129173b8d"},{"path":"apps/wallet-desktop/native/original-ide-contract-relay-binding.inc.mm","bytes":14917,"sha256":"7b32fd4eec1a7e73ebfbe2644ce1894b278e72cadaec8d70ceb2e9fa3174c9e7"}];
test('R166 exact14 supplier leaves form normal71+5 closure and retain unchanged R162 proof',()=>{
 const {contract}=verifySDK332R140Source(root);assert.equal(contract.version,'1.3.0-pq.3.32-auth.14');assert.equal(contract.NativeInputs.length,71);assert.equal(contract.HelperInputs.length,5);assert.equal(new Set([...contract.NativeInputs,...contract.HelperInputs].map(p=>p.path)).size,76);
 for(const expected of pins){const actual=read(expected.path),selected=contract.NativeInputs.find(p=>p.path===expected.path);assert.deepEqual(selected,expected);assert.equal(actual.length,expected.bytes);assert.equal(sha(actual),expected.sha256);}
 assert.equal(sha(read('packages/wallet-auth/native/original-ide-auth-proof-source.inc.mm')),'5c4a4ebd3251de6862763a40ea48e48123503b789f0438e06b96a50e5bb95826');
 const supplier=contract.supplierR166;assert.equal(supplier.handoff.bytes,11222);assert.equal(supplier.handoff.sha256,'54609d7d3035c8445adf3460c021d121caa6b0be8fd51952c77d80de66974241');assert.deepEqual(supplier.sourceLeaves,pins);assert.equal(supplier.sourceLeavesCount,14);assert.equal(supplier.originalReferencesVerified,21);
 for(const flag of ['sourceTestArtifactCopied','normalNativeBuild','installedProtectedClosure','actualSourceRoot','platformQualified','networkActivated'])assert.equal(supplier[flag],false);
 assert.equal(supplier.runtimeManifestRequiresFinalSamePackage,true);assert.equal(supplier.privateReleaseRowsDefaultEmpty,true);
});
test('R166 launch/runtime include closure keeps same Node13 and helper11 without extra TU or private release rows',async()=>{
 const selected=await sdk332R140NativePlan(root,'/original/pinned/headers','arm64'),owner=resolve(root,'packages/wallet-auth/native/original-ide-contract-relay-owner.mm');
 assert.equal(selected.plan.sources.length,13);assert.equal(selected.helperPlan.sources.length,11);assert.equal(selected.plan.sources.filter(p=>p===owner).length,1);assert.equal(selected.helperPlan.sources.includes(owner),false);
 for(const plan of [selected.plan,selected.helperPlan]){assert.equal(new Set(plan.sources).size,plan.sources.length);assert.equal(plan.sources.filter(p=>p.endsWith('/original-auth-identity-source-authority.mm')).length,1);assert.equal(plan.sources.some(p=>p.endsWith('/original-ide-contract-relay-runtime.inc.mm')||p.endsWith('/original-ide-contract-relay-launch.h')),false);for(const command of plan.commands)assert.equal(command.argv.some(p=>p.includes('-DYNX_ORIGINAL_NATIVE_SOURCE_RELEASE_ROWS')),false);}
 assert.equal(selected.rebuildRequired,true);assert.equal(selected.NativeBuild,false);assert.equal(selected.grant,false);assert.equal(selected.contractRelayProducerQualified,false);assert.equal(selected.prebuiltR140ModuleAllowed,false);
});
async function isolated(run){const {contract}=verifySDK332R140Source(root),temporary=mkdtempSync(join(tmpdir(),'ynx-r166-source-'));try{
 const files=new Set(['packages/wallet-auth/package.json','packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json','apps/wallet-desktop/package.json','apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs',...[...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool].map(p=>p.path)]);
 for(const p of files){const to=resolve(temporary,p);mkdirSync(dirname(to),{recursive:true});copyFileSync(resolve(root,p),to);}
 assert.equal(verifySDK332R140Source(temporary).contract.NativeInputs.length,71);const build=await import(pathToFileURL(resolve(temporary,contract.normalBuildTool.path)).href);await run(temporary,build);
 }finally{rmSync(temporary,{recursive:true,force:true});}}
test('R166 missing launch header or runtime include refuses both normal recipes rather than retaining old closure',async()=>{
 for(const name of ['original-ide-contract-relay-launch.h','original-ide-contract-relay-runtime.inc.mm'])await isolated(async(dir,build)=>{unlinkSync(resolve(dir,'packages/wallet-auth/native/'+name));assert.throws(()=>build.originalAuthNativeBuildPlan('arm64','/original/headers'),/AUTH_NATIVE_CONTRACT_RELAY_SOURCE_SELECTION_INCOMPLETE/);assert.throws(()=>build.originalIDEHelperBuildPlan('arm64'),/AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE/);});
});
test('R166 default private rows stay empty and actual Native initiator activation fence remains present',()=>{
 // Exact supplier hashes above bind these checks to the original producer;
 // no real keys/Root/current/launch/closure qualification is exercised here.
 const release=read('packages/wallet-auth/native/original-auth-identity-native-release.h').toString(),binding=read('apps/wallet-desktop/native/original-ide-contract-relay-binding.inc.mm').toString();
 assert.match(release,/#ifdef YNX_ORIGINAL_NATIVE_SOURCE_RELEASE_ROWS/);assert.match(release,/#else\s+static const std::vector<NativeSourceRelease> admitted;/);
 assert.match(binding,/YNX_CONTRACT_RELAY_INITIATOR_ROLE_BOUNDARY_UNQUALIFIED/);
 const {contract}=verifySDK332R140Source(root);assert.equal(contract.require.translationUnits,13);assert.equal(contract.require.helperTranslationUnits,11);assert.equal(contract.supplierR166.activationFence,'YNX_CONTRACT_RELAY_INITIATOR_ROLE_BOUNDARY_UNQUALIFIED');
});
