import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const own='release/integration/candidates/perf-state-v13-anchor-order';
const parent='release/integration/candidates/perf-state-v13-seal-compact-default';
const map=JSON.parse(fs.readFileSync(path.join(root,own,'source-map.json')));
const guard='scripts/verify/perf-v13-anchor-order-integration-check.mjs';
function fixedFixture(destination){
 execFileSync('git',['clone','--shared','--no-checkout','--quiet',root,destination],{stdio:'pipe',timeout:10000});
 execFileSync('git',['-C',destination,'update-ref','HEAD',map.sourceCommit],{stdio:'pipe'});
 execFileSync('git',['-C',destination,'checkout',map.sourceCommit,'--','internal',...Object.keys(map.files)],{stdio:'pipe'});
 const supplierGuards=['scripts/verify/perf-v13-seal-compact-default-integration-check.mjs','scripts/verify/perf-v13-seal-compact-default-integration-check.test.mjs'];
 const files=[...fs.readdirSync(path.join(root,own)).map(n=>own+'/'+n),...fs.readdirSync(path.join(root,parent)).map(n=>parent+'/'+n),guard,...supplierGuards];
 for(const file of files){const target=path.join(destination,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target)}
}
for(const mutation of ['runtime','omitted-benchmark','untracked-internal','manifest','evidence','parent-guard','parent-contract'])test('normal anchor guard rejects '+mutation,()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-anchor-guard-'));
 const fixture=path.join(temp,'source');
 try{
  fixedFixture(fixture);
  if(mutation==='runtime')fs.appendFileSync(path.join(fixture,'internal/consensus/state.go'),'\nchanged\n');
  if(mutation==='omitted-benchmark')fs.unlinkSync(path.join(fixture,'internal/consensus/state_anchor_cost_test.go'));
  if(mutation==='untracked-internal')fs.writeFileSync(path.join(fixture,'internal/consensus/extra-anchor-input.txt'),'new');
  if(mutation==='manifest')fs.appendFileSync(path.join(fixture,own,'SHA256SUMS'),'\nchanged');
  if(mutation==='evidence')fs.appendFileSync(path.join(fixture,own,'validation-cost-actual.json'),'\nchanged');
  if(mutation==='parent-guard')fs.appendFileSync(path.join(fixture,supplierGuardPath()),'\nchanged');
  if(mutation==='parent-contract')fs.appendFileSync(path.join(fixture,parent,'chain-core-contract.json'),'\nchanged');
  const result=spawnSync(process.execPath,[path.join(fixture,guard)],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stderr,mutation==='runtime'?/current anchor source differs/:mutation==='omitted-benchmark'?/ENOENT/:mutation==='untracked-internal'?/untracked internal input refused/:mutation==='manifest'?/bundle manifest differs/:mutation==='evidence'?/candidate file differs/:/parent candidate or guard changed/);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
function supplierGuardPath(){return 'scripts/verify/perf-v13-seal-compact-default-integration-check.mjs'}
