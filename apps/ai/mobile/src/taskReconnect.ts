import type {Task,TaskAPI,TaskEvent,TaskProjection,TaskRun,TaskReceipt,TaskStep} from './tasks';
import {readTaskProjection,readTaskRun,readTaskReceipt} from './taskResults';
export type RunCursor={version:'1';taskId:string;runId:string;recordId:string|null;cursor:number};
export type RunCursorPersistence={read(identity:string,taskId:string,runId:string):Promise<RunCursor|null>;write(identity:string,value:RunCursor):Promise<void>};
export type RunObservation={task:TaskProjection;run:TaskRun;receipts:TaskReceipt[];events:TaskEvent[];cursor:number;hasMore:boolean};
const identifier=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export function readRunCursor(value:unknown,taskId:string,runId:string):RunCursor{
 const v=value as RunCursor;
 if(!v||Object.keys(v).sort().join('|')!=='cursor|recordId|runId|taskId|version'||v.version!=='1'||v.taskId!==taskId||v.runId!==runId||!identifier(taskId)||!identifier(runId)||!(v.recordId===null||identifier(v.recordId))||!Number.isSafeInteger(v.cursor)||v.cursor<0)throw Error('ORIGINAL_RUN_CURSOR_INVALID');
 return {...v};
}
// A pull-based bounded event consumer on EXISTING task.read / run-read /
// step-result routes. It never starts/resumes/proves a replacement model run.
// The cursor is per task sequence, qualified by the explicit selected run.
export class OriginalRunReconnect{
 private cursor:RunCursor|null=null;private active:AbortController|null=null;private inflight:Promise<RunObservation>|null=null;private closed=false;
 private knownSteps=new Map<string,TaskStep>();
 constructor(private identity:string,private task:Task,private runId:string,private api:Pick<TaskAPI,'task'|'runView'|'result'>,private storage:RunCursorPersistence){
  if(!identity||!identifier(task.id)||!identifier(runId))throw Error('ORIGINAL_RUN_BINDING_REQUIRED');this.task={...task};const initial=task as Partial<TaskProjection>;if(Array.isArray(initial.steps))for(const step of initial.steps)this.knownSteps.set(step.id,{...step,toolStep:{...step.toolStep}});
 }
 reconnect(signal:AbortSignal,deliver:(value:RunObservation)=>Promise<void>):Promise<RunObservation>{
  if(this.closed||signal.aborted)return Promise.reject(Error('ORIGINAL_RUN_RECONNECT_CANCELLED'));
  if(this.inflight)return Promise.reject(Error('ORIGINAL_RUN_RECONNECT_ALREADY_ACTIVE'));
  const p=this.poll(signal,deliver);this.inflight=p;void p.then(()=>{this.inflight=null},()=>{this.inflight=null});return p;
 }
 private async poll(signal:AbortSignal,deliver:(value:RunObservation)=>Promise<void>){
  const abort=new AbortController(),cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();this.active=abort;
  const current=()=>{if(this.closed||abort.signal.aborted)throw Error('ORIGINAL_RUN_RECONNECT_CANCELLED')};
  try{
   current();if(this.cursor===null){const original=await this.storage.read(this.identity,this.task.id,this.runId);current();this.cursor=original===null?{version:'1',taskId:this.task.id,runId:this.runId,recordId:null,cursor:0}:readRunCursor(original,this.task.id,this.runId)}
   const previous={...this.cursor};
   const page=readTaskProjection(await this.api.task(this.task.id,abort.signal,previous.cursor),this.task.id);current();
   if(page.cursor<previous.cursor||page.hasMore&&page.cursor===previous.cursor)throw Error('ORIGINAL_RUN_CURSOR_NOT_ADVANCING');
   let seq=previous.cursor;for(const event of page.events){if(event.sequence<=seq||event.sequence>page.cursor)throw Error('ORIGINAL_RUN_EVENT_ORDER_INVALID');seq=event.sequence}
   if(page.holder!==this.task.holder||page.generation!==this.task.generation)this.knownSteps.clear();
   for(const step of page.steps)this.knownSteps.set(step.id,{...step,toolStep:{...step.toolStep}});
   // Cancellation/handoff is metadata recovery, never permission to publish an
   // earlier answer under the new holder/generation.
   const run=readTaskRun(await this.api.runView(this.task.id,this.runId,abort.signal),page,this.runId);current();
   if(page.recoveryOnly){if(run.content)throw Error('ORIGINAL_RUN_HISTORY_CANNOT_RELEASE_ANSWER');run.recoveryOnly=true;}
   if(previous.recordId!==null&&run.id!==previous.recordId)throw Error('ORIGINAL_RUN_RECORD_CHANGED');
   const retainedSteps=new Set(run.steps);if(this.knownSteps.size>256)for(const [key,step] of this.knownSteps){if(!retainedSteps.has(key)&&['COMPLETED','CANCELLED'].includes(step.status))this.knownSteps.delete(key)}
   if(this.knownSteps.size>256)throw Error('ORIGINAL_RUN_STEP_CACHE_FULL');
   page.steps=[...this.knownSteps.values()];
   const receipts:TaskReceipt[]=[];
   if(!page.recoveryOnly&&!run.recoveryOnly){for(const stepId of run.steps){
    // Cold reconnect with a terminal run rereads its SAME receipts even if the
    // earlier event page was acknowledged before process termination.
    const step=this.knownSteps.get(stepId);
    if(run.status!=='COMPLETED'&&step?.status!=='COMPLETED')continue;
    receipts.push(readTaskReceipt(await this.api.result(this.task.id,stepId,abort.signal),stepId,step?.toolStep.authorityOperationId));current();
   }}
   const selected=new Set([run.id,...run.steps,this.task.id]);
   const observation:RunObservation={task:page,run,receipts,events:page.events.filter(e=>selected.has(e.objectId)),cursor:page.cursor,hasMore:page.hasMore};
   const next:RunCursor={...previous,recordId:run.id,cursor:page.cursor};
   const taskSnapshot={...page};
   current();await deliver(observation);current();
   // A failed read/delivery/save cannot skip events. Saving only metadata means
   // cold reconnect always rechecks actual current run/result authority.
   await this.storage.write(this.identity,{...next});this.cursor=next;this.task=taskSnapshot;current();
   return observation;
  }finally{signal.removeEventListener('abort',cancel);this.active=null}
 }
 async checkpoint(){if(this.cursor===null)return null;return {...this.cursor}}
 async close(){this.closed=true;this.active?.abort();await Promise.allSettled(this.inflight?[this.inflight]:[])}
}
