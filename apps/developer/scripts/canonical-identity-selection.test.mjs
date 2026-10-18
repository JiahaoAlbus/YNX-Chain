import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,copyFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyCanonicalIdentityAdmissionSource,verifyCanonicalNativeSourceSelection} from './package-identity-admission-source.mjs';
const inputs=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
test('normal selection validates exact SDK328 and its new complete Native, without loading Native',async()=>{
 const sdk=await verifyCanonicalIdentityAdmissionSource();
 const native=await verifyCanonicalNativeSourceSelection();
 assert.equal(sdk.sdkCommit,'3556a602d17162773e051babf0753e5118360580');assert.equal(sdk.files.length,267);
 assert.equal(sdk.dependencies.length,263);assert.equal(native.sourceLeaves,49);assert.equal(native.buildInputLeaves,47);
 assert.equal(native.nativeQualified,false);assert.equal(native.registrationAccepted,false);
 assert.equal(inputs.predecessorManifestSha256,'0a9fae0c74d03e6a62fb308595a44faf043202369a89066f7d4a111c9e49ba48');
 assert.equal(sdk.runtimeClosure.files,451);assert.equal(sdk.runtimeClosure.edges,123);
 assert.equal(inputs.nativeComponent.module.sha256,'13e192554e5d47a6ea81c808bb5429466af2ef6eb2d02f74c3715c1ec1f3a367');
 assert.ok(inputs.nativeSourceUpdates.every(x=>Object.hasOwn(x,'parentSha256')));
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
  for(const row of rows){const p=join(root,row.path);await mkdir(join(p,'..'),{recursive:true});await copyFile(join(source,row.path),p);}
  await verifyCanonicalNativeSourceSelection(root,root);
  const firstEnterHeader=join(root,'packages/wallet-auth/native/original-first-enter-selection.h'),firstEnterBytes=await readFile(firstEnterHeader);
  await rm(firstEnterHeader);await assert.rejects(verifyCanonicalNativeSourceSelection(root,root),/ENOENT/);
  await writeFile(firstEnterHeader,firstEnterBytes);
  const journalHeader=join(root,'packages/wallet-auth/native/original-host-dirfd-journal.h'),journalBytes=await readFile(journalHeader);
  await writeFile(journalHeader,Buffer.concat([journalBytes,Buffer.from('\n// changed terminal-write boundary\n')]));
  await assert.rejects(verifyCanonicalNativeSourceSelection(root,root),/source leaf differs/);
  await writeFile(journalHeader,journalBytes);
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
