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
