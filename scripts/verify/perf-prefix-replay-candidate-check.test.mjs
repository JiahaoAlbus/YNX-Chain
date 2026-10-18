import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {source,validatePrefixSource,withFixedDiagnosticSource} from './perf-prefix-replay-candidate-check.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('exact prefix source has no network or release qualification',()=>{const actual=validatePrefixSource();assert.equal(actual.sourceCommit,source);assert.equal(actual.defaultFullDecodeRetained,true);assert.equal(actual.networkImprovementMeasured,false);assert.equal(actual.releaseQualified,false)});
test('all original diagnostic and anchor tests run at their fixed source',()=>{
 withFixedDiagnosticSource(root,fixture=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const raw=execFileSync(process.execPath,['--test','scripts/verify/perf-commit-validation-timing-check.test.mjs'],{cwd:fixture,env,encoding:'utf8',timeout:45000});
  assert.match(raw,/(?:fail 0|# fail 0)/);console.log(raw.trim());
 });
});
for(const mutation of ['modified','missing','untracked'])test('prefix candidate refuses '+mutation+' internal source',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-prefix-source-'));
 try{
  execFileSync('git',['clone','--shared','--no-checkout','--quiet',root,temp],{stdio:'pipe'});
  execFileSync('git',['-C',temp,'update-ref','HEAD',source],{stdio:'pipe'});execFileSync('git',['-C',temp,'checkout',source,'--','internal'],{stdio:'pipe'});
  const f=path.join(temp,'internal/consensus/block_journal_prefix.go');
  if(mutation==='modified')fs.appendFileSync(f,'\nchanged\n');if(mutation==='missing')fs.unlinkSync(f);if(mutation==='untracked')fs.writeFileSync(path.join(temp,'internal/new-prefix-input'),'new');
  assert.throws(()=>validatePrefixSource(temp),/prefix (?:source differs|internal input refused)/);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
