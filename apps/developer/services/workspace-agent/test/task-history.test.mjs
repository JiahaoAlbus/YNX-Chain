import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskHistory } from '../src/task-history.mjs';
const job={taskId:'original-task',owner:'owner-A',projectId:'project-A',kind:'build-run-active',files:{'main.js':'console.log("hello")'}};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'ynx-task-history-'));let db=new DatabaseSync(join(root,'original.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});return {db,reopen(){db.close();db=new DatabaseSync(join(root,'original.sqlite'));return db;}};}
test('original owner gets persisted real output after database and instance reopen',async t=>{
 const f=await fixture(t),h=createTaskHistory({db:f.db,instanceId:'first'});h.begin(job);assert.equal(h.start(job.taskId),true);
 const result={taskId:job.taskId,ok:true,code:0,output:'Hello World\n'};assert.equal(h.complete(job.taskId,{result}),true);
 const reopened=createTaskHistory({db:f.reopen(),instanceId:'second'}),read=reopened.read(job.owner,job.taskId);
 assert.equal(read.status,'completed');assert.equal(read.projectId,'project-A');assert.deepEqual(read.outcome,{result});assert.match(read.sourceSha256,/^[a-f0-9]{64}$/);
 assert.equal(reopened.read('owner-B',job.taskId),null);assert.equal(reopened.read(job.owner,'missing'),null);
});
test('new instance marks interrupted queued/running UNKNOWN and cannot finish or restart them',async t=>{
 const {db}=await fixture(t),a=createTaskHistory({db,instanceId:'A'});a.begin(job);a.begin({...job,taskId:'running'});a.start('running');
 const b=createTaskHistory({db,instanceId:'B'});for(const id of [job.taskId,'running']){assert.equal(b.read(job.owner,id).status,'unknown');assert.equal(b.read(job.owner,id).outcome,null);assert.equal(b.start(id),false);assert.equal(b.complete(id,{result:{ok:true,code:0}}),false);}
 assert.equal(a.read(job.owner,job.taskId).status,'queued');
});
test('cancelled/nonzero/error are truthful and terminal outcomes cannot be overwritten',async t=>{
 const {db}=await fixture(t),h=createTaskHistory({db,instanceId:'A'});
 for(const [id,actual,status] of [['cancel',{result:{ok:false,code:130,output:'partial'}},'cancelled'],['failed',{result:{ok:false,code:1,output:'compile error'}},'failed'],['exception',{error:Object.assign(Error('revoked'),{code:'identity_changed'})},'failed']]){
  h.begin({...job,taskId:id});assert.equal(h.complete(id,actual),true);const original=h.read(job.owner,id);assert.equal(original.status,status);assert.equal(h.start(id),false);assert.equal(h.complete(id,{result:{ok:true,code:0}}),false);assert.deepEqual(h.read(job.owner,id),original);
 }
});
test('source digest is stable, logs bounded, duplicate task cannot rebind owner/project',async t=>{
 const {db}=await fixture(t),h=createTaskHistory({db,instanceId:'A'});const begin=h.begin(job);
 assert.throws(()=>h.begin({...job,owner:'owner-B',projectId:'project-B'}));assert.equal(h.read('owner-B',job.taskId),null);
 h.begin({...job,taskId:'ordered',files:{'b.js':'B','a.js':'A'}});h.begin({...job,taskId:'reordered',files:{'a.js':'A','b.js':'B'}});assert.equal(h.read(job.owner,'ordered').sourceSha256,h.read(job.owner,'reordered').sourceSha256);
 h.complete(job.taskId,{result:{ok:true,code:0,output:'x'.repeat(3*1024*1024),artifacts:['x'.repeat(3*1024*1024)]}});
 const outcome=h.read(job.owner,job.taskId).outcome;assert.equal(outcome.result.historyTruncated,true);assert.ok(Buffer.byteLength(JSON.stringify(outcome))<2*1024*1024);assert.equal(h.read(job.owner,job.taskId).sourceSha256,begin.sourceSha256);
 assert.throws(()=>h.complete('ordered',{result:{ok:true}}),{code:'task_history_invalid'});
});
