import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as reservePort, connect } from "node:net";
import { request } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(read, accept) { for (let i = 0; i < 300; i++) { try { const value = await read(); if (accept(value)) return value; } catch {} await delay(10); } throw new Error("maintenance process condition timed out"); }
async function fixture(t, duration = 2000, r6Mode = null) {
  const root = await mkdtemp(join(tmpdir(), "code-real-signal-")), reservation = reservePort();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve)); const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const hook = r6Mode === 'n1-idle' ? await n1IdleLifecycleHook(root, `127.0.0.1:${port}`)
    : r6Mode ? await r6LifecycleHook(root, r6Mode, `127.0.0.1:${port}`) : null;
  const child = spawn(process.execPath, [...(hook ? ['--import', hook] : []), fileURLToPath(new URL("../src/server.mjs", import.meta.url))], {
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

// TEST_ONLY interception of the original configuration-loader module. No
// production selector, protected operator file, grant or private key is added.
async function r6LifecycleHook(root, mode, parentHost) {
  const supplier = '/Users/huangjiahao/ynx-social-qa-authority/ide-protected-completed-project-receiver-lifecycle-repair-r6-20261012/apps/developer/services/codeoss-service/src/protected-developer-operator.mjs';
  assert.equal(createHash('sha256').update(await readFile(supplier)).digest('hex'), '82f82003030ef058219ba20e1ed9db9591016801e6713883c959214cd409bfd6');
  const configURL = new URL('../../codeoss-service/src/configuration.mjs', import.meta.url).href;
  const release = join(root, 'PUBLIC-release-current'), entered = join(root, 'PUBLIC-entered-current'), disposed = join(root, 'PUBLIC-original-disposal');
  const source = `
import { createDeveloperCoreAdmission } from ${JSON.stringify(pathToFileURL(supplier).href)};
import { existsSync, writeFileSync } from 'node:fs';
const value = { owner:'a'.repeat(64), workspaceOwner:'b'.repeat(64), account:'PUBLIC', generation:1, identityReference:'r'.repeat(43), localProjectId:'PUBLIC-orphan', workspace:'/PUBLIC/fixture', launch:'12345678-1234-1234-1234-123456789abc', sessionId:'12345678-1234-1234-1234-123456789abc', expiresAt:Date.now()+60000 };
const original = { assertCurrent() { writeFileSync(${JSON.stringify(entered)}, 'entered'); return new Promise(resolve => { const timer=setInterval(()=>{ if(existsSync(${JSON.stringify(release)})){clearInterval(timer);resolve(value);} },10); }); }, request(){throw Error('PUBLIC no dispatch');}, close(){ writeFileSync(${JSON.stringify(disposed)}, 'original'); return ${mode === 'uncertain' ? 'Promise.resolve()' : 'undefined'}; } };
const admission = createDeveloperCoreAdmission({ coreAdmission:{ parentHost:${JSON.stringify(parentHost)}, driver:{start(){},stop(){},connect(){}},launchURL(){},sessionForHost(){},originForSession(){} }, retainedSSO:{acquireReference(){throw Error('PUBLIC no grant');}}, admittedProjects:{acquireProject(){throw Error('PUBLIC no acquire');}} });
const pending = admission.retainCompletedProject({admittedProject:original,nativeTools:admission.nativeTools,session:{sessionId:value.sessionId,projectId:value.localProjectId,status:'running',expiresAt:value.expiresAt}});
pending.catch(()=>{});
export async function loadCoreAdmissionAdapter(){return admission;}
`;
  const parentRoot = '/Users/huangjiahao/.ynx-ide-build-artifacts-b55-20261011/general-selected-cdn-r3-20261011/ide-r6-normal-lifecycle-20261012/parent';
  const parentPairs = process.env.YNX_R6_TEST_PARENT === '1' ? [
    [new URL('../src/server.mjs', import.meta.url).href, join(parentRoot, 'apps/developer/services/gateway/src/server.mjs')],
    [new URL('../../codeoss-service/src/service.mjs', import.meta.url).href, join(parentRoot, 'apps/developer/services/codeoss-service/src/service.mjs')],
  ] : [];
  const hook = join(root, 'PUBLIC-test-only-loader.mjs');
  await writeFile(hook, `import {registerHooks} from 'node:module';\nimport {readFileSync} from 'node:fs';\nconst parents=new Map(${JSON.stringify(parentPairs)});\nregisterHooks({load(url,context,next){if(url===${JSON.stringify(configURL)})return {format:'module',source:${JSON.stringify(source)},shortCircuit:true};if(parents.has(url))return {format:'module',source:readFileSync(parents.get(url),'utf8'),shortCircuit:true};return next(url,context);}});\n`);
  return hook;
}

for (const mode of ['disposed', 'uncertain']) test(`R6 actual Gateway shutdown ${mode} waits for original receiver and truthful store closure`, async t => {
  const { child, root, url, exited, output } = await fixture(t, 2000, mode);
  assert.equal(existsSync(join(root, 'PUBLIC-entered-current')), true);
  child.kill('SIGUSR2');
  await poll(() => fetch(url + '/healthz').then(r => r.json()), value => value.activity.phase !== 'serving');
  // Only the fixture's explicit file barrier can settle this original current.
  // Give the real maintenance loop time to reveal a premature store close;
  // this is a test observation window, never a product continuation delay.
  await delay(60);
  assert.equal(existsSync(join(root, 'maintenance.json')), false, 'Pending original current cannot produce a clean receipt');
  assert.equal(existsSync(join(root, 'PUBLIC-original-disposal')), false, 'Do not dispose underneath entered original current');
  await writeFile(join(root, 'PUBLIC-release-current'), 'release');
  // The normal writer publishes a temporary drained/false receipt before store
  // closure. Assert only its final disposition, never that intermediate file.
  await poll(() => readFile(join(root, 'maintenance.json')).then(b => JSON.parse(b)), value => ['maintenance', 'failed'].includes(value.status));
  const receipt = JSON.parse(await readFile(join(root, 'maintenance.json')));
  assert.equal(receipt.cleanShutdown, mode === 'disposed');
  assert.equal(existsSync(join(root, 'PUBLIC-original-disposal')), true);
  const db = new DatabaseSync(join(root, 'workspaces.sqlite'));
  const ownerCount = db.prepare('SELECT COUNT(*) n FROM codeoss_broker_owner').get().n; db.close();
  assert.equal(ownerCount, mode === 'disposed' ? 0 : 1, 'Uncertain disposal preserves original broker/store ownership');
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: mode === 'disposed' ? 0 : 1, signal: null }, output());
});

async function n1IdleLifecycleHook(root, parentHost) {
  const parent = process.env.YNX_N1_TEST_PARENT === '1';
  const supplierRoot = '/Users/huangjiahao/ynx-social-qa-authority/' + (parent ? 'ide-protected-completed-project-receiver-lifecycle-repair-r6-20261012' : 'ide-protected-completed-project-cleanup-pass-repair-r7-20261012');
  const supplier = join(supplierRoot, 'apps/developer/services/codeoss-service/src/protected-developer-operator.mjs');
  assert.equal(createHash('sha256').update(await readFile(supplier)).digest('hex'), parent ? '82f82003030ef058219ba20e1ed9db9591016801e6713883c959214cd409bfd6' : 'b57d7dddceb483df5669b7785290014ce907e676b3c2323f7ed1f87ed869f2e3');
  const countFile = join(root, 'PUBLIC-idle-close-count');
  const source = `
import {createDeveloperCoreAdmission} from ${JSON.stringify(pathToFileURL(supplier).href)};
import {writeFileSync} from 'node:fs';
const value={owner:'a'.repeat(64),workspaceOwner:'b'.repeat(64),account:'PUBLIC',generation:1,identityReference:'r'.repeat(43),localProjectId:'PUBLIC-orphan',workspace:'/PUBLIC/idle',launch:'12345678-1234-1234-1234-123456789abc',sessionId:'12345678-1234-1234-1234-123456789abc',expiresAt:Date.now()+60000};
let closes=0;
const original={async assertCurrent(){return value;},request(){throw Error('PUBLIC no request');},close(){}};
const witness={async assertCurrent(){return value;},request(){throw Error('PUBLIC no request');},close(){writeFileSync(${JSON.stringify(countFile)},String(++closes));if(closes===1)throw Object.freeze(new Error('PUBLIC idle first close'));}};
const admission=createDeveloperCoreAdmission({coreAdmission:{parentHost:${JSON.stringify(parentHost)},driver:{start(){},stop(){},connect(){}},launchURL(){},sessionForHost(){},originForSession(){}},retainedSSO:{acquireReference(){throw Error('PUBLIC no grant');}},admittedProjects:{async acquireProject(){return witness;}}});
await admission.retainCompletedProject({admittedProject:original,nativeTools:admission.nativeTools,session:{sessionId:value.sessionId,projectId:value.localProjectId,status:'running',expiresAt:value.expiresAt}});
export async function loadCoreAdmissionAdapter(){return admission;}
`;
  const configURL = new URL('../../codeoss-service/src/configuration.mjs', import.meta.url).href;
  const parentService = '/Users/huangjiahao/.ynx-ide-build-artifacts-b55-20261011/general-selected-cdn-r3-20261011/ide-r7-normal-cleanup-pass-20261012/parent/apps/developer/services/codeoss-service/src/service.mjs';
  const serviceURL = new URL('../../codeoss-service/src/service.mjs', import.meta.url).href;
  const hook = join(root, 'PUBLIC-n1-test-only-loader.mjs');
  await writeFile(hook, `import {registerHooks} from 'node:module';\nimport {readFileSync} from 'node:fs';\nregisterHooks({load(url,context,next){if(url===${JSON.stringify(configURL)})return {format:'module',source:${JSON.stringify(source)},shortCircuit:true};if(${parent}&&url===${JSON.stringify(serviceURL)})return {format:'module',source:readFileSync(${JSON.stringify(parentService)},'utf8'),shortCircuit:true};return next(url,context);}});\n`);
  return hook;
}

test('N1 actual Gateway idle failed disposal calls original once and preserves failed receipt and stores', async t => {
  const { child, root, exited, output } = await fixture(t, 1000, 'n1-idle');
  child.kill('SIGUSR2');
  const receipt = await poll(() => readFile(join(root, 'maintenance.json')).then(b => JSON.parse(b)), value => ['maintenance', 'failed'].includes(value.status));
  assert.equal(receipt.cleanShutdown, false);
  assert.equal(await readFile(join(root, 'PUBLIC-idle-close-count'), 'utf8'), '1');
  const db = new DatabaseSync(join(root, 'workspaces.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM codeoss_broker_owner').get().n, 1); db.close();
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 1, signal: null }, output());
  assert.equal(await readFile(join(root, 'PUBLIC-idle-close-count'), 'utf8'), '1', 'Cached maintenance cannot silently select a second retry');
});
