import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,copyFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyCanonicalIdentityAdmissionSource,verifyCanonicalNativeSourceSelection,canonicalNativeSourcesForOwner} from './package-identity-admission-source.mjs';
import {sdk36ProductLayout} from './sdk36-product-layout.mjs';
const inputs=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
test('normal selection validates exact SDK36 and complete Main18/helper11 Native without loading Native',async()=>{
 const sdk=await verifyCanonicalIdentityAdmissionSource();
 const native=await verifyCanonicalNativeSourceSelection();
 assert.equal(sdk.sdkCommit,'55fcb9c71a5437b935a50afe76fd555a7ad76559');assert.equal(sdk.files.length,406); // 404 full-source payloads plus two original full-build inventories.
 assert.equal(sdk.dependencies.length,9177);assert.equal(native.sourceLeaves,124);assert.equal(native.buildInputLeaves,112);
 assert.equal(native.nativeQualified,false);assert.equal(native.registrationAccepted,false);
 assert.equal(inputs.predecessorManifestSha256,'46d90ca47a9e2db05a664517eaa9b9d168c2ffa7125691f38b0d5efbb56738ac');
 assert.equal(inputs.nativeSourceCommit,'d7382a07251acd33c6fdc3c92290558efe60f614');
 assert.equal(sdk.runtimeClosure.contractRelay.files,9426);assert.equal(sdk.runtimeClosure.Auth.files,566);
 assert.equal(inputs.nativeComponent.module.sha256,'72f30ebb683984ec763b0beee63943f8a4a1dcc1789b4026086dcdf8681021a9');
 assert.equal(inputs.helperComponent.registered,false);
});
test('wrong SDK bytes, missing source and a symlink are refused on the selected SDK path',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-sdk-selection-'));
 const source=process.env.YNX_DEVELOPER_CANONICAL_SDK_ROOT;
 const deps=process.env.YNX_DEVELOPER_CANONICAL_DEPENDENCY_ROOT;
 assert.ok(source&&deps,'Run source-selection controls with the original fixed supplier roots.');
 try{
  const product=sdk36ProductLayout(inputs);
  for(const row of product.files){const p=join(root,row.path);await mkdir(join(p,'..'),{recursive:true});const generated=inputs.productProjection.generated.find(g=>g.destination===row.path);const origin=generated?fileURLToPath(new URL('../../../'+generated.source,import.meta.url)):join(source,row.path);await copyFile(origin,p);}
  await verifyCanonicalIdentityAdmissionSource(root,deps);
  const path=join(root,'package.json'),original=await readFile(path);
  const old=JSON.parse(original);old.version='1.2.0';await writeFile(path,JSON.stringify(old));
  await assert.rejects(verifyCanonicalIdentityAdmissionSource(root,deps),/source leaf differs/);
  await writeFile(path,original);await rm(join(root,'src/original-ide-admission-parent-delivery.js'));
  await assert.rejects(verifyCanonicalIdentityAdmissionSource(root,deps),/ENOENT/);
  await symlink(join(source,'src/original-ide-admission-parent-delivery.js'),join(root,'src/original-ide-admission-parent-delivery.js'));
  await assert.rejects(verifyCanonicalIdentityAdmissionSource(root,deps),/source leaf differs/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('missing or changed complete Native source and receipt mutation cannot substitute SDK fragments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-native-selection-'));
 const source=process.env.YNX_DEVELOPER_CANONICAL_NATIVE_ROOT;
 assert.ok(source,'Run Native source-selection controls with the original fixed supplier root.');
 try{
  const rows=[...inputs.nativeSources,inputs.nativeComponent.receipt,inputs.nativeComponent.module,...(inputs.nativeComponent.producerEvidence?.files||[])];
  const ideSource=fileURLToPath(new URL('../../../',import.meta.url));
  for(const row of rows){const p=join(root,row.path);await mkdir(join(p,'..'),{recursive:true});await copyFile(join(canonicalNativeSourcesForOwner({nativeSources:[row]},'ide').length?ideSource:source,row.path),p);}
  await verifyCanonicalNativeSourceSelection(root,root);
  const firstEnterHeader=join(root,'packages/wallet-auth/native/original-first-enter-selection.h'),firstEnterBytes=await readFile(firstEnterHeader);
  await rm(firstEnterHeader);await assert.rejects(verifyCanonicalNativeSourceSelection(root,root),/ENOENT/);
  await writeFile(firstEnterHeader,firstEnterBytes);
  const journalHeader=join(root,'packages/wallet-auth/native/original-host-dirfd-journal.h'),journalBytes=await readFile(journalHeader);
  await writeFile(journalHeader,Buffer.concat([journalBytes,Buffer.from('\n// changed terminal-write boundary\n')]));
  await assert.rejects(verifyCanonicalNativeSourceSelection(root,root),/source leaf differs/);
  await writeFile(journalHeader,journalBytes);
  const resultHeader=join(root,'packages/wallet-auth/native/original-ide-artifact-result-data.h'),resultBytes=await readFile(resultHeader);
  await writeFile(resultHeader,Buffer.concat([resultBytes,Buffer.from('\n// changed R181 publication result binding\n')]));
  await assert.rejects(verifyCanonicalNativeSourceSelection(root,root),/source leaf differs/);
  await writeFile(resultHeader,resultBytes);
  const ownSupplier=join(root,'apps/developer/desktop/macos/original-ide-parent-supplier.mm'),ownBytes=await readFile(ownSupplier);
  await writeFile(ownSupplier,Buffer.concat([ownBytes,Buffer.from('\n// current IDE body changed\n')]));
  await assert.rejects(verifyCanonicalNativeSourceSelection(root,root),/source leaf differs/);
  await writeFile(ownSupplier,ownBytes);
  const path=join(root,'packages/wallet-auth/native/original-ide-parent-observation.mm'),original=await readFile(path);
  await writeFile(path,Buffer.concat([original,Buffer.from('\n// changed body\n')]));
  await assert.rejects(verifyCanonicalNativeSourceSelection(root),/source leaf differs/);
  await rm(path);await assert.rejects(verifyCanonicalNativeSourceSelection(root),/ENOENT/);await writeFile(path,original);
  const receipt=join(root,inputs.nativeComponent.receipt.path),record=JSON.parse(await readFile(receipt));record.sourceRoot='/PUBLIC/forged';await writeFile(receipt,JSON.stringify(record));
  await assert.rejects(verifyCanonicalNativeSourceSelection(root),/receipt bytes differ/);
 }finally{await rm(root,{recursive:true,force:true});}
});
