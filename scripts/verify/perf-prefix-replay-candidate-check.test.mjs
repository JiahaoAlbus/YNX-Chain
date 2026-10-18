import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {source,pairControllerSource,pairControllerFiles,validatePrefixSource,withFixedDiagnosticSource} from './perf-prefix-replay-candidate-check.mjs';
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

for(const file of pairControllerFiles)test('prefix candidate refuses changed paired controller '+file,()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-prefix-pair-source-'));
 try{
  execFileSync('git',['clone','--shared','--no-checkout','--quiet',root,temp],{stdio:'pipe'});
  execFileSync('git',['-C',temp,'update-ref','HEAD',pairControllerSource],{stdio:'pipe'});
  execFileSync('git',['-C',temp,'checkout',pairControllerSource,'--','internal','cmd/ynx-consensus-perf-client',...pairControllerFiles,'scripts/verify/perf-commit-validation-timing-check.mjs','scripts/verify/perf-commit-validation-timing-check.test.mjs'],{stdio:'pipe'});
  assert.equal(validatePrefixSource(temp).pairControllerSource,pairControllerSource);
  fs.appendFileSync(path.join(temp,file),'\nchanged\n');
  assert.throws(()=>validatePrefixSource(temp),/prefix pair controller source differs/);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});

for(const mutation of ['modified','missing','untracked'])test('runtime client refuses '+mutation+' source',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-runtime-client-source-'));
 try{
  execFileSync('git',['clone','--shared','--no-checkout','--quiet',root,temp],{stdio:'pipe'});
  execFileSync('git',['-C',temp,'update-ref','HEAD',pairControllerSource],{stdio:'pipe'});
  execFileSync('git',['-C',temp,'checkout',pairControllerSource,'--','internal','cmd/ynx-consensus-perf-client',...pairControllerFiles,'scripts/verify/perf-commit-validation-timing-check.mjs','scripts/verify/perf-commit-validation-timing-check.test.mjs'],{stdio:'pipe'});
  const file=path.join(temp,'cmd/ynx-consensus-perf-client/process_cpu.go');
  if(mutation==='modified')fs.appendFileSync(file,'\nchanged\n');
  if(mutation==='missing')fs.unlinkSync(file);
  if(mutation==='untracked')fs.writeFileSync(path.join(temp,'cmd/ynx-consensus-perf-client/untracked-cpu-input'),'changed');
  assert.throws(()=>validatePrefixSource(temp),/runtime client (?:source differs|input refused)/);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
