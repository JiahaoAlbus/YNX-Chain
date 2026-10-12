import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createAgentOrchestrator } from "../src/service.mjs";

const protocolVersion = "ynx-code-agent/v1";
const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), release: () => resolve() }; };
const initial = 'export const value = "old";\n';
const outputs = {
  Planner: JSON.stringify({ summary: "Change the value", steps: [{ title: "Edit value", acceptance: "Value changes" }], contextPaths: ["main.ts"] }),
  Coder: JSON.stringify({ summary: "Changed value", edits: [{ path: "main.ts", expectedDigest: createHash("sha256").update(initial).digest("hex"), replacements: [{ find: '"old"', replace: '"new"' }] }] }),
  Reviewer: JSON.stringify({ approved: true, summary: "Reviewed", findings: [] }),
};
async function fixture(t, generate) {
  const root = await mkdtemp(join(tmpdir(), "ynx-agent-recovery-"));
  const store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  store.put("owner-a", "project", { expectedRevision: 0, idempotencyKey: "initial-source", payload: {
    name: "Owned", files: { "main.ts": initial }, folders: [], open: ["main.ts"], active: "main.ts",
  } });
  const releases = [], calls = [];
  const agent = createAgentOrchestrator({ filename: join(root, "agent.sqlite"), workspaceStore: store,
    ownerForRequest: req => req.headers["x-owner"] || "owner-a",
    modelRouter: { generate: async input => { calls.push(input); if (generate) await generate(input); return { provider: "ynx-hosted", model: "qwen3:4b", text: outputs[input.role] }; } },
  });
  let dropApplyResponse = false;
  const server = createServer((req, res) => {
    if (dropApplyResponse && req.method === "POST" && /\/runs\//.test(req.url)) {
      dropApplyResponse = false; const end = res.end.bind(res);
      res.end = function(value, ...args) { if (String(value).includes('"status":"applied"')) { res.destroy(); return res; } return end(value, ...args); };
    }
    void agent.handler(req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/runtime/agent/runs`;
  t.after(async () => { releases.forEach(release => release()); await new Promise(resolve => server.close(resolve)); agent.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const post = async (id, body, owner = "owner-a") => {
    const res = await fetch(base + (id ? `/${id}` : ""), { method: "POST", headers: { "content-type": "application/json", "x-owner": owner },
      body: JSON.stringify({ protocolVersion, approvalId: randomUUID(), ...body }) });
    return { status: res.status, value: await res.json() };
  };
  const create = () => post("", { projectId: "project", intent: "Change the existing value", approval: "model-request-once" });
  const detail = async id => (await fetch(`${base}/${id}`)).json();
  const list = async (query = "") => (await fetch(`${base}?projectId=project${query}`)).json();
  const toContext = async () => { const created = await create(), id = created.value.run.runId; assert.equal(created.status, 201);
    for (const body of [{ action: "approve-plan" }, { action: "approve-context", paths: ["main.ts"], approval: "context-read-once" }]) assert.equal((await post(id, body)).status, 200);
    return id;
  };
  return { root, agent, store, calls, releases, post, create, detail, list, toContext, dropApply: () => { dropApplyResponse = true; } };
}

test("Planner is durably visible before completion and read-only recovery never generates", async t => {
  const started = gate(), held = gate();
  const f = await fixture(t, async input => { if (input.role === "Planner") { started.release(); await held.promise; } });
  f.releases.push(held.release);
  const pending = f.create(); await started.promise;
  const saved = await f.list();
  assert.equal(saved.runs.length, 1);
  const id = saved.runs[0].runId;
  assert.equal(saved.runs[0].status, "planning"); assert.equal(saved.runs[0].operation.status, "running");
  assert.equal((await f.detail(id)).run.operation.action, "create");
  assert.equal((await f.post(id, { action: "approve-plan" })).status, 409);
  assert.equal(f.calls.length, 1);
  held.release(); const result = await pending;
  assert.equal(result.status, 201); assert.equal(result.value.run.operation.status, "finished");
  const recovered = (await f.detail(id)).run;
  assert.equal(recovered.status, "plan_review"); assert.ok(recovered.events.some(event => event.event_type === "planner.completed"));
  assert.equal(f.calls.length, 1);
});

test("a running Coder is visible and a second approval cannot duplicate the same run operation", async t => {
  const started = gate(), held = gate();
  const f = await fixture(t, async input => { if (input.role === "Coder") { started.release(); await held.promise; } });
  f.releases.push(held.release); const id = await f.toContext();
  const pending = f.post(id, { action: "generate-proposal", approval: "model-request-once" }); await started.promise;
  assert.equal((await f.detail(id)).run.operation.status, "running");
  const duplicate = await f.post(id, { action: "generate-proposal", approval: "model-request-once" });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.value.code, "agent_run_busy");
  assert.equal(f.calls.filter(input => input.role === "Coder").length, 1);
  held.release(); assert.equal((await pending).value.run.operation.status, "finished");
  assert.equal((await f.detail(id)).run.status, "diff_review");
});

test("a lost write response is recovered as applied without repeating the write or model approval", async t => {
  const f = await fixture(t), id = await f.toContext();
  assert.equal((await f.post(id, { action: "generate-proposal", approval: "model-request-once" })).status, 200);
  f.dropApply(); await assert.rejects(f.post(id, { action: "apply", approval: "write-once" }));
  const recovered = (await f.detail(id)).run;
  assert.equal(recovered.status, "applied"); assert.equal(recovered.operation.status, "finished");
  assert.equal(recovered.workspaceRevision, 2); assert.equal(f.store.get("owner-a", "project").revision, 2);
  assert.equal(f.calls.length, 3);
  assert.ok(recovered.events.some(event => event.event_type === "write.applied"));
  assert.equal((await f.post(id, { action: "apply", approval: "write-once" })).status, 409);
});

test("saved-run pagination retains owner isolation and returns older records without model calls", async t => {
  const f = await fixture(t);
  for (let index = 0; index < 4; index++) assert.equal((await f.create()).status, 201);
  const first = await f.list("&limit=2"), second = await f.list(`&limit=2&cursor=${first.nextCursor}`);
  assert.equal(first.runs.length, 2); assert.equal(second.runs.length, 2); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.runs, ...second.runs].map(run => run.runId)).size, 4);
  assert.equal(f.calls.length, 4);
  assert.equal((await f.post(first.runs[0].runId, { action: "approve-plan" }, "owner-b")).status, 404);
});

test("keyset history does not skip runs when status changes or a newer run is inserted", async t => {
  const f = await fixture(t);
  for (let index = 0; index < 4; index++) await f.create();
  const db = new DatabaseSync(join(f.root, "agent.sqlite"));
  db.exec("UPDATE agent_runs SET created_at='2026-10-02T08:00:00.000Z'");
  const original = db.prepare("SELECT run_id FROM agent_runs ORDER BY created_at DESC,run_id DESC").all().map(row => row.run_id);
  const first = await f.list("&limit=2");
  assert.equal(typeof first.nextCursor, "string");
  await f.post(original[3], { action: "approve-plan" });
  await f.create();
  const second = await f.list(`&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
  assert.deepEqual([...first.runs, ...second.runs].map(run => run.runId), original);
  assert.equal(second.nextCursor, null);
  const old = original[3];
  db.prepare("UPDATE agent_operations SET status='running' WHERE run_id=?").run(old);
  const live = await f.list("&limit=1");
  assert.ok(live.runs.some(run => run.runId === old && run.operation.status === "running"));
  assert.equal(new Set(live.runs.map(run => run.runId)).size, live.runs.length);
  db.prepare("UPDATE agent_operations SET status='finished' WHERE run_id=?").run(old);
  db.close();
  assert.equal(f.calls.length, 5);
});

test("a killed Planner process recovers an interrupted saved intent without retrying the model", async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-agent-restart-"));
  const serviceURL = new URL("../src/service.mjs", import.meta.url).href;
  const storeURL = new URL("../../workspace-manager/src/store.mjs", import.meta.url).href;
  const script = `
    import {createServer} from 'node:http'; import {DatabaseSync} from 'node:sqlite';
    const {createAgentOrchestrator}=await import(${JSON.stringify(serviceURL)});
    const {createWorkspaceStore}=await import(${JSON.stringify(storeURL)});
    const root=${JSON.stringify(root)}, store=createWorkspaceStore({filename:root+'/workspace.sqlite'});
    store.put('owner-a','project',{expectedRevision:0,idempotencyKey:'initial-source',payload:{name:'Owned',files:{'main.ts':'export const value = 1;'},folders:[],open:['main.ts'],active:'main.ts'}});
    const agent=createAgentOrchestrator({filename:root+'/agent.sqlite',workspaceStore:store,ownerForRequest:()=> 'owner-a',modelRouter:{generate:async()=>{
      const read=new DatabaseSync(root+'/agent.sqlite'); const row=read.prepare('SELECT run_id FROM agent_runs').get(); read.close();
      process.stdout.write(JSON.stringify({runId:row?.run_id})+'\\n'); return new Promise(()=>{});
    }}});
    const server=createServer((req,res)=>{void agent.handler(req,res);});
    server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:server.address().port})+'\\n'));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const port = gate(), started = gate(); let portNumber, runId, stderr = "", buffer = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.on("data", chunk => { buffer += chunk; let line;
    while ((line = buffer.indexOf("\n")) >= 0) { const value = JSON.parse(buffer.slice(0, line)); buffer = buffer.slice(line + 1);
      if (value.port) { portNumber = value.port; port.release(); } if (value.runId) { runId = value.runId; started.release(); }
    }
  });
  const stopped = once(child, "close");
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await stopped; await rm(root, { recursive: true, force: true }); });
  await port.promise;
  const pending = fetch(`http://127.0.0.1:${portNumber}/runtime/agent/runs`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion, approvalId: randomUUID(), approval: "model-request-once", projectId: "project", intent: "Preserve this exact intent before planning" }) }).catch(() => null);
  await started.promise; child.kill("SIGKILL"); await stopped; await pending;
  assert.equal(stderr, ""); let modelCalls = 0;
  const store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  const agent = createAgentOrchestrator({ filename: join(root, "agent.sqlite"), workspaceStore: store, ownerForRequest: () => "owner-a",
    modelRouter: { generate: async () => { modelCalls++; throw Error("Must not retry"); } } });
  try {
    const recovered = agent.read("owner-a", runId);
    assert.equal(recovered.status, "planning"); assert.equal(recovered.plan, null);
    assert.equal(recovered.operation.status, "interrupted"); assert.equal(recovered.operation.errorCode, "agent_process_interrupted");
    assert.equal(recovered.intent, "Preserve this exact intent before planning"); assert.equal(modelCalls, 0);
    assert.equal(agent.read("owner-b", runId), null);
  } finally { agent.close(); store.close(); }
});
