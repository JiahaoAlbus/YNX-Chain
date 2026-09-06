import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as reservePort, connect } from "node:net";
import { request } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(read, accept) { for (let i = 0; i < 300; i++) { try { const value = await read(); if (accept(value)) return value; } catch {} await delay(10); } throw new Error("maintenance process condition timed out"); }
async function fixture(t, duration = 2000) {
  const root = await mkdtemp(join(tmpdir(), "code-real-signal-")), reservation = reservePort();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve)); const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/server.mjs", import.meta.url))], {
    env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port),
      YNX_CODE_STATE_DIR: root, YNX_CODE_WORKSPACE_SESSION_KEY: "synthetic-maintenance-key-only-not-production",
      YNX_CODE_DRAIN_TIMEOUT_MS: String(duration), YNX_CODE_CANCEL_TIMEOUT_MS: "1000" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; await rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${port}`;
  try { await poll(async () => { if (child.exitCode !== null) throw new Error(output); return (await fetch(url + "/healthz")).json(); }, value => value.ready); }
  catch (error) { throw new Error(error.message + "\n" + output); }
  const cookie = (await fetch(url + "/runtime/health")).headers.get("set-cookie").split(";")[0];
  return { child, root, url, cookie, exited, output: () => output };
}

function delayedSave(url, cookie) {
  const body = JSON.stringify({ protocolVersion: "ynx-code/v1", expectedRevision: 0, idempotencyKey: "signal-save-0001",
    workspace: { name: "Retained", folders: [], files: { "main.js": "console.log('saved before shutdown')" }, open: ["main.js"], active: "main.js" } });
  let resolve, reject;
  const result = new Promise((done, fail) => { resolve = done; reject = fail; });
  const outgoing = request(url + "/runtime/workspaces/signal-project", { method: "PUT", headers: { cookie, "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, response => {
    let content = ""; response.on("data", chunk => { content += chunk; }); response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(content) }));
  });
  outgoing.on("error", reject); outgoing.write(body.slice(0, -1));
  return { result, finish: () => outgoing.end(body.slice(-1)) };
}

for (const mode of ["explicit-maintenance", "repeated-shutdown-signals"]) test(`real server ${mode} saves accepted work before closing SQLite`, async t => {
  const { child, root, url, cookie, exited, output } = await fixture(t), save = delayedSave(url, cookie);
  await poll(() => fetch(url + "/healthz").then(r => r.json()), value => value.activity.requests.byCategory.workspace === 1);
  child.kill(mode === "explicit-maintenance" ? "SIGUSR2" : "SIGTERM");
  if (mode === "repeated-shutdown-signals") { await delay(10); child.kill("SIGINT"); }
  const health = await poll(() => fetch(url + "/healthz").then(r => r.json()), value => !value.ready);
  assert.equal(health.activity.requests.byCategory.workspace, 1);
  assert.equal((await fetch(url + "/runtime/workspaces/new", { headers: { cookie } })).status, 503);
  assert.equal(child.exitCode, null); save.finish(); assert.equal((await save.result).status, 200);
  if (mode === "explicit-maintenance") {
    await poll(() => fetch(url + "/healthz").then(r => r.json()), value => value.activity.phase === "maintenance");
    assert.equal((await fetch(url + "/readyz")).status, 503); child.kill("SIGTERM");
  }
  assert.deepEqual(await exited, { code: 0, signal: null }, output());
  const receipt = JSON.parse(await readFile(join(root, "maintenance.json"))); assert.equal(receipt.cleanShutdown, true);
  const db = new DatabaseSync(join(root, "workspaces.sqlite"));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  const allRows = tables.map(name => db.prepare(`SELECT * FROM ${name}`).all());
  assert.match(JSON.stringify(allRows), /saved before shutdown/); db.close();
});

test("real SIGTERM cancels an unfinished request body with an explicit retry result", async t => {
  const { child, root, url, cookie, exited, output } = await fixture(t, 30), save = delayedSave(url, cookie);
  await poll(() => fetch(url + "/healthz").then(r => r.json()), value => value.activity.requests.total === 1);
  child.kill("SIGTERM"); const response = await save.result;
  assert.equal(response.status, 503); assert.equal(response.body.code, "service_maintenance");
  assert.deepEqual(await exited, { code: 0, signal: null }, output());
  const receipt = JSON.parse(await readFile(join(root, "maintenance.json")));
  assert.equal(receipt.cleanShutdown, true); assert.equal(receipt.forcedCancellation, true);
});

test("malformed websocket upgrade cannot terminate the real server", async t => {
  const { child, url, exited } = await fixture(t); const target = new URL(url);
  const reply = await new Promise((resolve, reject) => {
    let body = ""; const socket = connect(Number(target.port), target.hostname);
    socket.on("connect", () => socket.write("GET http://[ HTTP/1.1\r\nHost: test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"));
    socket.on("data", chunk => { body += chunk; }); socket.on("error", reject); socket.on("close", () => resolve(body));
  });
  assert.match(reply, /^HTTP\/1\.1 400/); assert.equal(child.exitCode, null);
  assert.equal((await fetch(url + "/healthz")).status, 200); child.kill("SIGTERM");
  assert.deepEqual(await exited, { code: 0, signal: null });
});
