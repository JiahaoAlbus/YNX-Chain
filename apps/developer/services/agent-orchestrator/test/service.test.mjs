import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createAgentOrchestrator } from "../src/service.mjs";

test("agent plan, context, coder, reviewer and one-time write are persisted and hash chained", async (t) => {
  const root=await mkdtemp(join(tmpdir(),"ynx-agent-test-")), workspaceStore=createWorkspaceStore({filename:join(root,"workspaces.sqlite")}), outputs=[
    {provider:"ynx-hosted",model:"qwen3:4b",text:`Planner result:\n${JSON.stringify({summary:"Add greeting",steps:[{title:"Edit source",acceptance:"Greeting is present"}],contextPaths:["src/main.ts"]})}\nEnd.`},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({summary:"Implemented greeting",edits:[{path:"Use only the approved file `./src/main.ts`",expectedDigest:createHash("sha256").update("export {};\n").digest("hex"),replacements:[{find:"export {};",replace:'export const greeting = "hello";'}]}]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({approved:false,summary:"Preserve the module marker",findings:[{severity:"medium",message:"Keep the existing export"}]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({summary:"Implemented bounded greeting",edits:[{path:"src/main.ts",expectedDigest:createHash("sha256").update("export {};\n").digest("hex"),replacements:[{find:"export {};",replace:'export const greeting = "hello";'}]}]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({approved:true,summary:"Safe bounded change",findings:[{severity:"info",message:"Scope is bounded"}]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({summary:"Fix test",edits:[{path:"src/main.ts",expectedDigest:createHash("sha256").update('export const greeting = "hello";\n').digest("hex"),replacements:[{find:'"hello"',replace:'"hello world"'}]}]})},
    {provider:"openai",model:"gpt-test",text:JSON.stringify({approved:true,summary:"Fix addresses evidence",findings:[]})},
  ], seen=[];let testAttempt=0;
  workspaceStore.put("owner-a","project-1",{expectedRevision:0,idempotencyKey:"initial-workspace",payload:{name:"Project",files:{"src/main.ts":"export {};\n"},folders:["src"],open:["src/main.ts"],active:"src/main.ts"}});
  const orchestrator=createAgentOrchestrator({filename:join(root,"agent.sqlite"),ownerForRequest:req=>req.headers["x-owner"]||null,workspaceStore,modelRouter:{generate:async input=>{seen.push(input);return outputs.shift();}},workspaceRuntime:{runTaskForOwner:async()=>{testAttempt+=1;return{protocolVersion:"ynx-code/v1",taskId:`task-${testAttempt}`,ok:testAttempt>1,code:testAttempt>1?0:1,language:"typescript",output:testAttempt>1?"tests passed":"expected hello world",durationMs:12,compiler:{executable:"node",version:"test"},sandbox:{kind:"test-sandbox",network:false,writableRoot:"workspace"},truncated:false}}}}), server=createServer(async(request,response)=>{if(await orchestrator.handler(request,response))return;response.statusCode=404;response.end()});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));orchestrator.close();workspaceStore.close()});
  const base=`http://127.0.0.1:${server.address().port}`, key="request-only-secret-never-store", call=(path,body)=>fetch(`${base}${path}`,{method:"POST",headers:{"x-owner":"owner-a","content-type":"application/json"},body:JSON.stringify({protocolVersion:"ynx-code-agent/v1",...body})});
  let response=await call("/runtime/agent/runs",{projectId:"project-1",intent:"Add a greeting export",provider:"ynx-hosted"}), value=await response.json(); assert.equal(response.status,201); const id=value.run.runId; assert.equal(value.run.status,"plan_review");
  for(const body of [{action:"approve-plan"},{action:"approve-context",paths:["src/main.ts"]},{action:"generate-proposal",provider:"openai",model:"gpt-test",apiKey:key}]){response=await call(`/runtime/agent/runs/${id}`,body);value=await response.json();assert.equal(response.status,200,value.error)}
  assert.equal(value.run.status,"diff_review");assert.equal(value.run.review.approved,false);response=await call(`/runtime/agent/runs/${id}`,{action:"revise-proposal",provider:"openai",apiKey:key});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.review.approved,true);assert.deepEqual(value.run.review.findings,["info: Scope is bounded"]);assert.equal(seen[1].apiKey,key);assert.equal(seen[4].apiKey,key);
  response=await call(`/runtime/agent/runs/${id}`,{action:"apply",approval:"write-once"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"applied");assert.equal(workspaceStore.get("owner-a","project-1").files["src/main.ts"],'export const greeting = "hello";\n');
  response=await call(`/runtime/agent/runs/${id}`,{action:"run-test",approval:"execute-once",activePath:"src/main.ts"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"test_failed");
  response=await call(`/runtime/agent/runs/${id}`,{action:"generate-fix",provider:"openai",apiKey:key});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"diff_review");
  response=await call(`/runtime/agent/runs/${id}`,{action:"apply",approval:"write-once"});value=await response.json();assert.equal(response.status,200,value.error);
  response=await call(`/runtime/agent/runs/${id}`,{action:"run-test",approval:"execute-once",activePath:"src/main.ts"});value=await response.json();assert.equal(response.status,200,value.error);assert.equal(value.run.status,"tested");assert.equal(value.run.events.at(-1).payload.result.output,"tests passed");
  const hashes=value.run.events.map(event=>event.event_hash);assert.equal(new Set(hashes).size,hashes.length);assert.ok(value.run.events.every((event,index)=>event.previous_hash===(index?hashes[index-1]:"0".repeat(64))));
  assert.equal((await readFile(join(root,"agent.sqlite"))).includes(Buffer.from(key)),false);
});

test("agent refuses write without approval, stale revision, and cross-owner reads", async (t)=>{
  const root=await mkdtemp(join(tmpdir(),"ynx-agent-boundary-")), store=createWorkspaceStore({filename:join(root,"workspaces.sqlite")}); store.put("a","p",{expectedRevision:0,idempotencyKey:"initial-project",payload:{name:"P",files:{"a.ts":"x"},folders:[],open:["a.ts"],active:"a.ts"}});
  const answers=[JSON.stringify({summary:"Plan",steps:[{title:"Edit",acceptance:"Done"}],contextPaths:["a.ts"]}),JSON.stringify({summary:"Patch",edits:[{path:"a.ts",expectedDigest:createHash("sha256").update("x").digest("hex"),replacements:[{find:"x",replace:"y"}]}]}),JSON.stringify({approved:true,summary:"Approved",findings:[]})], agent=createAgentOrchestrator({filename:join(root,"agent.sqlite"),ownerForRequest:req=>req.headers["x-owner"]||null,workspaceStore:store,modelRouter:{generate:async()=>({provider:"ynx-hosted",model:"qwen",text:answers.shift()})}}), server=createServer(async(req,res)=>{if(await agent.handler(req,res))return;res.writeHead(404).end()}); await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));agent.close();store.close()});
  const base=`http://127.0.0.1:${server.address().port}`, post=(path,body,owner="a")=>fetch(`${base}${path}`,{method:"POST",headers:{"x-owner":owner,"content-type":"application/json"},body:JSON.stringify({protocolVersion:"ynx-code-agent/v1",...body})});let value=await (await post("/runtime/agent/runs",{projectId:"p",intent:"Make a safe change"})).json(),id=value.run.runId;await post(`/runtime/agent/runs/${id}`,{action:"approve-plan"});await post(`/runtime/agent/runs/${id}`,{action:"approve-context",paths:["a.ts"]});await post(`/runtime/agent/runs/${id}`,{action:"generate-proposal"});let denied=await post(`/runtime/agent/runs/${id}`,{action:"apply"});assert.equal(denied.status,403);let hidden=await fetch(`${base}/runtime/agent/runs/${id}`,{headers:{"x-owner":"b"}});assert.equal(hidden.status,404);
});
