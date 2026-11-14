import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { createWorkspaceStore } from '../src/store.mjs';
const payload={name:'ordinary project',folders:[],files:{'main.js':'original','other.txt':'keep'},open:['main.js'],active:'main.js'};
const request={expectedRevision:1,idempotencyKey:'file-save-original',path:'源代码/子目录/你好.js',contents:'console.log("你好")\n'};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'ynx-save-file-store-')),filename=join(root,'original.sqlite');const stores=[];t.after(async()=>{for(const s of stores)try{s.close();}catch{}await rm(root,{recursive:true,force:true});});const open=()=>{const s=createWorkspaceStore({filename});stores.push(s);return s;};const store=open();store.put('owner','project',{expectedRevision:0,idempotencyKey:'create-project',payload});return {root,filename,store,open};}
test('save one real Unicode path preserves other files and editor state and records original history',async t=>{
 const {store}=await fixture(t),saved=store.saveFile('owner','project',request);
 assert.equal(saved.revision,2);assert.equal(saved.files[request.path],request.contents);assert.equal(saved.files['other.txt'],'keep');assert.equal(saved.files['main.js'],'original');assert.deepEqual(saved.open,['main.js']);assert.equal(saved.active,'main.js');assert.deepEqual(saved.folders,['源代码','源代码/子目录']);assert.equal(store.snapshot('owner','project',2).source,'file-save');
 const expectedHash=createHash('sha256').update(JSON.stringify({domain:'YNX_WORKSPACE_FILE_SAVE_V1',expectedRevision:1,path:request.path,contents:request.contents})).digest('hex');assert.equal(store.mutationReceipt('owner','project',request.idempotencyKey).requestHash,expectedHash);
});
test('original request replay returns its original result after other file edits and database reopen',async t=>{
 const {store,open}=await fixture(t);const saved=store.saveFile('owner','project',request);
 store.saveFile('owner','project',{expectedRevision:2,idempotencyKey:'later-file-edit',path:'other.txt',contents:'later'});
 const replay=open().saveFile('owner','project',request);assert.equal(replay.revision,2);assert.equal(replay.replayed,true);assert.equal(replay.files['other.txt'],'keep');assert.deepEqual(replay.files,saved.files);
 assert.throws(()=>store.saveFile('owner','project',{...request,contents:'changed'}),{code:'idempotency_conflict'});
 assert.throws(()=>store.put('owner','project',{expectedRevision:1,idempotencyKey:request.idempotencyKey,payload}),{code:'idempotency_conflict'});
});
test('missing/other owner cannot create a project through save-file and stale revision cannot save',async t=>{
 const {store}=await fixture(t);assert.throws(()=>store.saveFile('other-owner','project',request),{code:'workspace_not_found'});assert.throws(()=>store.saveFile('owner','missing',request),{code:'workspace_not_found'});
 assert.throws(()=>store.saveFile('owner','project',{...request,expectedRevision:0}),{code:'revision_conflict'});assert.equal(store.get('owner','project').revision,1);
});
test('native writer guard is enforced even for replay and foreign writer token cannot bypass it',async t=>{
 const {store}=await fixture(t);store.saveFile('owner','project',request);const token='a'.repeat(64);store.claimWriter('owner','project',{writerToken:token,sessionId:'12345678-1234-1234-1234-123456789012',expectedRevision:2});
 assert.throws(()=>store.saveFile('owner','project',request),{code:'core_writer_active'});assert.throws(()=>store.saveFile('owner','project',{...request,writerToken:'b'.repeat(64)}),{code:'core_writer_active'});
 assert.equal(store.get('owner','project').revision,2);
});
test('path, directory/file collision and existing aggregate quotas fail without changing receipt/history',async t=>{
 const {store}=await fixture(t);for(const path of ['../a','/a','a//b','a/./b','a/../b','a\\b','C:/a','a\u0000b','a\u007fb','a\u202eb','😀.js','汉'.repeat(81)])assert.throws(()=>store.saveFile('owner','project',{...request,path}),{code:'invalid_workspace_file'});
 assert.throws(()=>store.saveFile('owner','project',{...request,contents:7}),{code:'invalid_workspace_file'});
 assert.throws(()=>store.saveFile('owner','project',{...request,path:'main.js/child'}),{code:'workspace_path_conflict'});
 assert.throws(()=>store.saveFile('owner','project',{...request,contents:'x'.repeat(2*1024*1024)}),{code:'invalid_workspace_snapshot'});
 assert.equal(store.get('owner','project').revision,1);assert.equal(store.history('owner','project').revisions.length,1);assert.equal(store.mutationReceipt('owner','project',request.idempotencyKey),null);
 assert.throws(()=>store.saveFile('owner','project',{...request,expectedRevision:Number.MAX_SAFE_INTEGER+1}),{code:'invalid_revision'});
});
test('single-file save keeps original 256-file quota and fifty-revision retention without false replay',async t=>{
 const {store}=await fixture(t),files=Object.fromEntries(Array.from({length:256},(_,i)=>[`file${i}.txt`,'']));
 store.put('owner','project',{expectedRevision:1,idempotencyKey:'fill-original-file-quota',payload:{...payload,files,open:[],active:''}});
 assert.throws(()=>store.saveFile('owner','project',{...request,expectedRevision:2}),{code:'invalid_workspace_snapshot'});assert.equal(store.get('owner','project').revision,2);
 const original={expectedRevision:2,idempotencyKey:'first-retained-file-save',path:'file0.txt',contents:'first'};store.saveFile('owner','project',original);
 for(let revision=3;revision<54;revision++)store.saveFile('owner','project',{expectedRevision:revision,idempotencyKey:`later-history-save-${revision}`,path:'file0.txt',contents:String(revision)});
 assert.equal(store.history('owner','project').revisions.length,20);assert.equal(store.history('owner','project',0,50).revisions.length,50);
 assert.equal(store.mutationReceipt('owner','project',original.idempotencyKey).revision,3);
 assert.throws(()=>store.saveFile('owner','project',original),{code:'idempotency_replay_expired'});assert.equal(store.get('owner','project').files['file0.txt'],'53');
});
test('byte-bound Unicode boundary, combining marks and own-property filenames preserve exact text',async t=>{
 const {store}=await fixture(t),path='汉'.repeat(79)+'.js';assert.equal(Buffer.byteLength(path),240);
 const first=store.saveFile('owner','project',{...request,path,contents:''});assert.equal(first.files[path],'');
 const second=store.saveFile('owner','project',{...request,expectedRevision:2,idempotencyKey:'combining-file-save',path:'e\u0301.txt',contents:'combining'});assert.equal(second.files['e\u0301.txt'],'combining');
 const third=store.saveFile('owner','project',{...request,expectedRevision:3,idempotencyKey:'own-property-file-save',path:'__proto__',contents:'ordinary text'});assert.equal(Object.hasOwn(third.files,'__proto__'),true);assert.equal(third.files.__proto__,'ordinary text');
 store.saveFile('owner','project',{...request,expectedRevision:4,idempotencyKey:'nested-file-save'});
 assert.throws(()=>store.saveFile('owner','project',{...request,expectedRevision:5,idempotencyKey:'folder-collision-file-save',path:'源代码'}),{code:'workspace_path_conflict'});
});
test('two actual SQLite writers race one expected revision and exactly one wins',async t=>{
 const {filename,store}=await fixture(t),gate=new SharedArrayBuffer(4),waiter=new Int32Array(gate),workers=[];
 const code=`import {parentPort,workerData} from 'node:worker_threads';const {createWorkspaceStore}=await import(workerData.url);const s=createWorkspaceStore({filename:workerData.filename});parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(workerData.gate),0,0);try{const saved=s.saveFile('owner','project',{expectedRevision:1,idempotencyKey:workerData.key,path:'main.js',contents:workerData.key});parentPort.postMessage({revision:saved.revision});}catch(error){parentPort.postMessage({code:error.code});}finally{s.close();}`;
 const done=[];for(const key of ['race-writer-one','race-writer-two']){const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{filename,gate,key,url:new URL('../src/store.mjs',import.meta.url).href}});workers.push(worker);done.push(new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',value=>{if(value.ready){if(Atomics.add(waiter,0,0)===0)readyCount++;if(readyCount===2){Atomics.store(waiter,0,1);Atomics.notify(waiter,0);}}else resolve(value);});}));}let readyCount=0;
 t.after(()=>Promise.all(workers.map(w=>w.terminate())));const results=await Promise.all(done);assert.equal(results.filter(r=>r.revision===2).length,1);assert.equal(results.filter(r=>r.code==='revision_conflict').length,1);assert.equal(store.get('owner','project').revision,2);assert.equal(store.history('owner','project').revisions.length,2);
});
