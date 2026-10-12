import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createGitService } from "../../git-service/src/service.mjs";
import { inspectAgentGitRecovery } from "../src/git-recovery.mjs";
import { resolveExecutable } from "../../workspace-agent/src/sandbox.mjs";

const payload = content => ({ name: "Owned", files: { "main.ts": content }, folders: [], open: ["main.ts"], active: "main.ts" });
const failure = (code, status) => Object.assign(new Error(code), { code, status });
const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), release: () => resolve() }; };
const run = () => ({
  workspaceOwner: "owner-a", runId: "run-a", projectId: "project", status: "git_review", workspaceRevision: 1,
  operation: { status: "interrupted", action: "approve-git" },
  gitOperation: { projectId: "project", workspaceRevision: 1, testEvidenceHash: "tester-hash", previewDigest: "preview-digest", head: "old-head", branch: "main", executable: false },
  events: [{ event_type: "tester.completed", event_hash: "tester-hash", payload: { result: { ok: true } } }],
});
async function fixture(t, generateStatus) {
  const root = await realpath(await mkdtemp("/private/tmp/ynx-agent-git-recovery-"));
  const store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") });
  store.put("owner-a", "project", { expectedRevision: 0, idempotencyKey: "seed-owner-a", payload: payload("owned-a\n") });
  store.put("owner-b", "project", { expectedRevision: 0, idempotencyKey: "seed-owner-b", payload: payload("private-b\n") });
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const calls = [], reads = [], controller = new AbortController();
  const workspaceStore = {
    get: (owner, project) => { reads.push({ owner, project }); return store.get(owner, project); },
    storageMode: (owner, project) => store.storageMode(owner, project),
    put: () => assert.fail("Recovery must not save a workspace"),
  };
  const gitService = { runForOwner: async (...args) => {
    calls.push(args); assert.equal(args[2], null, "recovery may only use the existing Git status read");
    return generateStatus ? generateStatus(...args) : { initialized: true, head: "actual-head", branch: "main", changes: [] };
  } };
  const currentRun = run(), assertCurrent = async () => {};
  const args = { owner: "owner-a", run: currentRun, workspaceStore, gitService, signal: controller.signal, assertCurrent };
  return { root, store, workspaceStore, calls, reads, controller, run: currentRun, args, inspect: override => inspectAgentGitRecovery({ ...args, ...override }) };
}

test("clean Git observation preserves uncertainty, owner scope and the original saved review without writes", async t => {
  const f = await fixture(t), original = structuredClone(f.run);
  const value = await f.inspect();
  assert.equal(value.status, "tested"); assert.equal(value.gitOperation.executed, false);
  assert.equal(value.gitOperation.head, "old-head", "old approval is not rewritten into a new execution receipt");
  assert.deepEqual({ ...value.gitOperation.recovery, checkedAt: null }, {
    state: "clean", head: "actual-head", branch: "main", pendingChanges: [], checkedAt: null, previousOutcome: "unknown",
  });
  assert.ok(Number.isFinite(Date.parse(value.gitOperation.recovery.checkedAt)));
  assert.deepEqual(f.run, original); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].slice(0, 3), ["owner-a", "project", null]);
  assert.equal(f.calls[0][3].signal, f.controller.signal); assert.equal(f.calls[0][3].assertCurrent, f.args.assertCurrent);
  assert.ok(f.reads.every(value => value.owner === "owner-a" && value.project === "project"));
  assert.equal(f.store.get("owner-a", "project").revision, 1); assert.equal(f.store.get("owner-b", "project").revision, 1);
});

test("pending changes and process-reported completion remain separate observations", async t => {
  const change = { path: "renamed.ts", originalPath: "main.ts", status: "R ", indexStatus: "R", worktreeStatus: " " };
  const f = await fixture(t, () => ({ initialized: true, head: "actual-head", branch: "main", changes: [change] }));
  f.run.operation.recoveryEvidence = { completedOperation: "commit-reviewed", recheckRequired: true };
  const value = await f.inspect();
  assert.equal(value.gitOperation.recovery.state, "pending-changes");
  assert.deepEqual(value.gitOperation.recovery.pendingChanges, [change]);
  assert.equal(value.gitOperation.recovery.previousOutcome, "process-reported-completed");
  assert.equal(value.gitOperation.executed, false);
  value.gitOperation.recovery.pendingChanges[0].path = "changed-return-value";
  assert.equal(change.path, "renamed.ts", "the recovery result does not alias the adapter status");
  f.run.operation.recoveryEvidence.completedOperation = "checkout";
  assert.equal((await f.inspect()).gitOperation.recovery.previousOutcome, "unknown");
});

test("an uninitialized repository reports the owned workspace files as pending without initializing Git", async t => {
  const f = await fixture(t, () => ({ initialized: false, branch: null, changes: [], commits: [] }));
  const value = await f.inspect();
  assert.deepEqual({ ...value.gitOperation.recovery, checkedAt: null }, {
    state: "pending-changes", head: null, branch: null,
    pendingChanges: [{ path: "main.ts", status: "??", indexStatus: "?", worktreeStatus: "?" }], checkedAt: null, previousOutcome: "unknown",
  });
  assert.equal(f.calls.length, 1); assert.equal(f.store.get("owner-a", "project").revision, 1);
});

test("a foreign owner with the same project and revision cannot inspect another owner's run", async t => {
  const f = await fixture(t);
  await assert.rejects(f.inspect({ owner: "owner-b" }), error => error.code === "agent_run_not_found" && error.status === 404);
  assert.deepEqual(f.reads, []); assert.deepEqual(f.calls, []);
  assert.equal(f.store.get("owner-b", "project").files["main.ts"], "private-b\n");
});

test("Git recovery refuses an active operation, unrelated action, stale review or missing passing Tester evidence", async t => {
  const f = await fixture(t);
  const variants = [
    [value => { value.operation.status = "running"; }, "agent_git_recovery_unavailable"],
    [value => { value.operation.action = "apply"; }, "agent_git_recovery_unavailable"],
    [value => { value.status = "git_committed"; }, "agent_git_recovery_unavailable"],
    [value => { value.events = []; }, "git_test_evidence_required"],
    [value => { value.events[0].payload.result.ok = false; }, "git_test_evidence_required"],
    [value => { value.gitOperation.testEvidenceHash = "other-test"; }, "git_test_evidence_required"],
    [value => { value.gitOperation.projectId = "other-project"; }, "git_test_evidence_required"],
    [value => { value.gitOperation.workspaceRevision = 2; }, "git_test_evidence_required"],
  ];
  for (const [mutate, code] of variants) {
    const input = run(); mutate(input);
    await assert.rejects(f.inspect({ run: input }), error => error.code === code && error.status === 409);
  }
  f.store.put("owner-a", "project", { expectedRevision: 1, idempotencyKey: "changed-before-inspection", payload: payload("new\n") });
  await assert.rejects(f.inspect(), error => error.code === "git_preview_stale" && error.status === 409);
  assert.deepEqual(f.calls, []);
});

test("workspace changes during the Git read invalidate the observation", async t => {
  const started = gate(), held = gate();
  const f = await fixture(t, async () => { started.release(); await held.promise; return { initialized: true, head: "head", branch: "main", changes: [] }; });
  const pending = f.inspect(), rejected = assert.rejects(pending, error => error.code === "git_preview_stale");
  await started.promise;
  f.store.put("owner-a", "project", { expectedRevision: 1, idempotencyKey: "changed-during-inspection", payload: payload("new\n") });
  held.release(); await rejected;
  assert.equal(f.calls.length, 1); assert.equal(f.run.status, "git_review");
});

test("identity revocation and service closure before inspection dispatch no Git read", async t => {
  const f = await fixture(t);
  await assert.rejects(f.inspect({ assertCurrent: async () => { throw failure("agent_identity_changed", 401); } }), error => error.code === "agent_identity_changed");
  await assert.rejects(f.inspect({ assertCurrent: async () => false }), error => error.code === "agent_identity_changed");
  const closed = failure("agent_service_closed", 503); f.controller.abort(closed);
  await assert.rejects(f.inspect(), error => error === closed);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.reads, []);
});

for (const code of ["agent_identity_changed", "agent_service_closed"]) {
  test(`${code} during a late Git read returns no recovery metadata`, async t => {
    const started = gate(), held = gate(); let revoked = false;
    const f = await fixture(t, async () => { started.release(); await held.promise; return { initialized: true, head: "late-head", branch: "main", changes: [] }; });
    const reason = failure(code, code === "agent_identity_changed" ? 401 : 503);
    const pending = f.inspect({ assertCurrent: async () => { if (revoked) throw reason; } });
    const rejected = assert.rejects(pending, error => error === reason);
    await started.promise;
    if (code === "agent_service_closed") f.controller.abort(reason);
    else revoked = true;
    held.release(); await rejected;
    assert.equal(f.run.status, "git_review"); assert.equal(f.run.gitOperation.recovery, undefined);
    assert.equal(f.store.get("owner-a", "project").revision, 1);
  });
}

test("actual sandboxed Git recovery observes clean and pending state without commit, stage, reset or workspace saves", async t => {
  const f = await fixture(t), log = join(f.root, "commands.log"), executable = join(f.root, "observed-git.sh");
  const gitPath = await resolveExecutable(["git"]);
  assert.ok(gitPath, "the existing Git adapter must resolve an installed executable");
  // The wrapper observes the already-reviewed Git adapter under its existing
  // macOS sandbox; it does not add an unsandboxed production path.
  await writeFile(executable, `#!/bin/sh
for value in "$@"; do
  case "$value" in init|branch|status|log|for-each-ref|rev-parse|add|commit|checkout|symbolic-ref|show-ref|merge|reset|diff)
    printf '%s\\n' "$value" >> '${log}'; break;; esac
done
exec '${gitPath.replaceAll("'", "'\\''")}' "$@"
`, { mode: 0o700 });
  const gitService = createGitService({ workspaceStore: f.workspaceStore, root: join(f.root, "repositories"), gitPath: executable });
  const committed = await gitService.runForOwner("owner-a", "project", {
    protocolVersion: "ynx-code-git-v1", action: "commit-reviewed", expectedRevision: 1,
    expectedInitialized: false, expectedHead: null, expectedBranch: null, paths: ["main.ts"],
    message: "Fixture reviewed commit", authorName: "YNX Test", authorEmail: "test@ynx.local",
  });
  await writeFile(log, "");
  const clean = await f.inspect({ gitService });
  assert.equal(clean.gitOperation.recovery.state, "clean");
  assert.equal(clean.gitOperation.recovery.head, committed.head);
  assert.equal(clean.gitOperation.recovery.previousOutcome, "unknown", "a clean current HEAD cannot prove the interrupted approval committed it");
  f.store.put("owner-a", "project", { expectedRevision: 1, idempotencyKey: "reviewed-second-revision", payload: payload("changed\n") });
  f.run.workspaceRevision = 2; f.run.gitOperation.workspaceRevision = 2;
  const dirty = await f.inspect({ gitService });
  assert.equal(dirty.gitOperation.recovery.state, "pending-changes");
  assert.equal(dirty.gitOperation.recovery.head, committed.head);
  assert.equal(dirty.gitOperation.recovery.pendingChanges[0].path, "main.ts");
  const commands = (await readFile(log, "utf8")).trim().split("\n");
  assert.equal(commands.length, 10);
  assert.ok(commands.every(command => ["branch", "status", "log", "for-each-ref", "rev-parse"].includes(command)), commands.join(","));
  assert.equal(f.store.get("owner-a", "project").revision, 2);
  assert.equal(f.store.get("owner-a", "project").files["main.ts"], "changed\n");
  assert.equal(f.store.get("owner-b", "project").files["main.ts"], "private-b\n");
});
