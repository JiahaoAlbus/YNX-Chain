// Exact opt-in prefix/runtime and bounded diagnostic shutdown source qualification.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withFrozenAnchor} from './perf-commit-validation-timing-check.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const source='ebe2733397c4ab42708efcbf4977c8eb2762bec4';
export const pairControllerSource='ebe2733397c4ab42708efcbf4977c8eb2762bec4';
export const pairControllerFiles=['scripts/loadtest/supply-linux-window.py','scripts/loadtest/test_supply_linux_window.py','.github/workflows/chain-core.yml'];
const parent='9cdaeb0a64bff4d26b2e4b1558c96863d2791640';
const tree='d59bc9b6f2c7bd486f25f973f6c974572d875033';
export const diagnosticNodeTree='8206358b1f284904285e9f5f78f7fd96eee40818';
export const runtimeClientTree='9c98da02430eed5d542b9630f877fd5c169a1c79';
const diagnosticGuard='scripts/verify/perf-commit-validation-timing-check.mjs';
const diagnosticTests='scripts/verify/perf-commit-validation-timing-check.test.mjs';
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:16<<20,stdio:['ignore','pipe','pipe']});
const requireValue=(v,m)=>{if(!v)throw Error(m)};
export function validatePrefixSource(repo=root){
 const delta=git(repo,'diff','--binary',parent,source,'--','internal');
 requireValue(createHash('sha256').update(delta).digest('hex')==='f67f67548ee1985543c638f5c60a1a11f5519a0b05e303c43ce5a426624eee63','prefix source derivation differs');
 requireValue(git(repo,'rev-parse','HEAD:internal').toString().trim()===tree,'current prefix internal tree differs');
 try{git(repo,'diff','--quiet',source,'--','internal')}catch{throw Error('current prefix source differs')}
 requireValue(!git(repo,'ls-files','--others','--exclude-standard','--','internal').toString().trim(),'untracked prefix internal input refused');
 requireValue(git(repo,'rev-parse','HEAD:cmd/ynx-consensus-perf-client').toString().trim()===runtimeClientTree,'current runtime client tree differs');
 try{git(repo,'diff','--quiet',pairControllerSource,'--','cmd/ynx-consensus-perf-client')}catch{throw Error('current runtime client source differs')}
 requireValue(!git(repo,'ls-files','--others','--exclude-standard','--','cmd/ynx-consensus-perf-client').toString().trim(),'untracked runtime client input refused');
 requireValue(git(repo,'rev-parse','HEAD:cmd/ynx-abci').toString().trim()===diagnosticNodeTree,'current diagnostic node tree differs');
 try{git(repo,'diff','--quiet',pairControllerSource,'--','cmd/ynx-abci')}catch{throw Error('current diagnostic node source differs')}
 requireValue(!git(repo,'ls-files','--others','--exclude-standard','--','cmd/ynx-abci').toString().trim(),'untracked diagnostic node input refused');
 for(const file of pairControllerFiles)requireValue(fs.readFileSync(path.join(repo,file)).equals(git(repo,'show',pairControllerSource+':'+file)),'prefix pair controller source differs: '+file);
 for(const file of [diagnosticGuard,diagnosticTests])requireValue(fs.readFileSync(path.join(repo,file)).equals(git(repo,'show',parent+':'+file)),'original diagnostic guard changed');
 return {sourceCommit:source,pairControllerSource,pairControllerFiles,runtimeClientTree,diagnosticNodeTree,internalTree:tree,qualification:'source-candidate-with-native-private-clone-eight-submitters-and-private-suffix-setup',defaultFullDecodeRetained:true,goRuntimeTestsRun:false,networkImprovementMeasured:false,releaseQualified:false};
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
