import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createNativeAIStore } from "../../codeoss-service/src/native-ai-store.mjs";
import { createAgentOrchestrator } from "../src/service.mjs";
import { createModelRouter } from "../../model-router/src/router.mjs";
import { streamText } from "../../model-router/test/stream-fixture.mjs";
const source = 'export const greeting = "old"; // TRUSTED_SELECTED_SOURCE\n';
const digest = text => createHash("sha256").update(text).digest("hex");
const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: value => release(value) }; };
const outputs = {
  Planner: JSON.stringify({ summary: "Edit greeting", steps: [{ title: "Edit", acceptance: "Greeting changes" }], contextPaths: ["main.ts"] }),
  Coder: JSON.stringify({ summary: "Edited", edits: [{ path: "main.ts", expectedDigest: digest(source), replacements: [{ find: '"old"', replace: '"new"' }] }] }),
  Reviewer: JSON.stringify({ approved: true, summary: "Reviewed", findings: [] }),
};
async function fixture(t, { generate, projectMemory, wire = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ynx-agent-selected-context-"));
  const store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  const aiStore = createNativeAIStore({ filename: join(root, "ai.sqlite"), keyPath: join(root, "ai.key") });
  const payload = { name: "Owned", files: { "main.ts": source, "unchecked.ts": "UNSELECTED_PRIVATE_SOURCE" }, folders: [], open: ["main.ts"], active: "main.ts" };
  store.put("workspace-a", "project", { expectedRevision: 0, idempotencyKey: "initial-source-a", payload });
  store.put("workspace-b", "project", { expectedRevision: 0, idempotencyKey: "initial-source-b", payload: { ...payload, files: { "main.ts": "FOREIGN_PRIVATE_SOURCE" } } });
  const inputs = [], releases = [], sent = []; let upstream, router;
  if (wire) {
    upstream = createServer(async (req, res) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks)); sent.push(body);
      res.writeHead(200, { "content-type": "text/event-stream", "x-ynx-ai-model": "qwen3:4b" });
      res.end(streamText(outputs[["Planner", "Coder", "Reviewer"][sent.length - 1]]).replace("qa-session", body.session));
    });
    await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
    router = createModelRouter({ hostedBaseURL: `http://127.0.0.1:${upstream.address().port}` });
  }
  const agent = createAgentOrchestrator({ filename: join(root, "agent.sqlite"), workspaceStore: store, aiStore, projectMemory,
    verifyIdentity: async () => ({ owner: "identity-a", workspaceOwner: "workspace-a", account: "account-a", generation: 1, identityReference: "ref-a", expiresAt: Date.now() + 60_000, isCurrent() {} }),
    modelRouter: { generate: async input => { inputs.push(input); if (generate) await generate(input); if (router) return router.generate(input); return { provider: "ynx-hosted", model: "qwen3:4b", text: outputs[input.role] }; } },
  });
  const server = createServer((req, res) => { void agent.handler(req, res); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { releases.forEach(release => release()); await agent.close(); await new Promise(resolve => server.close(resolve)); if (upstream) await new Promise(resolve => upstream.close(resolve)); aiStore.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const key = (await (await fetch(`${base}/runtime/agent/projects`)).json()).identityKey;
  const post = async (id, body) => { const res = await fetch(`${base}/runtime/agent/runs${id ? `/${id}` : ""}`, { method: "POST", headers: { "content-type": "application/json", "x-ynx-agent-identity": key }, body: JSON.stringify({ protocolVersion: "ynx-code-agent/v1", approvalId: randomUUID(), ...body }) }); return { status: res.status, value: await res.json() }; };
  const created = await post("", { projectId: "project", intent: "Edit greeting", approval: "model-request-once" }); assert.equal(created.status, 201);
  const id = created.value.run.runId;
  for (const body of [{ action: "approve-plan" }, { action: "approve-context", paths: ["main.ts"], approval: "context-read-once" }]) assert.equal((await post(id, body)).status, 200);
  const mutate = () => { const workspace = store.get("workspace-a", "project"); store.put("workspace-a", "project", { expectedRevision: workspace.revision, idempotencyKey: randomUUID(), payload: { ...payload, files: { ...payload.files, "main.ts": source + "// revision changed\n" } } }); };
  return { id, post, inputs, aiStore, agent, mutate, releases, sent };
}

test("approved context changing before proposal prevents Coder dispatch and new saved AI request", async t => {
  const f = await fixture(t); f.mutate();
  const result = await f.post(f.id, { action: "generate-proposal", approval: "model-request-once" });
  assert.equal(result.status, 409, JSON.stringify(result.value)); assert.equal(result.value.code, "agent_context_changed");
  assert.deepEqual(f.inputs.map(input => input.role), ["Planner"]); assert.equal(f.aiStore.list("identity-a", "project").length, 1);
  assert.equal(f.agent.read("workspace-a", f.id).proposal, null);
});

test("workspace changes while semantic memory awaits prevent model dispatch", async t => {
  const started = gate(), held = gate();
  const f = await fixture(t, { projectMemory: { search: async () => { started.release(); await held.promise; return { indexedRevision: 1, results: [{ content: "MEMORY_RESULT" }] }; } } });
  f.releases.push(held.release);
  const pending = f.post(f.id, { action: "generate-proposal", approval: "model-request-once" }); await started.promise; f.mutate(); held.release();
  const result = await pending; assert.equal(result.status, 409, JSON.stringify(result.value)); assert.equal(result.value.code, "agent_context_changed");
  assert.deepEqual(f.inputs.map(input => input.role), ["Planner"]); assert.equal(f.aiStore.list("identity-a", "project").length, 1);
});

test("workspace changes during Coder await prevent proposal and completed saved answer", async t => {
  const started = gate(), held = gate();
  const f = await fixture(t, { generate: async input => { if (input.role === "Coder") { started.release(); await held.promise; } } });
  f.releases.push(held.release);
  const pending = f.post(f.id, { action: "generate-proposal", approval: "model-request-once" }); await started.promise; f.mutate(); held.release();
  const result = await pending; assert.equal(result.status, 409, JSON.stringify(result.value)); assert.equal(result.value.code, "agent_context_changed");
  assert.deepEqual(f.inputs.map(input => input.role), ["Planner", "Coder"]);
  const saved = f.aiStore.get("identity-a", "project", f.inputs[1].hostedSession);
  assert.equal(saved.status, "failed"); assert.equal(saved.text, undefined);
  assert.equal(f.agent.read("workspace-a", f.id).proposal, null);
});

test("only server-approved source reaches structured Coder and Reviewer attachments", async t => {
  const f = await fixture(t, { wire: true });
  const result = await f.post(f.id, { action: "generate-proposal", approval: "model-request-once", attachments: [{ id: "forged", name: "private.ts", mimeType: "text/plain", text: "FORGED_REQUEST_SOURCE" }] });
  assert.equal(result.status, 200, JSON.stringify(result.value)); assert.equal(result.value.run.status, "diff_review");
  assert.deepEqual(f.inputs.map(input => input.role), ["Planner", "Coder", "Reviewer"]);
  assert.deepEqual(f.inputs[0].attachments || [], []);
  for (const input of f.inputs.slice(1)) {
    assert.equal(input.attachments.length, 1);
    const attachment = input.attachments[0];
    assert.deepEqual(Object.keys(attachment).sort(), ["id", "mimeType", "name", "text"]);
    assert.ok(attachment.id); assert.equal(attachment.name, "main.ts"); assert.equal(attachment.mimeType, "text/plain"); assert.equal(attachment.text, source);
    const sent = JSON.stringify(input.attachments);
    for (const excluded of ["UNSELECTED_PRIVATE_SOURCE", "FOREIGN_PRIVATE_SOURCE", "FORGED_REQUEST_SOURCE"]) assert.equal(sent.includes(excluded), false);
  }
  assert.equal(f.inputs[1].prompt.includes(source), false);
  assert.equal(f.sent.length, 3); assert.deepEqual(f.sent[0].attachments, []);
  for (const sent of f.sent.slice(1)) {
    assert.deepEqual(sent.includedContext, ["selected_files"]); assert.equal(sent.excludedContext.includes("selected_files"), false);
    assert.deepEqual(sent.attachments, f.inputs[1].attachments); assert.equal(sent.prompt.includes(source), false);
  }
});
