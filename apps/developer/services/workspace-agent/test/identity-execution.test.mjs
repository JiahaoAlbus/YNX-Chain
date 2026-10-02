import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceRuntime } from "../src/runtime.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const revoked = () => Object.assign(new Error("Wallet changed"), { status: 401, code: "identity_changed" });
const task = (projectId, source = "console.log('finished')") => ({
  protocolVersion: "ynx-code/v1", task: "build-run-active", projectId, activePath: "main.js",
  files: { "main.js": source }, approval: "execute-once",
});
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "ynx-task-identity-"));
  const runtime = createWorkspaceRuntime({ root, concurrency: 1, ...options });
  t.after(async () => { runtime.cancelAll(); runtime.closeAdmission(); await rm(root, { recursive: true, force: true }); });
  return runtime;
}

test("owner task rejects a previously aborted request before admission", async t => {
  const runtime = await fixture(t), controller = new AbortController(); controller.abort(revoked());
  assert.throws(() => runtime.runTaskForOwner("wallet-a", task("project"), undefined, { signal: controller.signal }), { code: "identity_changed" });
  assert.equal(runtime.status().active, 0); assert.equal(runtime.status().queued, 0);
});

test("revoked owner task leaves the queue without starting or reading its environment", async t => {
  const entered = deferred(), release = deferred(), environments = [];
  const runtime = await fixture(t, { environmentResolver: async (_owner, projectId) => {
    environments.push(projectId); if (projectId === "first") { entered.resolve(); await release.promise; }
    return { revision: 0, environment: {} };
  } });
  let current = true;
  const first = runtime.runTaskForOwner("wallet-a", task("first"), undefined, { assertCurrent: () => { if (!current) throw revoked(); } });
  const firstResult = Promise.allSettled([first]); await entered.promise;
  const controller = new AbortController(), queued = runtime.runTaskForOwner("wallet-a", task("queued"), undefined, { signal: controller.signal });
  const queuedResult = assert.rejects(queued, { code: "identity_changed" });
  assert.equal(runtime.status().queued, 1); controller.abort(revoked()); await queuedResult;
  assert.equal(runtime.status().queued, 0); assert.deepEqual(environments, ["first"]);
  current = false; release.resolve(); assert.equal((await firstResult)[0].reason.code, "identity_changed");
});

test("owner assertion is rechecked when queued work is actually dispatched", async t => {
  const entered = deferred(), release = deferred(), environments = [];
  const runtime = await fixture(t, { environmentResolver: async (_owner, projectId) => {
    environments.push(projectId); entered.resolve(); await release.promise; return { revision: 0, environment: {} };
  } });
  let current = true;
  const assertion = () => { if (!current) throw revoked(); };
  const first = runtime.runTaskForOwner("wallet-a", task("first"), undefined, { assertCurrent: assertion });
  await entered.promise;
  const second = runtime.runTaskForOwner("wallet-a", task("queued"), undefined, { assertCurrent: assertion });
  const results = Promise.allSettled([first, second]);
  current = false; release.resolve();
  assert.ok((await results).every(value => value.status === "rejected" && value.reason.code === "identity_changed"));
  assert.deepEqual(environments, ["first"]);
});

test("owner revocation terminates an already running sandbox process before releasing capacity", async t => {
  const runtime = await fixture(t), started = deferred(), controller = new AbortController();
  const operation = runtime.runTaskForOwner("wallet-a", task("running", "console.log('IDENTITY_START');setInterval(()=>{},1000)"), event => {
    if (event.type === "output" && event.data.includes("IDENTITY_START")) started.resolve();
  }, { signal: controller.signal, assertCurrent: () => controller.signal.throwIfAborted() });
  const result = assert.rejects(operation, { code: "identity_changed" });
  await started.promise;
  assert.equal(runtime.status().active, 1); controller.abort(revoked());
  assert.equal(runtime.status().active, 1);
  await result;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.status().active, 0); assert.equal(runtime.status().queued, 0);
});
