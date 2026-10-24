import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,copyFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyCanonicalIdentityAdmissionSource,verifyCanonicalNativeSourceSelection,canonicalNativeSourcesForOwner} from './package-identity-admission-source.mjs';
const inputs=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
test('normal selection validates exact SDK20 and complete R181 Native without loading Native',async()=>{
 const sdk=await verifyCanonicalIdentityAdmissionSource();
 const native=await verifyCanonicalNativeSourceSelection();
 assert.equal(sdk.sdkCommit,'b330fffdfe5ceda04ff665f396e46c6c85e8bb74');assert.equal(sdk.files.length,309); // 307 raw SDK payloads and two same-version runtime inventories.
 assert.equal(sdk.dependencies.length,9123);assert.equal(native.sourceLeaves,89);assert.equal(native.buildInputLeaves,77);
 assert.equal(native.nativeQualified,false);assert.equal(native.registrationAccepted,false);
 assert.equal(inputs.predecessorManifestSha256,'f88f98e62c95b739f3a09706685245416c53d83f6735e3b94065c1f3013d98c1');
 assert.equal(inputs.nativeSourceCommit,'b330fffdfe5ceda04ff665f396e46c6c85e8bb74');
 assert.equal(sdk.runtimeClosure.contractRelay.files,9335);assert.equal(sdk.runtimeClosure.Auth.edges,134);
 assert.equal(inputs.nativeComponent.module.sha256,'f7e87a618198a0e4aaa5f5724e4c9d0a560226e60f79f61c59b7fb78a2be60e2');
 assert.equal(inputs.helperComponent.registered,false);
});
test('wrong SDK bytes, missing source and a symlink are refused on the selected SDK path',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-sdk-selection-'));
 const source=process.env.YNX_DEVELOPER_CANONICAL_SDK_ROOT;
 const deps=process.env.YNX_DEVELOPER_CANONICAL_DEPENDENCY_ROOT;
 assert.ok(source&&deps,'Run source-selection controls with the original fixed supplier roots.');
 try{
  for(const row of inputs.files){const p=join(root,row.path);await mkdir(join(p,'..'),{recursive:true});await copyFile(join(source,row.path),p);}
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
  const rows=[...inputs.nativeSources,inputs.nativeComponent.receipt,inputs.nativeComponent.module];
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
