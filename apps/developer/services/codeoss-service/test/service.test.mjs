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
    now: overrides.now || Date.now,
    verifyIdentity: overrides.verifyIdentity || (async request => {
      const owner = request.headers["x-test-owner"] === "b" ? ownerB : ownerA;
      return { owner, workspaceOwner: owner, account: `ynx-${owner[0]}`, generation: Number(request.headers["x-test-generation"] || 1), expiresAt: Date.now() + 3600000 };
    }) });
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

test("owner drain rejects unconfirmed stop and preserves the writer until explicit retry", async t => {
  let confirmed = false;
  const f = await fixture(t, { stop: async value => ({ stopped: confirmed, runtimeId: value.runtimeId, identityDigest: value.identityDigest }) });
  const launched = await f.launch(); assert.equal(launched.status, 201);
  await assert.rejects(f.service().drainOwner(ownerA), { code: "core_drain_incomplete", status: 503 });
  assert.equal((await f.call()).value.sessions[0].status, "recovery-required");
  assert.throws(() => f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "still-protected", payload: snapshot }), { code: "core_writer_active" });
  confirmed = true; await f.service().drainOwner(ownerA);
  assert.equal((await f.call()).value.sessions[0].status, "stopped");
});

test("browser-scoped logout preserves an independent same-account runtime", async t => {
  const verifyIdentity = async request => ({ owner: ownerA, workspaceOwner: ownerA, account: "ynx-a", generation: 1,
    identityReference: request.headers["x-test-reference"] || "browser-a", expiresAt: Date.now() + 300000 });
  verifyIdentity.resolveReference = async reference => ({ owner: ownerA, workspaceOwner: ownerA, account: "ynx-a", generation: 1, identityReference: reference, expiresAt: Date.now() + 300000 });
  const f = await fixture(t, { verifyIdentity, limits: { activePerOwner: 2 } });
  assert.equal((await f.launch()).status, 201);
  f.store.put(ownerA, "project-b", { expectedRevision: 0, idempotencyKey: "browser-b-seed", payload: snapshot });
  const b = await f.call("", "POST", { projectId: "project-b", expectedRevision: 1, approval: "launch-native-ide-once" }, { "x-test-reference": "browser-b" });
  assert.equal(b.status, 201);
  await f.service().drainOwner(ownerA, "browser-a");
  const rows = (await f.call()).value.sessions;
  assert.equal(rows.find(row => row.projectId === project).status, "stopped");
  assert.equal(rows.find(row => row.projectId === "project-b").status, "running");
  assert.equal((await f.service().authorizeConnection({ headers: { "x-test-reference": "browser-b" } }, b.value.session.sessionId)).identity.identityReference, "browser-b");
  await f.service().drainOwner(ownerA, "browser-b");
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

test("a renewed same-identity lease does not stop the native runtime at the old short grant deadline", async t => {
  let clock = 1_000_000, expiry = clock + 300_000;
  const verifyIdentity = async () => ({ owner: ownerA, workspaceOwner: ownerA, account: "ynx-a", generation: 1,
    identityReference: "local-server-identity-record", expiresAt: expiry });
  verifyIdentity.resolveReference = async () => verifyIdentity();
  const f = await fixture(t, { now: () => clock, verifyIdentity }), launched = await f.launch();
  assert.equal(launched.status, 201);
  clock += 299_000; expiry = clock + 300_000;
  assert.equal((await f.service().authorizeConnection({ headers: {} }, launched.value.session.sessionId)).identity.expiresAt, expiry);
  clock += 2_000; await f.service().expireSessions();
  assert.equal((await f.call()).value.sessions[0].status, "running");
  await f.call(`/${launched.value.session.sessionId}`, "DELETE");
});

function renewableIdentity(clock, resolve) {
  const current = () => ({ owner: ownerA, workspaceOwner: ownerA, account: "ynx-a", generation: 1,
    identityReference: "server-only-reference", expiresAt: clock() + 300_000 });
  const check = async () => current();
  check.resolveReference = async () => resolve ? resolve(current()) : current();
  return check;
}

test("timer renewal survives restart but never moves the original runtime hard deadline", async t => {
  let clock = 1_000_000, reads = 0;
  const check = renewableIdentity(() => clock, id => { reads++; return id; });
  const f = await fixture(t, { now: () => clock, verifyIdentity: check, limits: { maxSessionMs: 600_000 } });
  const started = await f.launch(), id = started.value.session.sessionId;
  const hard = (await f.service().authorizeConnection({ headers: {} }, id)).expiresAt;
  f.restart(); clock += 300_001; await f.service().expireSessions();
  assert.equal(reads, 1); assert.equal((await f.call()).value.sessions[0].status, "running");
  assert.equal((await f.service().authorizeConnection({ headers: {} }, id)).expiresAt, hard);
  clock = hard; await f.service().expireSessions();
  assert.equal((await f.call()).value.sessions[0].status, "stopped");
});

test("transient central outage denies access without releasing the writer; fresh verification recovers", async t => {
  let clock = 1_000_000, unavailable = false;
  const check = renewableIdentity(() => clock, id => { if (unavailable) throw Object.assign(new Error("central unavailable"), { status: 503 }); return id; });
  const f = await fixture(t, { now: () => clock, verifyIdentity: check }), started = await f.launch();
  clock += 300_001; unavailable = true;
  const results = await f.service().expireSessions(); assert.equal(results[0].status, "rejected");
  assert.equal((await f.call()).value.sessions[0].status, "running");
  assert.throws(() => f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "outage-write", payload: snapshot }), { code: "core_writer_active" });
  unavailable = false; await f.service().expireSessions();
  assert.equal((await f.call()).value.sessions[0].status, "running");
  await f.call(`/${started.value.session.sessionId}`, "DELETE");
});

test("changed owner/account/generation cannot renew another runtime", async t => {
  for (const mutation of [id => ({ ...id, owner: ownerB, workspaceOwner: ownerB }), id => ({ ...id, account: "ynx-b" }), id => ({ ...id, generation: 2 })]) {
    let clock = 1_000_000;
    const f = await fixture(t, { now: () => clock, verifyIdentity: renewableIdentity(() => clock, mutation) });
    await f.launch(); clock += 300_001; await f.service().expireSessions();
    assert.equal((await f.call()).value.sessions[0].status, "stopped");
    assert.equal(f.store.get(ownerB, project).revision, 1);
  }
});

test("concurrent timer checks are single-flight and a late result cannot revive an explicitly stopped runtime", async t => {
  let clock = 1_000_000, release, entered, reads = 0;
  const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const check = renewableIdentity(() => clock, async id => { reads++; entered(); await held; return id; });
  const f = await fixture(t, { now: () => clock, verifyIdentity: check }), launched = await f.launch();
  clock += 300_001; const first = f.service().expireSessions(); await started;
  const second = f.service().expireSessions();
  assert.equal((await f.call(`/${launched.value.session.sessionId}`, "DELETE")).status, 200);
  release(); await Promise.all([first, second]);
  assert.equal(reads, 1); assert.equal((await f.call()).value.sessions[0].status, "stopped");
});

test("legacy identity adapters keep their original short cutoff", async t => {
  let clock = 1_000_000;
  const verifyIdentity = async () => ({ owner: ownerA, workspaceOwner: ownerA, account: "ynx-a", generation: 1, expiresAt: clock + 300_000 });
  const f = await fixture(t, { now: () => clock, verifyIdentity }), launched = await f.launch();
  assert.equal((await f.service().authorizeConnection({ headers: {} }, launched.value.session.sessionId)).expiresAt, clock + 300_000);
  clock += 300_001; await f.service().expireSessions();
  assert.equal((await f.call()).value.sessions[0].status, "stopped");
});

test("legacy schema migration preserves the original deadline, writer and native files", async t => {
  let clock = 1_000_000;
  const f = await fixture(t, { now: () => clock, verifyIdentity: renewableIdentity(() => clock) }), launched = await f.launch();
  const file = join(f.context().projectDirectory, "workspace", "main.js"), original = await readFile(file);
  const db = f.store.nativeJournalDatabase();
  f.service().close();
  db.exec("ALTER TABLE codeoss_sessions DROP COLUMN hard_deadline; ALTER TABLE codeoss_sessions DROP COLUMN identity_reference");
  f.restart();
  assert.equal((await f.service().authorizeConnection({ headers: {} }, launched.value.session.sessionId)).expiresAt, clock + 300_000);
  assert.deepEqual(await readFile(file), original);
  clock += 300_001; await f.service().expireSessions();
  assert.equal((await f.call()).value.sessions[0].status, "stopped");
});

test("logout during actual driver start cannot publish a late running session", async t => {
  let live = true, entered, release;
  const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const current = () => { if (!live) throw Object.assign(new Error("local logout"), { status: 401, code: "core_identity_changed" }); };
  const verifyIdentity = async () => ({ owner: ownerA, workspaceOwner: ownerA, account: "ynx-a", generation: 1, expiresAt: Date.now() + 300_000, isCurrent: current });
  const f = await fixture(t, { verifyIdentity, start: async () => { entered(); await held; } });
  const launch = f.launch(); await started; live = false; release();
  assert.equal((await launch).status, 503);
  assert.equal((await f.call()).value.sessions[0].status, "recovery-required");
  assert.throws(() => f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "after-logout-launch", payload: snapshot }), { code: "core_writer_active" });
  live = true; assert.equal((await f.call(`/${(await f.call()).value.sessions[0].sessionId}`, "DELETE")).status, 200);
});
