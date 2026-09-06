import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createCommandRunner } from "../src/commands.mjs";
import { createActivityRegistry, createMaintenance } from "../../gateway/src/activity.mjs";

for (const cause of ["timeout", "max_buffer", "abort"]) test(`${cause} waits for the real child to close before rejecting`, async () => {
  let child; const runner = createCommandRunner({ spawnProcess: (...args) => child = spawn(...args) }), controller = new AbortController();
  const body = cause === "max_buffer" ? "process.stdout.write('x'.repeat(8192));setInterval(()=>{},1000)" : "setInterval(()=>{},1000)";
  const job = runner.run(process.execPath, ["-e", body], { timeout: cause === "timeout" ? 50 : 2000, maxBuffer: 1024, signal: controller.signal });
  if (cause === "abort") controller.abort();
  await assert.rejects(job, { code: cause === "abort" ? "service_maintenance" : cause });
  assert.ok(child.exitCode !== null || child.signalCode !== null); assert.deepEqual(runner.status(), { active: 0, unsafeCleanup: 0 });
});

test("an unresponsive child remains counted after caller failure and prevents false idle", async () => {
  const child = Object.assign(new EventEmitter(), { pid: undefined, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
  const runner = createCommandRunner({ spawnProcess: () => child, reapTimeoutMs: 10 });
  await assert.rejects(runner.run("fixture", [], { timeout: 10 }), { code: "child_exit_timeout" });
  assert.deepEqual(runner.status(), { active: 1, unsafeCleanup: 1 });
  const activity = createActivityRegistry(); activity.observe("runtimeCommands", runner.status);
  const result = await createMaintenance({ activity, stopInteractive: async () => {}, cancelWork() {}, checkpoint() {},
    closeStores() { assert.fail("unreaped child must not close stores"); }, drainTimeoutMs: 10, cancelTimeoutMs: 10 })();
  assert.equal(result.cleanShutdown, false); assert.equal(result.exitCode, 1);
  child.emit("close", 1); assert.deepEqual(runner.status(), { active: 0, unsafeCleanup: 1 });
});

test("timeout terminates a local descendant before it can write after its parent closes", { skip: process.platform === "win32" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "code-command-descendant-")), marker = join(root, "late-write");
  t.after(() => rm(root, { recursive: true, force: true }));
  const descendant = "require('node:fs').writeFileSync(process.argv[1]+'.started', 'started');setTimeout(()=>require('node:fs').writeFileSync(process.argv[1], 'late'), 600)";
  const program = "require('node:child_process').spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{stdio:'ignore'});setInterval(()=>{},1000)";
  const runner = createCommandRunner();
  await assert.rejects(runner.run(process.execPath, ["-e", program, descendant, marker], { timeout: 250 }), { code: "timeout" });
  await access(marker + ".started"); await new Promise(resolve => setTimeout(resolve, 500)); await assert.rejects(access(marker));
  assert.deepEqual(runner.status(), { active: 0, unsafeCleanup: 0 });
});

test("pre-aborted work does not spawn or disclose input", async () => {
  const runner = createCommandRunner({ spawnProcess() { assert.fail("cancelled work cannot spawn"); } }), controller = new AbortController();
  controller.abort(); await assert.rejects(runner.run("fixture", ["synthetic-secret"], { signal: controller.signal }), error => error.code === "service_maintenance" && !error.message.includes("synthetic-secret"));
});
