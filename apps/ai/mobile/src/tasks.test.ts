import test from "node:test";
import assert from "node:assert/strict";
import {createTaskAPI,TaskAPIError,TaskWorkspaceController,type Task,type TaskAPI,type TaskPersistence,type WorkspaceRecord,type TaskProjection,type TaskStep,type TaskRequestSnapshot} from "./tasks";

const task:Task={id:"task_original",conversationId:"conv_original",holder:"holder_original",revision:2,generation:1,status:"READY"};
const step:TaskStep={id:"step_original",status:"UNKNOWN",toolStep:{taskId:task.id,taskRevision:2,generation:1,holder:task.holder,toolId:"ai.conversation.read",toolVersion:"1",authorityOperationId:"original-node-op"}};
const projection:TaskProjection={...task,cursor:2,hasMore:false,events:[],steps:[step]};

test("cancelled task can query a locally completed step whose Auth receipt is UNKNOWN", async () => {
 const original = {...step, status:"COMPLETED", toolStep:{...step.toolStep, authorityReferenceState:"UNKNOWN"}};
 const cancelled = {...projection, revision:3, status:"RECONCILING", cancelledAt:"2026-11-13T00:00:00Z", steps:[original]};
 let queries = 0;
 const c = new TaskWorkspaceController("PUBLIC", mockAPI({
  task:async()=>queries ? {...cancelled, revision:4, status:"CANCELLED", steps:[{...original, toolStep:{...original.toolStep, authorityReferenceState:"COMMITTED"}}]} : cancelled,
  reconcile:async(taskID,stepID)=>{assert.equal(taskID,task.id);assert.equal(stepID,original.id);queries++;return {}},
  result:async()=>({state:"COMMITTED",effectRef:original.id,result:{message:"original result"}})
 }), storage().api, ()=>"query_original");
 await c.select(task.id);
 await c.reconcile(cancelled,c.state.projection!.steps[0]!,"PUBLIC-ref");
 assert.equal(queries,1);
 await c.select(task.id);
 assert.equal(c.state.projection!.status,"CANCELLED");
 await c.readResult(c.state.projection!.steps[0]!);
 assert.deepEqual(c.state.receipt?.result,{message:"original result"});
});
function storage(){let saved:WorkspaceRecord|null=null;const values:string[]=[];const api:TaskPersistence={read:async()=>saved?JSON.parse(JSON.stringify(saved)):null,write:async(_id,value)=>{values.push(JSON.stringify(value));saved=JSON.parse(JSON.stringify(value))}};return {api,values,get saved(){return saved}}}
function mockAPI(changes:Partial<TaskAPI>={}):TaskAPI{return {list:async()=>({tasks:[task],hasMore:false}),task:async()=>JSON.parse(JSON.stringify(projection)),create:async()=>task,prepare:async()=>({task:{...task,revision:3}}),cancel:async()=>({task:{...task,status:"RECONCILING",revision:3},remoteRollback:false}),handoff:async()=>({task:{...task,holder:"holder_next",revision:3,generation:2}}),complete:async()=>({task:{...task,status:"COMPLETED"}}),propose:async()=>({}),approve:async()=>({}),dispatch:async()=>({state:"COMMITTED",effectRef:step.id,result:{}}),reconcile:async()=>({}),result:async()=>({state:"COMMITTED",effectRef:step.id,result:{actual:"PUBLIC controlled result"}}),run:async()=>({id:"run_internal",runId:"run_original",taskId:task.id,status:"NEEDS_APPROVAL",steps:[step.id],recoveryOnly:false}),runView:async()=>({id:"run_internal",runId:"run_original",taskId:task.id,status:"UNKNOWN",steps:[step.id],recoveryOnly:true}),...changes}}
test("native task requests use fresh original scope proof and fixed route, no legacy bearer",async()=>{
 const scopes:string[]=[],requests:{url:string;init:RequestInit}[]=[];
 const api=createTaskAPI("http://127.0.0.1:6438",{identity:"PUBLIC-session",proof:async scope=>{scopes.push(scope);return `PUBLIC-${scopes.length}`}},async(input,init)=>{requests.push({url:String(input),init:init!});return new Response(JSON.stringify({tasks:[],hasMore:false}),{status:200})});
 await api.list(new AbortController().signal);await api.reconcile(task.id,step.id,"PUBLIC-ref",new AbortController().signal);
 assert.deepEqual(scopes,["ai:conversations","ai:permissions"]);assert.equal(requests[0]!.url,"http://127.0.0.1:6438/api/tasks?afterId=");assert.equal(requests[1]!.init.headers&&new Headers(requests[1]!.init.headers).get("Authorization"),null);assert.equal(new Headers(requests[1]!.init.headers).get("X-YNX-Product-Session-Proof-V2"),"PUBLIC-2");assert.deepEqual(JSON.parse(requests[1]!.init.body as string),{authorizationRef:"PUBLIC-ref"});assert.equal(requests[1]!.init.redirect,"error");assert.equal(requests[1]!.init.credentials,"omit");
});
test("missing task scope proof refuses without network and service unavailable remains refusal",async()=>{
 let calls=0;const missing=createTaskAPI("http://127.0.0.1:6438",{identity:"PUBLIC",proof:async()=>""},async()=>{calls++;return new Response("{}")});await assert.rejects(missing.list(new AbortController().signal),/CANONICAL_TASK_PROOF_UNAVAILABLE/);assert.equal(calls,0);
 const unavailable=createTaskAPI("http://127.0.0.1:6438",{identity:"PUBLIC",proof:async()=>"PUBLIC-not-authority"},async()=>new Response('{"code":"AUTHORITY_UNAVAILABLE"}',{status:503}));await assert.rejects(unavailable.list(new AbortController().signal),error=>error instanceof TaskAPIError&&error.status===503);
});
test("pending create is durable before network, response loss survives restart without new task",async()=>{
 const saved=storage();let calls=0;
 const api=mockAPI({create:async()=>{assert.equal(saved.saved!.deliveries[0]!.state,"PENDING");calls++;throw new Error("PUBLIC lost response")}});
 const c=new TaskWorkspaceController("PUBLIC-account",api,saved.api,()=>"delivery_original");await c.create("conv_original");assert.equal(calls,1);assert.equal(saved.saved!.deliveries[0]!.state,"UNKNOWN");assert.equal(saved.saved!.deliveries[0]!.taskId,"");assert.equal(saved.saved!.deliveries[0]!.conversationId,"conv_original");
 c.dispose();const next=new TaskWorkspaceController("PUBLIC-account",api,saved.api,()=>"different-delivery");await next.restore();await next.create("conv_original");assert.equal(calls,1);assert.match(next.state.error,/ORIGINAL_DELIVERY_RETAINED/);await next.discover();assert.equal(next.state.tasks[0]!.id,task.id);
});
test("manual cancellation binds actual revision/generation, changed task confirmation rejects",async()=>{
 const saved=storage();let calls=0;const c=new TaskWorkspaceController("PUBLIC",mockAPI({cancel:async actual=>{calls++;assert.equal(actual.revision,2);assert.equal(actual.generation,1);return {task:{...actual,status:"RECONCILING",revision:3},remoteRollback:false}}}),saved.api,()=>"cancel_original");await c.select(task.id);await assert.rejects(c.cancel({...task,revision:1}),/TASK_CHANGED/);assert.equal(calls,0);await c.cancel(task);assert.equal(calls,1);assert.equal(c.state.projection!.status,"RECONCILING");assert.equal(c.state.projection!.revision,3);
});
test("UNKNOWN queries keep original task/step and may explicitly query again, never NEW",async()=>{
 const saved=storage();let queries=0,runs=0;const c=new TaskWorkspaceController("PUBLIC",mockAPI({reconcile:async(taskID,stepID)=>{assert.equal(taskID,task.id);assert.equal(stepID,step.id);queries++;return {}},run:async()=>{runs++;throw Error("unexpected NEW")}}),saved.api,()=>`query_${queries}`);await c.select(task.id);await c.reconcile(task,step,"PUBLIC-secret-ref");await c.reconcile(task,step,"PUBLIC-secret-ref");assert.equal(queries,2);await c.readRun("run_original");await assert.rejects(c.model(task,"new_run","PRIVATE prompt","PUBLIC-secret-ref",["ai.conversation.read"]),/UNKNOWN_ORIGINAL_QUERY/);assert.equal(runs,0);assert.ok(saved.values.every(raw=>!raw.includes("PUBLIC-secret-ref")&&!raw.includes("PRIVATE prompt")));
});
test("closing workspace cancels actual request, keeps unresolved journal and ignores late screen return",async()=>{
 const saved=storage();let started!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>started=resolve),blocked=new Promise<void>(resolve=>release=resolve);let changes=0;
 const c=new TaskWorkspaceController("PUBLIC",mockAPI({create:async(_conversation,signal)=>{started();await blocked;assert.equal(signal.aborted,true);throw Error("PUBLIC cancelled after possible dispatch")}}),saved.api,()=>"pending_create",()=>changes++);
 const work=c.create("conv_original");await entered;c.dispose();const atClose=changes;release();await work;assert.equal(changes,atClose);assert.equal(saved.saved!.deliveries[0]!.state,"UNKNOWN");
});
test("storage failure prevents request and retained final result is not stored in delivery metadata",async()=>{
 let calls=0;const broken:TaskPersistence={read:async()=>null,write:async()=>{throw Error("PUBLIC disk unavailable")}};const c=new TaskWorkspaceController("PUBLIC",mockAPI({create:async()=>{calls++;return task}}),broken,()=>"create_original");await c.create("conv_original");assert.equal(calls,0);assert.match(c.state.error,/disk unavailable/);
 const saved=storage();const ready=new TaskWorkspaceController("PUBLIC",mockAPI(),saved.api,()=>"read_original");await ready.select(task.id);await ready.readResult(step);assert.equal(ready.state.receipt!.state,"COMMITTED");assert.ok(saved.values.every(raw=>!raw.includes("controlled result")));
});
test("manual cancel remains available during a model request and ignores its late success",async()=>{
 const saved=storage();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r);let signal:AbortSignal|undefined;let ids=0;
 const c=new TaskWorkspaceController("PUBLIC",mockAPI({task:async()=>({...projection,steps:[]}),run:async(_task,_run,_prompt,_ref,_tools,_resume,s)=>{signal=s;entered();await waiting;return {id:"old_internal",runId:"run_original",taskId:task.id,status:"COMPLETED",steps:[],content:"PUBLIC late unapproved return",recoveryOnly:false}}}),saved.api,()=>`delivery_${++ids}`);
 await c.select(task.id);const running=c.model(task,"run_original","PRIVATE prompt","PRIVATE ref",["ai.conversation.read"]);await started;await c.cancel(task);assert.equal(signal!.aborted,true);assert.equal(c.state.projection!.status,"RECONCILING");assert.equal(c.state.busy,false);release();await running;assert.equal(c.state.run,null);assert.equal(c.state.projection!.status,"RECONCILING");assert.equal(saved.saved!.deliveries.length,2);assert.ok(saved.values.every(value=>!value.includes("PRIVATE prompt")&&!value.includes("PRIVATE ref")));
});
test("failed cancel leaves the original in-flight model request running",async()=>{
 const saved=storage();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r);let signal:AbortSignal|undefined;let ids=0;
 const c=new TaskWorkspaceController("PUBLIC",mockAPI({task:async()=>({...projection,steps:[]}),cancel:async()=>{throw new TaskAPIError(409,"TASK_CHANGED")},run:async(_t,_r,_p,_a,_tools,_resume,s)=>{signal=s;entered();await waiting;return {id:"run_internal",runId:"run_original",taskId:task.id,status:"NEEDS_APPROVAL",steps:[step.id],recoveryOnly:false}}}),saved.api,()=>`delivery_${++ids}`);await c.select(task.id);const running=c.model(task,"run_original","private","ref",["ai.conversation.read"]);await started;await assert.rejects(c.cancel(task),/TASK_CHANGED/);assert.equal(signal!.aborted,false);release();await running;assert.equal(c.state.run!.status,"NEEDS_APPROVAL");assert.equal(saved.saved!.deliveries.find(d=>d.action==="cancel")!.state,"REJECTED_RESPONSE");
});
test("lost model response resumes only after readback of its exact original run",async()=>{
 const saved=storage();let modelCalls=0,ids=0;
 const api=mockAPI({task:async()=>({...projection,steps:[]}),run:async(_t,runId,_p,_r,_tools,resume)=>{modelCalls++;if(!resume)throw Error("PUBLIC response lost");assert.equal(runId,"run_original");return {id:"run_internal",runId,taskId:task.id,status:"NEEDS_APPROVAL",steps:[],recoveryOnly:false}},runView:async()=>({id:"run_internal",runId:"run_original",taskId:task.id,status:"NEEDS_APPROVAL",steps:[],recoveryOnly:false})});
 const c=new TaskWorkspaceController("PUBLIC",api,saved.api,()=>`delivery_${++ids}`);await c.select(task.id);await c.model(task,"run_original","prompt","ref",["ai.conversation.read"]);await assert.rejects(c.model(task,"replacement_run","prompt","ref",["ai.conversation.read"]),/UNKNOWN_ORIGINAL_QUERY/);assert.equal(modelCalls,1);await c.readRun("run_original");assert.equal(saved.saved!.deliveries[0]!.state,"ORIGINAL_OBSERVED");await c.model(task,"run_original","","ref",["ai.conversation.read"],true);assert.equal(modelCalls,2);
});
test("unreadable prior journal cannot be overwritten or bypassed by task creation",async()=>{
 let creates=0,writes=0;const persistence:TaskPersistence={read:async()=>{throw Error("PUBLIC original journal unavailable")},write:async()=>{writes++}};const c=new TaskWorkspaceController("PUBLIC",mockAPI({create:async()=>{creates++;return task}}),persistence,()=>"replacement_id");await c.restore();await c.create("conv_original");assert.equal(creates,0);assert.equal(writes,0);assert.match(c.state.error,/original journal unavailable/);
});
test("proof acquisition snapshots exact method path and bytes before asynchronous signer work",async()=>{
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>release=r);let signed:TaskRequestSnapshot|undefined,sent:RequestInit|undefined;
 const original={...task};const api=createTaskAPI("http://127.0.0.1:6438",{identity:"PUBLIC",proof:async(_scope,request)=>{assert.ok(Object.isFrozen(request));signed=request;entered();await pending;return "PUBLIC-controlled-proof"}},async(_url,init)=>{sent=init;return new Response(JSON.stringify({task:{...task,status:"RECONCILING"},remoteRollback:false}),{status:200})});
 const call=api.reconcile(original.id,step.id,"PUBLIC-ref",new AbortController().signal);await started;original.revision=999;original.generation=888;release();await call;assert.deepEqual(signed,{method:"POST",path:"/api/tasks/task_original/tool-steps/step_original/reconcile",bodyOriginal:'{"authorizationRef":"PUBLIC-ref"}'});assert.equal(sent!.body,signed!.bodyOriginal);assert.equal(sent!.method,signed!.method);
});
test("cancel while awaiting native proof never dispatches a previously requested body",async()=>{
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>release=r);let sends=0;const abort=new AbortController();const api=createTaskAPI("http://127.0.0.1:6438",{identity:"PUBLIC",proof:async()=>{entered();await pending;return "PUBLIC-proof"}},async()=>{sends++;return new Response("{}")});const call=api.reconcile(task.id,step.id,"PUBLIC-ref",abort.signal);await started;abort.abort();release();await assert.rejects(call,/TASK_REQUEST_CANCELLED/);assert.equal(sends,0);
});
test("approved Shop step executes once after durable journal and original result survives lost response",async()=>{
 const saved=storage();let calls=0,ids=0;const approved:TaskStep={...step,status:"approved_not_executed",toolStep:{...step.toolStep,toolId:"shop.order.read"}};
 const api=mockAPI({task:async()=>({...projection,steps:[approved]}),dispatch:async(taskID,stepID,ref)=>{assert.equal(saved.saved!.deliveries.at(-1)!.state,"PENDING");assert.equal(taskID,task.id);assert.equal(stepID,step.id);assert.equal(ref,"PRIVATE original grant ref");calls++;throw Error("PUBLIC lost original response")}});
 const c=new TaskWorkspaceController("PUBLIC",api,saved.api,()=>`delivery_${++ids}`);await c.select(task.id);await c.dispatch(task,approved,"PRIVATE original grant ref");assert.equal(calls,1);assert.equal(saved.saved!.deliveries.at(-1)!.state,"UNKNOWN");
 c.dispose();const restored=new TaskWorkspaceController("PUBLIC",api,saved.api,()=>`delivery_${++ids}`);await restored.restore();await restored.select(task.id);await restored.dispatch(task,approved,"PRIVATE original grant ref");assert.equal(calls,1);assert.match(restored.state.error,/ORIGINAL_DELIVERY_RETAINED/);await restored.readResult(approved);assert.equal(restored.state.receipt!.state,"COMMITTED");assert.ok(saved.values.every(raw=>!raw.includes("PRIVATE original grant ref")&&!raw.includes("controlled result")));
});
test("native step actions reject foreign, changed, unapproved or cancelled execution before network",async()=>{
 let calls=0;const approved:TaskStep={...step,status:"approved_not_executed",toolStep:{...step.toolStep,toolId:"shop.order.read"}};
 const api=mockAPI({task:async()=>({...projection,steps:[approved]}),dispatch:async()=>{calls++;return {state:"COMMITTED",effectRef:step.id,result:{}}},approve:async()=>{calls++;return {}}});
 const c=new TaskWorkspaceController("PUBLIC",api,storage().api,()=>"delivery");await c.select(task.id);
 for(const candidate of [{...approved,id:"foreign_step"},{...approved,status:"NEEDS_APPROVAL"},{...approved,toolStep:{...approved.toolStep,holder:"different_holder"}},{...approved,toolStep:{...approved.toolStep,taskId:"foreign_task"}}])await assert.rejects(c.dispatch(task,candidate,"ref"),/ORIGINAL_STEP_CHANGED/);
 await assert.rejects(c.approve(task,{...approved,status:"NEEDS_APPROVAL"},"ref"),/ORIGINAL_STEP_CHANGED/);
 c.state.projection!.status="CANCELLED";await assert.rejects(c.dispatch(c.state.projection!,approved,"ref"),/TASK_NOT_EXECUTABLE/);assert.equal(calls,0);
});
test("legacy dispatch and both model paths refuse before proof or network; V6 migration never auto-signs",async()=>{
 const requests:{path:string;body:unknown}[]=[];const api=createTaskAPI("http://127.0.0.1:6438",{identity:"PUBLIC",proof:async(_scope,request)=>{requests.push({path:request.path,body:JSON.parse(request.bodyOriginal)});return "PUBLIC-proof"}},async()=>new Response(JSON.stringify({state:"COMMITTED",effectRef:step.id,result:{}})));
 const signal=new AbortController().signal;await assert.rejects(api.dispatch(task.id,step.id,"PRIVATE ref",signal),/LEGACY_QUERY_ONLY/);await assert.rejects(api.run(task,"original_run","prompt","ref",["ai.conversation.read","shop.order.read"],false,signal),/LEGACY_QUERY_ONLY/);await assert.rejects(api.run(task,"original_run","","ref",[],true,signal),/LEGACY_QUERY_ONLY/);assert.equal(requests.length,0);
});
test("holder handoff uses canonical route and makes old workspace recovery only without replay",async()=>{
 const saved=storage();let calls=0,ids=0;const api=mockAPI({task:async()=>({...projection,steps:[]}),handoff:async(t,next,ref)=>{calls++;assert.equal(t.holder,task.holder);assert.equal(next,"holder_next");assert.equal(ref,"PRIVATE handoff ref");assert.equal(saved.saved!.deliveries.at(-1)!.state,"PENDING");return {task:{...task,holder:next,revision:3,generation:2}}}});
 const c=new TaskWorkspaceController("PUBLIC",api,saved.api,()=>`handoff_${++ids}`);await c.select(task.id);await c.handoff(task,"holder_next","PRIVATE handoff ref");assert.equal(calls,1);assert.equal(c.state.projection!.holder,"holder_next");assert.equal(c.state.projection!.recoveryOnly,true);await assert.rejects(c.prepare(c.state.projection!),/OLD_HOLDER_RECOVERY_ONLY/);await assert.rejects(c.handoff(c.state.projection!,"third_holder","ref"),/OLD_HOLDER_RECOVERY_ONLY/);assert.ok(saved.values.every(raw=>!raw.includes("PRIVATE handoff ref")));
 const snapshots:TaskRequestSnapshot[]=[];const transport=createTaskAPI("http://127.0.0.1:6438",{identity:"PUBLIC",proof:async(_scope,r)=>{snapshots.push(r);return "PUBLIC-proof"}},async()=>new Response('{"code":"AI_TASK_HANDOFF_UNREGISTERED"}',{status:503}));await assert.rejects(transport.handoff(task,"holder_next","ref",new AbortController().signal),/LEGACY_QUERY_ONLY/);assert.equal(snapshots.length,0);
});
test("complete refuses pending original effects and uses the actual completed internal run key",async()=>{
 let completes=0;const pending={...step,status:"PENDING"};const api=mockAPI({task:async()=>({...projection,steps:[pending]}),runView:async()=>({id:"run_internal",runId:"run_original",taskId:task.id,status:"COMPLETED",steps:[step.id],recoveryOnly:false}),complete:async(_t,id)=>{completes++;assert.equal(id,"run_internal");return {task:{...task,status:"COMPLETED"}}}});
 const c=new TaskWorkspaceController("PUBLIC",api,storage().api,()=>"complete_original");await c.select(task.id);await c.readRun("run_original");await assert.rejects(c.complete(task),/VERIFIED_COMPLETED_ORIGINAL_WORKFLOW_REQUIRED/);assert.equal(completes,0);c.state.projection!.steps=[];await c.complete(task);assert.equal(completes,1);assert.equal(c.state.projection!.status,"COMPLETED");
});
test("PENDING and SENT effects allow only original query and block replacement model work",async()=>{
 for(const status of ["PENDING","SENT"]){let queries=0,runs=0;const original={...step,status};const c=new TaskWorkspaceController("PUBLIC",mockAPI({task:async()=>({...projection,steps:[original]}),reconcile:async()=>{queries++;return {}},run:async()=>{runs++;throw Error("unexpected NEW")}}),storage().api,()=>`query_${status}`);await c.select(task.id);await c.reconcile(task,original,"ref");assert.equal(queries,1);await assert.rejects(c.model(task,"replacement","prompt","ref",["ai.conversation.read"]),/UNKNOWN_ORIGINAL_QUERY/);assert.equal(runs,0)}
});
