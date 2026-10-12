import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createCodeOSSService } from "../src/service.mjs";
import { CORE_LIMITS } from "../src/upstream.mjs";
import { consumerIdentityBinding } from "../src/identity-consumer-binding.mjs";
import { createDeveloperCoreAdmission } from "../src/admission.mjs";
import { OPENVSCODE_X64 } from "../src/upstream.mjs";
import { createNativeToolsService } from '../src/tools-service.mjs';
import { createNativeAIStore } from '../src/native-ai-store.mjs';
import { createActivityRegistry, createMaintenance } from '../../gateway/src/activity.mjs';

const ownerA = "a".repeat(64), ownerB = "b".repeat(64), project = "project-a";
const snapshot = { name: "YNX project", files: { "main.js": "console.log(42)\n", "empty.txt": "" }, folders: [], open: ["main.js"], active: "main.js" };
async function fixture(t, overrides = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ynx-core-test-"))); let context;
  const store = createWorkspaceStore({ filename: join(root, "workspace.sqlite") });
  store.put(ownerA, project, { expectedRevision: 0, idempotencyKey: "seed-owner-a", payload: snapshot });
  store.put(ownerB, project, { expectedRevision: 0, idempotencyKey: "seed-owner-b", payload: snapshot });
  const driver = { upstream: OPENVSCODE_X64, ...(overrides.runtimeArtifact ? { runtimeArtifact: overrides.runtimeArtifact } : {}), async start(value) { context = value; return await overrides.start?.(value) || { running: true, runtimeId: value.runtimeId }; }, async stop(value) {
    context = value;
    if (overrides.stop) return overrides.stop(value);
    return { stopped: true, runtimeId: value.runtimeId, identityDigest: value.identityDigest, neverStarted: false };
  }, connect: async () => { throw new Error("Contract test has no executable runtime listener."); } };
  const rawVerify = overrides.verifyIdentity || (async request => {
    const owner = request.headers["x-test-owner"] === "b" ? ownerB : ownerA;
    return { owner, workspaceOwner: owner, account: `ynx-${owner[0]}`, generation: Number(request.headers["x-test-generation"] || 1), expiresAt: Date.now() + 3600000 };
  });
  const completeIdentity = value => ({ identityReference: "browser-a", isCurrent() {}, ...value });
  const verifyIdentity = async request => completeIdentity(await rawVerify(request));
  if (rawVerify.resolveReference) verifyIdentity.resolveReference = async reference => completeIdentity(await rawVerify.resolveReference(reference));
  const admission = overrides.composed ? createDeveloperCoreAdmission({ driver, architecture: "linux-x64", executionDomain: "runtime.example" })
    : { driver, launchURL: ({ sessionId }) => `https://${sessionId}.native.ynxweb4.com/` };
  const make = () => createCodeOSSService({ filename: join(root, "core.sqlite"), root: join(root, "native"), workspaceStore: store, ...admission,
    assertProjectQuiescent() {}, limits: { ...CORE_LIMITS, ...overrides.limits },
    now: overrides.now || Date.now,
    requestNativeTools: overrides.requestNativeTools,
    runRetainedOperation: overrides.runRetainedOperation,
    onCompletedProject: overrides.onCompletedProject,
    completedProjectLifecycle: overrides.completedProjectLifecycle,
    verifyIdentity });
  let service = make();
  const server = createServer((req, res) => service.handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/runtime/codeoss`;
  const call = async (suffix = "", method = "GET", body, headers = {}) => {
    if (method !== "GET") headers = { "x-ynx-agent-identity": consumerIdentityBinding(await verifyIdentity({ headers })), ...headers };
    const result = await fetch(base + suffix, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: result.status, value: await result.json() };
  };
  const launch = () => call("", "POST", { projectId: project, expectedRevision: 1, approval: "launch-native-ide-once" });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); service.close(); store.close(); });
  return { root, store, driver, call, launch, context: () => context, restart: () => { service.close(); service = make(); }, service: () => service };
}

test('normal project entry reports the composed workbench and cold recovery retains its original artifact after configuration changes', async t => {
  const artifact = { kind: 'ynx-theia', version: '1.76.0', architecture: 'linux-x64', lockSha256: '1'.repeat(64), manifestSha256: '2'.repeat(64), treeSha256: '3'.repeat(64) };
  const f = await fixture(t, { runtimeArtifact: artifact });
  assert.equal((await f.call()).value.kernel, 'YNX / Theia 1.76.0');
  const launched = await f.launch(); assert.equal(launched.status, 201);
  assert.deepEqual(f.context().image, artifact);
  f.driver.runtimeArtifact = { ...artifact, treeSha256: '4'.repeat(64) };
  f.restart();
  const stopped = await f.call(`/${launched.value.session.sessionId}`, 'DELETE');
  assert.equal(stopped.status, 200);
  assert.deepEqual(f.context().image, artifact);
});

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

test("composed admission retains uncertain launch and Stop across durable broker restart and denies another account", async t => {
  let confirmStart = false, confirmStop = false;
  const f = await fixture(t, { composed: true,
    start: async value => ({ running: true, runtimeId: confirmStart ? value.runtimeId : "uncertain-runtime" }),
    stop: async value => ({ stopped: true, runtimeId: confirmStop ? value.runtimeId : "uncertain-runtime", identityDigest: value.identityDigest }) });
  assert.equal((await f.launch()).status, 503);
  const first = f.context(), binary = Buffer.from([0, 0xff, 0x89, 0x50]);
  await writeFile(join(first.projectDirectory, "workspace", "recovery.bin"), binary);
  f.restart();
  const pending = (await f.call()).value.sessions[0];
  assert.equal(pending.status, "recovery-required"); assert.equal(pending.launchURL, undefined);
  assert.throws(() => f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "unsafe-replace", payload: snapshot }), { code: "core_writer_active" });
  await assert.rejects(f.service().authorizeConnection({ headers: { "x-test-owner": "b" } }, pending.sessionId), { code: "core_not_found" });
  assert.equal((await f.call(`/${pending.sessionId}`, "DELETE")).status, 503);
  assert.equal((await f.call()).value.sessions[0].status, "recovery-required");
  confirmStop = true;
  assert.equal((await f.call(`/${pending.sessionId}`, "DELETE")).status, 200);
  assert.deepEqual(await readFile(join(first.projectDirectory, "workspace", "recovery.bin")), binary);
  confirmStart = true;
  const reopened = await f.launch(); assert.equal(reopened.status, 201);
  assert.equal(f.context().projectDirectory, first.projectDirectory);
  assert.deepEqual(await readFile(join(f.context().projectDirectory, "workspace", "recovery.bin")), binary);
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
  let clock = Date.now(), expiry = clock + 300_000;
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
  let clock = Date.now(), reads = 0;
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
  let clock = Date.now(), unavailable = false;
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
    let clock = Date.now();
    const f = await fixture(t, { now: () => clock, verifyIdentity: renewableIdentity(() => clock, mutation) });
    await f.launch(); clock += 300_001; await f.service().expireSessions();
    assert.equal((await f.call()).value.sessions[0].status, "stopped");
    assert.equal(f.store.get(ownerB, project).revision, 1);
  }
});

test("concurrent timer checks are single-flight and a late result cannot revive an explicitly stopped runtime", async t => {
  let clock = Date.now(), release, entered, reads = 0;
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
  let clock = Date.now();
  const verifyIdentity = async () => ({ owner: ownerA, workspaceOwner: ownerA, account: "ynx-a", generation: 1, expiresAt: clock + 300_000 });
  const f = await fixture(t, { now: () => clock, verifyIdentity }), launched = await f.launch();
  assert.equal((await f.service().authorizeConnection({ headers: {} }, launched.value.session.sessionId)).expiresAt, clock + 300_000);
  clock += 300_001; await f.service().expireSessions();
  assert.equal((await f.call()).value.sessions[0].status, "stopped");
});

test("legacy schema migration preserves the original deadline, writer and native files", async t => {
  let clock = Date.now();
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
  assert.equal((await f.call()).status, 401);
  assert.equal(f.store.nativeJournalDatabase().prepare("SELECT status FROM codeoss_sessions").get().status, "recovery-required");
  assert.throws(() => f.store.put(ownerA, project, { expectedRevision: 1, idempotencyKey: "after-logout-launch", payload: snapshot }), { code: "core_writer_active" });
  live = true; assert.equal((await f.call(`/${(await f.call()).value.sessions[0].sessionId}`, "DELETE")).status, 200);
});

async function retainedFixture(t, options = {}) {
  let current = { owner: ownerA, workspaceOwner: ownerA, account: 'ynx-a', generation: 1,
    identityReference: 'browser-a', expiresAt: Date.now() + 60000, isCurrent() {} };
  const verifier = async () => current;
  verifier.resolveReference = async reference => {
    assert.equal(reference, 'browser-a');
    return options.resolveReference ? options.resolveReference(current) : current;
  };
  const f = await fixture(t, { verifyIdentity: verifier, requestNativeTools: options.requestNativeTools, now: options.now, runRetainedOperation: options.runRetainedOperation, onCompletedProject: options.onCompletedProject });
  const launched = await f.launch(); assert.equal(launched.status, 201);
  const sessionId = launched.value.session.sessionId;
  const locators = { projectId: project, workspace: join(f.context().projectDirectory, 'workspace'), launch: sessionId };
  return { ...f, locators, sessionId, setIdentity: value => { current = { ...current, ...value }; },
    borrow: (input = locators, signal) => f.service().acquireProject(input, { signal }) };
}

test('original retained journal borrows the real running writer and fixed routes; close does not stop the project', async t => {
  let requests = 0;
  const f = await retainedFixture(t, { requestNativeTools: async ({ request, admission }) => {
    requests++; assert.equal(admission.context.sessionId, f.sessionId); assert.equal(admission.identity.owner, ownerA);
    assert.equal(request.path, `/runtime/native-tools/context?sessionId=${f.sessionId}`); return { connected: true };
  } });
  const owner = await f.borrow(), state = await owner.assertCurrent();
  assert.equal(state.generation, 1); assert.equal(state.localProjectId, project); assert.equal(state.workspace, f.locators.workspace);
  assert.deepEqual(await owner.request({ method: 'GET', path: `/runtime/native-tools/context?sessionId=${f.sessionId}` }), { connected: true });
  await assert.rejects(owner.request({ method: 'GET', path: '/runtime/native-tools/context?sessionId=wrong' }));
  await assert.rejects(owner.request({ method: 'GET', path: `/runtime/native-tools/context?sessionId=${f.sessionId}`, headers: { cookie: 'PUBLIC-forged' } }));
  owner.close(); owner.close(); await assert.rejects(owner.assertCurrent());
  assert.equal((await f.call()).value.sessions[0].status, 'running'); assert.equal(requests, 1);
});

test('original completed start produces a held canonical owner only after real running journal publication',async t=>{
  let produced;
  const f=await retainedFixture(t,{async onCompletedProject(value){produced=value;const s=await value.admittedProject.assertCurrent();assert.equal(s.localProjectId,project);assert.equal(value.session.status,'running');assert.equal(s.sessionId,value.session.sessionId);}});
  assert.ok(produced);assert.equal((await produced.admittedProject.assertCurrent()).sessionId,f.sessionId);
  produced.admittedProject.close();assert.equal((await f.call()).value.sessions[0].status,'running');
});

test('original completed start failed private delivery retires the borrow and preserves protected writer recovery',async t=>{
  let produced;
  const identity={owner:ownerA,workspaceOwner:ownerA,account:'ynx-a',generation:1,identityReference:'a'.repeat(43),expiresAt:Date.now()+60000,isCurrent(){}};
  const verifier=async()=>identity;verifier.resolveReference=async()=>identity;
  const f=await fixture(t,{verifyIdentity:verifier,async onCompletedProject(value){produced=value.admittedProject;throw Error('PUBLIC delivery failed');}});
  assert.equal((await f.launch()).status,503);await assert.rejects(produced.assertCurrent());
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT status FROM codeoss_sessions').get().status,'recovery-required');
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n,1);
});

test('original retained journal refuses arbitrary local project, launch and noncanonical paths', async t => {
  const f = await retainedFixture(t);
  for (const change of [{ projectId: 'guest' }, { launch: '00000000-0000-4000-8000-000000000001' },
    { workspace: f.locators.workspace + '/..' }, { workspace: f.root }, { owner: ownerB }]) {
    await assert.rejects(f.borrow({ ...f.locators, ...change }));
  }
});

test('original retained journal denies current identity drift and revoked reference', async t => {
  let revoked = false;
  const f = await retainedFixture(t, { resolveReference: id => { if (revoked) throw Object.assign(Error('PUBLIC revoked'), { status: 401 }); return id; } });
  const owner = await f.borrow(); f.setIdentity({ generation: 2 }); await assert.rejects(owner.assertCurrent());
  f.setIdentity({ generation: 1 }); revoked = true; await assert.rejects(owner.assertCurrent());
});

test('original retained journal checks real writer custody and stopped state', async t => {
  const f = await retainedFixture(t), owner = await f.borrow(), db = f.store.nativeJournalDatabase();
  const writer = db.prepare('SELECT * FROM workspace_writers').get();
  db.prepare('UPDATE workspace_writers SET writer_token=?').run('PUBLIC-wrong-writer');
  await assert.rejects(owner.assertCurrent());
  db.prepare('UPDATE workspace_writers SET writer_token=?').run(writer.writer_token);
  assert.equal((await f.call(`/${f.sessionId}`, 'DELETE')).status, 200);
  await assert.rejects(owner.assertCurrent()); await assert.rejects(f.borrow());
});

test('original retained journal cannot renew its captured deadline', async t => {
  let now = Date.now(); const f = await retainedFixture(t, { now: () => now });
  const owner = await f.borrow(), initial = await owner.assertCurrent();
  f.setIdentity({ expiresAt: initial.expiresAt + 60000 }); now = initial.expiresAt;
  await assert.rejects(owner.assertCurrent());
});

test('original retained journal rejects late entered approval and refuses replay', async t => {
  let count = 0, release; const wait = new Promise(resolve => { release = resolve; });
  const f = await retainedFixture(t, { requestNativeTools: async () => { count++; await wait; return { completed: true }; } });
  const owner = await f.borrow(); const request = { method: 'POST', path: `/runtime/native-tools/approve?sessionId=${f.sessionId}`, body: { proposalId: 'PUBLIC-proposal', csrf: 'PUBLIC-csrf' } };
  const pending = owner.request(request); while (!count) await new Promise(resolve => setImmediate(resolve));
  f.setIdentity({ generation: 2 }); release(); await assert.rejects(pending, error => error.code === 'AI_UNKNOWN');
  f.setIdentity({ generation: 1 }); await assert.rejects(owner.request(request), error => error.code === 'AI_UNKNOWN'); assert.equal(count, 1);
});

test('original retained journal observes request cancellation and close across reference awaits', async t => {
  let block = false, release; const wait = new Promise(resolve => { release = resolve; });
  const f = await retainedFixture(t, { resolveReference: async id => { if (block) await wait; return id; } });
  const owner = await f.borrow(); block = true; const pending = owner.assertCurrent(); owner.close(); release(); await assert.rejects(pending);
  const controller = new AbortController(); controller.abort(); await assert.rejects(f.borrow(f.locators, controller.signal));
});

// Public fixtures exercise the real journal and private dispatcher. They are
// neither an online-model acceptance nor a supplied desktop identity mapping.
async function retainedToolsFixture(t, modelWork, options = {}) {
  let tools, calls = 0;
  const f = await retainedFixture(t, { ...options, requestNativeTools: operation => tools.dispatchRetained(operation) });
  const aiStore = createNativeAIStore({ filename: join(f.root, 'PUBLIC-ai.sqlite'), keyPath: join(f.root, 'PUBLIC-ai.key') });
  t.after(() => aiStore.close());
  tools = createNativeToolsService({ coreService: f.service(), aiStore, modelRouter: {
    catalog: () => ({ hosted: { id: 'ynx-hosted', configuredModel: 'PUBLIC-test-model' } }),
    async generate(value) {
      calls++; await value.assertCurrent(); value.onDispatch();
      return modelWork ? modelWork(value) : { model: 'PUBLIC-test-model', text: 'PUBLIC fixture result' };
    }
  } });
  const owner = await f.borrow();
  const request = (action, body, signal) => owner.request({ method: body ? 'POST' : 'GET',
    path: `/runtime/native-tools/${action}?sessionId=${f.sessionId}`, ...(body ? { body } : {}) }, { signal });
  const preview = async () => {
    const context = await request('context');
    return request('proposals', { csrf: context.csrf, prompt: 'Explain this PUBLIC code', context: 'console.log(42)' });
  };
  return { ...f, tools, owner, request, preview, aiStore, calls: () => calls };
}

test('original retained integrated dispatcher uses actual journal and one-use reviewed model request', async t => {
  const f = await retainedToolsFixture(t), preview = await f.preview();
  assert.equal(f.calls(), 0);
  const body = { csrf: preview.csrf, proposalId: preview.proposalId, approval: 'send-reviewed-context-once' };
  const result = await f.request('approve', body);
  assert.equal(result.text, 'PUBLIC fixture result'); assert.equal(result.applied, false); assert.equal(result.signed, false);
  assert.equal(f.aiStore.get(ownerA, project, result.conversationId).status, 'completed');
  await assert.rejects(f.request('approve', body), { code: 'AI_UNKNOWN' }); assert.equal(f.calls(), 1);
});

test('original retained integrated dispatcher rejects forged authority and schema without model calls', async t => {
  const f = await retainedToolsFixture(t);
  await assert.rejects(f.tools.dispatchRetained({ admission: { context: { sessionId: f.sessionId }, identity: { owner: ownerA } },
    request: { method: 'GET', path: `/runtime/native-tools/context?sessionId=${f.sessionId}` } }));
  const context = await f.request('context');
  await assert.rejects(f.request('proposals', { csrf: context.csrf, prompt: 'Explain PUBLIC code', context: 'PUBLIC', owner: ownerA }), { code: 'tools_schema' });
  assert.equal((await f.call(`/${f.sessionId}`, 'DELETE')).status, 200);
  await assert.rejects(f.request('context')); assert.equal(f.calls(), 0);
});

test('original retained integrated dispatcher cancellation preserves UNKNOWN and cannot replay a late model', async t => {
  let release, entered;
  const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const f = await retainedToolsFixture(t, async value => {
    entered(value); await held; return { model: 'PUBLIC-test-model', text: 'PUBLIC late result' };
  });
  const preview = await f.preview(), controller = new AbortController();
  const body = { csrf: preview.csrf, proposalId: preview.proposalId, approval: 'send-reviewed-context-once' };
  const pending = f.request('approve', body, controller.signal);
  const rejected = assert.rejects(pending, { code: 'AI_UNKNOWN' });
  const dispatched = await started; controller.abort(); await rejected;
  assert.equal(dispatched.signal.aborted, true);
  const rows = f.aiStore.list(ownerA, project); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'unknown');
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.aiStore.get(ownerA, project, rows[0].id).status, 'unknown');
  await assert.rejects(f.request('approve', body), { code: 'AI_UNKNOWN' }); assert.equal(f.calls(), 1);
});

for (const phase of ['pre-dispatch', 'post-model']) test(`retained maintenance holds original stores across ${phase} current and final persistence`, async t => {
  const activity = createActivityRegistry(); let block = false, entered, release, closed = 0;
  const waiting = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(release);
  const runRetainedOperation = work => {
    const ticket = activity.admitRequest('native-tools');
    return activity.runRequest(ticket, async () => { try { return await work(ticket.controller.signal); } finally { ticket.finish(); } });
  };
  const f = await retainedToolsFixture(t, async () => { block = true; return { model: 'PUBLIC-test-model', text: 'PUBLIC result' }; }, {
    runRetainedOperation, async resolveReference(id) { if (block) { entered(); await waiting; } return id; }
  });
  let pending;
  if (phase === 'post-model') {
    const preview = await f.preview();
    pending = f.request('approve', { csrf: preview.csrf, proposalId: preview.proposalId, approval: 'send-reviewed-context-once' });
  } else { block = true; pending = f.request('context'); }
  const rejected = assert.rejects(pending); await started;
  const maintenance = createMaintenance({ activity, stopInteractive: () => f.service().drain(), cancelWork() {},
    async closeStores() { f.service().close(); closed++; }, async checkpoint() {}, drainTimeoutMs: 2000, cancelTimeoutMs: 2000 });
  const finishing = maintenance('PUBLIC-test-maintenance');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(closed, 0, 'A pending original current callback must prevent clean store close');
  assert.equal(activity.idle(), false);
  assert.throws(() => f.service().close());
  await assert.rejects(f.owner.assertCurrent());
  release(); await rejected; const result = await finishing;
  assert.equal(result.cleanShutdown, true); assert.equal(closed, 1); assert.equal(activity.idle(), true);
  if (phase === 'post-model') assert.equal(f.aiStore.list(ownerA, project)[0].status, 'unknown');
});

test('retained maintenance bounded unresolved current reports failure and keeps stores open through cancellation',async t=>{
  const activity=createActivityRegistry();let block=false,entered,release,closed=0;
  const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});t.after(release);
  const f=await retainedToolsFixture(t,undefined,{async resolveReference(id){if(block){entered();await waiting;}return id;},
    runRetainedOperation:work=>{const ticket=activity.admitRequest('native-tools');return activity.runRequest(ticket,async()=>{try{return await work(ticket.controller.signal);}finally{ticket.finish();}});}});
  block=true;const pending=f.request('context'),rejected=assert.rejects(pending);await started;
  const maintenance=createMaintenance({activity,stopInteractive:()=>f.service().drain(),cancelWork(){},async closeStores(){closed++;},async checkpoint(){},drainTimeoutMs:10,cancelTimeoutMs:10});
  const result=await maintenance('PUBLIC unresolved');assert.equal(result.cleanShutdown,false);assert.equal(result.timedOut,true);assert.equal(closed,0);
  assert.equal(activity.snapshot().cancellationRequests,1);assert.equal(activity.snapshot().requests.total,1);assert.throws(()=>f.service().close());
  release();await rejected;assert.equal(activity.snapshot().requests.total,0);
});

test('retained periodic current remains counted after outer cancellation until its original verification settles',async t=>{
  const activity=createActivityRegistry();let block=false,tickEntered,releaseTick,modelEntered,releaseModel,closed=0,settled=false;
  const tickWait=new Promise(r=>{releaseTick=r;}),tickStarted=new Promise(r=>{tickEntered=r;});
  const modelWait=new Promise(r=>{releaseModel=r;}),modelStarted=new Promise(r=>{modelEntered=r;});t.after(()=>{releaseTick();releaseModel();});
  const f=await retainedToolsFixture(t,async()=>{modelEntered();await modelWait;return {model:'PUBLIC-test-model',text:'PUBLIC late'};},
    {async resolveReference(id){if(block){tickEntered();await tickWait;}return id;},runRetainedOperation:work=>{
      const ticket=activity.admitRequest('native-tools');return activity.runRequest(ticket,async()=>{try{return await work(ticket.controller.signal);}finally{ticket.finish();}});
    }});
  const preview=await f.preview(),controller=new AbortController();
  const pending=f.request('approve',{csrf:preview.csrf,proposalId:preview.proposalId,approval:'send-reviewed-context-once'},controller.signal);
  pending.then(()=>{settled=true;},()=>{settled=true;});const rejected=assert.rejects(pending);
  await modelStarted;block=true;await tickStarted;controller.abort();
  await new Promise(r=>setTimeout(r,30));
  const maintenance=createMaintenance({activity,stopInteractive:()=>f.service().drain(),cancelWork(){},async closeStores(){f.service().close();closed++;},async checkpoint(){},drainTimeoutMs:30,cancelTimeoutMs:30});
  const outcome=await maintenance('PUBLIC pending periodic identity');
  assert.equal(closed,0);assert.equal(settled,false);assert.equal(outcome.cleanShutdown,false);assert.equal(outcome.timedOut,true);
  assert.throws(()=>f.service().close());assert.equal(f.aiStore.list(ownerA,project)[0].status,'unknown');
  releaseTick();releaseModel();await rejected;assert.equal(activity.snapshot().requests.total,0);assert.equal(f.calls(),1);
});

// R6 PUBLIC source controls bind the frozen original supplier only in tests.
async function r6Receiver() {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const path = '/Users/huangjiahao/ynx-social-qa-authority/ide-protected-completed-project-receiver-lifecycle-repair-r6-20261012/apps/developer/services/codeoss-service/src/protected-developer-operator.mjs';
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), '82f82003030ef058219ba20e1ed9db9591016801e6713883c959214cd409bfd6');
  return (await import((await import('node:url')).pathToFileURL(path))).createDeveloperCoreAdmission;
}

test('R6 actual callback partial failure reaches same receiver through Stop before writer release', async t => {
  const constructor = await r6Receiver();
  const primary = Object.freeze(new Error('PUBLIC original witness current refusal'));
  let held, carrier, disposed = false, closes = 0, acquires = 0, starts = 0, stops = 0;
  const receiver = constructor({
    coreAdmission: { driver: { start() {}, stop() {}, connect() {} }, launchURL() {}, sessionForHost() {}, originForSession() {} },
    retainedSSO: { acquireReference() { throw Error('No identity acquisition expected'); } },
    admittedProjects: { async acquireProject() {
      acquires++;
      return { assertCurrent: async () => { throw primary; }, request() { throw Error('No request expected'); },
        close() { closes++; return { complete: disposed }; }, finishCleanup() { return { complete: disposed }; } };
    } },
  });
  const identity = { owner: ownerA, workspaceOwner: ownerA, account: 'ynx-a', generation: 1,
    identityReference: 'a'.repeat(43), expiresAt: Date.now() + 60000, isCurrent() {} };
  const verify = async () => identity; verify.resolveReference = async () => identity;
  const f = await fixture(t, { verifyIdentity: verify, completedProjectLifecycle: receiver.completedProjectLifecycle,
    start() { starts++; }, stop(value) { stops++; return { stopped: true, runtimeId: value.runtimeId, identityDigest: value.identityDigest }; },
    async onCompletedProject(value) {
      held = value.admittedProject;
      try { await receiver.retainCompletedProject({ ...value, nativeTools: receiver.nativeTools }); }
      catch (error) { carrier = error; throw error; }
    } });
  const launched = await f.launch(); assert.equal(launched.status, 503);
  assert.equal(carrier.primary, primary);
  assert.equal(receiver.completedProjectLifecycle.cleanupStatus().retained, 1);
  const row = f.store.nativeJournalDatabase().prepare('SELECT * FROM codeoss_sessions').get();
  assert.equal((await f.call('/' + row.id, 'DELETE')).status, 503);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT status FROM codeoss_sessions').get().status, 'recovery-required');
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 1);
  assert.throws(() => f.service().close(), /cleanup|Drain/i);
  disposed = true;
  assert.equal((await f.call('/' + row.id, 'DELETE')).status, 200);
  assert.equal(receiver.completedProjectLifecycle.cleanupStatus().complete, true);
  assert.equal(receiver.completedProjectLifecycle.cleanupStatus().records[0].primary, primary);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
  await assert.rejects(receiver.acquireCompletedProject(held), { code: 'AI_RETIRED' });
  assert.equal(acquires, 1); assert.equal(starts, 1); assert.equal(stops, 2); assert.equal(closes, 1);
  assert.doesNotMatch(JSON.stringify(launched.value), /cleanupOwner|original witness/);
});

test('R6 callback retirement passes exact primary and same owner through owner drain', async t => {
  const primary = Object.freeze({ code: 'PUBLIC_FROZEN_PRIMARY' });
  let original, seenPrimary, retirement = 0, finish = 0;
  const lifecycle = Object.freeze({
    retireOriginal(value, options) { original = value; seenPrimary = options.primary; retirement++; return { recognized: true }; },
    retireSession() {}, async finishSessionCleanup() { finish++; original.close(); return { complete: true, pending: 0, retained: 0 }; },
    async drain() { return { complete: true, pending: 0, retained: 0 }; }, cleanupStatus() { return { complete: finish > 0, pending: 0, retained: finish ? 0 : 1 }; },
  });
  const identity = { owner: ownerA, workspaceOwner: ownerA, account: 'ynx-a', generation: 1,
    identityReference: 'a'.repeat(43), expiresAt: Date.now() + 60000, isCurrent() {} };
  const verify = async () => identity; verify.resolveReference = async () => identity;
  let delivered;
  const f = await fixture(t, { verifyIdentity: verify, completedProjectLifecycle: lifecycle,
    onCompletedProject(value) { delivered = value.admittedProject; throw primary; } });
  assert.equal((await f.launch()).status, 503);
  assert.equal(retirement, 1); assert.equal(original, delivered); assert.equal(seenPrimary, primary);
  // The durable recovery row itself refuses business current regardless of the
  // transferred borrow's local retirement. Do not use it as a Close counter.
  await assert.rejects(delivered.assertCurrent(), { code: 'core_retained_project_unavailable' });
  await f.service().drainOwner(ownerA, 'a'.repeat(43));
  assert.equal(finish, 1); await assert.rejects(delivered.assertCurrent());
});

test('R6 global drain owns orphan receiver cleanup and close refuses incomplete disposal', async t => {
  let complete = false, drainCalls = 0;
  const state = () => ({ complete, pending: 0, retained: complete ? 0 : 1, unknown: true });
  const f = await fixture(t, { completedProjectLifecycle: Object.freeze({ retireOriginal() {}, retireSession() {},
    finishSessionCleanup: async () => state(), drain: async () => { drainCalls++; return state(); }, cleanupStatus: state }) });
  await assert.rejects(f.service().drain(), { code: 'core_drain_incomplete' });
  assert.throws(() => f.service().close(), /cleanup|Drain/i);
  assert.equal(drainCalls, 1);
  complete = true; await f.service().drain(); assert.equal(drainCalls, 2);
  // Disposed UNKNOWN is history: it does not keep the broker or writer locked.
  f.service().close();
});

test('R6 Stop waits for entered original POST and preserves late UNKNOWN after positive disposal', async t => {
  const constructor = await r6Receiver();
  let original, pair, entered, release, driverStopped, requestCount = 0, closeCount = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const stopProof = new Promise(resolve => { driverStopped = resolve; });
  const receiver = constructor({
    coreAdmission: { driver: { start() {}, stop() {}, connect() {} }, launchURL() {}, sessionForHost() {}, originForSession() {} },
    retainedSSO: { acquireReference() { throw Error('PUBLIC no grant acquisition'); } },
    admittedProjects: { async acquireProject() { return { assertCurrent: () => original.assertCurrent(),
      async request() { requestCount++; entered(); await blocked; return 'PUBLIC late result'; }, close() { closeCount++; } }; } },
  });
  const identity = { owner: ownerA, workspaceOwner: ownerA, account: 'ynx-a', generation: 1,
    identityReference: 'a'.repeat(43), expiresAt: Date.now() + 60000, isCurrent() {} };
  const verify = async () => identity; verify.resolveReference = async () => identity;
  const f = await fixture(t, { verifyIdentity: verify, completedProjectLifecycle: receiver.completedProjectLifecycle,
    async onCompletedProject(value) { original = value.admittedProject; pair = await receiver.retainCompletedProject({ ...value, nativeTools: receiver.nativeTools }); },
    stop(value) { driverStopped(); return { stopped: true, runtimeId: value.runtimeId, identityDigest: value.identityDigest }; } });
  const launch = await f.launch(); assert.equal(launch.status, 201);
  const request = pair.admittedProject.request({ method: 'POST', path: '/PUBLIC-test-effect' }).catch(error => error);
  await started;
  const stopping = f.call('/' + launch.value.session.sessionId, 'DELETE');
  await stopProof;
  assert.equal(receiver.completedProjectLifecycle.cleanupStatus().complete, false);
  assert.equal(closeCount, 0);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 1);
  release();
  const failure = await request;
  assert.equal(failure.unknown, true); assert.ok(failure.outcomeCause);
  assert.equal((await stopping).status, 200);
  const status = receiver.completedProjectLifecycle.cleanupStatus();
  assert.equal(status.complete, true); assert.equal(status.unknown, true);
  assert.equal(status.records[0].outcomeCause, failure.outcomeCause);
  assert.equal(closeCount, 1); assert.equal(requestCount, 1);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
  await assert.rejects(pair.admittedProject.request({ method: 'POST' })); assert.equal(requestCount, 1);
});

test('R6 completed receiver cleanup never substitutes for exact driver stop proof', async t => {
  let proof = false, finishes = 0;
  const lifecycle = Object.freeze({ retireOriginal() {}, retireSession() {},
    finishSessionCleanup: async () => { finishes++; return { complete: true, pending: 0, retained: 0 }; },
    drain: async () => ({ complete: true, pending: 0, retained: 0 }), cleanupStatus: () => ({ complete: true, pending: 0, retained: 0 }) });
  const f = await fixture(t, { completedProjectLifecycle: lifecycle,
    stop(value) { return { stopped: true, runtimeId: proof ? value.runtimeId : 'PUBLIC-wrong-runtime', identityDigest: value.identityDigest }; } });
  const launch = await f.launch(); assert.equal(launch.status, 201);
  assert.equal((await f.call('/' + launch.value.session.sessionId, 'DELETE')).status, 503);
  assert.equal(finishes, 0);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 1);
  proof = true;
  assert.equal((await f.call('/' + launch.value.session.sessionId, 'DELETE')).status, 200);
  assert.equal(finishes, 1);
});

async function n1ReceiverConstructor() {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const path = '/Users/huangjiahao/ynx-social-qa-authority/ide-protected-completed-project-cleanup-pass-repair-r7-20261012/apps/developer/services/codeoss-service/src/protected-developer-operator.mjs';
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), 'b57d7dddceb483df5669b7785290014ce907e676b3c2323f7ed1f87ed869f2e3');
  return (await import((await import('node:url')).pathToFileURL(path))).createDeveloperCoreAdmission;
}
async function n1NormalFixture(t, { failClose = true, badProof = false } = {}) {
  const constructor = await n1ReceiverConstructor();
  const firstCloseError = Object.freeze(new Error('PUBLIC idle close first failure'));
  let original, closeCount = 0, acquires = 0, starts = 0, stops = 0, release, stopEntered;
  const block = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { stopEntered = resolve; });
  const receiver = constructor({ coreAdmission: { driver: { start() {}, stop() {}, connect() {} }, launchURL() {}, sessionForHost() {}, originForSession() {} },
    retainedSSO: { acquireReference() { throw Error('PUBLIC no grant'); } },
    admittedProjects: { async acquireProject() { acquires++; return { assertCurrent: () => original.assertCurrent(), request() { throw Error('PUBLIC no dispatch'); },
      close() { closeCount++; if (failClose && closeCount === 1) throw firstCloseError; } }; } },
  });
  const identity = { owner: ownerA, workspaceOwner: ownerA, account: 'ynx-a', generation: 1,
    identityReference: 'a'.repeat(43), expiresAt: Date.now() + 60000, isCurrent() {} };
  const verify = async () => identity; verify.resolveReference = async () => identity;
  const f = await fixture(t, { verifyIdentity: verify, completedProjectLifecycle: receiver.completedProjectLifecycle,
    start() { starts++; }, async stop(value) { stops++; stopEntered(); await block;
      return { stopped: true, runtimeId: badProof ? 'PUBLIC-wrong' : value.runtimeId, identityDigest: value.identityDigest }; },
    async onCompletedProject(value) { original = value.admittedProject; await receiver.retainCompletedProject({ ...value, nativeTools: receiver.nativeTools }); } });
  const launched = await f.launch(); assert.equal(launched.status, 201);
  return { ...f, receiver, firstCloseError, entered, release, counts: () => ({ closeCount, acquires, starts, stops }) };
}

test('N1 normal global drain and delayed row Stop share idle failed owner until later independent cleanup', async t => {
  const f = await n1NormalFixture(t);
  const draining = f.service().drain().catch(error => error);
  await f.entered;
  // Driver has an explicit barrier; let the first cleanup promise settle while
  // the original row join is still pending, without any product delay.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.counts().closeCount, 1);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 1);
  f.release();
  const failure = await draining; assert.equal(failure.code, 'core_drain_incomplete');
  assert.equal(f.counts().closeCount, 1, 'Same global/row invocation must not retry newly failing close');
  assert.equal(f.receiver.completedProjectLifecycle.cleanupStatus().complete, false);
  assert.ok(f.receiver.completedProjectLifecycle.cleanupStatus().errors.includes(f.firstCloseError));
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT status FROM codeoss_sessions').get().status, 'recovery-required');
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 1);
  await f.service().drain();
  assert.equal(f.counts().closeCount, 2);
  assert.equal(f.receiver.completedProjectLifecycle.cleanupStatus().complete, true);
  assert.ok(f.receiver.completedProjectLifecycle.cleanupStatus().errors.includes(f.firstCloseError));
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
  assert.equal(f.counts().acquires, 1); assert.equal(f.counts().starts, 1);
});

test('N1 normal drain waits for row join and keeps writer when genuine driver proof fails', async t => {
  const f = await n1NormalFixture(t, { failClose: false, badProof: true });
  let settled = false;
  const draining = f.service().drain().then(() => { settled = true; }, error => { settled = true; return error; });
  await f.entered; await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(f.receiver.completedProjectLifecycle.cleanupStatus().complete, true);
  f.release(); assert.equal((await draining).code, 'core_drain_incomplete');
  assert.equal(f.counts().closeCount, 1);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 1);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT status FROM codeoss_sessions').get().status, 'recovery-required');
});

async function r8StandaloneFixture(t, { kind = 'POST', badProof = false } = {}) {
  const { createHash } = await import('node:crypto');
  const operatorPath = '/Users/huangjiahao/ynx-social-qa-authority/ide-protected-standalone-stop-cleanup-pass-repair-r8-20261012/apps/developer/services/codeoss-service/src/protected-developer-operator.mjs';
  assert.equal(createHash('sha256').update(await readFile(operatorPath)).digest('hex'), '2f905ebd6f1736b1611888d7f50ed067f118b35a6c65b176c964965d83d8809f');
  const { createDeveloperCoreAdmission: constructor } = await import((await import('node:url')).pathToFileURL(operatorPath));
  const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  const requestEntered = deferred(), output = deferred(), driverEntered = deferred(), driverProof = deferred();
  const first = Object.freeze(new Error('PUBLIC R8 late original ' + kind));
  const closeFailure = Object.freeze(new Error('PUBLIC R8 first witness Close failure'));
  let original, pair, witness, closeCount = 0, acquires = 0, starts = 0, requests = 0, validProof = !badProof;
  const receiver = constructor({ coreAdmission: { driver: { start() {}, stop() {}, connect() {} }, launchURL() {}, sessionForHost() {}, originForSession() {} },
    retainedSSO: { acquireReference() { throw Error('PUBLIC no grant'); } },
    admittedProjects: { async acquireProject() { acquires++; witness = {
      assertCurrent: () => original.assertCurrent(),
      request: async () => { requests++; requestEntered.resolve(); return output.promise; },
      close() { closeCount++; if (closeCount === 1) throw closeFailure; },
    }; return witness; } },
  });
  const identity = { owner: ownerA, workspaceOwner: ownerA, account: 'ynx-a', generation: 1,
    identityReference: 'a'.repeat(43), expiresAt: Date.now() + 60000, isCurrent() {} };
  const verify = async () => identity; verify.resolveReference = async () => identity;
  const f = await fixture(t, { verifyIdentity: verify, completedProjectLifecycle: receiver.completedProjectLifecycle,
    start() { starts++; }, async stop(value) { driverEntered.resolve(); await driverProof.promise;
      return { stopped: true, runtimeId: validProof ? value.runtimeId : 'PUBLIC-wrong-runtime', identityDigest: value.identityDigest }; },
    async onCompletedProject(value) { original = value.admittedProject; pair = await receiver.retainCompletedProject({ ...value, nativeTools: receiver.nativeTools }); },
  });
  const launched = await f.launch(); assert.equal(launched.status, 201);
  if (kind === 'current') witness.assertCurrent = async () => { requestEntered.resolve(); return output.promise; };
  const operation = (kind === 'POST' ? pair.admittedProject.request({ method: 'POST', path: '/PUBLIC-R8-effect' }) : pair.admittedProject.assertCurrent()).catch(error => error);
  await requestEntered.promise;
  const stopping = f.call('/' + launched.value.session.sessionId, 'DELETE'); await driverEntered.promise;
  // A normal admitted DELETE reached the real row Stop; no cleanup helper is
  // called in place of the route, and the driver remains behind a real barrier.
  assert.equal(closeCount, 0);
  output.reject(first); const carrier = await operation;
  return { ...f, receiver, pair, first, closeFailure, carrier, stopping,
    suffix: '/' + launched.value.session.sessionId, release: driverProof.resolve,
    allowProof: () => { validProof = true; }, counts: () => ({ closeCount, acquires, starts, requests }) };
}

for (const kind of ['POST', 'current']) test(`R8 normal standalone DELETE holds pending ${kind} disposal until driver proof and independent retry`, async t => {
  const f = await r8StandaloneFixture(t, { kind });
  // Capture before the valid driver result; the assertion is made after the
  // route settles so even a parent RED test leaves no abandoned Stop promise.
  const beforeProof = f.counts().closeCount;
  assert.equal(f.carrier.primary, f.first);
  if (kind === 'POST') { assert.equal(f.carrier.unknown, true); assert.equal(f.carrier.outcomeCause, f.first); }
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 1);
  f.release(); const stopped = await f.stopping;
  const firstCount = f.counts().closeCount;
  const state = f.receiver.completedProjectLifecycle.cleanupStatus();
  const writerCount = f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n;
  const rowStatus = f.store.nativeJournalDatabase().prepare('SELECT status FROM codeoss_sessions').get().status;
  const retry = await f.call(f.suffix, 'DELETE');
  assert.equal(beforeProof, 0, 'Retirement-only pending completion must not dispose before driver proof');
  assert.equal(stopped.status, 503); assert.equal(firstCount, 1);
  assert.equal(state.complete, false); assert.ok(state.errors.includes(f.closeFailure));
  assert.equal(state.records[0].primary, f.first); assert.equal(writerCount, 1); assert.equal(rowStatus, 'recovery-required');
  if (kind === 'POST') { assert.equal(state.unknown, true); assert.equal(state.records[0].outcomeCause, f.first); }
  assert.equal(retry.status, 200); assert.equal(f.counts().closeCount, 2);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
  assert.equal(f.receiver.completedProjectLifecycle.cleanupStatus().complete, true);
  assert.equal(f.carrier.primary, f.first);
  await assert.rejects(f.pair.admittedProject.request({ method: 'POST' }));
  assert.equal(f.counts().acquires, 1); assert.equal(f.counts().starts, 1); assert.equal(f.counts().requests, kind === 'POST' ? 1 : 0);
});

test('R8 normal standalone DELETE wrong driver proof keeps late UNKNOWN owner and writer without disposal', async t => {
  const f = await r8StandaloneFixture(t, { badProof: true });
  const beforeProof = f.counts().closeCount; f.release(); const stopped = await f.stopping;
  const rejectedProofCount = f.counts().closeCount;
  const retained = f.receiver.completedProjectLifecycle.cleanupStatus();
  const writerCount = f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n;
  // Later independently admitted Stop may try cleanup only after a valid
  // driver proof; first disposal fails, next independent Stop may retry it.
  f.allowProof(); const first = await f.call(f.suffix, 'DELETE'); const retry = await f.call(f.suffix, 'DELETE');
  assert.equal(beforeProof, 0); assert.equal(stopped.status, 503); assert.equal(rejectedProofCount, 0);
  assert.equal(writerCount, 1); assert.equal(retained.complete, false); assert.equal(retained.unknown, true);
  assert.equal(retained.records[0].primary, f.first); assert.equal(retained.records[0].outcomeCause, f.first);
  assert.equal(first.status, 503); assert.equal(retry.status, 200); assert.equal(f.counts().closeCount, 2);
  assert.equal(f.counts().requests, 1); assert.equal(f.counts().acquires, 1); assert.equal(f.counts().starts, 1);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
});

test('R8 normal standalone DELETE retains a late acquired owner while original launch settles', async t => {
  const { createHash } = await import('node:crypto');
  const operatorPath = '/Users/huangjiahao/ynx-social-qa-authority/ide-protected-standalone-stop-cleanup-pass-repair-r8-20261012/apps/developer/services/codeoss-service/src/protected-developer-operator.mjs';
  assert.equal(createHash('sha256').update(await readFile(operatorPath)).digest('hex'), '2f905ebd6f1736b1611888d7f50ed067f118b35a6c65b176c964965d83d8809f');
  const { createDeveloperCoreAdmission: constructor } = await import((await import('node:url')).pathToFileURL(operatorPath));
  let acquired, releaseAcquisition, driverEntered, releaseDriver, retired, original, carrier, closeCount = 0, acquires = 0, starts = 0;
  const acquisitionEntered = new Promise(resolve => { acquired = resolve; });
  const acquisition = new Promise(resolve => { releaseAcquisition = resolve; });
  const entered = new Promise(resolve => { driverEntered = resolve; });
  const proof = new Promise(resolve => { releaseDriver = resolve; });
  const retirement = new Promise(resolve => { retired = resolve; });
  const closeFailure = Object.freeze(new Error('PUBLIC late owner first Close refusal'));
  const receiver = constructor({ coreAdmission: { driver: { start() {}, stop() {}, connect() {} }, launchURL() {}, sessionForHost() {}, originForSession() {} },
    retainedSSO: { acquireReference() { throw Error('PUBLIC no grant'); } },
    admittedProjects: { async acquireProject() { acquires++; acquired(); await acquisition;
      return { assertCurrent: () => original.assertCurrent(), request() { throw Error('PUBLIC no dispatch'); },
        close() { closeCount++; if (closeCount === 1) throw closeFailure; } }; } },
  });
  const identity = { owner: ownerA, workspaceOwner: ownerA, account: 'ynx-a', generation: 1,
    identityReference: 'a'.repeat(43), expiresAt: Date.now() + 60000, isCurrent() {} };
  const verify = async () => identity; verify.resolveReference = async () => identity;
  const observedLifecycle = Object.freeze({ ...receiver.completedProjectLifecycle,
    retireSession(...args) { const result = receiver.completedProjectLifecycle.retireSession(...args); retired(); return result; } });
  const f = await fixture(t, { verifyIdentity: verify, completedProjectLifecycle: observedLifecycle,
    start() { starts++; }, async stop(value) { driverEntered(); await proof;
      return { stopped: true, runtimeId: value.runtimeId, identityDigest: value.identityDigest }; },
    async onCompletedProject(value) { original = value.admittedProject;
      try { await receiver.retainCompletedProject({ ...value, nativeTools: receiver.nativeTools }); }
      catch (error) { carrier = error; throw error; } },
  });
  const launching = f.launch(); await acquisitionEntered;
  const session = (await f.call()).value.sessions[0];
  const stopping = f.call('/' + session.sessionId, 'DELETE');
  // Observe the actual lifecycle retirement reached by DELETE without sleeps.
  // The pending launch is still joined and its newly returned owner stays held.
  await retirement;
  releaseAcquisition(); const launched = await launching; await entered;
  const beforeProof = closeCount; const pending = receiver.completedProjectLifecycle.cleanupStatus();
  releaseDriver(); const stopped = await stopping; const firstCount = closeCount;
  const retained = receiver.completedProjectLifecycle.cleanupStatus();
  const writers = f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n;
  const retry = await f.call('/' + session.sessionId, 'DELETE');
  assert.equal(launched.status, 503); assert.equal(carrier.code, 'AI_ACQUISITION_CLEANUP_REQUIRED');
  assert.equal(beforeProof, 0); assert.equal(pending.pending, 0); assert.equal(pending.retained, 2);
  assert.equal(stopped.status, 503); assert.equal(firstCount, 1); assert.equal(writers, 1);
  assert.equal(retained.records[0].primary, carrier.primary); assert.ok(retained.errors.includes(closeFailure));
  assert.equal(retry.status, 200); assert.equal(closeCount, 2); assert.equal(acquires, 1); assert.equal(starts, 1);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
});
