import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkspaceStore} from '../src/store.mjs';
const payload=content=>({name:'save QA',files:{'main.cpp':content},folders:[],open:['main.cpp'],active:'main.cpp'});
test('two independent clients save one expected revision: exactly one wins and prior content remains in history',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-save-cas-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const filename=join(root,'workspace.sqlite'),store=createWorkspaceStore({filename});t.after(()=>store.close());
 store.put('owner-a','project-a',{expectedRevision:0,idempotencyKey:'initial-save-001',payload:payload('original')});
 const workers=[];
 const start=async value=>{
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
  (async()=>{const {createWorkspaceStore}=await import(workerData.module);const store=createWorkspaceStore({filename:workerData.filename});parentPort.postMessage({ready:true});parentPort.once('message',()=>{try{const saved=store.put('owner-a','project-a',{expectedRevision:1,idempotencyKey:workerData.value+'-save-001',payload:{name:'save QA',files:{'main.cpp':workerData.value},folders:[],open:['main.cpp'],active:'main.cpp'}});parentPort.postMessage({ok:true,revision:saved.revision,value:workerData.value});}catch(error){parentPort.postMessage({ok:false,code:error.code});}finally{store.close();}});})().catch(error=>{throw error;});`,{eval:true,workerData:{module:new URL('../src/store.mjs',import.meta.url).href,filename,value}});
  workers.push(worker);await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});return worker;
 };
 t.after(()=>Promise.all(workers.map(worker=>worker.terminate())));
 const a=await start('client-A'),b=await start('client-B');
 const pending=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}));
 a.postMessage('save');b.postMessage('save');
 const results=await Promise.all(pending);assert.equal(results.filter(result=>result.ok).length,1);assert.equal(results.find(result=>!result.ok).code,'revision_conflict');
 assert.equal(store.get('owner-a','project-a').revision,2);assert.equal(store.snapshot('owner-a','project-a',1).files['main.cpp'],'original');
 assert.equal(store.get('owner-a','project-a').files['main.cpp'],results.find(result=>result.ok).value);
});
test('unknown revision and non-normalized paths are rejected by the real save store',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-save-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=createWorkspaceStore({filename:join(root,'workspace.sqlite')});t.after(()=>store.close());
 assert.throws(()=>store.put('owner-a','project-a',{idempotencyKey:'save-no-version',payload:payload('a')}),{code:'invalid_revision'});
 for(const path of ['../escape','a/../b','/absolute','a//b'])assert.throws(()=>store.put('owner-a','project-a',{expectedRevision:0,idempotencyKey:'save-bad-path-001',payload:{...payload('a'),files:{[path]:'a'}}}),{code:'invalid_workspace_snapshot'});
 assert.equal(store.get('owner-a','project-a'),null);
});
