import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createAgentOrchestrator } from "../src/service.mjs";

test("agent plan, context, coder, reviewer and one-time write are persisted and hash chained", async (t) => {
  const root=await mkdtemp(join(tmpdir(),"ynx-agent-test-")), workspaceStore=createWorkspaceStore({filename:join(root,"workspaces.sqlite")}), outputs=[
    {provider:"ynx-hosted",model:"qwen3:4b",text:`Planner result:\n${JSON.stringify({summary:"Add greeting",steps:[{title:"Edit source",acceptance:"Greeting is present"}],contextPaths:["src/main.ts","src/old.ts"],createPaths:["src/greeting.ts"],deletePaths:["src/old.ts"]})}\nEnd.`},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({summary:"Implemented greeting",edits:[{path:"Use only the approved file `./src/main.ts`",expectedDigest:createHash("sha256").update("export {};\n").digest("hex"),replacements:[{find:"export {};",replace:'export const greeting = "hello";'}]}]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({approved:false,summary:"Preserve the module marker",findings:[{severity:"medium",message:"Keep the existing export"}]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({summary:"Implemented bounded greeting",edits:[{path:"src/main.ts",expectedDigest:createHash("sha256").update("export {};\n").digest("hex"),replacements:[{find:"export {};",replace:'export const greeting = "hello";'}]}],creates:[{path:"src/greeting.ts",content:'export const greetingModule = "hello";\n'}],deletes:[{path:"src/old.ts",expectedDigest:createHash("sha256").update('export const old = true;\n').digest("hex")} ]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({approved:true,summary:"Safe bounded change",findings:[{severity:"info",message:"Scope is bounded"}]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({summary:"Fix test",edits:[{path:"src/main.ts",expectedDigest:createHash("sha256").update('export const greeting = "hello";\n').digest("hex"),replacements:[{find:'"hello"',replace:'"hello world"'}]}]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({approved:true,summary:"Fix addresses evidence",findings:[]})},
  ], seen=[];let testAttempt=0,gitInitialized=false,gitHead=null,gitDrift=false;const gitCalls=[],gitService={runForOwner:async(owner,projectId,body=null)=>{gitCalls.push({owner,projectId,body});if(!body){if(gitDrift)return{initialized:true,branch:"other",head:"b".repeat(64),changes:[],commits:[]};return gitInitialized?{initialized:true,branch:"main",head:gitHead,changes:[],commits:gitHead?[{hash:gitHead}]:[]}:{initialized:false,branch:null,head:null,changes:[],commits:[]}}if(body.action==="commit-reviewed"){assert.equal(body.expectedRevision,3);assert.equal(body.expectedInitialized,false);assert.equal(body.expectedHead,null);assert.equal(body.expectedBranch,null);gitInitialized=true;gitHead="a".repeat(64);return{initialized:true,branch:"main",head:gitHead,changes:[],commits:[{hash:gitHead}]}}throw new Error("unexpected Git action")}};
  workspaceStore.put("owner-a","project-1",{expectedRevision:0,idempotencyKey:"initial-workspace",payload:{name:"Project",files:{"src/main.ts":"export {};\n","src/old.ts":'export const old = true;\n'},folders:["src"],open:["src/main.ts","src/old.ts"],active:"src/main.ts"}});
  const orchestrator=createAgentOrchestrator({filename:join(root,"agent.sqlite"),ownerForRequest:req=>req.headers["x-owner"]||null,workspaceStore,modelRouter:{generate:async input=>{seen.push(input);return{...outputs.shift(),usage:{inputTokens:10,outputTokens:5},durationMs:20};}},workspaceRuntime:{runTaskForOwner:async()=>{testAttempt+=1;return{protocolVersion:"ynx-code/v1",taskId:`task-${testAttempt}`,ok:testAttempt>1,code:testAttempt>1?0:1,language:"typescript",output:testAttempt>1?"tests passed":"expected hello world",durationMs:12,compiler:{executable:"node",version:"test"},sandbox:{kind:"test-sandbox",network:false,writableRoot:"workspace"},truncated:false}}},gitService}), server=createServer(async(request,response)=>{if(await orchestrator.handler(request,response))return;response.statusCode=404;response.end()});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));orchestrator.close();workspaceStore.close()});
  const base=`http://127.0.0.1:${server.address().port}`, key="request-only-secret-never-store", call=(path,body)=>fetch(`${base}${path}`,{method:"POST",headers:{"x-owner":"owner-a","content-type":"application/json"},body:JSON.stringify({protocolVersion:"ynx-code-agent/v1",approvalId:randomUUID(),...body})});
  let response=await call("/runtime/agent/runs",{projectId:"project-1",intent:"Add a greeting export",provider:"ynx-hosted",approval:"model-request-once"}), value=await response.json(); assert.equal(response.status,201); const id=value.run.runId; assert.equal(value.run.status,"plan_review");
  for(const body of [{action:"approve-plan"},{action:"approve-context",paths:["src/main.ts","src/old.ts"],createPaths:["src/greeting.ts"],deletePaths:["src/old.ts"],approval:"context-read-once"},{action:"generate-proposal",provider:"openai",model:"gpt-test",apiKey:key,approval:"model-request-once"}]){response=await call(`/runtime/agent/runs/${id}`,body);value=await response.json();assert.equal(response.status,200,value.error)}
  assert.equal(value.run.status,"diff_review");assert.equal(value.run.review.approved,false);response=await call(`/runtime/agent/runs/${id}`,{action:"revise-proposal",provider:"openai",apiKey:key,approval:"model-request-once"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.review.approved,true);assert.deepEqual(value.run.review.findings,["info: Scope is bounded"]);assert.equal(value.run.proposal.files.find(file=>file.path==="src/greeting.ts").operation,"create");assert.equal(seen[1].apiKey,key);assert.equal(seen[4].apiKey,key);
  response=await call(`/runtime/agent/runs/${id}`,{action:"apply",approval:"write-once"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"applied");assert.equal(workspaceStore.get("owner-a","project-1").files["src/main.ts"],'export const greeting = "hello";\n');assert.equal(workspaceStore.get("owner-a","project-1").files["src/greeting.ts"],'export const greetingModule = "hello";\n');assert.equal(Object.hasOwn(workspaceStore.get("owner-a","project-1").files,"src/old.ts"),false);assert.equal(value.run.trash[0].digest,createHash("sha256").update('export const old = true;\n').digest("hex"));
  response=await call(`/runtime/agent/runs/${id}`,{action:"run-test",approval:"execute-once",activePath:"src/main.ts"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"test_failed");
  response=await call(`/runtime/agent/runs/${id}`,{action:"generate-fix",provider:"openai",apiKey:key,approval:"model-request-once"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"diff_review");
  response=await call(`/runtime/agent/runs/${id}`,{action:"apply",approval:"write-once"});value=await response.json();assert.equal(response.status,200,value.error);
  response=await call(`/runtime/agent/runs/${id}`,{action:"run-test",approval:"execute-once",activePath:"src/main.ts"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"tested");assert.equal(value.run.events.at(-1).payload.result.output,"tests passed");
  response=await call(`/runtime/agent/runs/${id}`,{action:"prepare-git",message:"Agent: add tested greeting"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"git_review");assert.equal(value.run.gitOperation.boundary,"local-only-no-network-no-credentials-no-hooks-no-signing");assert.equal(value.run.gitOperation.files.length,2);assert.equal(value.run.gitOperation.testEvidenceHash,value.run.events.findLast(event=>event.event_type==="tester.completed").event_hash);
  response=await call(`/runtime/agent/runs/${id}`,{action:"approve-git"});assert.equal(response.status,403);gitDrift=true;response=await call(`/runtime/agent/runs/${id}`,{action:"approve-git",approval:"git-local-commit-once"});assert.equal(response.status,409);assert.equal((await response.json()).code,"git_preview_stale");gitDrift=false;response=await call(`/runtime/agent/runs/${id}`,{action:"approve-git",approval:"git-local-commit-once"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"git_committed");assert.equal(value.run.gitOperation.commit,"a".repeat(64));assert.deepEqual(gitCalls.filter(call=>call.body).map(call=>call.body.action),["commit-reviewed"]);assert.equal(value.run.permissions.find(permission=>permission.id==="git-local-commit").status,"used");assert.equal(value.run.permissions.find(permission=>permission.id==="git-remote").status,"disabled");
  response=await call(`/runtime/agent/runs/${id}`,{action:"prepare-deployment",target:"ynx-testnet"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"deployment_review");assert.equal(value.run.deployment.executable,false);assert.equal(value.run.deployment.boundary,"review-only-no-network-no-signing");assert.equal(value.run.deployment.files.find(file=>file.path==="src/main.ts").digest,createHash("sha256").update('export const greeting = "hello world";\n').digest("hex"));assert.equal(value.run.deployment.testEvidenceHash,value.run.events.findLast(event=>event.event_type==="tester.completed").event_hash);
  response=await call(`/runtime/agent/runs/${id}`,{action:"approve-deployment"});assert.equal(response.status,403);response=await call(`/runtime/agent/runs/${id}`,{action:"approve-deployment",approval:"deployment-review-once"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"deployment_approved");assert.equal(value.run.deployment.executable,false);assert.equal(value.run.usage.reportedCalls,7);assert.equal(value.run.usage.inputTokens,70);assert.equal(value.run.usage.outputTokens,35);assert.equal(value.run.usage.cost.status,"unreported-by-provider");assert.equal(value.run.permissions.find(permission=>permission.id==="deployment-review").status,"used");assert.equal(value.run.permissions.find(permission=>permission.id==="deployment-execute").status,"disabled");assert.equal(value.run.events.filter(event=>event.event_type==="permission.decision"&&event.payload.decision==="denied").length,2);
  response=await call(`/runtime/agent/runs/${id}`,{action:"restore-deleted",paths:["src/old.ts"]});assert.equal(response.status,403);response=await call(`/runtime/agent/runs/${id}`,{action:"restore-deleted",paths:["src/old.ts"],approval:"restore-once"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"restored");assert.equal(value.run.trash.length,0);assert.equal(value.run.deployment,null);assert.equal(workspaceStore.get("owner-a","project-1").files["src/old.ts"],'export const old = true;\n');assert.equal(value.run.permissions.find(permission=>permission.id==="workspace-restore").status,"used");
  const hashes=value.run.events.map(event=>event.event_hash);assert.equal(new Set(hashes).size,hashes.length);assert.ok(value.run.events.every((event,index)=>event.previous_hash===(index?hashes[index-1]:"0".repeat(64))));
  assert.equal((await readFile(join(root,"agent.sqlite"))).includes(Buffer.from(key)),false);
});

test("agent refuses write without approval, stale revision, and cross-owner reads", async (t)=>{
  const root=await mkdtemp(join(tmpdir(),"ynx-agent-boundary-")), store=createWorkspaceStore({filename:join(root,"workspaces.sqlite")}); store.put("a","p",{expectedRevision:0,idempotencyKey:"initial-project",payload:{name:"P",files:{"a.ts":"x"},folders:[],open:["a.ts"],active:"a.ts"}});
  const answers=[JSON.stringify({summary:"Plan",steps:[{title:"Edit",acceptance:"Done"}],contextPaths:["a.ts"]}),JSON.stringify({summary:"Patch",edits:[{path:"a.ts",expectedDigest:createHash("sha256").update("x").digest("hex"),replacements:[{find:"x",replace:"y"}]}]}),JSON.stringify({approved:true,summary:"Approved",findings:[]})], agent=createAgentOrchestrator({filename:join(root,"agent.sqlite"),ownerForRequest:req=>req.headers["x-owner"]||null,workspaceStore:store,modelRouter:{generate:async()=>({provider:"ynx-hosted",model:"qwen",text:answers.shift()})}}), server=createServer(async(req,res)=>{if(await agent.handler(req,res))return;res.writeHead(404).end()}); await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));agent.close();store.close()});
  const base=`http://127.0.0.1:${server.address().port}`, post=(path,body,owner="a")=>fetch(`${base}${path}`,{method:"POST",headers:{"x-owner":owner,"content-type":"application/json"},body:JSON.stringify({protocolVersion:"ynx-code-agent/v1",approvalId:randomUUID(),...body})});let denied=await post("/runtime/agent/runs",{projectId:"p",intent:"Make a safe change"});assert.equal(denied.status,403);let value=await (await post("/runtime/agent/runs",{projectId:"p",intent:"Make a safe change",approval:"model-request-once"})).json(),id=value.run.runId;await post(`/runtime/agent/runs/${id}`,{action:"approve-plan"});denied=await post(`/runtime/agent/runs/${id}`,{action:"approve-context",paths:["a.ts"],createPaths:["a.ts"],approval:"context-read-once"});assert.equal(denied.status,409);const contextApprovalId=randomUUID();await post(`/runtime/agent/runs/${id}`,{action:"approve-context",paths:["a.ts"],approval:"context-read-once",approvalId:contextApprovalId});denied=await post(`/runtime/agent/runs/${id}`,{action:"generate-proposal",approval:"model-request-once",approvalId:contextApprovalId});assert.equal(denied.status,409);await post(`/runtime/agent/runs/${id}`,{action:"generate-proposal",approval:"model-request-once"});denied=await post(`/runtime/agent/runs/${id}`,{action:"apply"});assert.equal(denied.status,403);value=await (await fetch(`${base}/runtime/agent/runs/${id}`,{headers:{"x-owner":"a"}})).json();assert.equal(value.run.events.at(-1).event_type,"permission.decision");assert.equal(value.run.events.at(-1).payload.decision,"denied");assert.ok(value.run.events.some(event=>event.payload.reason==="approval_replayed"));let hidden=await fetch(`${base}/runtime/agent/runs/${id}`,{headers:{"x-owner":"b"}});assert.equal(hidden.status,404);
});

test("agent disconnect cancels the in-flight Planner model request", async (t)=>{
  const root=await mkdtemp(join(tmpdir(),"ynx-agent-abort-")),store=createWorkspaceStore({filename:join(root,"workspaces.sqlite")});
  store.put("owner","project",{expectedRevision:0,idempotencyKey:"initial-project-workspace",payload:{name:"P",files:{"main.cpp":"int main(){}\n"},folders:[],open:["main.cpp"],active:"main.cpp"}});
  let modelSignal,modelStarted;
  const started=new Promise(resolve=>{modelStarted=resolve});
  const agent=createAgentOrchestrator({filename:join(root,"agent.sqlite"),ownerForRequest:req=>req.headers["x-owner"]||null,workspaceStore:store,modelRouter:{generate:input=>{modelSignal=input.signal;modelStarted();return new Promise((_resolve,reject)=>input.signal.addEventListener("abort",()=>reject(Object.assign(new Error("cancelled"),{code:"model_request_cancelled",status:499})),{once:true}))}}});
  const server=createServer(async(req,res)=>{if(await agent.handler(req,res))return;res.writeHead(404).end()});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));agent.close();store.close()});
  const payload=JSON.stringify({protocolVersion:"ynx-code-agent/v1",projectId:"project",intent:"Create a reviewed plan",approval:"model-request-once",approvalId:randomUUID()});
  const client=httpRequest({host:"127.0.0.1",port:server.address().port,path:"/runtime/agent/runs",method:"POST",headers:{"x-owner":"owner","content-type":"application/json","content-length":Buffer.byteLength(payload)}});
  client.on("error",()=>{});client.end(payload);
  await started;
  assert.equal(modelSignal.aborted,false);
  client.destroy();
  for(let attempt=0;attempt<20&&!modelSignal.aborted;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(modelSignal.aborted,true);
});

test("agent orchestrator migrates an existing run database for deployment review", async () => {
  const root = await mkdtemp(join(tmpdir(), "ynx-agent-migration-")),
    filename = join(root, "agent.sqlite"),
    legacy = new DatabaseSync(filename);
  legacy.exec("CREATE TABLE agent_runs(owner_id TEXT NOT NULL,run_id TEXT NOT NULL,project_id TEXT NOT NULL,status TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,intent TEXT NOT NULL,workspace_revision INTEGER NOT NULL,plan TEXT,approved_paths TEXT NOT NULL DEFAULT '[]',proposal TEXT,review TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,run_id))");
  legacy.close();
  const workspaceStore = createWorkspaceStore({
      filename: join(root, "workspaces.sqlite"),
    }),
    orchestrator = createAgentOrchestrator({
      filename,
      ownerForRequest: () => "owner",
      workspaceStore,
      modelRouter: { generate: async () => assert.fail("model not expected") },
    }),
    migrated = new DatabaseSync(filename);
  assert.ok(
    migrated
      .prepare("PRAGMA table_info(agent_runs)")
      .all()
      .some((column) => column.name === "deployment"),
  );
  assert.ok(
    migrated
      .prepare("PRAGMA table_info(agent_runs)")
      .all()
      .some((column) => column.name === "approved_create_paths"),
  );
  for (const column of ["approved_delete_paths", "trash", "git_operation"])
    assert.ok(
      migrated
        .prepare("PRAGMA table_info(agent_runs)")
        .all()
        .some((item) => item.name === column),
    );
  assert.equal(
    migrated
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_approvals'")
      .get().name,
    "agent_approvals",
  );
  migrated.close();
  orchestrator.close();
  workspaceStore.close();
});
