import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as packager from './package-identity-admission-source.mjs';
test('canonical package retains original SDK relative topology and detects changed bytes', async () => {
  assert.equal(typeof packager.copyCanonicalIdentityAdmissionSource,'function');
  const temp=await mkdtemp(join(tmpdir(),'ynx-canonical-identity-中文 % # '));
  try {
    const code=join(temp,'Fixture.app/Contents/Resources/code'); await mkdir(code,{recursive:true});
    const receipt=await packager.copyCanonicalIdentityAdmissionSource(code);
    assert.equal(receipt.nativeModuleCopied,false);
    const sdk=join(code,'packages/wallet-auth');
    assert.equal((await stat(join(sdk,'src/original-ide-admission-parent-delivery.js'))).isFile(),true);
    const loadPath=new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',pathToFileURL(join(sdk,'src/original-ide-admission-parent-delivery.js')));
    assert.equal(fileURLToPath(loadPath),join(code,'apps/wallet-desktop/native/original-auth-identity.node'));
    const native=await packager.copyCanonicalNativeModule(code);
    assert.equal(native.registrationAccepted,false);
    assert.equal(native.sourcePinsVerified,true);
    await assert.rejects(packager.copyCanonicalNativeModule(code),/EEXIST/);
    await packager.verifyCanonicalIdentityAdmissionSource(sdk);
    await mkdir(join(sdk,'unexpected-empty'));
    await assert.rejects(packager.verifyCanonicalIdentityAdmissionSource(sdk),/inventory differs/);
    await rm(join(sdk,'unexpected-empty'),{recursive:true});
    const leaf=join(sdk,'src/original-ide-admission-parent-delivery.js');
    await writeFile(leaf,(await readFile(leaf,'utf8'))+'\n// changed\n');
    await assert.rejects(packager.verifyCanonicalIdentityAdmissionSource(sdk),/differs/);
    await assert.rejects(packager.copyCanonicalIdentityAdmissionSource(code),/EEXIST/);
  } finally {await rm(temp,{recursive:true,force:true});}
});
test('canonical package rejects a relocated SDK destination',async()=>{
  assert.equal(typeof packager.copyCanonicalIdentityAdmissionSource,'function');
  await assert.rejects(packager.copyCanonicalIdentityAdmissionSource('/tmp/vendor/identity-admission'),/canonical/);
});

test('PUBLIC build receipt validation requires the exact selected Native closure and never upgrades qualification', async()=>{
  const inputs=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
  const sourceNames=['apps/wallet-desktop/native/original-auth-identity-node.mm',
    'packages/wallet-auth/native/original-auth-identity-joint-owner.mm',
    'packages/wallet-auth/native/original-auth-identity-source-authority.mm',
    'packages/wallet-auth/native/original-ide-parent-source-binding.mm',
    'packages/wallet-auth/native/original-ide-parent-kernel.mm',
    'packages/wallet-auth/native/original-ide-parent-node.mm'];
  for(const path of ['packages/wallet-auth/native/original-ide-wallet-identity-source.mm','packages/wallet-auth/native/original-ide-wallet-peer-launch.mm'])
    if(inputs.nativeBuildInputs.some(row=>row.path===path))sourceNames.push(path);
  if(inputs.requiredBuild?.nodeTU===13)sourceNames.push(...['original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-ide-publication-artifact.mm','original-ide-contract-relay-owner.mm'].map(name=>'packages/wallet-auth/native/'+name));
  const record={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,
    headerVersion:'22.13.1',minimumSystemVersion:'13.0',appSigned:false,nativeQualified:false,
    registrationAccepted:false,readbackOnly:true,commandsKind:'normal-build-plan',architectures:['arm64'],sourceRoot:'/PUBLIC/source',existingComponentEvidence:{path:'/PUBLIC/actual-compile-evidence.json',bytes:10,sha256:'3'.repeat(64)},
    commands:[{tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-DNAPI_VERSION=8','-mmacosx-version-min=13.0','-lbsm','Foundation','Security',...(sourceNames.length>=8?['-framework','AppKit']:[]),...(sourceNames.length===13?['-framework','ServiceManagement']:[]),...sourceNames.map(p=>'/PUBLIC/source/'+p)]}],
    relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},
    headerRoot:'/PUBLIC/headers',headers:['node_api.h','node_api_types.h','js_native_api.h','js_native_api_types.h','node_version.h'].map(relative=>{const pin=inputs.node22HeaderPins.find(x=>x.path===relative);return{relative,bytes:pin.bytes,sha256:pin.sha256};}),
    inputFiles:inputs.nativeBuildInputs.map(pin=>({relative:pin.path,bytes:pin.bytes,sha256:pin.sha256})),
    output:{relative:inputs.nativeComponent.module.path,bytes:inputs.nativeComponent.module.bytes,sha256:inputs.nativeComponent.module.sha256}};
  assert.equal(packager.validateCanonicalNativeBuildReceipt(record,inputs,'arm64'),record);
  for(const change of [r=>r.nativeQualified=true,r=>r.inputFiles.pop(),r=>r.inputFiles[0].sha256='1'.repeat(64),
    r=>r.output.relative='vendor/identity-admission/original-auth-identity.node',r=>r.relativeBases.inputFiles='app-root',r=>r.architectures=['x64'],r=>r.headers[0].sha256='2'.repeat(64),r=>r.commands[0].argv.pop(),r=>r.commandsKind='executed-normal-build',r=>delete r.existingComponentEvidence,
    r=>r.inputFiles=r.inputFiles.filter(pin=>!pin.relative.endsWith('/original-ide-parent-transport.h')),
    r=>r.inputFiles=r.inputFiles.filter(pin=>!pin.relative.endsWith('/original-source-verifier-io.h'))]){
    const altered=structuredClone(record);change(altered);
    assert.throws(()=>packager.validateCanonicalNativeBuildReceipt(altered,inputs,'arm64'),/differs|required/);
  }
});
