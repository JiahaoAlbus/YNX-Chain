import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createAgentOrchestrator } from "../src/service.mjs";

const protocolVersion = "ynx-code-agent/v1";
const initial = 'export const value = "old";\n', removed = "export const obsolete = true;\n";
const digest = value => createHash("sha256").update(value).digest("hex");
const payload = { name: "Owned", files: { "main.ts": initial, "old.ts": removed }, folders: [], open: ["main.ts", "old.ts"], active: "main.ts" };
const outputs = {
  Planner: JSON.stringify({ summary: "Update value and remove obsolete source", steps: [{ title: "Edit and remove", acceptance: "Value changes and obsolete source is recoverable" }], contextPaths: ["main.ts", "old.ts"] }),
  Coder: JSON.stringify({ summary: "Updated value and removed obsolete source", edits: [{ path: "main.ts", expectedDigest: digest(initial), replacements: [{ find: '"old"', replace: '"new"' }] }], deletes: [{ path: "old.ts", expectedDigest: digest(removed) }] }),
  Reviewer: JSON.stringify({ approved: true, summary: "Reviewed exact changes", findings: [] }),
};

async function crashFixture(t, action, phase = "after-put") {
  const root = await mkdtemp(join(tmpdir(), "ynx-agent-write-crash-"));
  const serviceURL = new URL("../src/service.mjs", import.meta.url).href;
  const storeURL = new URL("../../workspace-manager/src/store.mjs", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict'; import {createServer} from 'node:http';
    import {randomUUID} from 'node:crypto'; import {writeFileSync} from 'node:fs';
    const {createAgentOrchestrator}=await import(${JSON.stringify(serviceURL)});
    const {createWorkspaceStore}=await import(${JSON.stringify(storeURL)});
    const root=${JSON.stringify(root)}, action=${JSON.stringify(action)}, phase=${JSON.stringify(phase)};
    const outputs=${JSON.stringify(outputs)}, store=createWorkspaceStore({filename:root+'/workspace.sqlite'});
    store.put('owner-a','project',{expectedRevision:0,idempotencyKey:'initial-owned-workspace',payload:${JSON.stringify(payload)}});
    store.put('owner-b','project',{expectedRevision:0,idempotencyKey:'initial-foreign-workspace',payload:{name:'Foreign',files:{'main.ts':'foreign-private-content'},folders:[],open:['main.ts'],active:'main.ts'}});
    let armed=false, runId=null, modelCalls=0;
    const die=(input,result)=>{
      writeFileSync(root+'/crash.json',JSON.stringify({runId,action,phase,modelCalls,idempotencyKey:input.idempotencyKey,expectedRevision:input.expectedRevision,savedRevision:result?.revision??null}));
      process.kill(process.pid,'SIGKILL');
      throw Error('SIGKILL boundary must never return to Agent persistence');
    };
    const workspaceStore={...store,put:(owner,project,input)=>{
      if(armed&&phase==='before-put')die(input,null);
      const result=store.put(owner,project,input);
      if(armed)die(input,result);
      return result;
    }};
    const agent=createAgentOrchestrator({filename:root+'/agent.sqlite',workspaceStore,ownerForRequest:()=> 'owner-a',
      modelRouter:{generate:async input=>{modelCalls++;return{provider:'ynx-hosted',model:'qwen3:4b',text:outputs[input.role]};}}});
    const server=createServer((req,res)=>{void agent.handler(req,res);});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port+'/runtime/agent/runs';
    async function post(id,body){
      const response=await fetch(base+(id?'/'+id:''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:${JSON.stringify(protocolVersion)},approvalId:randomUUID(),...body})});
      const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result.run;
    }
    const created=await post('',{projectId:'project',intent:'Update the value and delete the obsolete source with recoverable trash',approval:'model-request-once'});runId=created.runId;
    await post(runId,{action:'approve-plan'});
    await post(runId,{action:'approve-context',paths:['main.ts','old.ts'],deletePaths:['old.ts'],approval:'context-read-once'});
    await post(runId,{action:'generate-proposal',approval:'model-request-once'});
    if(action==='restore-deleted')await post(runId,{action:'apply',approval:'write-once'});
    armed=true;
    await post(runId,action==='apply'?{action:'apply',approval:'write-once'}:{action:'restore-deleted',paths:['old.ts'],approval:'restore-once'});
    throw Error('Expected a process death during the workspace write');
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", value => { stderr += value; });
  const stopped = once(child, "close"), timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  t.after(async () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await stopped; await rm(root, { recursive: true, force: true });
  });
  const [exitCode, signal] = await stopped; clearTimeout(timer);
  assert.equal(exitCode, null, stderr); assert.equal(signal, "SIGKILL", stderr);
  assert.equal(stderr, "");
  const crash = JSON.parse(await readFile(join(root, "crash.json"), "utf8"));
  assert.equal(crash.modelCalls, 3);
  const raw = new DatabaseSync(join(root, "agent.sqlite"));
  const beforeRun = raw.prepare("SELECT * FROM agent_runs WHERE owner_id=? AND run_id=?").get("owner-a", crash.runId);
  const beforeOperation = raw.prepare("SELECT * FROM agent_operations WHERE owner_id=? AND run_id=?").get("owner-a", crash.runId);
  const beforeEvents = raw.prepare("SELECT event_type,payload FROM agent_events WHERE owner_id=? AND run_id=? ORDER BY sequence").all("owner-a", crash.runId);
  raw.close();
  assert.equal(beforeRun.status, action === "apply" ? "diff_review" : "applied", "Agent state must still be before its final save when the process dies");
  assert.equal(beforeOperation.status, "running"); assert.equal(beforeOperation.action, action);
  assert.ok(beforeOperation.write_intent, "the exact write intent must already be durable before workspace put");
  const eventType = action === "apply" ? "write.applied" : "trash.restored";
  assert.equal(beforeEvents.some(event => event.event_type === eventType), false, "completion evidence must not have been saved before this crash");
  return { root, crash, beforeRun, beforeOperation, beforeEvents, eventType };
}

async function reopen(f, work) {
  const store = createWorkspaceStore({ filename: join(f.root, "workspace.sqlite") });
  let puts = 0, models = 0;
  const workspaceStore = { ...store, put: () => { puts++; assert.fail("Recovery must not retry the workspace mutation"); } };
  const agent = createAgentOrchestrator({ filename: join(f.root, "agent.sqlite"), workspaceStore, ownerForRequest: () => "owner-a",
    modelRouter: { generate: async () => { models++; assert.fail("Recovery must not request any model output"); } } });
  try {
    await work({ agent, store });
    assert.equal(puts, 0); assert.equal(models, 0);
    assert.equal(agent.read("owner-b", f.crash.runId), null);
    assert.equal(store.get("owner-b", "project").revision, 1);
    assert.equal(store.get("owner-b", "project").files["main.ts"], "foreign-private-content");
  } finally { await agent.close(); store.close(); }
}

for (const action of ["apply", "restore-deleted"]) {
  test(`SIGKILL after ${action} workspace commit reconstructs the exact run and event without another write`, async t => {
    const f = await crashFixture(t, action), expectedRevision = action === "apply" ? 2 : 3;
    assert.equal(f.crash.savedRevision, expectedRevision);
    const intent = JSON.parse(f.beforeOperation.write_intent);
    assert.equal(intent.idempotencyKey, f.crash.idempotencyKey); assert.equal(intent.expectedRevision + 1, expectedRevision);
    await reopen(f, ({ agent, store }) => {
      const receipt = store.mutationReceipt("owner-a", "project", intent.idempotencyKey);
      assert.equal(receipt.requestHash, intent.requestHash); assert.equal(receipt.revision, expectedRevision);
      const recovered = agent.read("owner-a", f.crash.runId), workspace = store.get("owner-a", "project");
      assert.equal(recovered.status, action === "apply" ? "applied" : "restored");
      assert.equal(recovered.operation.status, "finished"); assert.equal(recovered.workspaceRevision, expectedRevision);
      assert.equal(workspace.revision, expectedRevision); assert.equal(workspace.files["main.ts"], 'export const value = "new";\n');
      if (action === "apply") {
        assert.equal(Object.hasOwn(workspace.files, "old.ts"), false);
        assert.deepEqual(recovered.trash, [{ path: "old.ts", content: removed, digest: digest(removed), deletedRevision: 2 }]);
      } else {
        assert.equal(workspace.files["old.ts"], removed); assert.deepEqual(recovered.trash, []);
        assert.equal(recovered.deployment, null); assert.equal(recovered.gitOperation, null);
      }
      const completed = recovered.events.filter(event => event.event_type === f.eventType);
      assert.equal(completed.length, 1); assert.equal(completed[0].payload.revision, expectedRevision);
      assert.ok(recovered.events.every((event, index) => event.previous_hash === (index ? recovered.events[index - 1].event_hash : "0".repeat(64))));
      assert.deepEqual(agent.read("owner-a", f.crash.runId), recovered, "repeated read must not append duplicate completion evidence");
    });
    await reopen(f, ({ agent, store }) => {
      assert.equal(agent.read("owner-a", f.crash.runId).events.filter(event => event.event_type === f.eventType).length, 1);
      assert.equal(store.get("owner-a", "project").revision, expectedRevision);
    });
  });

  test(`SIGKILL before ${action} workspace commit leaves interrupted intent and never fabricates a receipt`, async t => {
    const f = await crashFixture(t, action, "before-put"), expectedRevision = action === "apply" ? 1 : 2;
    assert.equal(f.crash.savedRevision, null);
    await reopen(f, ({ agent, store }) => {
      const recovered = agent.read("owner-a", f.crash.runId);
      assert.equal(recovered.status, action === "apply" ? "diff_review" : "applied");
      assert.equal(recovered.operation.status, "interrupted");
      assert.equal(recovered.operation.errorCode, "agent_process_interrupted");
      assert.equal(recovered.workspaceRevision, expectedRevision); assert.equal(store.get("owner-a", "project").revision, expectedRevision);
      assert.equal(store.mutationReceipt("owner-a", "project", f.crash.idempotencyKey), null);
      assert.equal(recovered.events.some(event => event.event_type === f.eventType), false);
    });
  });
}

test("failed Tester evidence insert rolls back the tested state and leaves an interrupted operation", async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-agent-tester-atomic-"));
  const store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  store.put("owner-a", "project", { expectedRevision: 0, idempotencyKey: "initial-owned-workspace", payload });
  let models = 0, tests = 0;
  const agent = createAgentOrchestrator({ filename: join(root, "agent.sqlite"), workspaceStore: store, ownerForRequest: () => "owner-a",
    modelRouter: { generate: async input => { models++; return { provider: "ynx-hosted", model: "qwen3:4b", text: outputs[input.role] }; } },
    workspaceRuntime: { runTaskForOwner: async () => { tests++; return { ok: true, taskId: "test-task", output: "passed" }; } },
  });
  const server = createServer((request, response) => { void agent.handler(request, response); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const raw = new DatabaseSync(join(root, "agent.sqlite"));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); raw.close(); await agent.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/runtime/agent/runs`;
  const post = async (id, body) => {
    const response = await fetch(base + (id ? `/${id}` : ""), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion, approvalId: randomUUID(), ...body }) });
    return { status: response.status, value: await response.json() };
  };
  const created = await post("", { projectId: "project", intent: "Update value and remove obsolete source", approval: "model-request-once" });
  assert.equal(created.status, 201); const id = created.value.run.runId;
  for (const body of [
    { action: "approve-plan" },
    { action: "approve-context", paths: ["main.ts", "old.ts"], deletePaths: ["old.ts"], approval: "context-read-once" },
    { action: "generate-proposal", approval: "model-request-once" },
    { action: "apply", approval: "write-once" },
  ]) { const result = await post(id, body); assert.equal(result.status, 200, JSON.stringify(result.value)); }
  raw.exec("CREATE TRIGGER fail_tester_evidence BEFORE INSERT ON agent_events WHEN NEW.event_type='tester.completed' BEGIN SELECT RAISE(ABORT,'test evidence store unavailable'); END");
  const result = await post(id, { action: "run-test", activePath: "main.ts", approval: "execute-once" });
  assert.ok(result.status >= 400);
  const recovered = agent.read("owner-a", id);
  assert.equal(recovered.status, "applied"); assert.equal(recovered.workspaceRevision, 2);
  assert.equal(recovered.operation.status, "interrupted");
  assert.equal(recovered.events.some(event => event.event_type === "tester.completed"), false);
  assert.equal(raw.prepare("SELECT status FROM agent_runs WHERE owner_id=? AND run_id=?").get("owner-a", id).status, "applied");
  assert.equal(store.get("owner-a", "project").revision, 2); assert.equal(models, 3); assert.equal(tests, 1);
});
