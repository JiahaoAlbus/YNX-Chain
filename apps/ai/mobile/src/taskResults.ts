import type {Task,TaskProjection,TaskRun,TaskReceipt,TaskStep} from './tasks';
// Product display boundaries only. These checks never verify a signature,
// produce a Grant, or promote an SDK declaration into business authority.
const fail=():never=>{throw Error('TASK_ORIGINAL_RESULT_INVALID')};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail();
const text=(v:unknown,max:number,empty=false):string=>typeof v==='string'&&v.length<=max&&(empty||v.length>0)?v:fail();
const identifier=(v:unknown):string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)?v:fail();
const integer=(v:unknown,zero=false):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=(zero?0:1)?v:fail();
const array=(v:unknown,max:number):unknown[]=>Array.isArray(v)&&v.length<=max?v:fail();
const bool=(v:unknown):boolean=>typeof v==='boolean'?v:fail();
export class TaskAPIError extends Error {
 constructor(public status:number,public code:string){super(code||`HTTP_${status}`)}
}
export function readTask(value:unknown,expectedId?:string,conversationId?:string):Task{
 const v=object(value);const task:Task={id:identifier(v.id),conversationId:identifier(v.conversationId),holder:text(v.holder,256),revision:integer(v.revision),generation:integer(v.generation),status:text(v.status,64)};
 if(!['DRAFT','READY','WORKING','NEEDS_APPROVAL','COMPLETED','FAILED','CANCELLED','RECONCILING'].includes(task.status)||expectedId!==undefined&&task.id!==expectedId||conversationId!==undefined&&task.conversationId!==conversationId)fail();
 if(v.cancelledAt!==undefined)task.cancelledAt=text(v.cancelledAt,64,true);
 return task;
}
export function readTaskList(value:unknown){
 const v=object(value),tasks=array(v.tasks,100).map(t=>readTask(t));if(new Set(tasks.map(t=>t.id)).size!==tasks.length)fail();
 const hasMore=bool(v.hasMore);const nextId=v.nextId===undefined?'':text(v.nextId,128,true);if(nextId)identifier(nextId);if(hasMore&&!nextId)fail();
 return {tasks,hasMore,nextId};
}
export function readTaskProjection(value:unknown,expectedId:string):TaskProjection{
 const v=object(value),task=readTask(v,expectedId),cursor=integer(v.cursor,true),hasMore=bool(v.hasMore);
 const steps=array(v.steps,100).map(raw=>{
  const r=object(raw),s=object(r.toolStep);if(s.taskId!==task.id)fail();
  const step:TaskStep={id:identifier(r.id),status:text(r.status,64),toolStep:{taskId:task.id,taskRevision:integer(s.taskRevision),generation:integer(s.generation),holder:text(s.holder,256),toolId:text(s.toolId,128),toolVersion:text(s.toolVersion,64)}};
  if(s.inputDigest!==undefined)step.toolStep.inputDigest=text(s.inputDigest,256);
  if(s.approvedFields!==undefined)step.toolStep.approvedFields=array(s.approvedFields,64).map(f=>text(f,128));
  for(const k of ['authorityOperationId','authorityReferenceState','remoteOperationId','remoteRef','effectFirstCause'] as const)if(s[k]!==undefined)step.toolStep[k]=text(s[k],1024,true);
  return step;
 });if(new Set(steps.map(s=>s.id)).size!==steps.length)fail();
 const events=array(v.events,100).map(raw=>{const e=object(raw);return {sequence:integer(e.sequence),type:text(e.type,128),objectId:text(e.objectId,256,true),at:text(e.at,64)}});
 return {...task,cursor,hasMore,steps,events,...(v.recoveryOnly!==undefined?{recoveryOnly:bool(v.recoveryOnly)}:{})};
}
export function readTaskRun(value:unknown,task:Task,runId:string):TaskRun{
 const v=object(value);if(v.taskId!==task.id||v.runId!==runId)fail();
 const status=text(v.status,64);if(!['WORKING','NEEDS_APPROVAL','UNKNOWN','STOPPED','COMPLETED','RETURN_PENDING','RETURN_BLOCKED'].includes(status))fail();
 // Historical recovery responses intentionally omit revision/generation.
 // When supplied, they must match this current task snapshot exactly.
 const recoveryOnly=bool(v.recoveryOnly);
 const cancelled=v.cancelled===undefined?false:bool(v.cancelled);
 for(const [key,expected] of [['taskRevision',task.revision],['generation',task.generation]] as const){if(v[key]===undefined)continue;if(recoveryOnly&&v[key]===0)continue;const original=integer(v[key]);if(original!==expected&&!((recoveryOnly||cancelled)&&!v.content))fail()}
 const steps=v.steps===null?[]:array(v.steps,64).map(identifier);if(new Set(steps).size!==steps.length)fail();
 const run:TaskRun={id:identifier(v.id),runId,taskId:task.id,status,steps,recoveryOnly};
 if(v.firstCause!==undefined)run.firstCause=text(v.firstCause,256,true);
 if(v.content!==undefined){const content=text(v.content,2<<20,true);if(content&&(status!=='COMPLETED'||recoveryOnly||cancelled))fail();run.content=content}
 return run;
}
export function readTaskReceipt(value:unknown,stepId:string):TaskReceipt{
 const v=object(value);
 if(v.scope==='external-content-observation-only'){
  if(v.operationId!==stepId||v.state!=='CONTENT_PRESENT'||v.contentState!=='CONTENT_PRESENT'||v.authorshipProven!==false||typeof v.writeAcknowledged!=='boolean'||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))fail();
  identifier(v.resourceId);identifier(v.destinationId);text(v.remoteId,2048);integer(v.bytes,true);text(v.observedAt,64);
  return {state:'CONTENT_PRESENT',effectRef:stepId,scope:'external-content-observation-only',result:{...v}};
 }
 if(v.effectRef!==stepId||v.state!=='COMMITTED'||!Object.hasOwn(v,'result'))fail();
 const receipt:TaskReceipt={state:'COMMITTED',effectRef:stepId,result:v.result};
 for(const k of ['originalOperationId','authorityOperationId','remoteRef','authScope'] as const)if(v[k]!==undefined)receipt[k]=text(v[k],1024,true);
 // Preserve the business result as display DATA; never replace it with model
 // prose, assume an external write, or mark the parent workflow completed.
 return receipt;
}
export function readTaskAction(value:unknown,expected:Task,action:'prepare'|'cancel'|'complete'){
 const v=object(value),task=readTask(v.task,expected.id,expected.conversationId);
 if(task.holder!==expected.holder||task.generation!==expected.generation||task.revision<expected.revision)fail();
 if(action==='cancel'&&v.remoteRollback!==false)fail();
 return {task,...(action==='cancel'?{remoteRollback:false as const}:{})};
}
