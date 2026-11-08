import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertPhysicalQAProfile} from '../scripts/qa-profile-selection.mjs';

function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wallet-qa-profile-selection-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const qaRoot=path.join(root,'QA'),profile=path.join(qaRoot,'original');
  fs.mkdirSync(profile,{recursive:true});
  return {root,qaRoot,profile,options:{qaRoot,reuseExisting:true}};
}
test('QA profile defaults to fresh; occupied custody is rejected and left unchanged',t=>{
  const f=fixture(t);assert.equal(assertPhysicalQAProfile(f.profile).reuseExisting,false);
  const sentinel=path.join(f.profile,'synthetic-custody');fs.writeFileSync(sentinel,'unchanged synthetic fixture');
  assert.throws(()=>assertPhysicalQAProfile(f.profile),/WALLET_PHYSICAL_QA_FRESH_PROFILE_REQUIRED/);
  assert.equal(fs.readFileSync(sentinel,'utf8'),'unchanged synthetic fixture');
});
test('explicit QA upgrade uses metadata only and never enumerates or reads custody',t=>{
  const f=fixture(t),sentinel=path.join(f.profile,'synthetic-custody');fs.writeFileSync(sentinel,'unchanged synthetic fixture');
  const read=fs.readFileSync,list=fs.readdirSync;
  try{
    fs.readFileSync=()=>assert.fail('upgrade must not read custody');fs.readdirSync=()=>assert.fail('upgrade must not enumerate custody');
    assert.deepEqual(assertPhysicalQAProfile(f.profile,f.options),{profile:f.profile,reuseExisting:true});
  }finally{fs.readFileSync=read;fs.readdirSync=list;}
  assert.equal(fs.readFileSync(sentinel,'utf8'),'unchanged synthetic fixture');
});
test('QA upgrade rejects a populated directory outside the dedicated QA root',t=>{
  const f=fixture(t),outside=path.join(f.root,'production');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'synthetic-custody'),'unchanged');
  assert.throws(()=>assertPhysicalQAProfile(outside,f.options),/WALLET_PHYSICAL_QA_EXISTING_PROFILE_BOUNDARY/);
});
test('QA upgrade rejects the root itself and sibling prefix lookalikes',t=>{
  const f=fixture(t),sibling=f.qaRoot+'-other';fs.mkdirSync(sibling);
  for(const selected of [f.qaRoot,sibling])assert.throws(()=>assertPhysicalQAProfile(selected,f.options),/WALLET_PHYSICAL_QA_EXISTING_PROFILE_BOUNDARY/);
});
test('QA upgrade rejects symlink profiles and symlink QA roots',t=>{
  const f=fixture(t),alias=path.join(f.qaRoot,'alias'),rootAlias=path.join(f.root,'alias-root');fs.symlinkSync(f.profile,alias);fs.symlinkSync(f.qaRoot,rootAlias);
  assert.throws(()=>assertPhysicalQAProfile(alias,f.options),/WALLET_PHYSICAL_QA_PROFILE_REQUIRED/);
  assert.throws(()=>assertPhysicalQAProfile(f.profile,{reuseExisting:true,qaRoot:rootAlias}),/WALLET_PHYSICAL_QA_EXISTING_PROFILE_BOUNDARY/);
});
test('QA profile selection rejects ambiguous paths, files and implicit reuse values',t=>{
  const f=fixture(t),file=path.join(f.qaRoot,'file');fs.writeFileSync(file,'synthetic');
  for(const selected of ['relative',f.profile+'/../original',f.profile+'\n',file])assert.throws(()=>assertPhysicalQAProfile(selected,f.options));
  for(const reuseExisting of ['1',1,null])assert.throws(()=>assertPhysicalQAProfile(f.profile,{qaRoot:f.qaRoot,reuseExisting}),/WALLET_PHYSICAL_QA_PROFILE_MODE_INVALID/);
});
