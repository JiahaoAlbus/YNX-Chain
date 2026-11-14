import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createTaskAPI,TaskWorkspaceController,type WorkspaceRecord} from './tasks';
import {TaskSessionLifetime} from './taskSession';
import type {NativeTaskV6,V6Journal} from './taskV6';import type {OriginalAITaskActionV6Client as Client,OriginalAITaskActionV6Intent as Intent,OriginalAITaskActionV6Observation as Observation} from '../contracts/sdk047/original-ai-task-action-v6-client';
async function setup(withCursor=false,cold=false){
 const data=JSON.parse(await readFile(new URL('./testdata/task-results-public.json',import.meta.url),'utf8'));let journal:V6Journal|null=null,workspace:WorkspaceRecord|null=null;const writes:string[]=[],calls:string[]=[];let n=0;const packets=new Map<object,Intent>();let override:unknown=null;let resultStatus=200;let cursor:import("./taskReconnect").RunCursor|null=null;
 // PUBLIC SDK orchestration seam. Result bodies are byte-for-byte Go outputs;
 // cryptographic/source/installed-client proof is explicitly not part of this test.
 const client={prepare(i:Intent){const p={};packets.set(p,i);return p},async prove(p:object){return p},async send(p:object){const i=packets.get(p)!;calls.push(i.action);let body:unknown;switch(i.action){case 'task.list':body={tasks:[data.task],hasMore:false};break;case 'task.read':{const after=Number(new URL('http://PUBLIC'+i.path).searchParams.get('afterCursor')||0);body={...data.projection,events:data.projection.events.filter((e:{sequence:number})=>e.sequence>after),steps:after===0?data.projection.steps:[]};break;}case 'task.run-read':body=override??data.completedRun;break;case 'task.step-result':body=data.receipt;break;default:throw Error('PUBLIC unexpected effect, replay refused')}
 const status=i.action==='task.step-result'?resultStatus:200;
 return {operationId:i.operationId,phase:status===200?'OBSERVED':'DENIED',unknown:false,responseOriginal:{status,complete:true,headers:[],bodyOriginal:new TextEncoder().encode(JSON.stringify(status===200?body:{error:'READ_UNAVAILABLE'}))},toolAuthorized:false,modelAuthorized:false,fundsAuthorized:false,dataOnly:true,RootAdmission:false,NativeAdmission:false,operationVerified:false} as Observation},async close(){}} as unknown as Client;
 if(cold)workspace={selectedTask:data.task.id,runId:data.requestRunID,deliveries:[{version:'6',id:'original_delivery',binding:'original',action:'run',taskId:data.task.id,runId:data.requestRunID,state:'UNKNOWN'}]};
 const original:NativeTaskV6={client,newOperationId:()=>`observed_${++n}`,journal:{read:async()=>journal,write:async(_id,v)=>{journal=structuredClone(v);writes.push(JSON.stringify(v))}}};
 const lifetime=new TaskSessionLifetime('PUBLIC-source-contract',async()=>client,original.journal,original.newOperationId);
 const reopen=async()=>{const credentials=await lifetime.open(new AbortController().signal);const api=createTaskAPI('http://127.0.0.1:6438',credentials);return new TaskWorkspaceController(credentials.identity,api,{read:async()=>workspace,write:async(_id,v)=>{workspace=structuredClone(v);writes.push(JSON.stringify(v))}},()=>`delivery_${++n}`,()=>{},withCursor?{read:async()=>cursor,write:async(_id,value)=>{cursor={...value};writes.push(JSON.stringify(value))}}:undefined)};
 const c=await reopen();
 return {data,c,calls,writes,lifetime,reopen,get cursor(){return cursor},get journal(){return journal},set override(v:unknown){override=v},set resultUnavailable(v:boolean){resultStatus=v?503:200},set resultStatus(v:number){resultStatus=v}};
}
test('refresh retries only the retained completed result after a temporary read failure',async()=>{
 const f=await setup();await f.c.discover();await f.c.select(f.data.task.id);
 const step=f.c.state.projection!.steps.find(s=>s.id===f.data.requestStepID)!;await f.c.readResult(step);
 assert.equal(f.c.state.receipt!.effectRef,f.data.requestStepID);
 f.resultUnavailable=true;await f.c.select(f.data.task.id);assert.ok(f.c.state.error);assert.equal(f.c.state.receipt,null);
 f.resultUnavailable=false;await f.c.select(f.data.task.id);assert.equal(f.c.state.error,'');assert.equal(f.c.state.receipt!.effectRef,f.data.requestStepID);
 assert.deepEqual(f.calls,['task.list','task.read','task.step-result','task.read','task.step-result','task.read','task.step-result']);
 assert.ok(f.writes.every(w=>!w.includes('actual selected source body')));await f.c.whenClosed();
});
test('normal native consumer returns actual Go tool result and completed model answer without executing a replacement',async()=>{
 const f=await setup();await f.c.restore();await f.c.discover();await f.c.select(f.data.task.id);assert.equal(f.c.state.error,'');await f.c.readRun(f.data.requestRunID);assert.equal(f.c.state.error,'');assert.equal(f.c.state.run!.content,f.data.completedRun.content);
 const step=f.c.state.projection!.steps.find(s=>s.id===f.data.requestStepID)!;await f.c.readResult(step);assert.equal(f.c.state.error,'');assert.ok(JSON.stringify(f.c.state.receipt!.result).includes('actual selected source body'));
 await f.c.readRun(f.data.requestRunID);assert.deepEqual(f.calls,['task.list','task.read','task.run-read','task.step-result','task.run-read']);assert.ok(f.writes.every(w=>!w.includes(f.data.completedRun.content)&&!w.includes('actual selected source body')));assert.ok(f.journal!.entries.every(e=>e.state==='OBSERVED'));await f.c.whenClosed();
});
test('normal consumer refuses wrong-version or blocked model response before clearing UNKNOWN journal or showing content',async()=>{
 const f=await setup();await f.c.discover();await f.c.select(f.data.task.id);await f.c.readRun(f.data.requestRunID);assert.ok(f.c.state.run?.content);for(const delta of [{generation:2},{taskId:'foreign'},{status:'RETURN_BLOCKED',recoveryOnly:true}]){f.override={...f.data.completedRun,...delta};await f.c.readRun(f.data.requestRunID);assert.match(f.c.state.error,/RESULT_INVALID/);assert.equal(f.c.state.run,null)}await f.c.whenClosed();
});
test('normal client readRun uses durable event pages and rechecks same completed run/receipt on reconnect',async()=>{const f=await setup(true);await f.c.restore();await f.c.discover();await f.c.select(f.data.task.id);await f.c.readRun(f.data.requestRunID);assert.equal(f.c.state.error,'');assert.equal(f.cursor!.taskId,f.data.task.id);assert.equal(f.cursor!.runId,f.data.requestRunID);assert.equal(f.cursor!.recordId,f.data.completedRun.id);const saved=f.cursor!.cursor;assert.equal(f.c.state.run!.content,f.data.completedRun.content);assert.equal(f.c.state.receipt!.effectRef,f.data.requestStepID);await f.c.readRun(f.data.requestRunID);assert.equal(f.c.state.error,'');assert.equal(f.cursor!.cursor,saved);assert.equal(f.c.state.run!.content,f.data.completedRun.content);assert.ok(f.calls.every(c=>['task.list','task.read','task.run-read','task.step-result'].includes(c)));assert.ok(f.writes.every(w=>!w.includes(f.data.completedRun.content)));await f.c.whenClosed()});

test('normal cold startup restores original Go task/model/tool results through actual V6 consumer and durable cursor',async()=>{const f=await setup(true,true);await f.c.restoreOriginalTask();assert.equal(f.c.state.error,'');assert.equal(f.c.state.run!.content,f.data.completedRun.content);assert.equal(f.c.state.receipt!.effectRef,f.data.requestStepID);assert.equal(f.cursor!.runId,f.data.requestRunID);assert.equal(f.c.state.record.deliveries[0]!.state,'UNKNOWN');assert.deepEqual(f.calls,['task.list','task.read','task.read','task.run-read','task.step-result']);assert.ok(f.writes.every(w=>!w.includes(f.data.completedRun.content)));await f.c.whenClosed()});
test('V6 run read without cursor storage does not promote an unresolved original delivery',async()=>{
 const f=await setup(false,true);await f.c.restoreOriginalTask();
 assert.equal(f.c.state.error,'');assert.equal(f.c.state.run!.content,f.data.completedRun.content);
 assert.equal(f.c.state.record.deliveries[0]!.state,'UNKNOWN');
 await assert.rejects(f.c.model(f.c.state.projection!,f.data.requestRunID,'','PUBLIC-ref',[],true),/UNKNOWN_ORIGINAL_QUERY_REQUIRED/);
 assert.ok(f.calls.every(c=>['task.list','task.read','task.run-read'].includes(c)));await f.c.whenClosed();
});
test('workspace refresh reloads the original run and selected receipt without new effects',async()=>{
 const f=await setup(true,true);await f.c.restoreOriginalTask();
 const step=f.c.state.projection!.steps.find(s=>s.id===f.data.requestStepID)!;await f.c.readResult(step);
 await f.c.refreshOriginalTask(f.data.task.id);
 assert.equal(f.c.state.error,'');assert.equal(f.c.state.run!.content,f.data.completedRun.content);assert.equal(f.c.state.receipt!.effectRef,f.data.requestStepID);
 assert.equal(f.c.state.record.deliveries[0]!.state,'UNKNOWN');
 assert.ok(f.calls.every(c=>['task.list','task.read','task.run-read','task.step-result'].includes(c)));
 assert.ok(f.writes.every(w=>!w.includes(f.data.completedRun.content)));await f.c.whenClosed();
});
test('original session reopen recovers selected result and revocation removes private display state',async()=>{
 const f=await setup(true,true);await f.c.restoreOriginalTask();
 const step=f.c.state.projection!.steps.find(s=>s.id===f.data.requestStepID)!;await f.c.readResult(step);
 await f.c.whenClosed();const reopened=await f.reopen();await reopened.restoreOriginalTask();
 assert.equal(reopened.state.receipt!.effectRef,f.data.requestStepID);
 await reopened.refreshOriginalTask(f.data.task.id);assert.equal(reopened.state.run!.content,f.data.completedRun.content);
 f.resultStatus=401;await reopened.readResult(reopened.state.projection!.steps.find(s=>s.id===f.data.requestStepID)!);
 assert.match(reopened.state.error,/401/);assert.equal(reopened.state.projection,null);assert.equal(reopened.state.run,null);assert.equal(reopened.state.receipt,null);assert.deepEqual(reopened.state.tasks,[]);
 assert.equal(reopened.state.record.deliveries[0]!.state,'UNKNOWN');assert.ok(f.writes.every(w=>!w.includes(f.data.completedRun.content)&&!w.includes('actual selected source body')));
 await reopened.whenClosed();await f.lifetime.retire();await assert.rejects(f.reopen(),/RETIRED_OR_CANCELLED/);
 assert.ok(f.calls.every(c=>['task.list','task.read','task.run-read','task.step-result'].includes(c)));
});
