import test from 'node:test';import assert from 'node:assert/strict';
import {NativeTaskV6Adapter,createTaskV6API,validateV6Journal,type V6Journal,type NativeTaskV6} from './taskV6';
import {createTaskAPI} from './tasks';
import type {OriginalAITaskActionV6Intent as Intent,OriginalAITaskActionV6Client as Client,OriginalAITaskActionV6Observation as Observation} from '../contracts/sdk047/original-ai-task-action-v6-client';
const t={id:'task_original',conversationId:'conversation_original',revision:2,generation:1,holder:'device_original',status:'READY'};
const request=(action:Intent['action']='task.cancel')=>({action,method:'POST' as const,path:`/api/tasks/${t.id}/cancel`,bodyOriginal:new TextEncoder().encode(JSON.stringify({revision:2,generation:1})),taskId:t.id,taskRevision:'2',generation:'1',stepId:null,runId:null,creationBinding:null});
function fixture(){
 let saved:V6Journal|null=null,n=0;const calls:string[]=[],intents:Intent[]=[],writes:string[]=[];let failWrite=false;
 const client={
  prepare(i:Intent){calls.push('prepare');assert.ok(saved!.entries.some(e=>e.operationId===i.operationId&&e.state==='PENDING'));intents.push(i);return Object.freeze({})},
  async prove(p:unknown){calls.push('prove');return p},
  async send(){calls.push('send');const i=intents.at(-1)!;return {operationId:i.operationId,phase:'COMMITTED',unknown:false,responseOriginal:{status:200,complete:true,headers:[],bodyOriginal:new TextEncoder().encode(JSON.stringify(i.action==='task.list'?{tasks:[t],hasMore:false}:i.action==='task.read'?{...t,cursor:2,hasMore:false,events:[],steps:[]}:['task.run-start','task.run-resume','task.run-read'].includes(i.action)?{id:'run_internal',runId:i.runId,taskId:t.id,taskRevision:t.revision,generation:t.generation,status:'NEEDS_APPROVAL',steps:null,recoveryOnly:false}:['task.prepare','task.cancel','task.complete'].includes(i.action)?{task:t,remoteRollback:false}:t))},toolAuthorized:false,modelAuthorized:false,fundsAuthorized:false,dataOnly:true,RootAdmission:false,NativeAdmission:false,operationVerified:false} as unknown as Observation},
  async lookupOriginal(op:string){calls.push('lookup:'+op);return {op}},readRecovery(token:{op:string}){calls.push('readRecovery');return {operationId:token.op,evidenceOriginal:new Uint8Array([1,2]),dataOnly:true,RootAdmission:false,NativeAdmission:false,operationVerified:false,replayAuthorized:false}},
  async close(){calls.push('close')}
 } as unknown as Client;
 const original:NativeTaskV6={client,newOperationId:()=>`operation_${++n}`,journal:{async read(){return saved?structuredClone(saved):null},async write(_identity,j){writes.push(JSON.stringify(j));if(failWrite)throw Error('PUBLIC disk failed');saved=structuredClone(j)}}};
 return {client,original,calls,intents,writes,get saved(){return saved},get failWrite(){return failWrite},set failWrite(v:boolean){failWrite=v}};
}
// These are PUBLIC orchestration seams, not signatures, Source or Native admission.
test('V6 persists original metadata before SDK proof/send and never stores prompt or member',async()=>{
 const f=fixture(),a=new NativeTaskV6Adapter('PUBLIC',f.original);const r=request();r.bodyOriginal=new TextEncoder().encode('PRIVATE input');const result=await a.execute(r,new AbortController().signal);
 assert.deepEqual(f.calls,['prepare','prove','send']);assert.equal(result.toolAuthorized,false);assert.equal(f.saved!.entries[0]!.state,'COMMITTED');assert.ok(f.writes.every(w=>!w.includes('PRIVATE input')));assert.ok(Object.isFrozen(f.intents[0]!.abortContext));
 await assert.rejects(a.execute(r,new AbortController().signal),/ORIGINAL_QUERY_REQUIRED/);assert.equal(f.intents.length,1);
});
test('lost SDK outcome survives cold restart; only original lookup, never prove/send/new operation',async()=>{
 const f=fixture();f.client.send=async()=>{f.calls.push('send');throw Error('PUBLIC lost acknowledgement')};const a=new NativeTaskV6Adapter('PUBLIC',f.original);await assert.rejects(a.execute(request(),new AbortController().signal),/lost acknowledgement/);assert.equal(f.saved!.entries[0]!.state,'UNKNOWN');
 const cold=new NativeTaskV6Adapter('PUBLIC',f.original);await assert.rejects(cold.execute(request('task.run-start'),new AbortController().signal),/ORIGINAL_QUERY_REQUIRED/);const result=await cold.lookupOriginal('operation_1',new AbortController().signal);assert.equal(result.operationId,'operation_1');assert.equal(result.replayAuthorized,false);assert.equal(f.intents.length,1);assert.equal(f.saved!.entries[0]!.state,'UNKNOWN');
});
test('lookup cannot invent operation or silently import old V2 journal',async()=>{
 const f=fixture(),a=new NativeTaskV6Adapter('PUBLIC',f.original);await assert.rejects(a.lookupOriginal('foreign',new AbortController().signal),/NOT_RETAINED/);assert.equal(f.calls.length,0);assert.throws(()=>validateV6Journal({selectedTask:'old',runId:'old',deliveries:[]}),/JOURNAL_INVALID/);
});
test('cancel during held review prevents SDK send and preserves UNKNOWN original operation',async()=>{
 const f=fixture();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);f.client.prove=async p=>{entered();await wait;return p};const a=new NativeTaskV6Adapter('PUBLIC',f.original),abort=new AbortController();const p=a.execute(request(),abort.signal);await started;abort.abort();release();await assert.rejects(p,/CANCELLED/);assert.ok(!f.calls.includes('send'));assert.equal(f.saved!.entries[0]!.firstCause,'CANCELLED');
});
test('pre-dispatch storage failure never reaches SDK and retained in-memory original cannot retry',async()=>{
 const f=fixture(),a=new NativeTaskV6Adapter('PUBLIC',f.original);f.failWrite=true;await assert.rejects(a.execute(request(),new AbortController().signal),/disk failed/);f.failWrite=false;await assert.rejects(a.execute(request(),new AbortController().signal),/ORIGINAL_QUERY_REQUIRED/);assert.equal(f.calls.length,0);
});
test('concurrent same binding reserves once and no new operation escapes UNKNOWN',async()=>{
 const f=fixture(),a=new NativeTaskV6Adapter('PUBLIC',f.original);const results=await Promise.allSettled([a.execute(request(),new AbortController().signal),a.execute(request(),new AbortController().signal)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.intents.length,1);
});
test('wrong operation / unresolved outcome rejected without promoting local receipt',async()=>{
 for(const result of [{operationId:'foreign',phase:'COMMITTED',unknown:false},{operationId:'operation_1',phase:'UNKNOWN',unknown:true}]){const f=fixture();f.client.send=async()=>result as Observation;const a=new NativeTaskV6Adapter('PUBLIC',f.original);await assert.rejects(a.execute(request(),new AbortController().signal),/UNRESOLVED/);assert.equal(f.saved!.entries[0]!.state,'UNKNOWN')}
});
test('normal credentials without genuine factory cannot mutate and never fall back to V2',async()=>{
 let n=0;const api=createTaskAPI('http://127.0.0.1:6438',{identity:'PUBLIC',proof:async()=>{n++;return 'PUBLIC'}},async()=>{n++;return new Response('{}')});await assert.rejects(api.cancel(t,new AbortController().signal),/FACTORY_NOT_SUPPLIED_LEGACY_QUERY_ONLY/);assert.equal(n,0);
});
test('normal createTaskAPI selects V6 client; no legacy proof or fetch, unregistered handoff stays unavailable',async()=>{
 const f=fixture();let legacy=0;const api=createTaskAPI('http://127.0.0.1:6438',{identity:'PUBLIC',v6:f.original,proof:async()=>{legacy++;throw Error('legacy')}},async()=>{legacy++;throw Error('legacy fetch')});const created=await api.create(t.conversationId,new AbortController().signal);assert.equal(created.id,t.id);assert.equal(f.intents[0]!.action,'task.create');assert.deepEqual(f.intents[0]!.creationBinding,{conversationId:t.conversationId});assert.equal(legacy,0);await assert.rejects(api.handoff(t,'next','ref',new AbortController().signal),/UNREGISTERED/);
});
test('V6 cancel and both model bodies consume exact frozen request operands',async()=>{
 const f=fixture(),api=createTaskV6API('PUBLIC',f.original),signal=new AbortController().signal;await api.cancel(t,signal);await api.run(t,'run_original','PRIVATE prompt','PRIVATE ref',['shop.order.read'],false,signal);await api.run(t,'run_original','','PRIVATE ref',[],true,signal);
 assert.deepEqual(f.intents.map(i=>i.action),['task.cancel','task.run-start','task.run-resume']);assert.equal(f.intents[1]!.taskRevision,'2');assert.deepEqual(JSON.parse(new TextDecoder().decode(f.intents[1]!.bodyOriginal)).toolIds,['shop.order.read']);assert.equal(JSON.parse(new TextDecoder().decode(f.intents[2]!.bodyOriginal)).resume,true);assert.ok(f.writes.every(w=>!w.includes('PRIVATE')));
});
test('V6 current task observations cache snapshots; missing snapshot refuses before SDK',async()=>{
 const f=fixture(),api=createTaskV6API('PUBLIC',f.original),signal=new AbortController().signal;await assert.rejects(async()=>api.task(t.id,signal),/SNAPSHOT_REQUIRED/);assert.equal(f.calls.length,0);await api.list(signal);await api.task(t.id,signal);assert.equal(f.intents[1]!.action,'task.read');assert.equal(f.intents[1]!.taskRevision,'2');
});
test('close aborts in-flight review, drains original client, forbids further execution',async()=>{
 const f=fixture();let enter!:()=>void;const started=new Promise<void>(r=>enter=r);f.client.prove=async p=>{enter();await new Promise<void>(r=>f.intents[0]!.abortContext.signal.addEventListener('abort',()=>r(),{once:true}));return p};const a=new NativeTaskV6Adapter('PUBLIC',f.original);const p=a.execute(request(),new AbortController().signal);await started;const closing=a.close();await assert.rejects(p,/CANCELLED/);await closing;assert.equal(f.calls.at(-1),'close');assert.ok(!f.calls.includes('send'));await assert.rejects(a.execute(request(),new AbortController().signal),/CLOSED/);
});
test('malformed or duplicated persisted V6 metadata cannot create a new request',()=>{
 const entry={version:'6',operationId:'original',binding:'PUBLIC',action:'task.cancel',taskId:t.id,state:'UNKNOWN'};assert.throws(()=>validateV6Journal({version:'6',entries:[entry,entry]}),/JOURNAL_INVALID/);assert.throws(()=>validateV6Journal({version:'6',entries:[{...entry,member:'secret'}]}),/JOURNAL_INVALID/);
});
test('V6 snapshots body/task/creation fields before asynchronous journal read',async()=>{
 const f=fixture();let release!:()=>void;const wait=new Promise<void>(r=>release=r);f.original.journal.read=async()=>{await wait;return null};const a=new NativeTaskV6Adapter('PUBLIC',f.original),r=request();const originalBytes=r.bodyOriginal.slice();const p=a.execute(r,new AbortController().signal);r.path='/api/tasks/foreign/cancel';r.taskRevision='999';r.bodyOriginal.fill(0);release();await p;assert.equal(f.intents[0]!.path,'/api/tasks/task_original/cancel');assert.equal(f.intents[0]!.taskRevision,'2');assert.deepEqual(f.intents[0]!.bodyOriginal,originalBytes);
});
test('close owns cold lookup cancellation and drains without new proof/send',async()=>{
 const f=fixture(),a=new NativeTaskV6Adapter('PUBLIC',f.original);await a.execute(request(),new AbortController().signal);let enter!:()=>void;const entered=new Promise<void>(r=>enter=r);f.client.lookupOriginal=async(_op,c)=>{enter();await new Promise<void>(r=>c.signal.addEventListener('abort',()=>r(),{once:true}));throw Error('PUBLIC original lookup cancelled')};const lookup=a.lookupOriginal('operation_1',new AbortController().signal);await entered;const closing=a.close();await assert.rejects(lookup,/lookup cancelled/);await closing;assert.equal(f.calls.filter(c=>c==='prepare').length,1);assert.equal(f.calls.at(-1),'close');
});
test('old V2 task/delivery stays query-only under a V6 session; no migration or auto re-sign',async()=>{
 const {TaskWorkspaceController}=await import('./tasks');const f=fixture();let proofs=0;
 const api=createTaskAPI('http://127.0.0.1:6438',{identity:'PUBLIC',v6:f.original,proof:async()=>{proofs++;return 'PUBLIC-old-query'}},async()=>new Response(JSON.stringify({taskId:t.id,runId:'old_run',status:'UNKNOWN',recoveryOnly:true})));
 const old={selectedTask:t.id,runId:'old_run',deliveries:[{id:'v2_delivery',binding:'old',action:'run',taskId:t.id,runId:'old_run',state:'UNKNOWN' as const}]};let saved=structuredClone(old);
 const c=new TaskWorkspaceController('PUBLIC',api,{read:async()=>structuredClone(saved),write:async(_i,v)=>{saved=structuredClone(v) as typeof old}},()=> 'new_delivery');await c.restore();c.state.projection={...t,cursor:0,hasMore:false,events:[],steps:[]};
 await c.prepare(t);assert.match(c.state.error,/LEGACY_V2_TASK_QUERY_ONLY/);await c.cancel(t);assert.match(c.state.error,/LEGACY_V2_TASK_QUERY_ONLY/);assert.equal(f.intents.length,0);
 const oldResult=await c.recoverLegacyRun(t.id,'old_run',new AbortController().signal);assert.equal(oldResult.status,'UNKNOWN');assert.equal(proofs,1);assert.deepEqual(saved,old);assert.equal(f.intents.length,0);
});
test('vendored SDK047 types are byte-exact supplier contracts, with no executable codec',async()=>{
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');const provenance=JSON.parse(await readFile(new URL('../contracts/sdk047/PROVENANCE.json',import.meta.url),'utf8'));assert.equal(provenance.commit,'0475514dd461a3adf0ea316b941888a4677a3a19');for(const f of provenance.files){const b=await readFile(new URL('../contracts/sdk047/'+f.path,import.meta.url));assert.equal(createHash('sha256').update(b).digest('hex'),f.sha256);assert.ok(f.path.endsWith('.d.ts'))}
});
test('normal workspace disposal owns original SDK close exactly once and exposes cleanup failure',async()=>{
 const {TaskWorkspaceController}=await import('./tasks');const f=fixture();let n=0;f.client.close=async()=>{n++;throw Error('PUBLIC close retained')};const api=createTaskAPI('http://127.0.0.1:6438',{identity:'PUBLIC',v6:f.original});const c=new TaskWorkspaceController('PUBLIC',api,{read:async()=>null,write:async()=>{}},()=> 'unused');c.dispose();c.dispose();await assert.rejects(c.whenClosed(),/close retained/);assert.equal(n,1);assert.equal(c.state.error,'V6_ORIGINAL_CLEANUP_UNRESOLVED');
});
test('corrupt falsy cold journal is not mistaken for absent storage',async()=>{const f=fixture();f.original.journal.read=async()=>false as never;const a=new NativeTaskV6Adapter('PUBLIC',f.original);await assert.rejects(a.execute(request(),new AbortController().signal),/JOURNAL_INVALID/);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0)});
test('cached task DATA cannot be mutated through a caller-owned list result',async()=>{const f=fixture(),api=createTaskV6API('PUBLIC',f.original),s=new AbortController().signal;const list=await api.list(s);list.tasks[0]!.revision=999;await api.task(t.id,s);assert.equal(f.intents[1]!.taskRevision,'2')});
test('foreign conversation or current-task response is never cached as this task',async()=>{
 const f=fixture(),api=createTaskV6API('PUBLIC',f.original),signal=new AbortController().signal;await api.list(signal);const send=f.client.send.bind(f.client);
 f.client.send=async p=>{const result=await send(p);return {...result,responseOriginal:{...result.responseOriginal!,bodyOriginal:new TextEncoder().encode(JSON.stringify({...t,id:'foreign',cursor:2,hasMore:false,events:[],steps:[]}))}}};
 await assert.rejects(api.task(t.id,signal),/RESULT_INVALID/);
 f.client.send=async p=>{const result=await send(p);return {...result,responseOriginal:{...result.responseOriginal!,bodyOriginal:new TextEncoder().encode(JSON.stringify({...t,conversationId:'foreign'}))}}};
 await assert.rejects(api.create('different_conversation',signal),/RESULT_INVALID/);
});
test('normal V6 task page includes frozen SDK required afterCursor and preserves exact sequence',async()=>{const f=fixture(),api=createTaskV6API('PUBLIC',f.original),signal=new AbortController().signal;await api.list(signal);await api.task(t.id,signal,42);assert.equal(f.intents[1]!.path,'/api/tasks/task_original?afterCursor=42');await assert.rejects(async()=>api.task(t.id,signal,-1),/CURSOR_INVALID/)});
test('bounded observation journal compacts only terminal reads and preserves effects/UNKNOWN',async()=>{const f=fixture(),a=new NativeTaskV6Adapter('PUBLIC',f.original);f.client.send=async()=>{const i=f.intents.at(-1)!;return {operationId:i.operationId,phase:'OBSERVED',unknown:false} as Observation};await a.execute(request(),new AbortController().signal);f.client.send=async()=>{throw Error('PUBLIC read unknown')};await assert.rejects(a.execute(request('task.run-read'),new AbortController().signal),/read unknown/);const retainedUnknown=f.saved!.entries.at(-1)!.operationId;f.client.send=async()=>({operationId:f.intents.at(-1)!.operationId,phase:'OBSERVED',unknown:false} as Observation);for(let i=0;i<160;i++)await a.execute(request('task.read'),new AbortController().signal);assert.ok(f.saved!.entries.length<=35);assert.ok(f.saved!.entries.some(e=>e.action==='task.cancel'));assert.equal(f.saved!.entries.find(e=>e.operationId===retainedUnknown)!.state,'UNKNOWN')});
test('original reconcile query remains available despite an UNKNOWN effect journal',async()=>{const f=fixture(),a=new NativeTaskV6Adapter('PUBLIC',f.original);f.client.send=async()=>{throw Error('PUBLIC original effect unknown')};await assert.rejects(a.execute(request('task.dispatch'),new AbortController().signal));f.client.send=async()=>({operationId:f.intents.at(-1)!.operationId,phase:'OBSERVED',unknown:false} as Observation);await a.execute(request('task.reconcile'),new AbortController().signal);await a.execute(request('task.reconcile'),new AbortController().signal);assert.equal(f.saved!.entries[0]!.state,'UNKNOWN');assert.deepEqual(f.intents.map(i=>i.action),['task.dispatch','task.reconcile','task.reconcile'])});

test('cold original lookups retain one context and cancellation never renews it',async()=>{
 const f=fixture(),warm=new NativeTaskV6Adapter('PUBLIC',f.original);
 await warm.execute(request(),new AbortController().signal);
 const cold=new NativeTaskV6Adapter('PUBLIC',f.original),contexts:unknown[]=[];
 f.client.lookupOriginal=async(op,c)=>{contexts.push(c);return {op} as never};
 await cold.lookupOriginal('operation_1',new AbortController().signal);
 await cold.lookupOriginal('operation_1',new AbortController().signal);
 assert.equal(contexts.length,2);assert.equal(contexts[0],contexts[1]);
 let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
 f.client.lookupOriginal=async(_op,c)=>{contexts.push(c);entered();await new Promise<void>(r=>c.signal.addEventListener('abort',()=>r(),{once:true}));throw Error('PUBLIC lookup cancelled')};
 const abort=new AbortController(),pending=cold.lookupOriginal('operation_1',abort.signal);await started;
 await assert.rejects(cold.lookupOriginal('operation_1',new AbortController().signal),/LOOKUP_ALREADY_ACTIVE/);
 abort.abort();await assert.rejects(pending,/lookup cancelled/);
 await assert.rejects(cold.lookupOriginal('operation_1',new AbortController().signal),/CONTEXT_CANCELLED_REOPEN_FOR_QUERY/);
 assert.equal(contexts.length,3);assert.equal(contexts[2],contexts[0]);
 assert.equal(f.intents.length,1);assert.equal(f.saved!.entries[0]!.state,'COMMITTED');await cold.close();
});
