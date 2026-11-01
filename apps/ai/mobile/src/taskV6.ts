import {readTask,readTaskList,readTaskProjection,readTaskRun,readTaskReceipt,readTaskAction} from './taskResults';
// Product orchestration only. SDK owns canonical bytes, SAME held review,
// signatures, transport, Source-current and verified original outcome custody.
import type {OriginalAITaskActionV6Client as Client,OriginalAITaskActionV6Intent as Intent,OriginalAITaskActionV6Observation as Observation} from '../contracts/sdk047/original-ai-task-action-v6-client';
import type {Task,TaskProjection,TaskRun,TaskReceipt} from './tasks';
export type V6Entry={version:'6';operationId:string;binding:string;action:Intent['action'];taskId:string|null;state:'PENDING'|'UNKNOWN'|'COMMITTED'|'ACCEPTED'|'OBSERVED'|'DENIED';firstCause?:'SDK_OR_TRANSPORT_UNRESOLVED'|'CANCELLED'|'LOCAL_PERSISTENCE_FAILED'};
export type V6Journal={version:'6';entries:V6Entry[]};
export type V6Persistence={read(identity:string):Promise<V6Journal|null>;write(identity:string,journal:V6Journal):Promise<void>};
export type NativeTaskV6={client:Client;journal:V6Persistence;newOperationId:()=>string};
type Request=Omit<Intent,'operationId'|'abortContext'>;
const id=(v:string)=>{if(!/^[A-Za-z0-9_-]{1,128}$/.test(v))throw Error('V6_ORIGINAL_IDENTIFIER_REQUIRED');return v};
export function validateV6Journal(value:unknown):V6Journal{
 const j=value as V6Journal;if(!j||j.version!=='6'||Object.keys(j).sort().join(',')!=='entries,version'||!Array.isArray(j.entries)||j.entries.length>128)throw Error('V6_JOURNAL_INVALID');
 const ids=new Set<string>();for(const e of j.entries){if(!e||e.version!=='6'||typeof e.binding!=='string'||e.binding.length>1024||typeof e.action!=='string'||(e.firstCause!==undefined&&!['SDK_OR_TRANSPORT_UNRESOLVED','CANCELLED','LOCAL_PERSISTENCE_FAILED'].includes(e.firstCause))||!['PENDING','UNKNOWN','COMMITTED','ACCEPTED','OBSERVED','DENIED'].includes(e.state)||!(e.taskId===null||typeof e.taskId==='string')||Object.keys(e).some(k=>!['version','operationId','binding','action','taskId','state','firstCause'].includes(k)))throw Error('V6_JOURNAL_INVALID');id(e.operationId);if(ids.has(e.operationId))throw Error('V6_JOURNAL_INVALID');ids.add(e.operationId)}return j;
}
export class NativeTaskV6Adapter{
 private record:V6Journal|null=null;private active=new Map<string,AbortController>();private queue=Promise.resolve();private closed=false;private closing:Promise<void>|null=null;private flights=new Set<Promise<unknown>>();
 constructor(private identity:string,private original:NativeTaskV6){if(!identity)throw Error('V6_IDENTITY_REQUIRED')}
 private async locked<T>(fn:()=>Promise<T>){const before=this.queue;let release!:()=>void;this.queue=new Promise<void>(r=>release=r);await before;try{return await fn()}finally{release()}}
 private async load(){if(!this.record){const original=await this.original.journal.read(this.identity);this.record=validateV6Journal(original===null?{version:'6',entries:[]}:original);}return this.record}
 private async save(){await this.original.journal.write(this.identity,JSON.parse(JSON.stringify(this.record)) as V6Journal)}
 private track<T>(p:Promise<T>){this.flights.add(p);void p.then(()=>this.flights.delete(p),()=>this.flights.delete(p));return p}
 execute(request:Request,signal:AbortSignal):Promise<Observation>{
  const snapshot=Object.freeze({...request,bodyOriginal:request.bodyOriginal.slice(),creationBinding:request.creationBinding?Object.freeze({...request.creationBinding}):null}) as Request;
  return this.track(this.perform(snapshot,signal));
 }
 private async perform(request:Request,signal:AbortSignal):Promise<Observation>{
  if(this.closed)throw Error('V6_CLIENT_CLOSED');if(signal.aborted)throw Error('V6_CANCELLED');
  const binding=JSON.stringify([request.action,request.taskId,request.taskRevision,request.generation,request.stepId,request.runId,request.creationBinding]);
  const entry=await this.locked(async()=>{const record=await this.load();if(this.closed||signal.aborted)throw Error('V6_CANCELLED');
   // Read-only fresh observations may be repeated. Effects never reuse a new
   // nonce/op to escape a retained original delivery, including DENIED.
   const read=['task.list','task.read','task.step-result','task.run-read','task.reconcile'].includes(request.action);
   if(!read&&record.entries.some(e=>e.binding===binding||(request.action!=='task.cancel'&&request.taskId!==null&&e.taskId===request.taskId&&['PENDING','UNKNOWN'].includes(e.state))))throw Error('V6_ORIGINAL_QUERY_REQUIRED');
   // Compact only terminal read observations. Never discard effects or any
   // uncertain original operation to make room for a reconnect.
   const terminalReads=record.entries.filter(e=>['task.list','task.read','task.step-result','task.run-read','task.reconcile'].includes(e.action)&&['OBSERVED','COMMITTED','DENIED'].includes(e.state));
   const remove=new Set(terminalReads.slice(0,Math.max(0,terminalReads.length-32)).map(e=>e.operationId));
   if(remove.size)record.entries=record.entries.filter(e=>!remove.has(e.operationId));
   if(record.entries.length>=128)throw Error('V6_JOURNAL_FULL');
   const operationId=id(this.original.newOperationId());if(record.entries.some(e=>e.operationId===operationId))throw Error('V6_ORIGINAL_QUERY_REQUIRED');
   const e:V6Entry={version:'6',operationId,binding,action:request.action,taskId:request.taskId,state:'PENDING'};record.entries.push(e);await this.save();return e;
  });
  const abort=new AbortController();const cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();this.active.set(entry.operationId,abort);
  const context=Object.freeze({signal:abort.signal});
  try{
   if(this.closed||abort.signal.aborted)throw Error('V6_CANCELLED');
   const packet=this.original.client.prepare({...request,bodyOriginal:request.bodyOriginal.slice(),operationId:entry.operationId,abortContext:context});
   // The frozen SDK client obtains one review, passes SAME review to its
   // original producer, checks original bytes/current, then verifies outcome.
   await this.original.client.prove(packet);
   if(this.closed||abort.signal.aborted)throw Error('V6_CANCELLED');
   const result=await this.original.client.send(packet);
   if(result.operationId!==entry.operationId||result.unknown||!['COMMITTED','ACCEPTED','OBSERVED','DENIED'].includes(result.phase))throw Error('V6_ORIGINAL_OUTCOME_UNRESOLVED');
   // Metadata flags remain DATA. No ToolGrant/model/funds completion promotion.
   await this.locked(async()=>{entry.state=result.phase as V6Entry['state'];await this.save()});
   if(this.closed||abort.signal.aborted)throw Error('V6_CANCELLED');return result;
  }catch(error){await this.locked(async()=>{entry.state='UNKNOWN';entry.firstCause??=abort.signal.aborted?'CANCELLED':'SDK_OR_TRANSPORT_UNRESOLVED';try{await this.save()}catch{entry.firstCause??='LOCAL_PERSISTENCE_FAILED';throw Error('V6_JOURNAL_WRITE_FAILED_ORIGINAL_RETAINED')}});throw error}
  finally{signal.removeEventListener('abort',cancel);this.active.delete(entry.operationId)}
 }
 // Cold recovery requires the retained original op. Lookup never prepares,
 // proves or sends a replacement. Its evidence remains opaque DATA, not success.
 async lookupOriginal(operationId:string,signal:AbortSignal){
  if(this.closed||signal.aborted)throw Error('V6_CANCELLED');id(operationId);
  const exists=await this.locked(async()=>(await this.load()).entries.some(e=>e.operationId===operationId));if(!exists)throw Error('V6_ORIGINAL_OPERATION_NOT_RETAINED');if(this.closed||signal.aborted)throw Error('V6_CANCELLED');
  return this.track((async()=>{const abort=new AbortController(),cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();const key='lookup:'+operationId;if(this.active.has(key)){signal.removeEventListener('abort',cancel);throw Error('V6_ORIGINAL_LOOKUP_ALREADY_ACTIVE')}this.active.set(key,abort);try{const token=await this.original.client.lookupOriginal(operationId,Object.freeze({signal:abort.signal}));const result=this.original.client.readRecovery(token);if(this.closed||abort.signal.aborted||result.operationId!==operationId)throw Error('V6_ORIGINAL_LOOKUP_MISMATCH');return result}finally{signal.removeEventListener('abort',cancel);this.active.delete(key)}})());
 }
 async retained(){return this.locked(async()=>JSON.parse(JSON.stringify(await this.load())) as V6Journal)}
 abortLocal(operationId:string){this.active.get(operationId)?.abort()}
 close(){if(this.closing)return this.closing;this.closed=true;for(const a of this.active.values())a.abort();this.closing=(async()=>{await Promise.allSettled([...this.flights]);await this.original.client.close()})();return this.closing}
}
const utf8=new TextEncoder();
export function createTaskV6API(identity:string,original:NativeTaskV6){
 const adapter=new NativeTaskV6Adapter(identity,original),tasks=new Map<string,Task>();
 const snapshot=(key:string)=>{const t=tasks.get(id(key));if(!t)throw Error('V6_TASK_SNAPSHOT_REQUIRED');return {...t}};
 const remember=<T>(value:T):T=>{const v=value as unknown as {id?:string;tasks?:Task[];task?:Task};if(v.task)tasks.set(v.task.id,{...v.task});if(Array.isArray(v.tasks))for(const t of v.tasks)tasks.set(t.id,{...t});if(v.id&&typeof (v as Task).revision==='number')tasks.set(v.id,{...(v as Task)});return value};
 async function call<T>(action:Intent['action'],path:string,signal:AbortSignal,body?:unknown,task?:Task,stepId:string|null=null,runId:string|null=null,conversationId?:string):Promise<T>{
  if(task)task=readTask(task);
  const request:Request={action,path,method:body===undefined?'GET':'POST',bodyOriginal:utf8.encode(body===undefined?'':JSON.stringify(body)),taskId:task?.id??null,taskRevision:task?String(task.revision):null,generation:task?String(task.generation):null,stepId,runId,creationBinding:conversationId?{conversationId}:null} as Request;
  const observed=await adapter.execute(request,signal);const response=observed.responseOriginal;
  if(observed.phase==='DENIED'||!response||!response.complete||response.status<200||response.status>=300)throw Error('V6_ORIGINAL_RESPONSE_REJECTED');
  // This JSON is only product display DATA after the original SDK send/outcome
  // fences. Never decode a member, build a header, or infer Source from JSON.
  if(response.bodyOriginal.byteLength>1<<20)throw Error('TASK_ORIGINAL_RESULT_TOO_LARGE');
  const data:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.bodyOriginal));
  let value:unknown=data;
  switch(action){
   case 'task.list':value=readTaskList(data);break;
   case 'task.create':value=readTask(data,undefined,conversationId);break;
   case 'task.read':value=readTaskProjection(data,task!.id);break;
   case 'task.prepare':case 'task.cancel':case 'task.complete':value=readTaskAction(data,task!,action.slice(5) as 'prepare'|'cancel'|'complete');break;
   case 'task.run-start':case 'task.run-resume':case 'task.run-read':value=readTaskRun(data,task!,runId!);break;
   case 'task.dispatch':case 'task.step-result':value=readTaskReceipt(data,stepId!);break;
  }
  return remember(value as T);
 }
 return {
  list:(s:AbortSignal,after='')=>call<{tasks:Task[];nextId?:string;hasMore:boolean}>('task.list',`/api/tasks?afterId=${after?id(after):''}`,s),
  task:(key:string,s:AbortSignal,afterCursor=0)=>{if(!Number.isSafeInteger(afterCursor)||afterCursor<0)throw Error('TASK_CURSOR_INVALID');return call<TaskProjection>('task.read',`/api/tasks/${id(key)}?afterCursor=${afterCursor}`,s,undefined,snapshot(key))},
  create:(conversationId:string,s:AbortSignal)=>call<Task>('task.create','/api/tasks',s,{conversationId:id(conversationId)},undefined,null,null,conversationId),
  prepare:(t:Task,s:AbortSignal)=>call<{task:Task}>('task.prepare',`/api/tasks/${id(t.id)}/prepare`,s,{revision:t.revision,generation:t.generation},t),
  cancel:(t:Task,s:AbortSignal)=>call<{task:Task;remoteRollback:false}>('task.cancel',`/api/tasks/${id(t.id)}/cancel`,s,{revision:t.revision,generation:t.generation},t),
  handoff:async(_t:Task,_holder:string,_ref:string,_s:AbortSignal):Promise<{task:Task}>=>{throw Error('AI_TASK_HANDOFF_UNREGISTERED')},
  complete:(t:Task,run:string,s:AbortSignal)=>call<{task:Task}>('task.complete',`/api/tasks/${id(t.id)}/complete`,s,{revision:t.revision,generation:t.generation,runId:id(run)},t,null,run),
  propose:(t:Task,operationId:string,toolId:string,input:unknown,s:AbortSignal)=>call<unknown>('task.propose-tool-step',`/api/tasks/${id(t.id)}/tool-steps`,s,{operationId:id(operationId),taskRevision:t.revision,generation:t.generation,toolId,toolVersion:'1',input},t),
  approve:(key:string,step:string,authorizationRef:string,s:AbortSignal)=>call<unknown>('task.approve',`/api/tasks/${id(key)}/tool-steps/${id(step)}/approve`,s,{authorizationRef},snapshot(key),step),
  dispatch:(key:string,step:string,authorizationRef:string,s:AbortSignal)=>call<TaskReceipt>('task.dispatch',`/api/tasks/${id(key)}/tool-steps/${id(step)}/dispatch`,s,{authorizationRef},snapshot(key),step),
  reconcile:(key:string,step:string,authorizationRef:string,s:AbortSignal)=>call<unknown>('task.reconcile',`/api/tasks/${id(key)}/tool-steps/${id(step)}/reconcile`,s,{authorizationRef},snapshot(key),step),
  result:(key:string,step:string,s:AbortSignal)=>call<TaskReceipt>('task.step-result',`/api/tasks/${id(key)}/tool-steps/${id(step)}/result`,s,undefined,snapshot(key),step),
  run:(t:Task,runId:string,prompt:string,authorizationRef:string,toolIds:string[],resume:boolean,s:AbortSignal)=>call<TaskRun>(resume?'task.run-resume':'task.run-start',`/api/tasks/${id(t.id)}/runs`,s,{runId:id(runId),taskRevision:t.revision,generation:t.generation,prompt,authorizationRef,toolIds,resume},t,null,runId),
  runView:(key:string,runId:string,s:AbortSignal)=>call<TaskRun>('task.run-read',`/api/tasks/${id(key)}/runs/${id(runId)}`,s,undefined,snapshot(key),null,runId),
  adapter
 };
}
