import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createAgentOrchestrator } from "../src/service.mjs";
const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: value => release(value) }; };

test("close interrupts a signal-ignoring Planner and late resolution cannot publish its plan", async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-agent-close-recovery-"));
  const filename = join(root, "agent.sqlite"), store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  store.put("owner-a", "project", { expectedRevision: 0, idempotencyKey: "initial-source", payload: { name: "Owned", files: { "main.ts": "export const value = 1;" }, folders: [], open: ["main.ts"], active: "main.ts" } });
  const started = gate(), late = gate(); let modelCalls = 0, reopened;
  const agent = createAgentOrchestrator({ filename, workspaceStore: store, ownerForRequest: () => "owner-a", modelRouter: { generate: async () => {
    modelCalls++; started.release(); await late.promise;
    return { provider: "ynx-hosted", model: "qwen3:4b", text: JSON.stringify({ summary: "Late plan", steps: [{ title: "Edit", acceptance: "Done" }], contextPaths: ["main.ts"] }) };
  } } });
  const server = createServer((req, res) => { void agent.handler(req, res); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { late.release(); await agent.close(); if (reopened) await reopened.close(); await new Promise(resolve => server.close(resolve)); store.close(); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/runtime/agent/runs`;
  const pending = fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ protocolVersion: "ynx-code-agent/v1", approvalId: randomUUID(), approval: "model-request-once", projectId: "project", intent: "Preserve exact original intent" }) });
  await started.promise;
  const listed = await (await fetch(`${base}?projectId=project`)).json(); const id = listed.runs[0].runId;
  assert.equal(listed.runs[0].operation.status, "running");
  await agent.close();
  const response = await pending; assert.equal(response.status, 503);
  reopened = createAgentOrchestrator({ filename, workspaceStore: store, ownerForRequest: () => "owner-a", modelRouter: { generate: async () => { throw Error("Recovery must not call a provider"); } } });
  const saved = reopened.read("owner-a", id);
  assert.equal(saved.status, "planning"); assert.equal(saved.plan, null); assert.equal(saved.operation.status, "interrupted");
  assert.equal(saved.intent, "Preserve exact original intent"); assert.equal(saved.operation.action, "create");
  late.release(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reopened.read("owner-a", id), saved);
  assert.equal(saved.events.some(event => event.event_type === "planner.completed"), false); assert.equal(modelCalls, 1);
  assert.equal(store.get("owner-a", "project").revision, 1);
});
