import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL,fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {readR227PublicationResultSupply,stageR227PublicationResultSupply} from './auth-r227-publication-result-supply.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function temporary(){return fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'r227-stage-PUBLIC-')))}
test('PUBLIC R227 exact50 Go custody; only inherited test Node constant changes and vector exact',()=>{
 const dir=temporary();try{
  const original=readR227PublicationResultSupply(),r=stageR227PublicationResultSupply({outputRoot:path.join(dir,'fresh'),nodeExecutable:fs.realpathSync(process.execPath)});assert.equal(r.files.length,50);assert.equal(r.originalProductionUnchanged,true);assert.equal(r.GoExecuted,false);assert.equal(r.oldFullPinned28_63FailureResolved,false);
  const changed=[];for(const p of original.files){const name=p.pin.path.slice(7),bytes=fs.readFileSync(path.join(r.outputRoot,name));if(sha(bytes)!==p.pin.sha256)changed.push(name);const output=r.files.find(x=>x.path===name);assert.equal(sha(bytes),output.sha256);}
  const expected=fs.realpathSync(process.execPath)==='/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'?[]:['internal/developerauthority/original_source_process_test.go'];assert.deepEqual(changed,expected);assert.equal(r.testOnlyNodeConstant.replacements,1);assert.equal(sha(fs.readFileSync(r.publicVector)),original.vector.sha256);
  assert.throws(()=>stageR227PublicationResultSupply({outputRoot:r.outputRoot,nodeExecutable:fs.realpathSync(process.execPath)}),{code:'EEXIST'});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('PUBLIC R227 foreign Node or symlink parent rejected before selecting output',()=>{
 const dir=temporary();try{
  assert.throws(()=>stageR227PublicationResultSupply({outputRoot:path.join(dir,'no-node'),nodeExecutable:fileURLToPath(import.meta.url)}),{code:'R227_NODE'});assert.equal(fs.existsSync(path.join(dir,'no-node')),false);
  fs.mkdirSync(path.join(dir,'actual'));fs.symlinkSync(path.join(dir,'actual'),path.join(dir,'link'));
  assert.throws(()=>stageR227PublicationResultSupply({outputRoot:path.join(dir,'link','no-output'),nodeExecutable:fs.realpathSync(process.execPath)}),{code:'R227_SYMLINK'});assert.equal(fs.existsSync(path.join(dir,'actual','no-output')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
for(const mode of ['corrupt','extra'])test('PUBLIC R227 '+mode+' isolated supplier tree rejected without modifying original',async()=>{
 const dir=temporary();try{
  const supply=fileURLToPath(new URL('./auth-r227-publication-result-supply.mjs',import.meta.url)),original=readR227PublicationResultSupply();
  fs.copyFileSync(supply,path.join(dir,'supply.mjs'));fs.mkdirSync(path.join(dir,'fixtures'));const copy=path.join(dir,'fixtures/auth-r227-go-source');fs.cpSync(original.fixture,copy,{recursive:true});
  if(mode==='corrupt')fs.appendFileSync(path.join(copy,original.files[0].pin.path),'PUBLIC change');else fs.writeFileSync(path.join(copy,'unexpected.go'),'PUBLIC');
  const mod=await import(pathToFileURL(path.join(dir,'supply.mjs')).href);assert.throws(()=>mod.stageR227PublicationResultSupply({outputRoot:path.join(dir,'blocked'),nodeExecutable:fs.realpathSync(process.execPath)}),{code:mode==='corrupt'?'R227_PIN':'R227_EXTRA'});assert.equal(fs.existsSync(path.join(dir,'blocked')),false);assert.equal(readR227PublicationResultSupply().files.length,50);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
