import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
test('normal desktop bridge requires the complete pinned entry and dependency list before loading',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pay-bridge-identity-'));
 try{
  for(const name of fs.readdirSync(here).filter(x=>x.endsWith('.mjs')&&!x.endsWith('.test.mjs')))fs.copyFileSync(path.join(here,name),path.join(root,name));
  fs.mkdirSync(path.join(root,'normal-runtime'));const entry=path.join(root,'normal-runtime','entry.mjs');
  const raw="export async function openNativePayMainEntry(){return {status(){return {available:false,reason:'PUBLIC_FIXTURE'}}}}";fs.writeFileSync(entry,raw);
  const hash=createHash('sha256').update(raw).digest('hex'),ref={path:'normal-runtime/entry.mjs',sha256:hash};
  const invoke=config=>{fs.writeFileSync(path.join(root,'desktop-runtime.json'),JSON.stringify(config));return spawnSync(process.execPath,[path.join(root,'desktop-entry.mjs')],{input:'{"action":"status"}',encoding:'utf8'})};
  const valid=invoke({runtime:ref.path,sha256:hash,runtimeFiles:[ref]});assert.equal(valid.status,0,valid.stderr);assert.equal(JSON.parse(valid.stdout).reason,'PUBLIC_FIXTURE');
  for(const runtimeFiles of [undefined,[],[{path:'normal-runtime/other.mjs',sha256:hash}],[ref,ref]]){const result=invoke({runtime:ref.path,sha256:hash,runtimeFiles});assert.equal(result.status,2);assert.equal(JSON.parse(result.stdout).code,'NATIVE_PAY_NORMAL_RUNTIME_IDENTITY_MISMATCH')}
  fs.renameSync(entry,path.join(root,'actual.mjs'));fs.symlinkSync(path.join(root,'actual.mjs'),entry);const linked=invoke({runtime:ref.path,sha256:hash,runtimeFiles:[ref]});assert.equal(linked.status,2);assert.equal(JSON.parse(linked.stdout).code,'NATIVE_PAY_NORMAL_RUNTIME_IDENTITY_MISMATCH');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
