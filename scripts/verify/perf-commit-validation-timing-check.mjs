// Diagnostic-only descendant qualification. Frozen release claims stay frozen.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const source='3982e7c0ad3b952fc1b1db39c65a3a7788092cc7';
const parent='b3c0b8b2e9349ec73b4aa8d0e613ed7e517582d3';
const tree='152c0501404b7da2c3826ff746c0ed48a521e998';
const own='release/integration/candidates/perf-state-v13-anchor-order';
const supplier='release/integration/candidates/perf-state-v13-seal-compact-default';
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:16<<20,stdio:['ignore','pipe','pipe']});
const requireValue=(v,m)=>{if(!v)throw Error(m)};
export function validateTimingSource(repo=root){
 const delta=git(repo,'diff','--binary',parent,source,'--','internal');
 requireValue(createHash('sha256').update(delta).digest('hex')==='115f12bc31fa2845afe1c16cd9def89722dc31c184d32cde5796d1db94b2790e','diagnostic source derivation differs');
 requireValue(git(repo,'rev-parse','HEAD:internal').toString().trim()===tree,'current diagnostic internal tree differs');
 try{git(repo,'diff','--quiet',source,'--','internal')}catch{throw Error('current diagnostic source differs')}
 requireValue(!git(repo,'ls-files','--others','--exclude-standard','--','internal').toString().trim(),'untracked diagnostic internal input refused');
 return {sourceCommit:source,internalTree:tree,diagnosticsOnly:true,goRuntimeTestsRun:false,networkPerformanceQualified:false,releaseQualified:false};
}
export function withFrozenAnchor(repo,action){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-frozen-anchor-'));
 const fixture=path.join(temp,'source');
 try{
  git(repo,'clone','--shared','--no-checkout','--quiet',repo,fixture);
  git(fixture,'update-ref','HEAD',parent);
  const map=JSON.parse(fs.readFileSync(path.join(repo,own,'source-map.json')));
  git(fixture,'checkout',parent,'--','internal',...Object.keys(map.files));
  const guards=['scripts/verify/perf-v13-anchor-order-integration-check.mjs','scripts/verify/perf-v13-anchor-order-integration-check.test.mjs','scripts/verify/perf-v13-seal-compact-default-integration-check.mjs','scripts/verify/perf-v13-seal-compact-default-integration-check.test.mjs'];
  const files=[...guards,...[own,supplier].flatMap(dir=>fs.readdirSync(path.join(repo,dir)).map(n=>dir+'/'+n))];
  for(const file of files){const target=path.join(fixture,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target)}
  return action(fixture);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const diagnostic=validateTimingSource();
 const frozenAnchor=withFrozenAnchor(root,fixture=>JSON.parse(execFileSync(process.execPath,['scripts/verify/perf-v13-anchor-order-integration-check.mjs'],{cwd:fixture,encoding:'utf8',timeout:10000})));
 console.log(JSON.stringify({diagnostic,frozenAnchor,interpretation:'Frozen candidate is verified only at its original source; current descendant is diagnostics-only and has no release or network-performance qualification.'}));
}
