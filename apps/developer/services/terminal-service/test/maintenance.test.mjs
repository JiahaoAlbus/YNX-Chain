import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import WebSocket from "ws";
import { createTerminalService } from "../src/service.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail("terminal maintenance boundary timed out"); }

for (const conflict of [false, true]) test(`maintenance waits for real PTY startup and ${conflict ? "retains a recovery snapshot on conflict" : "persists before reporting completion"}`, async t => {
  const root = await mkdtemp(join(tmpdir(), "terminal-maintenance-")), started = deferred(), collected = deferred(), events = [];
  const snapshot = { name: "Recovery", revision: 1, folders: [], files: { "main.js": "before" }, open: ["main.js"], active: "main.js" };
  const terminal = createTerminalService({ root, ownerForRequest: () => "synthetic-owner", workspaceStore: {
    get: () => snapshot,
    put: (_owner, _project, value) => {
      if (conflict) throw Object.assign(new Error("Newer workspace retained"), { code: "revision_conflict" });
      assert.equal(value.payload.files["main.js"], "after-maintenance"); events.push("persisted"); return { revision: 2 };
    },
  }, containerTerminalBroker: {
    openTerminal: async () => {
      await started.promise;
      return { launch: { command: process.execPath, args: ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], cwd: root, env: process.env, sandbox: { kind: "synthetic-local-broker" } },
        assertStopped: async () => {}, collect: async () => { events.push("collecting"); await collected.promise; return { files: { "main.js": "after-maintenance" }, folders: [] }; },
        release: async () => { events.push("released"); } };
    },
  } });
  const server = createServer(); server.on("upgrade", terminal.handleUpgrade); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = `127.0.0.1:${server.address().port}`;
  const socket = new WebSocket(`ws://${address}/runtime/terminals?projectId=project&runtimeId=0123456789abcdef01234567`, "ynx-code-terminal-v1", { headers: { origin: `http://${address}` } });
  socket.on("error", () => {});
  t.after(async () => { started.resolve(); collected.resolve(); socket.terminate(); await terminal.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  await until(() => terminal.status().starting === 1);
  let completed = false; const closing = terminal.close(); closing.then(() => { completed = true; }, () => { completed = true; });
  assert.equal(completed, false); started.resolve();
  await until(() => events.includes("collecting"));
  assert.equal(terminal.status().finishing, 1); assert.equal(terminal.status().active, 0); assert.equal(terminal.status().recoveryRequired, 1); assert.equal(completed, false);
  if (conflict) {
    const workspace = (await readdir(root)).find(name => name.startsWith("terminal-"));
    await writeFile(join(root, "unrelated.txt"), "retain-original");
    await symlink(join(root, "unrelated.txt"), join(root, workspace, ".ynx-terminal-recovery.json"));
  }
  collected.resolve();
  if (conflict) {
    await assert.rejects(closing, { code: "interactive_cleanup_failed" });
    const recoveryFile = (await readdir(join(root, ".recovery")))[0];
    const recovery = JSON.parse(await readFile(join(root, ".recovery", recoveryFile)));
    assert.equal(await readFile(join(root, "unrelated.txt"), "utf8"), "retain-original");
    assert.equal(recovery.owner, "synthetic-owner"); assert.equal(recovery.reason, "revision_conflict"); assert.equal(recovery.payload.files["main.js"], "after-maintenance");
    assert.equal(terminal.status().cleanupFailures, 1);
  } else {
    await closing; assert.deepEqual(events, ["collecting", "persisted", "released"]); assert.equal(terminal.status().active, 0);
  }
});

test("a failed remote collection retains the only copy and DELETE reports failure without disclosing another owner's terminal", async t => {
  const root = await mkdtemp(join(tmpdir(), "terminal-collect-failure-")), events = [];
  const snapshot = { name: "Recovery", revision: 1, folders: [], files: { "main.js": "before" }, open: ["main.js"], active: "main.js" };
  const terminal = createTerminalService({ root, ownerForRequest: request => request.headers["x-owner"], workspaceStore: {
    get: () => snapshot, put() { assert.fail("An incomplete remote snapshot must not be persisted"); },
  }, containerTerminalBroker: { openTerminal: async () => ({
    launch: { command: process.execPath, args: ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], cwd: root, env: process.env, sandbox: { kind: "synthetic-local-broker" } },
    assertStopped: async () => {}, collect: async () => { throw Object.assign(new Error("Synthetic remote unavailable"), { code: "remote_unavailable" }); },
    acknowledgeSnapshot: async () => events.push("acknowledged"), release: async () => events.push("released"),
  }) } });
  const server = createServer((req, res) => terminal.handler(req, res)); server.on("upgrade", terminal.handleUpgrade);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const address = `127.0.0.1:${server.address().port}`;
  const socket = new WebSocket(`ws://${address}/runtime/terminals?projectId=project&runtimeId=0123456789abcdef01234567`, "ynx-code-terminal-v1", { headers: { origin: `http://${address}`, "x-owner": "owner-a" } });
  const messages = []; socket.on("message", value => messages.push(JSON.parse(value))); socket.on("error", () => {});
  t.after(async () => { socket.terminate(); await terminal.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  await until(() => messages.some(value => value.type === "ready")); const id = messages.find(value => value.type === "ready").sessionId;
  const other = await fetch(`http://${address}/runtime/terminals/${id}`, { method: "DELETE", headers: { "x-owner": "owner-b" } });
  assert.equal(other.status, 404); assert.equal(terminal.status().active, 1);
  const stopped = await fetch(`http://${address}/runtime/terminals/${id}`, { method: "DELETE", headers: { "x-owner": "owner-a" } });
  assert.equal(stopped.status, 503); assert.equal((await stopped.json()).stopped, false); assert.deepEqual(events, []);
  const recoveryFile = (await readdir(join(root, ".recovery")))[0];
  const recovery = JSON.parse(await readFile(join(root, ".recovery", recoveryFile)));
  assert.equal(recovery.payload, null); assert.equal(recovery.owner, "owner-a"); assert.equal(terminal.status().recoveryRequired, 1);
  await assert.rejects(terminal.close(), { code: "interactive_cleanup_failed" });
});

test("a late remote writer after transport exit keeps its guard and cannot acknowledge an incomplete snapshot", async t => {
  const root = await mkdtemp(join(tmpdir(), "terminal-late-writer-")), remoteFile = join(root, "remote.txt"), events = [];
  const writer = spawn(process.execPath, ["-e", "setTimeout(()=>require('node:fs').writeFileSync(process.argv[1], 'late-remote-edit'), 350)", remoteFile], { stdio: "ignore" });
  const exited = new Promise(resolve => writer.once("exit", resolve));
  const terminal = createTerminalService({ root, ownerForRequest: () => "owner-a", workspaceStore: {
    get: () => ({ name: "Remote", revision: 1, folders: [], files: { "main.js": "before" }, open: ["main.js"], active: "main.js" }),
    put: () => assert.fail("Unverified writers must not commit an incomplete snapshot"),
  }, containerTerminalBroker: { openTerminal: async () => ({
    launch: { command: process.execPath, args: ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], cwd: root, env: process.env, sandbox: { kind: "synthetic-remote-transport" } },
    collect: async () => { events.push("collected"); return { files: {}, folders: [] }; },
    acknowledgeSnapshot: () => events.push("acknowledged"), release: () => events.push("released"),
  }) } });
  const server = createServer(); server.on("upgrade", terminal.handleUpgrade); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = `127.0.0.1:${server.address().port}`, socket = new WebSocket(`ws://${address}/runtime/terminals?projectId=project&runtimeId=0123456789abcdef01234567`, "ynx-code-terminal-v1", { headers: { origin: `http://${address}` } });
  socket.on("error", () => {});
  t.after(async () => { socket.terminate(); await terminal.close().catch(() => {}); await exited; await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  await until(() => terminal.status().active === 1); await assert.rejects(terminal.close(), { code: "interactive_cleanup_failed" });
  await exited; assert.equal(await readFile(remoteFile, "utf8"), "late-remote-edit"); assert.deepEqual(events, []);
  assert.equal(terminal.status().recoveryRequired, 1);
  const recoveryFile = (await readdir(join(root, ".recovery")))[0];
  const recovery = JSON.parse(await readFile(join(root, ".recovery", recoveryFile)));
  assert.equal(recovery.payload, null); assert.equal(recovery.reason, "remote_terminal_recovery_required");
});

test("normal DELETE retries a failed remote proof, retains the first recovery receipt and clears only its resolved failure", async t => {
  const root = await mkdtemp(join(tmpdir(), "terminal-stop-retry-")), events = [];
  let verified = false;
  const terminal = createTerminalService({ root, ownerForRequest: request => request.headers["x-owner"], workspaceStore: {
    get: () => ({ name: "Recovery", revision: 1, folders: [], files: { "main.js": "before" }, open: ["main.js"], active: "main.js" }),
    put: (_owner,_project,input) => { events.push("persist"); assert.equal(input.expectedRevision,1); assert.equal(input.payload.files["main.js"],"after"); return {revision:2}; },
  }, containerTerminalBroker: { openTerminal: async () => ({
    launch: { command: process.execPath,args:["-e","process.stdin.resume();setInterval(()=>{},1000)"],cwd:root,env:process.env,sandbox:{kind:"synthetic-broker"} },
    assertStopped: async () => { events.push("verify"); if(!verified) throw Object.assign(new Error("Remote child is still writing"),{code:"remote_terminal_recovery_required"}); },
    collect: async () => { events.push("collect"); return {files:{"main.js":"after"},folders:[]}; },
    acknowledgeSnapshot: () => events.push("ack"), release: () => events.push("release"),
  }) } });
  const server=createServer((req,res)=>terminal.handler(req,res));server.on("upgrade",terminal.handleUpgrade);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const address=`127.0.0.1:${server.address().port}`;
  const socket=new WebSocket(`ws://${address}/runtime/terminals?projectId=project&runtimeId=0123456789abcdef01234567`,"ynx-code-terminal-v1",{headers:{origin:`http://${address}`,"x-owner":"owner-a"}}),messages=[];
  socket.on("message",value=>messages.push(JSON.parse(value)));socket.on("error",()=>{});
  t.after(async()=>{socket.terminate();await terminal.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  await until(()=>messages.some(value=>value.type==="ready"));const sessionId=messages.find(value=>value.type==="ready").sessionId;
  const stop=owner=>fetch(`http://${address}/runtime/terminals/${sessionId}`,{method:"DELETE",headers:{"x-owner":owner}});
  assert.equal((await stop("owner-b")).status,404);assert.equal((await stop("owner-a")).status,503);assert.deepEqual(events,["verify"]);
  const files=await readdir(join(root,".recovery"));assert.equal(files.length,1);const first=await readFile(join(root,".recovery",files[0]),"utf8");
  verified=true;assert.equal((await stop("owner-a")).status,200);assert.deepEqual(events,["verify","verify","collect","persist","ack","release"]);
  assert.equal(await readFile(join(root,".recovery",files[0]),"utf8"),first);assert.equal(terminal.status().cleanupFailures,0);assert.equal(terminal.status().recoveryRequired,0);
});

test("cold recovery scratch failure acquires no remote lock and same-owner Stop retries after storage repair", async t => {
  const directory=await mkdtemp(join(tmpdir(),"terminal-cold-scratch-")),root=join(directory,"scratch"),sessionId="00000000-0000-4000-8000-000000000002",events=[];
  await writeFile(root,"invalid scratch root");let held=false;
  const terminal=createTerminalService({root,ownerForRequest:req=>req.headers["x-owner"],workspaceStore:{put:()=>{events.push("persist");return{revision:2};}},containerTerminalBroker:{
    recoverableTerminals:owner=>owner==="owner-a"?[{sessionId,projectId:"project",runtimeId:"a".repeat(24)}]:[],
    resumeContainerTerminal:async({owner})=>{assert.equal(owner,"owner-a");assert.equal(held,false);held=true;events.push("resume");return{projectId:"project",runtimeId:"a".repeat(24),snapshot:{name:"Cold",revision:1,files:{"main.js":"before"},folders:[],open:["main.js"],active:"main.js"},remote:{assertStopped:async()=>events.push("verify"),collect:async()=>({files:{"main.js":"after"},folders:[]}),acknowledgeSnapshot:async()=>events.push("ack"),release:async()=>{held=false;events.push("release");}}};},
  }});
  const server=createServer((req,res)=>terminal.handler(req,res));await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await terminal.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  const stop=owner=>fetch(`${base}/runtime/terminals/${sessionId}`,{method:"DELETE",headers:{"x-owner":owner}});
  assert.equal((await stop("owner-b")).status,404);assert.equal((await stop("owner-a")).status,503);assert.equal(held,false);assert.deepEqual(events,[]);
  await rm(root);await mkdir(root);
  assert.equal((await stop("owner-a")).status,200);assert.equal(held,false);assert.deepEqual(events,["resume","verify","persist","ack","release"]);
});
