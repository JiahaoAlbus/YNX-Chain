import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL,fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {readR231RuntimeSupply,stageR231RuntimeSupply} from './auth-r231-runtime-supply.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function temporary(){return fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'r231-stage-PUBLIC-')))}
test('PUBLIC R231 exact53 delta-only fixture Go custody; only inherited test Node constant changes; no Go/vector execution',()=>{
 const dir=temporary();try{
  const original=readR231RuntimeSupply(),r=stageR231RuntimeSupply({outputRoot:path.join(dir,'fresh'),nodeExecutable:fs.realpathSync(process.execPath)});assert.equal(r.files.length,53);assert.equal(r.originalProductionUnchanged,true);assert.equal(original.delta.length,4);assert.equal(r.delta.filter(p=>p.parent!==null).length,3);assert.equal(r.delta.filter(p=>p.parent===null).length,1);assert.equal(r.baselineSupplier.sha256,'d98c6681917487d57e2a3acb7e62d91cf0331dec0f46957992c09050e6b30b3a');assert.equal(r.GoExecuted,false);assert.equal(r.oldFullPinned28_63FailureResolved,false);
  const changed=[];for(const p of original.files){const name=p.pin.path.slice(7),bytes=fs.readFileSync(path.join(r.outputRoot,name));if(sha(bytes)!==p.pin.sha256)changed.push(name);const output=r.files.find(x=>x.path===name);assert.equal(sha(bytes),output.sha256);}
  const expected=fs.realpathSync(process.execPath)==='/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'?[]:['internal/developerauthority/original_source_process_test.go'];assert.deepEqual(changed,expected);assert.equal(r.testOnlyNodeConstant.replacements,1);assert.equal(Object.hasOwn(r,'publicVector'),false);
  assert.throws(()=>stageR231RuntimeSupply({outputRoot:r.outputRoot,nodeExecutable:fs.realpathSync(process.execPath)}),{code:'EEXIST'});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('PUBLIC R231 foreign Node or symlink parent rejected before selecting output',()=>{
 const dir=temporary();try{
  assert.throws(()=>stageR231RuntimeSupply({outputRoot:path.join(dir,'no-node'),nodeExecutable:fileURLToPath(import.meta.url)}),{code:'R231_NODE'});assert.equal(fs.existsSync(path.join(dir,'no-node')),false);
  fs.mkdirSync(path.join(dir,'actual'));fs.symlinkSync(path.join(dir,'actual'),path.join(dir,'link'));
  assert.throws(()=>stageR231RuntimeSupply({outputRoot:path.join(dir,'link','no-output'),nodeExecutable:fs.realpathSync(process.execPath)}),{code:'R231_SYMLINK'});assert.equal(fs.existsSync(path.join(dir,'actual','no-output')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
for(const mode of ['corrupt','extra'])test('PUBLIC R231 '+mode+' isolated supplier tree rejected without modifying original',async()=>{
 const dir=temporary();try{
  const supply=fileURLToPath(new URL('./auth-r231-runtime-supply.mjs',import.meta.url)),original=readR231RuntimeSupply();
  fs.copyFileSync(supply,path.join(dir,'supply.mjs'));const baseline=fileURLToPath(new URL('./auth-r229-factory-supply.mjs',import.meta.url));fs.copyFileSync(baseline,path.join(dir,'auth-r229-factory-supply.mjs'));fs.mkdirSync(path.join(dir,'fixtures'));fs.cpSync(path.dirname(baseline)+'/fixtures/auth-r229-go-source',path.join(dir,'fixtures/auth-r229-go-source'),{recursive:true});const copy=path.join(dir,'fixtures/auth-r231-go-source');fs.cpSync(original.fixture,copy,{recursive:true});
  if(mode==='corrupt')fs.appendFileSync(path.join(copy,original.delta[0].path),'PUBLIC change');else fs.writeFileSync(path.join(copy,'unexpected.go'),'PUBLIC');
  const mod=await import(pathToFileURL(path.join(dir,'supply.mjs')).href);assert.throws(()=>mod.stageR231RuntimeSupply({outputRoot:path.join(dir,'blocked'),nodeExecutable:fs.realpathSync(process.execPath)}),{code:mode==='corrupt'?'R231_PIN':'R231_EXTRA'});assert.equal(fs.existsSync(path.join(dir,'blocked')),false);assert.equal(readR231RuntimeSupply().files.length,53);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
