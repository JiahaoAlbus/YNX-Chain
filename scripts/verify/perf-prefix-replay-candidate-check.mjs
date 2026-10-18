// Exact source qualification for the explicit read-only prefix prototype.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withFrozenAnchor} from './perf-commit-validation-timing-check.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const source='df556b61b7748254e364a9f193c4f599db9ecb71';
const parent='9cdaeb0a64bff4d26b2e4b1558c96863d2791640';
const tree='08fd523362c16a578ae43655c30fce050671103a';
const diagnosticGuard='scripts/verify/perf-commit-validation-timing-check.mjs';
const diagnosticTests='scripts/verify/perf-commit-validation-timing-check.test.mjs';
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:16<<20,stdio:['ignore','pipe','pipe']});
const requireValue=(v,m)=>{if(!v)throw Error(m)};
export function validatePrefixSource(repo=root){
 const delta=git(repo,'diff','--binary',parent,source,'--','internal');
 requireValue(createHash('sha256').update(delta).digest('hex')==='8956aa4a464c76f853a70f64206a8e006f8bb79708e9d6016b5108126299b89d','prefix source derivation differs');
 requireValue(git(repo,'rev-parse','HEAD:internal').toString().trim()===tree,'current prefix internal tree differs');
 try{git(repo,'diff','--quiet',source,'--','internal')}catch{throw Error('current prefix source differs')}
 requireValue(!git(repo,'ls-files','--others','--exclude-standard','--','internal').toString().trim(),'untracked prefix internal input refused');
 for(const file of [diagnosticGuard,diagnosticTests])requireValue(fs.readFileSync(path.join(repo,file)).equals(git(repo,'show',parent+':'+file)),'original diagnostic guard changed');
 return {sourceCommit:source,internalTree:tree,qualification:'read-only-source-candidate',defaultFullDecodeRetained:true,goRuntimeTestsRun:false,networkImprovementMeasured:false,releaseQualified:false};
}
export function withFixedDiagnosticSource(repo,action){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-fixed-diagnostic-'));const fixture=path.join(temp,'source');
 try{
  git(repo,'clone','--shared','--no-checkout','--quiet',repo,fixture);git(fixture,'update-ref','HEAD',parent);git(fixture,'checkout',parent,'--','internal');
  const bundles=['perf-state-v13-anchor-order','perf-state-v13-seal-compact-default'].map(n=>'release/integration/candidates/'+n);
  const files=[diagnosticGuard,diagnosticTests,...['perf-v13-anchor-order','perf-v13-seal-compact-default'].flatMap(n=>['scripts/verify/'+n+'-integration-check.mjs','scripts/verify/'+n+'-integration-check.test.mjs']),...bundles.flatMap(dir=>fs.readdirSync(path.join(repo,dir)).map(n=>dir+'/'+n))];
  for(const file of files){const target=path.join(fixture,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target)}
  return action(fixture);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const candidate=validatePrefixSource();
 const originalDiagnostic=withFixedDiagnosticSource(root,fixture=>JSON.parse(execFileSync(process.execPath,[diagnosticGuard],{cwd:fixture,encoding:'utf8',timeout:15000})));
 const originalAnchor=withFrozenAnchor(root,fixture=>JSON.parse(execFileSync(process.execPath,['scripts/verify/perf-v13-anchor-order-integration-check.mjs'],{cwd:fixture,encoding:'utf8',timeout:10000})));
 console.log(JSON.stringify({candidate,originalDiagnostic,originalAnchor,interpretation:'Each original contract remains qualified only at its original source. Current read-only prefix candidate has no network or release qualification.'}));
}
