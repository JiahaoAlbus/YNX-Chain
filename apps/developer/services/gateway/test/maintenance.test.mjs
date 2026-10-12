import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { connect } from "node:net";
import { createActivityRegistry, createMaintenance, guardRequests, writeMaintenanceReceipt } from "../src/activity.mjs";
import { createGateway } from "../src/gateway.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5); } assert.fail("condition did not become true"); }

async function fixture(t, handler) {
  const root = await mkdtemp(join(tmpdir(), "code-maintenance-")), activity = createActivityRegistry();
  const gateway = createGateway({ staticRoot: root, activity, runtime: { handler: async () => false, status: () => ({ active: 0, queued: 0 }) }, handlers: [handler] });
  const server = createServer(guardRequests(activity, gateway));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { root, activity, url: `http://127.0.0.1:${server.address().port}` };
}

test("simultaneous owners and categories drain before SQLite closes; new work and readyz fail immediately", async t => {
  const gate = deferred(), events = [], fixtureReady = deferred();
  const { root, activity, url } = await fixture(t, async (request, response) => {
    const db = await fixtureReady.promise;
    await gate.promise;
    db.prepare("INSERT INTO accepted(category) VALUES(?)").run(request.url);
    events.push("committed"); response.end("saved"); return true;
  });
  const db = new DatabaseSync(join(root, "synthetic.sqlite")); db.exec("CREATE TABLE accepted(category TEXT)"); fixtureReady.resolve(db);
  const paths = ["/runtime/tasks", "/runtime/agent/runs", "/runtime/language/go", "/runtime/git/a", "/runtime/workspaces/a", "/runtime/environments/a"];
  const pending = paths.map(path => fetch(url + path, { method: "POST" }).then(r => r.text()));
  await until(() => activity.snapshot().requests.total === paths.length);
  const health = await (await fetch(url + "/healthz")).json();
  assert.equal(health.active, 0); assert.equal(health.activity.requests.total, 6);
  assert.deepEqual(Object.keys(health.activity.requests.byCategory).sort(), ["agent", "compile", "environment", "git", "language", "workspace"]);
  const maintain = createMaintenance({ activity, stopInteractive: async () => {}, cancelWork() {},
    closeStores() { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accepted").get().n, 6); db.close(); events.push("db-closed"); },
    checkpoint: value => writeMaintenanceReceipt(join(root, "maintenance.json"), value) });
  const drained = maintain();
  assert.equal(activity.accepting(), false);
  assert.equal((await fetch(url + "/runtime/git/new", { method: "POST" })).status, 503);
  assert.equal((await fetch(url + "/readyz")).status, 503);
  assert.equal((await fetch(url + "/healthz")).status, 200);
  assert.equal(events.length, 0); gate.resolve();
  assert.deepEqual(await Promise.all(pending), Array(6).fill("saved"));
  assert.equal((await drained).cleanShutdown, true);
  assert.equal(events.at(-1), "db-closed");
  assert.equal(JSON.parse(await readFile(join(root, "maintenance.json"))).cleanShutdown, true);
  const reopened = new DatabaseSync(join(root, "synthetic.sqlite"));
  assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM accepted").get().n, 6); reopened.close();
});

test("a disconnected response remains active until its handler actually finishes", async t => {
  const gate = deferred();
  const { activity, url } = await fixture(t, async (_request, response) => { await gate.promise; response.end(); return true; });
  const request = httpRequest(url + "/runtime/git/a"); request.on("error", () => {}); request.end();
  await until(() => activity.snapshot().requests.total === 1);
  request.destroy(); await delay(20);
  assert.equal(activity.snapshot().requests.total, 1);
  activity.beginMaintenance(); assert.equal(await activity.waitIdle(10), false);
  gate.resolve(); assert.equal(await activity.waitIdle(1000), true);
});

test("an accepted agent can finish nested AI after admission closes, while unrelated new AI is rejected", async () => {
  const activity = createActivityRegistry(), request = activity.admitRequest("agent"), gate = deferred();
  activity.beginMaintenance();
  const work = activity.runRequest(request, () => activity.operation("ai", async () => { await gate.promise; return "plan"; }));
  assert.equal(activity.snapshot().operations.byCategory.ai, 1);
  await assert.rejects(activity.operation("ai", () => "unrelated"), { code: "service_maintenance" });
  gate.resolve(); assert.equal(await work, "plan"); request.finish(); assert.equal(activity.idle(), true);
});

test("maintenance cancellation is persisted after abort settles and before database close", async t => {
  const { root, activity, url } = await fixture(t, async (request, response) => {
    await new Promise(resolve => request.maintenanceSignal.addEventListener("abort", resolve, { once: true }));
    await delay(25); events.push("cancellation-persisted"); response.end(); return true;
  });
  const events = [], pending = fetch(url + "/runtime/agent/runs/id", { method: "POST" }).then(r => r.json());
  await until(() => activity.snapshot().requests.total === 1);
  const result = await createMaintenance({ activity, drainTimeoutMs: 10, cancelTimeoutMs: 500,
    stopInteractive: async () => {}, cancelWork() {}, closeStores() { events.push("db-closed"); },
    checkpoint: value => writeMaintenanceReceipt(join(root, "maintenance.json"), value) })();
  assert.equal((await pending).code, "service_maintenance");
  assert.equal(result.forcedCancellation, true); assert.equal(result.cleanShutdown, true);
  assert.deepEqual(events, ["cancellation-persisted", "db-closed"]);
});

test("uncooperative handler timeout reports failure and never closes its database", async t => {
  const gate = deferred(), events = [];
  const { root, activity, url } = await fixture(t, async (_request, response) => { await gate.promise; events.push("late-work"); response.end(); return true; });
  const pending = fetch(url + "/runtime/language/go", { method: "POST" }).then(r => r.json());
  await until(() => activity.snapshot().requests.total === 1);
  const result = await createMaintenance({ activity, drainTimeoutMs: 10, cancelTimeoutMs: 10, stopInteractive: async () => {}, cancelWork() {},
    closeStores() { events.push("closed"); }, checkpoint: value => writeMaintenanceReceipt(join(root, "maintenance.json"), value) })();
  assert.equal(result.exitCode, 1); assert.equal(result.timedOut, true); assert.deepEqual(events, []);
  const receipt = JSON.parse(await readFile(join(root, "maintenance.json"))); assert.equal(receipt.cleanShutdown, false); assert.equal(receipt.activity.requests.total, 1);
  gate.resolve(); await pending; await until(() => activity.snapshot().requests.total === 0);
  assert.deepEqual(events, ["late-work"]);
});

test("interactive persistence failure cannot be swallowed into a clean maintenance result", async () => {
  const activity = createActivityRegistry(), receipts = []; let closed = false;
  const maintain = createMaintenance({ activity, stopInteractive: async () => { throw new Error("disk full"); }, cancelWork() {},
    closeStores() { closed = true; }, checkpoint: value => receipts.push(value) });
  const [first, second] = await Promise.all([maintain("operator"), maintain("SIGTERM")]);
  assert.equal(first, second); assert.equal(first.exitCode, 1); assert.equal(closed, false);
  assert.equal(receipts.at(-1).reason, "interactive_state_not_saved");
});

test("malformed raw request targets do not escape the gateway or poison later requests", async t => {
  const { activity, url } = await fixture(t, async (_request, response) => { response.end("alive"); return true; });
  const target = new URL(url);
  const reply = await new Promise((resolve, reject) => {
    const socket = connect(Number(target.port), target.hostname); let body = "";
    socket.on("connect", () => socket.write("GET http://[ HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n"));
    socket.on("data", data => { body += data; }); socket.on("error", reject); socket.on("close", () => resolve(body));
  });
  assert.match(reply, /^HTTP\/1\.1 400/); assert.equal(activity.snapshot().requests.total, 0);
  assert.equal(await (await fetch(url + "/runtime/workspaces/a")).text(), "alive");
});

test("one interactive failure still waits for another owner's accepted write before reporting failure", async t => {
  const gate = deferred(), receipts = []; let committed = false, completed = false, closed = false;
  const { activity, url } = await fixture(t, async (_request, response) => { await gate.promise; committed = true; response.end("saved"); return true; });
  const pending = fetch(url + "/runtime/workspaces/other-owner", { method: "PUT" }).then(r => r.text());
  await until(() => activity.snapshot().requests.total === 1);
  const maintenance = createMaintenance({ activity, stopInteractive: async () => { throw new Error("synthetic conflict"); },
    cancelWork() {}, closeStores() { closed = true; }, checkpoint: value => receipts.push(value) })();
  maintenance.then(() => { completed = true; }); await delay(20); assert.equal(completed, false);
  gate.resolve(); assert.equal(await pending, "saved");
  const result = await maintenance; assert.equal(committed, true); assert.equal(closed, false); assert.equal(result.exitCode, 1);
  assert.equal(receipts.at(-1).activity.requests.total, 0);
});

test("a durable remote recovery guard cannot be mistaken for a clean idle gateway", async () => {
  const activity = createActivityRegistry(), receipts = []; let closed = false;
  activity.observe("remoteRecovery", () => ({ recoveryRequired: 1 }));
  const result = await createMaintenance({ activity, stopInteractive: async () => {}, cancelWork() {},
    checkpoint: value => receipts.push(value), closeStores() { closed = true; } })();
  assert.equal(activity.snapshot().requests.total, 0); assert.equal(result.cleanShutdown, false); assert.equal(closed, false);
  assert.equal(receipts.at(-1).reason, "runtime_recovery_required");
});
