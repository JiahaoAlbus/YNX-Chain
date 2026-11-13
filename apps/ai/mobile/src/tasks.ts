import {OriginalRunReconnect,type RunCursorPersistence} from './taskReconnect';
import {readTaskRun,readTaskReceipt,readTaskProjection,readTaskList} from './taskResults';
import {createTaskV6API,type NativeTaskV6} from './taskV6';
// Native task orchestration only. Canonical proof acquisition belongs to the
// original Wallet session; neither a legacy token nor this UI grants authority.
export type TaskScope="ai:conversations"|"ai:permissions"|"ai:generate";
// Transport operands for the original matching SDK signer, not an authority
// DTO or new proof grammar. The shared SDK owns canonical bytes/domain/version.
export type TaskRequestSnapshot=Readonly<{method:"GET"|"POST";path:string;bodyOriginal:string}>;
export type TaskCredentials={identity:string;proof?:(scope:TaskScope,request:TaskRequestSnapshot)=>Promise<string>;v6?:NativeTaskV6};
export type Task={id:string;conversationId:string;holder:string;revision:number;generation:number;status:string;cancelledAt?:string};
export type TaskStep={id:string;status:string;toolStep:{taskId:string;taskRevision:number;generation:number;holder:string;toolId:string;toolVersion:string;inputDigest?:string;approvedFields?:string[];authorityOperationId?:string;authorityReferenceState?:string;remoteOperationId?:string;remoteRef?:string;effectFirstCause?:string}};
export function needsOriginalTaskQuery(step:TaskStep):boolean {
 return ["PENDING","SENT","UNKNOWN","DISPATCHING","RECONCILING"].includes(step.status) ||
  (step.status==="COMPLETED" && step.toolStep.toolId==="ai.conversation.read" &&
   !!step.toolStep.authorityOperationId && step.toolStep.authorityReferenceState!=="COMMITTED");
}
export type TaskEvent={sequence:number;type:string;objectId:string;at:string};
export type TaskProjection=Task&{cursor:number;hasMore:boolean;recoveryOnly?:boolean;events:TaskEvent[];steps:TaskStep[]};
export type TaskRun={id:string;runId:string;taskId:string;status:string;steps:string[];content?:string;firstCause?:string;recoveryOnly:boolean};
export type TaskReceipt={scope?:string;state:string;effectRef:string;originalOperationId?:string;authorityOperationId?:string;remoteRef?:string;result:unknown;authScope?:string};
export type Delivery={version?:"2"|"6";id:string;binding:string;action:string;taskId:string;conversationId?:string;stepId?:string;runId?:string;revision?:number;generation?:number;state:"PENDING"|"UNKNOWN"|"RESPONSE_RECEIVED"|"REJECTED_RESPONSE"|"ORIGINAL_OBSERVED"};
export type WorkspaceRecord={selectedTask:string;selectedResultStep?:string;runId:string;deliveries:Delivery[]};
export type TaskPersistence={read:(identity:string)=>Promise<WorkspaceRecord|null>;write:(identity:string,value:WorkspaceRecord)=>Promise<void>};
export class TaskAPIError extends Error{constructor(public status:number,public code:string){super(code||`HTTP_${status}`)}}
const segmentOrEmpty=(id:string)=>{if(id!=="")segment(id)};
const segment=(id:string)=>{if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error("INVALID_ORIGINAL_IDENTIFIER");return id};

function createLegacyTaskAPI(base:string,credentials:TaskCredentials,fetcher:typeof fetch=fetch){
 const endpoint=new URL(base);if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!['http:','https:'].includes(endpoint.protocol))throw new Error("INVALID_TASK_ENDPOINT");
 const request=async<T>(path:string,scope:TaskScope,signal:AbortSignal,body?:unknown):Promise<T>=>{
  const method=body===undefined?"GET":"POST",bodyOriginal=body===undefined?"":JSON.stringify(body);const snapshot:TaskRequestSnapshot=Object.freeze({method,path,bodyOriginal});
  if(method!=="GET"&&!/^\/api\/tasks\/[A-Za-z0-9_-]+\/tool-steps\/[A-Za-z0-9_-]+\/reconcile$/.test(path))throw new Error("AI_V6_NATIVE_CLIENT_FACTORY_NOT_SUPPLIED_LEGACY_QUERY_ONLY");
  if(!credentials.proof)throw new Error("AI_V6_NATIVE_CLIENT_FACTORY_NOT_SUPPLIED");
  const proof=await credentials.proof(scope,snapshot);if(signal.aborted)throw new Error("TASK_REQUEST_CANCELLED");if(!proof||proof.length>16384||/[\r\n\0]/.test(proof))throw new Error("CANONICAL_TASK_PROOF_UNAVAILABLE");
  const response=await fetcher(`${base.replace(/\/$/,"")}${path}`,{method,redirect:"error",credentials:"omit",signal,headers:{Accept:"application/json",...(body===undefined?{}:{"Content-Type":"application/json"}),"X-YNX-Product-Session-Proof-V2":proof},body:body===undefined?undefined:bodyOriginal});
  if(response.redirected)throw new Error("TASK_REDIRECT_REJECTED");
  const raw=await response.text();if(raw.length>20<<20)throw new Error("TASK_RESPONSE_TOO_LARGE");const value=JSON.parse(raw);
  if(!response.ok)throw new TaskAPIError(response.status,typeof value.code==="string"?value.code:`HTTP_${response.status}`);
  return value as T;
 };
 return {
  list:(signal:AbortSignal,after="")=>request<{tasks:Task[];nextId?:string;hasMore:boolean}>(`/api/tasks?afterId=${after?segment(after):""}`,"ai:conversations",signal),
  task:(id:string,signal:AbortSignal,afterCursor=0)=>request<TaskProjection>(`/api/tasks/${segment(id)}?afterCursor=${Number.isSafeInteger(afterCursor)&&afterCursor>=0?afterCursor:(()=>{throw Error("TASK_CURSOR_INVALID")})()}`,"ai:conversations",signal),
  create:(conversationId:string,signal:AbortSignal)=>request<Task>("/api/tasks","ai:conversations",signal,{conversationId:segment(conversationId)}),
  prepare:(task:Task,signal:AbortSignal)=>request<{task:Task}>(`/api/tasks/${segment(task.id)}/prepare`,"ai:permissions",signal,{revision:task.revision,generation:task.generation}),
  cancel:(task:Task,signal:AbortSignal)=>request<{task:Task;remoteRollback:false}>(`/api/tasks/${segment(task.id)}/cancel`,"ai:permissions",signal,{revision:task.revision,generation:task.generation}),
  handoff:(task:Task,newHolder:string,authorizationRef:string,signal:AbortSignal)=>request<{task:Task}>(`/open/v1/tasks/${segment(task.id)}/handoffs`,"ai:permissions",signal,{revision:task.revision,generation:task.generation,newHolder,authorizationRef}),
  complete:(task:Task,runId:string,signal:AbortSignal)=>request<{task:Task}>(`/api/tasks/${segment(task.id)}/complete`,"ai:permissions",signal,{revision:task.revision,generation:task.generation,runId:segment(runId)}),
  propose:(task:Task,operationId:string,toolId:string,input:unknown,signal:AbortSignal)=>request<unknown>(`/api/tasks/${segment(task.id)}/tool-steps`,"ai:permissions",signal,{operationId:segment(operationId),taskRevision:task.revision,generation:task.generation,toolId,toolVersion:"1",input}),
  approve:(task:string,step:string,authorizationRef:string,signal:AbortSignal)=>request<unknown>(`/api/tasks/${segment(task)}/tool-steps/${segment(step)}/approve`,"ai:permissions",signal,{authorizationRef}),
  dispatch:(task:string,step:string,authorizationRef:string,signal:AbortSignal)=>request<TaskReceipt>(`/api/tasks/${segment(task)}/tool-steps/${segment(step)}/dispatch`,"ai:permissions",signal,{authorizationRef}),
  reconcile:(task:string,step:string,authorizationRef:string,signal:AbortSignal)=>request<unknown>(`/api/tasks/${segment(task)}/tool-steps/${segment(step)}/reconcile`,"ai:permissions",signal,{authorizationRef}),
  result:(task:string,step:string,signal:AbortSignal)=>request<TaskReceipt>(`/api/tasks/${segment(task)}/tool-steps/${segment(step)}/result`,"ai:conversations",signal),
  run:(task:Task,runId:string,prompt:string,authorizationRef:string,toolIds:string[],resume:boolean,signal:AbortSignal)=>request<TaskRun>(`/api/tasks/${segment(task.id)}/runs`,"ai:generate",signal,{runId:segment(runId),taskRevision:task.revision,generation:task.generation,prompt,authorizationRef,toolIds,resume}),
  runView:(task:string,runId:string,signal:AbortSignal)=>request<TaskRun>(`/api/tasks/${segment(task)}/runs/${segment(runId)}`,"ai:conversations",signal)
 };
}
export function createTaskAPI(base:string,credentials:TaskCredentials,fetcher:typeof fetch=fetch){
 if(credentials.v6)return {...createTaskV6API(credentials.identity,credentials.v6),legacyRecovery:createLegacyTaskAPI(base,{identity:credentials.identity,proof:credentials.proof},fetcher)};
 return createLegacyTaskAPI(base,credentials,fetcher);
}
export type TaskAPI=ReturnType<typeof createTaskAPI>;
export type WorkspaceState={tasks:Task[];projection:TaskProjection|null;run:TaskRun|null;receipt:TaskReceipt|null;record:WorkspaceRecord;busy:boolean;error:string;hasMore:boolean;nextId:string};

export class TaskWorkspaceController{
 state:WorkspaceState={tasks:[],projection:null,run:null,receipt:null,record:{selectedTask:"",runId:"",deliveries:[]},busy:false,error:"",hasMore:false,nextId:""};
 private disposed=false;private epoch=0;private request:AbortController|null=null;private cancellation:AbortController|null=null;private writes:Promise<void>=Promise.resolve();private hydrated=false;private originalClosing:Promise<void>|null=null;private follower:OriginalRunReconnect|null=null;private followerKey="";
 constructor(private identity:string,private api:TaskAPI,private storage:TaskPersistence,private newID:()=>string,private changed:(state:WorkspaceState)=>void=()=>{},private runCursors?:RunCursorPersistence){}
 private emit(){if(!this.disposed)this.changed({...this.state,record:{...this.state.record,deliveries:[...this.state.record.deliveries]}})}
 private persist(record:WorkspaceRecord){const snapshot=JSON.parse(JSON.stringify(record)) as WorkspaceRecord;const next=this.writes.catch(()=>{}).then(()=>this.storage.write(this.identity,snapshot));this.writes=next;return next}
 private async hydrate(){if(this.hydrated)return;const saved=await this.storage.read(this.identity);if(saved){if(!Array.isArray(saved.deliveries)||saved.deliveries.some(d=>!d||(d.version!==undefined&&d.version!=="2"&&d.version!=="6")))throw Error("TASK_JOURNAL_VERSION_INVALID");segmentOrEmpty(saved.selectedTask);segmentOrEmpty(saved.runId);if(saved.selectedResultStep!==undefined){if(!saved.selectedTask||typeof saved.selectedResultStep!=="string")throw Error("TASK_JOURNAL_INVALID");segment(saved.selectedResultStep)}this.state.record=saved;}this.hydrated=true}
 private async work<T>(fn:(signal:AbortSignal)=>Promise<T>,apply:(value:T)=>void){
  if(this.disposed||this.state.busy)return;const epoch=++this.epoch;const request=new AbortController();this.request=request;this.state.busy=true;this.state.error="";this.emit();
  try{const value=await fn(request.signal);if(!this.disposed&&epoch===this.epoch){apply(value)}}catch(error){if(!this.disposed&&epoch===this.epoch)this.state.error=error instanceof Error?error.message:"TASK_REQUEST_FAILED"}finally{if(!this.disposed&&epoch===this.epoch){this.state.busy=false;this.request=null;this.emit()}}
 }
 async restore(){await this.work(async()=>{await this.hydrate();return this.state.record},record=>{this.state.record=record})}
 // Select only the original protocol retained for this task. No re-signing or
 // conversion of V2 metadata into a V6 operation is permitted.
 private legacyTask(taskId:string){const deliveries=this.state.record.deliveries.filter(d=>d.taskId===taskId);const old=deliveries.some(d=>d.version!=="6");if(old&&deliveries.some(d=>d.version==="6"))throw Error("TASK_ORIGINAL_PROTOCOL_AMBIGUOUS");return old}
 private legacyRecovery(taskId:string){return 'legacyRecovery' in this.api&&this.legacyTask(taskId)}
 private readAPI(taskId:string){return this.legacyTask(taskId)&&'legacyRecovery' in this.api?this.api.legacyRecovery:this.api}
 async restoreOriginalTask(){
  if(this.disposed||this.state.busy)return;
  await this.work(async signal=>{
   this.state.projection=null;this.state.run=null;this.state.receipt=null;this.emit();
   await this.hydrate();if(signal.aborted)throw Error("TASK_REQUEST_CANCELLED");
   const selected=this.state.record.selectedTask;
   if(selected&&this.legacyRecovery(selected)){
    const projection=readTaskProjection(await this.readAPI(selected).task(selected,signal),selected);
    if(signal.aborted)throw Error("TASK_REQUEST_CANCELLED");
    return {tasks:[projection],projection:{...projection,recoveryOnly:true},hasMore:false,nextId:""};
   }
   const tasks:Task[]=[];let after="";const seen=new Set<string>();
   for(let pageNumber=0;pageNumber<8;pageNumber++){
    if(signal.aborted)throw Error("TASK_REQUEST_CANCELLED");
    const page=readTaskList(await this.api.list(signal,after));
    if(signal.aborted)throw Error("TASK_REQUEST_CANCELLED");
    for(const task of page.tasks)if(!tasks.some(t=>t.id===task.id))tasks.push(task);
    if(!selected||tasks.some(t=>t.id===selected)){
     const projection=selected?readTaskProjection(await this.api.task(selected,signal),selected):null;
     if(signal.aborted)throw Error("TASK_REQUEST_CANCELLED");
     return {tasks,projection,hasMore:page.hasMore,nextId:page.nextId};
    }
    if(!page.hasMore)throw Error("ORIGINAL_SELECTED_TASK_NOT_RETURNED");
    if(page.nextId===after||seen.has(page.nextId))throw Error("TASK_DISCOVERY_CURSOR_NOT_ADVANCING");
    seen.add(page.nextId);after=page.nextId;
   }
   throw Error("ORIGINAL_TASK_DISCOVERY_PAGE_LIMIT");
  },value=>{this.state.tasks=value.tasks;this.state.projection=value.projection;this.state.hasMore=value.hasMore;this.state.nextId=value.nextId;this.state.run=null;this.state.receipt=null});
  if(this.disposed||this.state.error||!this.state.projection)return;
  const step=this.state.projection?.steps.find(item=>item.id===this.state.record.selectedResultStep);
  if(step?.status==="COMPLETED"&&!needsOriginalTaskQuery(step))await this.readResult(step);
  else if(this.state.record.runId)await this.readRun(this.state.record.runId);
 }
 async discover(more=false){await this.work(signal=>this.api.list(signal,more?this.state.nextId:""),page=>{this.state.tasks=more?[...this.state.tasks,...page.tasks.filter(t=>!this.state.tasks.some(old=>old.id===t.id))]:page.tasks;this.state.nextId=page.nextId||"";this.state.hasMore=page.hasMore})}
 async select(id:string){await this.work(async signal=>{await this.hydrate();const legacy=this.legacyRecovery(id);const original=readTaskProjection(await this.readAPI(id).task(id,signal),id);if(signal.aborted)throw Error("TASK_REQUEST_CANCELLED");const projection=legacy?{...original,recoveryOnly:true}:original;const sameTask=this.state.record.selectedTask===id;const record={...this.state.record,selectedTask:id,selectedResultStep:sameTask?this.state.record.selectedResultStep:undefined,runId:sameTask?this.state.record.runId:""};await this.persist(record);return {projection,record}},value=>{this.state.projection=value.projection;this.state.record=value.record;this.state.run=null;this.state.receipt=null})}
 private async mutate(action:string,task:Task|null,step:string,runId:string,invoke:(signal:AbortSignal)=>Promise<unknown>,apply:(value:unknown)=>void,conversationId=""){
  await this.work(async signal=>{
   await this.hydrate();if(signal.aborted)throw new Error("TASK_REQUEST_CANCELLED");
   if('adapter' in this.api&&action!=="query"&&this.state.record.deliveries.some(d=>d.version!=="6"&&((task&&d.taskId===task.id)||(!task&&d.conversationId===conversationId))))throw new Error("LEGACY_V2_TASK_QUERY_ONLY");
   const binding=[action,task?.id||conversationId,step,runId,task?.revision||0,task?.generation||0,action==="resume"?this.state.projection?.steps.map(s=>`${s.id}-${s.status}`).join(","):""].join(":");if(action!=="query"&&this.state.record.deliveries.some(d=>d.binding===binding))throw new Error("ORIGINAL_DELIVERY_RETAINED_QUERY_BEFORE_RETRY");if(this.state.record.deliveries.length>=64)throw new Error("TASK_DELIVERY_JOURNAL_FULL");
   const delivery:Delivery={version:'adapter' in this.api?"6":"2",id:this.newID(),binding,action,taskId:task?.id||"",conversationId:conversationId||undefined,stepId:step||undefined,runId:runId||undefined,revision:task?.revision,generation:task?.generation,state:"PENDING"};
   this.state.record={...this.state.record,runId:runId||this.state.record.runId,deliveries:[...this.state.record.deliveries,delivery]};await this.persist(this.state.record);
   let result:unknown;let cause:unknown;
   try{result=await invoke(signal);delivery.state="RESPONSE_RECEIVED"}catch(error){cause=error;delivery.state=error instanceof TaskAPIError?"REJECTED_RESPONSE":"UNKNOWN"}
   // Persist delivery even if screen/session is closed while awaiting Source.
   // No prompt, grant ref, provider response or result plaintext is retained.
   await this.persist(this.state.record);if(cause)throw cause;return result;
  },apply)
 }
 private current(expected:Task,write=true){const current=this.state.projection;if(write&&current?.recoveryOnly)throw new Error("OLD_HOLDER_RECOVERY_ONLY");if(!current||current.id!==expected.id||current.revision!==expected.revision||current.generation!==expected.generation||current.holder!==expected.holder)throw new Error("TASK_CHANGED_REFRESH_REQUIRED");return current}
 async create(conversationId:string){segment(conversationId);await this.mutate("create",null,"","",s=>this.api.create(conversationId,s),value=>{const task=value as Task;this.state.tasks=[task,...this.state.tasks]},conversationId)}
 async prepare(expected:Task){const task=this.current(expected);await this.mutate("prepare",task,"","",s=>this.api.prepare(task,s),value=>{this.state.projection={...this.state.projection!,...(value as {task:Task}).task}})}
 async cancel(expected:Task){const task=this.current(expected);if(this.state.busy){await this.cancelInFlight(task);return}await this.mutate("cancel",task,"","",s=>this.api.cancel(task,s),value=>{this.state.projection={...this.state.projection!,...(value as {task:Task}).task};this.state.run=null})}
 private async cancelInFlight(task:Task){
  if(this.disposed||this.cancellation)return;const binding=["cancel",task.id,"","",task.revision,task.generation,""].join(":");if(this.state.record.deliveries.some(d=>d.binding===binding))throw new Error("ORIGINAL_DELIVERY_RETAINED_QUERY_BEFORE_RETRY");if(this.state.record.deliveries.length>=64)throw new Error("TASK_DELIVERY_JOURNAL_FULL");
  if('adapter' in this.api&&this.state.record.deliveries.some(d=>d.version!=="6"&&d.taskId===task.id))throw new Error("LEGACY_V2_TASK_QUERY_ONLY");
  const request=new AbortController();this.cancellation=request;const delivery:Delivery={version:'adapter' in this.api?"6":"2",id:this.newID(),binding,action:"cancel",taskId:task.id,revision:task.revision,generation:task.generation,state:"PENDING"};this.state.record={...this.state.record,deliveries:[...this.state.record.deliveries,delivery]};
  try{await this.persist(this.state.record);if(request.signal.aborted)throw new Error("TASK_REQUEST_CANCELLED");const result=await this.api.cancel(task,request.signal);delivery.state="RESPONSE_RECEIVED";await this.persist(this.state.record);if(!this.disposed){this.state.projection={...this.state.projection!,...result.task};this.request?.abort();this.request=null;this.epoch++;this.state.busy=false;this.state.run=null;this.emit()}}
  catch(error){if(delivery.state==="PENDING"){delivery.state=error instanceof TaskAPIError?"REJECTED_RESPONSE":"UNKNOWN";await this.persist(this.state.record)}throw error}finally{this.cancellation=null}
 }
 private currentStep(task:Task,expected:TaskStep,status:string){
  const step=this.state.projection?.steps.find(item=>item.id===expected.id);
  if(!step||step.status!==status||expected.status!==status||step.toolStep.taskId!==task.id||step.toolStep.taskRevision!==task.revision||step.toolStep.generation!==task.generation||step.toolStep.holder!==task.holder||JSON.stringify(step.toolStep)!==JSON.stringify(expected.toolStep))throw new Error("ORIGINAL_STEP_CHANGED_REFRESH_REQUIRED");
  return step;
 }
 async handoff(expected:Task,newHolder:string,ref:string){
  const task=this.current(expected);if(!newHolder||newHolder!==newHolder.trim()||newHolder===task.holder||newHolder.length>256||!ref||ref.length>256)throw new Error("EXACT_REGISTERED_NEW_HOLDER_AND_AUTHORIZATION_REQUIRED");
  await this.mutate("handoff",task,"","",s=>this.api.handoff(task,newHolder,ref,s),value=>{this.state.projection={...this.state.projection!,...(value as {task:Task}).task,recoveryOnly:true};this.state.run=null;this.state.receipt=null});
 }
 async complete(expected:Task){const task=this.current(expected),run=this.state.run;if(!run||run.taskId!==task.id||run.status!=="COMPLETED"||run.recoveryOnly||task.steps.some(step=>["PENDING","SENT","DISPATCHING","UNKNOWN","RECONCILING"].includes(step.status)))throw new Error("VERIFIED_COMPLETED_ORIGINAL_WORKFLOW_REQUIRED");await this.mutate("complete",task,"",run.id,s=>this.api.complete(task,run.id,s),value=>{this.state.projection={...this.state.projection!,...(value as {task:Task}).task}})}
 async approve(expected:Task,step:TaskStep,ref:string){const task=this.current(expected);const original=this.currentStep(task,step,"NEEDS_APPROVAL");await this.mutate("approve",task,original.id,"",s=>this.api.approve(task.id,original.id,ref,s),()=>{})}
 async dispatch(expected:Task,step:TaskStep,ref:string){
  const task=this.current(expected);const original=this.currentStep(task,step,"approved_not_executed");
  if(!["READY","WORKING"].includes(task.status)||(task.cancelledAt&&!task.cancelledAt.startsWith("0001-")))throw new Error("TASK_NOT_EXECUTABLE");
  if(!ref||ref.length>256)throw new Error("ORIGINAL_AUTHORIZATION_REFERENCE_REQUIRED");
  await this.mutate("dispatch",task,original.id,"",s=>this.api.dispatch(task.id,original.id,ref,s),value=>{this.state.receipt=readTaskReceipt(value,original.id)});
 }
 async reconcile(expected:Task,step:TaskStep,ref:string){
  const task=this.current(expected,false);
  const original=task.steps.find(item=>item.id===step.id);
  if(this.legacyRecovery(task.id)){
   const historical=original??step;
   if(historical.toolStep.taskId!==task.id||!needsOriginalTaskQuery(historical))throw new Error("ORIGINAL_QUERY_ONLY");
   await this.work(signal=>this.readAPI(task.id).reconcile(task.id,historical.id,ref,signal),()=>{});
   return;
  }
  if(!original||!needsOriginalTaskQuery(original))throw new Error("ORIGINAL_QUERY_ONLY");
  let observed=false;
  await this.mutate("query",task,original.id,"",signal=>{
   this.state.receipt=null;this.emit();
   return this.api.reconcile(task.id,original.id,ref,signal);
  },()=>{observed=true});
  if(!observed||!original.toolStep.authorityOperationId||original.toolStep.toolId!=="ai.conversation.read")return;
  await this.work(async signal=>readTaskProjection(await this.api.task(task.id,signal),task.id),
   projection=>{this.state.projection=projection});
  const recovered=this.state.projection?.steps.find(item=>item.id===original.id);
  if(!this.state.error&&this.state.projection?.id===task.id&&recovered?.status==="COMPLETED"&&
   !needsOriginalTaskQuery(recovered)&&recovered.toolStep.authorityOperationId===original.toolStep.authorityOperationId){
   await this.readResult(recovered);
  }
 }
 async readResult(step:TaskStep){
  const task=this.state.projection;
  if(!task||step.toolStep.taskId!==task.id)return;
  await this.work(async signal=>{
   this.state.receipt=null;this.emit();
   const receipt=readTaskReceipt(await this.readAPI(task.id).result(task.id,step.id,signal),step.id);
   const operation=step.toolStep.authorityOperationId;
   if(step.toolStep.toolId==="ai.conversation.read"&&operation&&receipt.authorityOperationId!==operation)throw Error("TASK_ORIGINAL_RESULT_INVALID");
   if(signal.aborted)throw Error("TASK_REQUEST_CANCELLED");
   const record={...this.state.record,selectedTask:task.id,selectedResultStep:step.id};
   await this.persist(record);
   return {record,receipt};
  },({record,receipt})=>{this.state.record=record;this.state.receipt=receipt});
 }
 async reconnectOriginalRun(runId:string){const task=this.state.projection;if(!task||!this.runCursors)throw Error("ORIGINAL_RUN_CURSOR_STORAGE_REQUIRED");segment(runId);if(this.legacyRecovery(task.id))throw Error("LEGACY_ORIGINAL_QUERY_REQUIRED");await this.work(async signal=>{this.state.run=null;this.state.receipt=null;this.emit();const selected=task.id+":"+runId;if(this.followerKey!==selected){await this.follower?.close();if(this.disposed||signal.aborted)throw Error("TASK_REQUEST_CANCELLED");this.follower=new OriginalRunReconnect(this.identity,task,runId,this.api,this.runCursors!);this.followerKey=selected}return this.follower!.reconnect(signal,async()=>{})},value=>{this.state.projection=value.task;this.state.run=value.run;this.state.receipt=value.receipts.at(-1)??null})}
 async readRun(runId:string){const selected=this.state.projection;if(selected&&this.legacyRecovery(selected.id)){await this.work(async signal=>{this.state.run=null;this.state.receipt=null;this.emit();const received=await this.recoverLegacyRun(selected.id,runId,signal);return readTaskRun(received,selected,runId)},run=>{this.state.run=run});return}if(this.runCursors){await this.reconnectOriginalRun(runId);return}const task=this.state.projection;if(!task)return;await this.work(async signal=>{this.state.run=null;this.emit();const received=await this.api.runView(task.id,runId,signal);const run=readTaskRun(received,task,received.runId===runId||received.id===runId?received.runId:runId);if(run.taskId!==task.id||(run.runId!==runId&&run.id!==runId))throw new Error("ORIGINAL_RUN_BINDING_MISMATCH");if(!run.recoveryOnly&&run.status!=="UNKNOWN"){this.state.record={...this.state.record,deliveries:this.state.record.deliveries.map(delivery=>(!('adapter' in this.api)||delivery.version==="6")&&delivery.taskId===task.id&&delivery.runId===run.runId&&["run","resume"].includes(delivery.action)&&["PENDING","UNKNOWN"].includes(delivery.state)?{...delivery,state:"ORIGINAL_OBSERVED" as const}:delivery)};await this.persist(this.state.record)}return readTaskRun(run,task,run.runId)},run=>{this.state.run=run})}
 async model(expected:Task,runId:string,prompt:string,ref:string,tools:string[],resume=false){const task=this.current(expected);if(this.state.run?.recoveryOnly||this.state.run?.status==="UNKNOWN"||task.steps.some(needsOriginalTaskQuery)||this.state.record.deliveries.some(delivery=>delivery.taskId===task.id&&["run","resume"].includes(delivery.action)&&["UNKNOWN","PENDING","REJECTED_RESPONSE"].includes(delivery.state)))throw new Error("UNKNOWN_ORIGINAL_QUERY_REQUIRED");await this.mutate(resume?"resume":"run",task,"",runId,s=>{this.state.run=null;this.emit();return this.api.run(task,runId,prompt,ref,tools,resume,s)},value=>{this.state.run=readTaskRun(value,task,runId);this.state.record.runId=runId})}
 async retainedOriginalOperations(){if(!('adapter' in this.api))throw new Error("V6_ORIGINAL_ADAPTER_UNAVAILABLE");return this.api.adapter.retained()}
 async recoverOriginalOperation(operationId:string,signal:AbortSignal){if(!('adapter' in this.api))throw new Error("V6_ORIGINAL_ADAPTER_UNAVAILABLE");return this.api.adapter.lookupOriginal(operationId,signal)}
 async recoverLegacyRun(taskId:string,runId:string,signal:AbortSignal){if(!this.legacyTask(taskId))throw Error("LEGACY_ORIGINAL_DELIVERY_REQUIRED");const retained=this.state.record.deliveries.some(d=>d.version!=="6"&&d.taskId===taskId&&d.runId===runId&&["run","resume"].includes(d.action));if(!retained)throw new Error("LEGACY_ORIGINAL_DELIVERY_REQUIRED");return 'legacyRecovery' in this.api?this.api.legacyRecovery.runView(taskId,runId,signal):this.api.runView(taskId,runId,signal)}
 dispose(){if(this.disposed)return;this.disposed=true;this.epoch++;this.request?.abort();this.cancellation?.abort();this.originalClosing=(async()=>{await this.follower?.close();if('adapter' in this.api)await this.api.adapter.close()})();void this.originalClosing.catch(()=>{this.state.error="V6_ORIGINAL_CLEANUP_UNRESOLVED"})}
 async whenClosed(){if(!this.disposed)this.dispose();await this.originalClosing}
}
