import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createAgentOrchestrator } from "../src/service.mjs";

test("an existing mismatched workspace receipt cannot be erased by claiming another run action", async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-agent-receipt-conflict-"));
  const store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  store.put("owner-a", "project", { expectedRevision: 0, idempotencyKey: "initial-source", payload: { name: "Owned", files: { "main.ts": "export const value = 1;" }, folders: [], open: ["main.ts"], active: "main.ts" } });
  const filename = join(root, "agent.sqlite"); let models = 0;
  const agent = createAgentOrchestrator({ filename, workspaceStore: store, ownerForRequest: () => "owner-a", modelRouter: { generate: async () => {
    models++; return { provider: "ynx-hosted", model: "qwen3:4b", text: JSON.stringify({ summary: "Plan", steps: [{ title: "Edit", acceptance: "Done" }], contextPaths: ["main.ts"] }) };
  } } });
  const raw = new DatabaseSync(filename), server = createServer((req, res) => { void agent.handler(req, res); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await agent.close(); raw.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/runtime/agent/runs`;
  const post = async (id, body) => { const res = await fetch(base + (id ? `/${id}` : ""), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ protocolVersion: "ynx-code-agent/v1", approvalId: randomUUID(), ...body }) }); return { status: res.status, value: await res.json() }; };
  const created = await post("", { projectId: "project", intent: "Preserve intent", approval: "model-request-once" });
  assert.equal(created.status, 201); const id = created.value.run.runId;
  // Represent a persisted interrupted intent whose key resolves to a receipt for different bytes.
  // Both receipts and run state are real SQLite records; recovery must fail closed on this conflict.
  const receipt = store.mutationReceipt("owner-a", "project", "initial-source");
  const intent = JSON.stringify({ idempotencyKey: "initial-source", expectedRevision: 0, requestHash: "0".repeat(64), targetStatus: "applied", trash: [], event: { type: "write.applied", payload: {} } });
  assert.notEqual(receipt.requestHash, JSON.parse(intent).requestHash);
  raw.prepare("UPDATE agent_operations SET status='interrupted',action='apply',write_intent=? WHERE owner_id=? AND run_id=?").run(intent, "owner-a", id);
  const before = raw.prepare("SELECT * FROM agent_operations WHERE owner_id=? AND run_id=?").get("owner-a", id);
  const failed = await post(id, { action: "unknown-action" });
  const after = raw.prepare("SELECT * FROM agent_operations WHERE owner_id=? AND run_id=?").get("owner-a", id);
  assert.equal(after.write_intent, before.write_intent);
  assert.equal(after.operation_id, before.operation_id);
  assert.equal(failed.status, 409, JSON.stringify(failed.value));
  assert.equal(agent.read("owner-a", id).status, "plan_review"); assert.equal(models, 1);
  assert.equal(store.get("owner-a", "project").revision, 1);
});
