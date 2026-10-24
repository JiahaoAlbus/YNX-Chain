import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {readR232CatalogSupply,stageR232CatalogSupply} from './auth-r232-catalog-supply.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('PUBLIC R232 one new Go leaf composes54 with original53 bytes and one test Node adaptation',()=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'r232-PUBLIC-')));
 try{
  const input=readR232CatalogSupply(),node=fs.realpathSync(process.execPath),r=stageR232CatalogSupply({outputRoot:path.join(dir,'fresh'),nodeExecutable:node});
  assert.equal(input.baseline.files.length,53);assert.equal(r.files.length,54);assert.equal(r.delta.length,1);assert.equal(r.originalR231BytesUnchanged,true);assert.equal(r.testOnlyNodeConstant.replacements,1);assert.equal(r.GoExecuted,false);assert.equal(r.oldFullPinned28_63FailureResolved,false);
  const old='const fixtureNode = "/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"';
  for(const p of input.baseline.files){const relative=p.pin.path.slice(7),out=fs.readFileSync(path.join(r.outputRoot,relative));let expected=p.raw;if(relative==='internal/developerauthority/original_source_process_test.go'){const text=p.raw.toString('utf8');assert.equal(text.split(old).length,2);expected=Buffer.from(text.replace(old,'const fixtureNode = '+JSON.stringify(node)));}assert.deepEqual(out,expected);}
  assert.equal(hash(fs.readFileSync(path.join(r.outputRoot,input.delta.pin.path.slice(7)))),input.delta.pin.sha256);
  assert.throws(()=>stageR232CatalogSupply({outputRoot:r.outputRoot,nodeExecutable:node}),{code:'EEXIST'});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('PUBLIC R232 corrupt delta refuses before baseline output selection and leaves original supply unchanged',async()=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'r232-corrupt-PUBLIC-')));
 try{
  const input=readR232CatalogSupply(),original=fileURLToPath(new URL('./auth-r232-catalog-supply.mjs',import.meta.url)),baseline=pathToFileURL(fileURLToPath(new URL('./auth-r231-runtime-supply.mjs',import.meta.url))).href;
  const text=fs.readFileSync(original,'utf8').replace("'./auth-r231-runtime-supply.mjs'",JSON.stringify(baseline));fs.writeFileSync(path.join(dir,'supply.mjs'),text);
  const copy=path.join(dir,'fixtures/auth-r232-go-source');fs.mkdirSync(path.dirname(copy));fs.cpSync(input.fixture,copy,{recursive:true});fs.appendFileSync(path.join(copy,input.delta.pin.path),'PUBLIC corruption');
  const module=await import(pathToFileURL(path.join(dir,'supply.mjs')).href),outputRoot=path.join(dir,'never-selected');assert.throws(()=>module.stageR232CatalogSupply({outputRoot,nodeExecutable:fs.realpathSync(process.execPath)}),{code:'R232_PIN'});assert.equal(fs.existsSync(outputRoot),false);assert.equal(readR232CatalogSupply().baseline.files.length,53);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
