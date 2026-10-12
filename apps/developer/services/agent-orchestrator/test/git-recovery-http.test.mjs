import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createAgentOrchestrator } from "../src/service.mjs";

const initial = 'export const value = "old";\n';
const outputs = {
  Planner: JSON.stringify({ summary: "Change value", steps: [{ title: "Edit", acceptance: "Value changes" }], contextPaths: ["main.ts"] }),
  Coder: JSON.stringify({ summary: "Changed", edits: [{ path: "main.ts", expectedDigest: createHash("sha256").update(initial).digest("hex"), replacements: [{ find: '"old"', replace: '"new"' }] }] }),
  Reviewer: JSON.stringify({ approved: true, summary: "Reviewed", findings: [] }),
};
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "ynx-git-http-recovery-"));
  const store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  store.put("owner-a", "project", { expectedRevision: 0, idempotencyKey: "initial-source", payload: { name: "Owned", files: { "main.ts": initial }, folders: [], open: ["main.ts"], active: "main.ts" } });
  let committed = false, failRead = false; const calls = [];
  const agent = createAgentOrchestrator({ filename: join(root, "agent.sqlite"), workspaceStore: store, ownerForRequest: req => req.headers["x-owner"] || "owner-a",
    modelRouter: { generate: async input => ({ provider: "ynx-hosted", model: "qwen3:4b", text: outputs[input.role] }) },
    workspaceRuntime: { runTaskForOwner: async () => ({ ok: true, taskId: "passed-test", output: "Passed" }) },
    gitService: { runForOwner: async (owner, projectId, body, options) => {
      calls.push({ owner, projectId, body }); await options.assertCurrent();
      if (body) { assert.equal(body.action, "commit-reviewed"); committed = true; throw Object.assign(new Error("receipt interrupted"), { code: "git_receipt_interrupted", status: 503, details: { completedOperation: "commit-reviewed", childExitCode: 0 } }); }
      if (failRead) throw Object.assign(new Error("read interrupted"), { code: "git_read_unavailable", status: 503 });
      return committed ? { initialized: true, branch: "main", head: "observed-new-head", changes: [] } : { initialized: false, branch: null, head: null, changes: [] };
    } },
  });
  const server = createServer((req, res) => { void agent.handler(req, res); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/runtime/agent/runs`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await agent.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const post = async (id, body, owner = "owner-a") => {
    const res = await fetch(base + (id ? `/${id}` : ""), { method: "POST", headers: { "content-type": "application/json", "x-owner": owner }, body: JSON.stringify({ protocolVersion: "ynx-code-agent/v1", approvalId: randomUUID(), ...body }) });
    return { status: res.status, value: await res.json() };
  };
  const detail = async id => (await fetch(`${base}/${id}`)).json();
  const created = await post("", { projectId: "project", intent: "Change the value", approval: "model-request-once" });
  assert.equal(created.status, 201); const id = created.value.run.runId;
  for (const body of [{ action: "approve-plan" }, { action: "approve-context", paths: ["main.ts"], approval: "context-read-once" }, { action: "generate-proposal", approval: "model-request-once" }, { action: "apply", approval: "write-once" }, { action: "run-test", activePath: "main.ts", approval: "execute-once" }, { action: "prepare-git" }]) {
    const result = await post(id, body); assert.equal(result.status, 200, JSON.stringify(result.value));
  }
  return { id, post, detail, calls, failRead: value => { failRead = value; } };
}

test("HTTP Git recovery preserves interrupted commit evidence and only observes repository state", async t => {
  const f = await fixture(t);
  const failed = await f.post(f.id, { action: "approve-git", approval: "git-local-commit-once" });
  assert.equal(failed.status, 503);
  const original = (await f.detail(f.id)).run.operation;
  assert.equal(original.status, "interrupted"); assert.equal(original.action, "approve-git");
  assert.equal(original.recoveryEvidence.completedOperation, "commit-reviewed"); assert.equal(original.recoveryEvidence.childExitCode, 0);
  for (const action of ["unknown-action", "approve-plan", "approve-git"]) {
    const denied = await f.post(f.id, { action, approval: "git-local-commit-once" });
    assert.equal(denied.status, 409); assert.equal(denied.value.code, "git_recovery_required");
    assert.deepEqual((await f.detail(f.id)).run.operation, original);
  }
  assert.equal((await f.post(f.id, { action: "reconcile-git" }, "owner-b")).status, 404);
  const before = f.calls.length;
  const recovered = await f.post(f.id, { action: "reconcile-git" });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.value));
  const run = recovered.value.run;
  assert.equal(run.status, "tested"); assert.equal(run.operation.status, "finished");
  assert.equal(run.gitOperation.executed, false); assert.equal(run.gitOperation.recovery.head, "observed-new-head");
  assert.equal(run.gitOperation.recovery.previousOutcome, "process-reported-completed");
  assert.equal(run.gitOperation.recovery.state, "clean");
  assert.ok(run.events.some(event => event.event_type === "git.reconciled"));
  assert.equal(f.calls.length, before + 1); assert.equal(f.calls.at(-1).body, null);
  assert.equal(f.calls.filter(call => call.body !== null).length, 1);
});

test("failed HTTP reconciliation retains the original commit recovery gate for explicit retry", async t => {
  const f = await fixture(t);
  assert.equal((await f.post(f.id, { action: "approve-git", approval: "git-local-commit-once" })).status, 503);
  const original = (await f.detail(f.id)).run.operation.recoveryEvidence;
  f.failRead(true); assert.equal((await f.post(f.id, { action: "reconcile-git" })).status, 503);
  const saved = (await f.detail(f.id)).run;
  assert.equal(saved.status, "git_review"); assert.equal(saved.operation.status, "interrupted");
  assert.equal(saved.operation.action, "approve-git"); assert.deepEqual(saved.operation.recoveryEvidence, original);
  assert.equal((await f.post(f.id, { action: "approve-plan" })).value.code, "git_recovery_required");
  f.failRead(false); assert.equal((await f.post(f.id, { action: "reconcile-git" })).status, 200);
  assert.equal(f.calls.filter(call => call.body !== null).length, 1);
});
