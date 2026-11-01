import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createTaskAPI,TaskWorkspaceController,type WorkspaceRecord} from './tasks';
import type {NativeTaskV6,V6Journal} from './taskV6';import type {OriginalAITaskActionV6Client as Client,OriginalAITaskActionV6Intent as Intent,OriginalAITaskActionV6Observation as Observation} from '../contracts/sdk047/original-ai-task-action-v6-client';
async function setup(){
 const data=JSON.parse(await readFile(new URL('./testdata/task-results-public.json',import.meta.url),'utf8'));let journal:V6Journal|null=null,workspace:WorkspaceRecord|null=null;const writes:string[]=[],calls:string[]=[];let n=0;const packets=new Map<object,Intent>();let override:unknown=null;
 // PUBLIC SDK orchestration seam. Result bodies are byte-for-byte Go outputs;
 // cryptographic/source/installed-client proof is explicitly not part of this test.
 const client={prepare(i:Intent){const p={};packets.set(p,i);return p},async prove(p:object){return p},async send(p:object){const i=packets.get(p)!;calls.push(i.action);let body:unknown;switch(i.action){case 'task.list':body={tasks:[data.task],hasMore:false};break;case 'task.read':body=data.projection;break;case 'task.run-read':body=override??data.completedRun;break;case 'task.step-result':body=data.receipt;break;default:throw Error('PUBLIC unexpected effect, replay refused')}
 return {operationId:i.operationId,phase:'OBSERVED',unknown:false,responseOriginal:{status:200,complete:true,headers:[],bodyOriginal:new TextEncoder().encode(JSON.stringify(body))},toolAuthorized:false,modelAuthorized:false,fundsAuthorized:false,dataOnly:true,RootAdmission:false,NativeAdmission:false,operationVerified:false} as Observation},async close(){}} as unknown as Client;
 const original:NativeTaskV6={client,newOperationId:()=>`observed_${++n}`,journal:{read:async()=>journal,write:async(_id,v)=>{journal=structuredClone(v);writes.push(JSON.stringify(v))}}};
 const api=createTaskAPI('http://127.0.0.1:6438',{identity:'PUBLIC-source-contract',v6:original});const c=new TaskWorkspaceController('PUBLIC-source-contract',api,{read:async()=>workspace,write:async(_id,v)=>{workspace=structuredClone(v);writes.push(JSON.stringify(v))}},()=>`delivery_${++n}`);
 return {data,c,calls,writes,get journal(){return journal},set override(v:unknown){override=v}};
}
test('normal native consumer returns actual Go tool result and completed model answer without executing a replacement',async()=>{
 const f=await setup();await f.c.restore();await f.c.discover();await f.c.select(f.data.task.id);assert.equal(f.c.state.error,'');await f.c.readRun(f.data.requestRunID);assert.equal(f.c.state.error,'');assert.equal(f.c.state.run!.content,f.data.completedRun.content);
 const step=f.c.state.projection!.steps.find(s=>s.id===f.data.requestStepID)!;await f.c.readResult(step);assert.equal(f.c.state.error,'');assert.ok(JSON.stringify(f.c.state.receipt!.result).includes('actual selected source body'));
 await f.c.readRun(f.data.requestRunID);assert.deepEqual(f.calls,['task.list','task.read','task.run-read','task.step-result','task.run-read']);assert.ok(f.writes.every(w=>!w.includes(f.data.completedRun.content)&&!w.includes('actual selected source body')));assert.ok(f.journal!.entries.every(e=>e.state==='OBSERVED'));await f.c.whenClosed();
});
test('normal consumer refuses wrong-version or blocked model response before clearing UNKNOWN journal or showing content',async()=>{
 const f=await setup();await f.c.discover();await f.c.select(f.data.task.id);await f.c.readRun(f.data.requestRunID);assert.ok(f.c.state.run?.content);for(const delta of [{generation:2},{taskId:'foreign'},{status:'RETURN_BLOCKED',recoveryOnly:true}]){f.override={...f.data.completedRun,...delta};await f.c.readRun(f.data.requestRunID);assert.match(f.c.state.error,/RESULT_INVALID/);assert.equal(f.c.state.run,null)}await f.c.whenClosed();
});
