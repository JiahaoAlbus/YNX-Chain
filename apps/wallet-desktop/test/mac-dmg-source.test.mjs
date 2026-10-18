import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,symlink,readlink,readdir,unlink,rm,chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {withMacDmgSource} from '../scripts/mac-dmg-source.mjs';

// Real small filesystem fixtures, not a built/signed App or a real DMG.
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'wallet-dmg-source-test-'));
 const output=path.join(root,'mac-arm64'),app=path.join(output,'QA Wallet.app'),executable=path.join(app,'Contents/MacOS/QA');
 await mkdir(path.dirname(executable),{recursive:true});await writeFile(executable,'PUBLIC_TEST_BYTES');await chmod(executable,0o751);
 await mkdir(path.join(app,'Contents/_CodeSignature'));await writeFile(path.join(app,'Contents/_CodeSignature/CodeResources'),'PUBLIC_SIGNATURE_FIXTURE_NOT_REAL');
 await symlink('MacOS/QA',path.join(app,'Contents/current'));
 return {root,output,app,executable,close:()=>rm(root,{recursive:true,force:true})};
}
test('normal DMG source uses the original App inode and preserves bytes, modes and symlinks without a second App',{skip:process.platform==='win32'},async()=>{
 const f=await fixture();try{
  const before=await lstat(f.executable,{bigint:true}),app=await lstat(f.app,{bigint:true});
  const result=await withMacDmgSource(f.app,async source=>{
   assert.equal(source,f.output);assert.deepEqual((await readdir(source)).sort(),['Applications','QA Wallet.app']);
   assert.equal(await readlink(path.join(source,'Applications')),'/Applications');
   const same=await lstat(f.app,{bigint:true});assert.equal(same.ino,app.ino);assert.equal(same.dev,app.dev);
   assert.equal((await lstat(f.executable,{bigint:true})).ino,before.ino);return 'IMAGE_CALLBACK_RESULT';
  });
  assert.equal(result,'IMAGE_CALLBACK_RESULT');assert.deepEqual(await readdir(f.output),['QA Wallet.app']);
  assert.equal(await readFile(f.executable,'utf8'),'PUBLIC_TEST_BYTES');assert.equal((await lstat(f.executable,{bigint:true})).mode,before.mode);
  assert.equal(await readlink(path.join(f.app,'Contents/current')),'MacOS/QA');
  assert.equal(await readFile(path.join(f.app,'Contents/_CodeSignature/CodeResources'),'utf8'),'PUBLIC_SIGNATURE_FIXTURE_NOT_REAL');
 }finally{await f.close();}
});
test('image failures including falsy causes keep the App and exact cause while removing only the new link',{skip:process.platform==='win32'},async()=>{
 for(const cause of [Error('PUBLIC_IMAGE_ERROR'),undefined,false]){const f=await fixture();try{
  await assert.rejects(withMacDmgSource(f.app,async()=>{throw cause;}),e=>e===cause);
  assert.deepEqual(await readdir(f.output),['QA Wallet.app']);assert.equal(await readFile(f.executable,'utf8'),'PUBLIC_TEST_BYTES');
 }finally{await f.close();}}
});
test('pre-existing link or foreign output refuses before image creation without deleting anything',{skip:process.platform==='win32'},async()=>{
 for(const mode of ['link','file']){const f=await fixture();try{
  const foreign=path.join(f.output,mode==='link'?'Applications':'unrelated');
  if(mode==='link')await symlink('/Applications',foreign);else await writeFile(foreign,'PRESERVE');
  let calls=0;await assert.rejects(withMacDmgSource(f.app,async()=>{calls++;}),{message:'DMG_SOURCE_NOT_EXCLUSIVE'});assert.equal(calls,0);
  if(mode==='link')assert.equal(await readlink(foreign),'/Applications');else assert.equal(await readFile(foreign,'utf8'),'PRESERVE');
 }finally{await f.close();}}
});
test('changed cleanup link is retained, independently from the original image failure',{skip:process.platform==='win32'},async()=>{
 const f=await fixture(),first=Error('PUBLIC_IMAGE_FIRST_CAUSE');try{
  await assert.rejects(withMacDmgSource(f.app,async()=>{
   const link=path.join(f.output,'Applications');await unlink(link);await symlink('/PUBLIC_OTHER_TARGET',link);throw first;
  }),error=>error instanceof AggregateError&&error.cause===first&&error.errors[0]===first&&error.errors[1].message==='DMG_SOURCE_LINK_CHANGED');
  assert.equal(await readlink(path.join(f.output,'Applications')),'/PUBLIC_OTHER_TARGET');assert.equal(await readFile(f.executable,'utf8'),'PUBLIC_TEST_BYTES');
 }finally{await f.close();}
});
test('normal Mac entry uses the checked original output source rather than copying the App',async()=>{
 const source=await readFile(new URL('../scripts/build-mac.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('withMacDmgSource(appDir,'));
 assert.equal(source.includes('"/usr/bin/ditto"'),false);
 assert.equal(source.includes('mkdtemp('),false);
});
