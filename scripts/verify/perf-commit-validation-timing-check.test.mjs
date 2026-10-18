import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateTimingSource,withFrozenAnchor,source} from './perf-commit-validation-timing-check.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('current diagnostic source derives exactly from frozen anchor without new release claims',()=>{
 const actual=validateTimingSource();assert.equal(actual.sourceCommit,source);assert.equal(actual.releaseQualified,false);assert.equal(actual.networkPerformanceQualified,false);
});
test('all unchanged original anchor contract tests run against their original frozen source',()=>{
 withFrozenAnchor(root,fixture=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const originalGuard=JSON.parse(execFileSync(process.execPath,["scripts/verify/perf-v13-anchor-order-integration-check.mjs"],{cwd:fixture,env,encoding:"utf8",timeout:10000}));
  assert.equal(originalGuard.sourceCommit,"b3c0b8b2e9349ec73b4aa8d0e613ed7e517582d3");
  assert.equal(originalGuard.normalMatchingCIVerified,false);
  const raw=execFileSync(process.execPath,['--test','release/integration/candidates/perf-state-v13-anchor-order/check.test.mjs'],{cwd:fixture,env,encoding:'utf8',timeout:30000});
  assert.match(raw,/(?:fail 0|# fail 0)/);console.log(raw.trim());
 });
});
for(const mutation of ['modified','untracked','missing'])test('diagnostic descendant refuses '+mutation+' internal input',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-timing-source-'));
 try{
  execFileSync('git',['clone','--shared','--no-checkout','--quiet',root,temp],{stdio:'pipe'});
  execFileSync('git',['-C',temp,'update-ref','HEAD',source],{stdio:'pipe'});
  execFileSync('git',['-C',temp,'checkout',source,'--','internal'],{stdio:'pipe'});
  const p=path.join(temp,'internal/consensus/state.go');
  if(mutation==='modified')fs.appendFileSync(p,'\nchanged\n');
  if(mutation==='untracked')fs.writeFileSync(path.join(temp,'internal/extra-timing-input'),'changed');
  if(mutation==='missing')fs.unlinkSync(p);
  assert.throws(()=>validateTimingSource(temp),/diagnostic (?:source differs|internal input refused)/);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
