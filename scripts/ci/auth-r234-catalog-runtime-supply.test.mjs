import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';
import {readR234CatalogRuntimeSupply,stageR234CatalogRuntimeSupply} from './auth-r234-catalog-runtime-supply.mjs';
test('PUBLIC R234 two original Go additions compose56 without changing prepared54 or repeating Node adaptation',()=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'r234-PUBLIC-')));
 try{
  const input=readR234CatalogRuntimeSupply(),node=fs.realpathSync(process.execPath),r=stageR234CatalogRuntimeSupply({outputRoot:path.join(dir,'fresh'),nodeExecutable:node}),base=[...input.baseline.baseline.files,input.baseline.delta];
  assert.equal(base.length,54);assert.equal(r.files.length,56);assert.equal(r.delta.length,2);assert.equal(r.originalR232PreparedBytesUnchanged,true);assert.equal(r.testOnlyNodeConstant.replacements,1);assert.equal(r.GoExecuted,false);assert.equal(r.actualServiceMounted,false);assert.equal(r.Root,false);
  const old='const fixtureNode = "/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"';
  for(const p of base){const relative=p.pin.path.slice(7);let expected=p.raw;if(relative==='internal/developerauthority/original_source_process_test.go'){const text=p.raw.toString('utf8');assert.equal(text.split(old).length,2);expected=Buffer.from(text.replace(old,'const fixtureNode = '+JSON.stringify(node)));}assert.deepEqual(fs.readFileSync(path.join(r.outputRoot,relative)),expected);}
  for(const p of input.delta)assert.deepEqual(fs.readFileSync(path.join(r.outputRoot,p.pin.path.slice(7))),p.raw);
  assert.throws(()=>stageR234CatalogRuntimeSupply({outputRoot:r.outputRoot,nodeExecutable:node}),{code:'EEXIST'});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('PUBLIC R234 corrupt new leaf refuses before selecting original54 output and preserves fixed supplies',async()=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'r234-corrupt-PUBLIC-')));
 try{
  const input=readR234CatalogRuntimeSupply(),original=fileURLToPath(new URL('./auth-r234-catalog-runtime-supply.mjs',import.meta.url)),baseline=pathToFileURL(fileURLToPath(new URL('./auth-r232-catalog-supply.mjs',import.meta.url))).href;
  fs.writeFileSync(path.join(dir,'supply.mjs'),fs.readFileSync(original,'utf8').replace("'./auth-r232-catalog-supply.mjs'",JSON.stringify(baseline)));
  const copy=path.join(dir,'fixtures/auth-r234-go-source');fs.mkdirSync(path.dirname(copy));fs.cpSync(input.fixture,copy,{recursive:true});fs.appendFileSync(path.join(copy,input.delta[0].pin.path),'PUBLIC corruption');
  const module=await import(pathToFileURL(path.join(dir,'supply.mjs')).href),outputRoot=path.join(dir,'never-selected');assert.throws(()=>module.stageR234CatalogRuntimeSupply({outputRoot,nodeExecutable:fs.realpathSync(process.execPath)}),{code:'R234_PIN'});assert.equal(fs.existsSync(outputRoot),false);assert.equal(readR234CatalogRuntimeSupply().delta.length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
