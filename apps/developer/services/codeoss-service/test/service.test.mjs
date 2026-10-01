import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createCodeOSSService } from "../src/service.mjs";
import { CORE_LIMITS } from "../src/upstream.mjs";

const ownerA = "a".repeat(64), ownerB = "b".repeat(64), project = "project-a";
const snapshot = { name: "YNX project", files: { "main.js": "console.log(42)\n", "empty.txt": "" }, folders: [], open: ["main.js"], active: "main.js" };
async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "ynx-core-test-")); let context;
  const store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  store.put(ownerA, project, { expectedRevision: 0, idempotencyKey: "seed-owner-a", payload: snapshot });
  store.put(ownerB, project, { expectedRevision: 0, idempotencyKey: "seed-owner-b", payload: snapshot });
  const driver = { async start(value) { context = value; await overrides.start?.(value); }, async stop(value) {
    if (overrides.stop) return overrides.stop(value);
    return { stopped: true, runtimeId: value.runtimeId, identityDigest: value.identityDigest, neverStarted: false };
  } };
  const make = () => createCodeOSSService({ filename: join(root, "core.sqlite"), root: join(root, "native"), workspaceStore: store, driver,
    launchURL: ({ sessionId }) => `https://${sessionId}.native.ynxweb4.com/`, assertProjectQuiescent() {}, limits: { ...CORE_LIMITS, ...overrides.limits },
    verifyIdentity: async request => {
      const owner = request.headers["x-test-owner"] === "b" ? ownerB : ownerA;
      return { owner, workspaceOwner: owner, account: `ynx-${owner[0]}`, generation: Number(request.headers["x-test-generation"] || 1), expiresAt: Date.now() + 3600000 };
    } });
  let service = make();
  const server = createServer((req, res) => service.handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/runtime/codeoss`;
  const call = async (suffix = "", method = "GET", body, headers = {}) => {
    const result = await fetch(base + suffix, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: result.status, value: await result.json() };
  };
  const launch = () => call("", "POST", { projectId: project, expectedRevision: 1, approval: "launch-native-ide-once" });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); service.close(); store.close(); });
  return { root, store, call, launch, context: () => context, restart: () => { service.close(); service = make(); }, service: () => service };
}

test("normal HTTP launch binds current project; binary/empty/nested files remain lossless and reopen same volume", async t => {
  const f = await fixture(t), launched = await f.launch(); assert.equal(launched.status, 201);
  assert.deepEqual((await f.call()).value.walletProjects.map(row => row.projectId), [project]);
  const first = f.context(), binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0, 0x80]);
  await writeFile(join(first.projectDirectory, "workspace", "image.png"), binary);
  await writeFile(join(first.projectDirectory, "workspace", "large.txt"), Buffer.alloc(3 * 1024 * 1024, 65));
  assert.throws(() => f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "parallel-editor", payload: snapshot }), { code: "core_writer_active" });
  const stopped = await f.call(`/${launched.value.session.sessionId}`, "DELETE"); assert.equal(stopped.status, 200); assert.equal(stopped.value.session.checkpointed, true);
  assert.deepEqual(await readFile(join(first.projectDirectory, "workspace", "image.png")), binary);
  assert.equal((await readFile(join(first.projectDirectory, "workspace", "empty.txt"))).length, 0);
  assert.deepEqual(f.store.get(ownerA, project).files, snapshot.files); // original JSON import untouched
  assert.throws(() => f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "stale-editor", payload: snapshot }), { code: "core_native_project" });
  f.restart(); const reopened = await f.launch(); assert.equal(reopened.status, 201);
  assert.equal(f.context().projectDirectory, first.projectDirectory);
  assert.deepEqual(await readFile(join(f.context().projectDirectory, "workspace", "image.png")), binary);
  assert.equal((await f.call(`/${reopened.value.session.sessionId}`, "DELETE")).status, 200);
});

test("DELETE waits for delayed launch; no late running revival or released writer", async t => {
  let release, started; const entered = new Promise(resolve => { started = resolve; });
  const delay = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { start: async () => { started(); await delay; } });
  const launch = f.launch(); await entered;
  const rows = await f.call(), sessionId = rows.value.sessions[0].sessionId;
  const stop = f.call(`/${sessionId}`, "DELETE");
  assert.throws(() => f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "while-launch", payload: snapshot }), { code: "core_writer_active" });
  release(); assert.equal((await launch).status, 201); assert.equal((await stop).status, 200);
  assert.equal((await f.call()).value.sessions[0].status, "stopped");
});

test("live child or wrong runtime proof retains writer and allows actual Stop retry", async t => {
  let attempt = 0;
  const f = await fixture(t, { stop: async value => {
    if (++attempt === 1) return { stopped: false, runtimeId: value.runtimeId, identityDigest: value.identityDigest };
    return { stopped: true, runtimeId: value.runtimeId, identityDigest: value.identityDigest };
  } });
  const started = await f.launch(), sessionId = started.value.session.sessionId;
  assert.equal((await f.call(`/${sessionId}`, "DELETE")).status, 503);
  assert.throws(() => f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "protected", payload: snapshot }), { code: "core_writer_active" });
  assert.equal((await f.call(`/${sessionId}`, "DELETE")).status, 200); assert.equal(attempt, 2);
});

test("owner/generation isolation, hard owner capacity, duplicate project and durable restart", async t => {
  const f = await fixture(t, { limits: { activePerOwner: 1 } }), launched = await f.launch();
  const sessionId = launched.value.session.sessionId;
  assert.equal((await f.call(`/${sessionId}`, "DELETE", undefined, { "x-test-owner": "b" })).status, 404);
  assert.equal((await f.call(`/${sessionId}`, "DELETE", undefined, { "x-test-generation": "2" })).status, 401);
  assert.equal((await f.launch()).status, 409);
  f.store.put(ownerA, "other", { expectedRevision: 0, idempotencyKey: "seed-other", payload: snapshot });
  assert.equal((await f.call("", "POST", { projectId: "other", expectedRevision: 1, approval: "launch-native-ide-once" })).status, 429);
  f.restart(); assert.equal((await f.call()).value.sessions[0].status, "running");
  assert.equal((await f.call(`/${sessionId}`, "DELETE")).status, 200);
});

test("preflight failure never permanently adopts guest import; precise never-started cancellation releases writer", async t => {
  const f = await fixture(t, { start: async () => { throw new Error("quota missing"); }, stop: async value => ({ stopped: true, neverStarted: true, runtimeId: value.runtimeId, identityDigest: value.identityDigest }) });
  assert.equal((await f.launch()).status, 503); const id = (await f.call()).value.sessions[0].sessionId;
  assert.equal((await f.call(`/${id}`, "DELETE")).status, 200);
  assert.equal(f.store.storageMode(ownerA, project), "text-snapshot");
  assert.equal(f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "continue-original", payload: snapshot }).revision, 2);
});
