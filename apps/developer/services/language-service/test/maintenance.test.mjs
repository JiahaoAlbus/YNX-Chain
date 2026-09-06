import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { runStdioLanguageRequest } from "../src/cpp-lsp.mjs";
import { createActivityRegistry, createMaintenance } from "../../gateway/src/activity.mjs";

test("maintenance cancels queued language jobs and reaps running server processes", async () => {
  const children = [], controllers = Array.from({ length: 20 }, () => new AbortController());
  const config = { language: "cpp", label: "C++", extensions: new Set([".cpp"]), serverName: "synthetic-lsp", languageId: () => "cpp" };
  const jobs = controllers.map(controller => runStdioLanguageRequest({ files: { "main.cpp": "int main(){}" }, activePath: "main.cpp", operation: "documentSymbols" }, config, {
    signal: controller.signal,
    processFactory: async () => {
      const child = spawn(process.execPath, ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], { stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
      children.push(child);
      return { child, visibleRoot: "/synthetic", executable: process.execPath, sandbox: { kind: "synthetic-process" } };
    },
  }));
  const outcomes = Promise.allSettled(jobs);
  for (let attempt = 0; children.length === 0 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(children.length > 0 && children.length < jobs.length, "some real processes run while other work queues");
  const started = children.length;
  for (const controller of controllers) controller.abort(Object.assign(new Error("maintenance"), { code: "service_maintenance" }));
  for (const result of await outcomes) { assert.equal(result.status, "rejected"); assert.equal(result.reason.code, "service_maintenance"); }
  assert.equal(children.length, started, "cancelled queued work never spawned");
  assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null), "all spawned children exited before request settlement");
});

function syntheticChild() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), exitCode: null, kill() {} });
}
const input = { files: { "main.cpp": "int main(){}" }, activePath: "main.cpp", operation: "documentSymbols" };
const config = { language: "cpp", label: "C++", extensions: new Set([".cpp"]), serverName: "synthetic-lsp", languageId: () => "cpp" };

test("an unreaped language child preserves its failure and never releases the remote workspace", async () => {
  const child = syntheticChild(), controller = new AbortController(), activity = createActivityRegistry();
  let cleanupCalled = false, storesClosed = false;
  const job = activity.operation("language", () => runStdioLanguageRequest(input, config, { signal: controller.signal,
    processFactory: async () => ({ child, visibleRoot: "/synthetic", sandbox: { kind: "fixture" }, cleanup() { cleanupCalled = true; throw Object.assign(new Error("cleanup failed"), { code: "EIO" }); } }),
  }));
  await new Promise(resolve => setImmediate(resolve)); controller.abort(Object.assign(new Error("maintenance"), { code: "service_maintenance" }));
  await assert.rejects(job, { code: "child_exit_timeout" });
  assert.equal(cleanupCalled, false); assert.equal(activity.snapshot().unsafeCleanupCount, 1);
  const result = await createMaintenance({ activity, drainTimeoutMs: 10, cancelTimeoutMs: 10, stopInteractive: async () => {}, cancelWork() {}, checkpoint() {}, closeStores() { storesClosed = true; } })();
  assert.equal(result.cleanShutdown, false); assert.equal(storesClosed, false);
});

test("a tail protocol frame after abort cannot throw from a pipe callback", async () => {
  const child = syntheticChild(), controller = new AbortController(); let closed = false;
  child.kill = () => {
    if (closed) return; closed = true;
    queueMicrotask(() => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 99, method: "workspace/configuration", params: { items: [] } });
      child.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      child.emit("exit", null); child.emit("close", null);
    });
  };
  const job = runStdioLanguageRequest(input, config, { signal: controller.signal,
    processFactory: async () => ({ child, visibleRoot: "/synthetic", sandbox: { kind: "fixture" } }),
  });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(Object.assign(new Error("maintenance"), { code: "service_maintenance" }));
  await assert.rejects(job, { code: "service_maintenance" });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, true);
});
