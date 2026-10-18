import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bundle='release/integration/candidates/perf-state-v13-seal-guarded';
const map=JSON.parse(fs.readFileSync(path.join(root,bundle,'source-map.json'),'utf8'));
function copyFixedInputs(destination){
 const mapped=new Set([...Object.keys(map.files),...Object.keys(map.kernelDerivation.kernelFiles),...Object.keys(map.sealWitnessDerivation.files)]);
 const files=[...mapped,...fs.readdirSync(path.join(root,bundle)).map(n=>path.join(bundle,n)),'scripts/verify/perf-v13-seal-guarded-integration-check.mjs'];
 for(const f of files){
  const out=path.join(destination,f);fs.mkdirSync(path.dirname(out),{recursive:true});
  // Negative controls must begin with the fixed candidate's source, even
  // while the owning runtime is developing a separately pinned derivative.
  if(mapped.has(f))fs.writeFileSync(out,execFileSync('git',['-C',root,'show',`${map.sourceCommit}:${f}`]));
  else fs.copyFileSync(path.join(root,f),out);
 }
}
for(const kind of ['current-runtime','bundle-manifest'])test('fixed V13 seal-guarded consumer rejects '+kind+' substitution before immutable-source acceptance',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-perf-v13-input-'));
 try{
  copyFixedInputs(tmp);
  const target=kind==='current-runtime'?'internal/consensus/state.go':path.join(bundle,'SHA256SUMS');
  fs.appendFileSync(path.join(tmp,target),'\nsubstituted input\n');
  const r=spawnSync(process.execPath,[path.join(tmp,'scripts/verify/perf-v13-seal-guarded-integration-check.mjs')],{encoding:'utf8',timeout:5000});
  assert.equal(r.status,1,r.stderr);
  assert.match(r.stderr,kind==='current-runtime'?/current runtime\/source differs from fixed V13 seal-guarded candidate: internal\/consensus\/state.go/:/fixed V13 seal-guarded bundle manifest differs/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('fixed V13 seal-guarded consumer refuses additional internal input outside the23 mapped files',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-perf-v13-untracked-'));
 const fixture=path.join(parent,'fixed-source');
 try{
  // A temporary shared clone reads immutable objects without altering the
  // original checkout. Only the fixed internal tree/mapped inputs are checked
  // out; this is a source rejection fixture, never a substitute runtime.
  execFileSync('git',['clone','--shared','--no-checkout','--quiet',root,fixture],{stdio:'pipe'});
  execFileSync('git',['-C',fixture,'update-ref','HEAD',map.sourceCommit],{stdio:'pipe'});
  execFileSync('git',['-C',fixture,'checkout',map.sourceCommit,'--','internal',...Object.keys(map.files)],{stdio:'pipe'});
  copyFixedInputs(fixture);
  const own=fs.mkdtempSync(path.join(fixture,'internal/consensus/.perf-v13-input-'));
  fs.writeFileSync(path.join(own,'unmeasured.txt'),'untracked source fixture');
  const r=spawnSync(process.execPath,[path.join(fixture,'scripts/verify/perf-v13-seal-guarded-integration-check.mjs')],{encoding:'utf8',timeout:5000});
  assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/untracked fixed internal inputs cannot qualify V13 candidate/);
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});

for(const kind of ['modified','omitted'])test('fixed V13 seal-guarded consumer rejects '+kind+' new kernel leaf before immutable-source acceptance',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-perf-v13-kernel-'));
 try{
  copyFixedInputs(tmp);
  const target=path.join(tmp,'internal/consensus/state_hash_json.go');
  if(kind==='omitted')fs.unlinkSync(target);else fs.appendFileSync(target,'\nsubstituted kernel input\n');
  const r=spawnSync(process.execPath,[path.join(tmp,'scripts/verify/perf-v13-seal-guarded-integration-check.mjs')],{encoding:'utf8',timeout:5000});
  assert.equal(r.status,1,r.stderr);
  assert.match(r.stderr,kind==='omitted'?/ENOENT.*state_hash_json\.go/s:/current.*(?:kernel|source).*differs.*state_hash_json\.go/s);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

for(const kind of ['modified','omitted'])test('fixed V13 seal-guarded consumer rejects '+kind+' seal guard leaf before immutable-source acceptance',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-perf-v13-seal-'));
 try{
  copyFixedInputs(tmp);
  const target=path.join(tmp,'internal/consensus/state_seal_guard.go');
  if(kind==='omitted')fs.unlinkSync(target);else fs.appendFileSync(target,'\nsubstituted seal guard input\n');
  const r=spawnSync(process.execPath,[path.join(tmp,'scripts/verify/perf-v13-seal-guarded-integration-check.mjs')],{encoding:'utf8',timeout:5000});
  assert.equal(r.status,1,r.stderr);
  assert.match(r.stderr,kind==='omitted'?/ENOENT.*state_seal_guard\.go/s:/current.*(?:seal|source).*differs.*state_seal_guard\.go/s);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
