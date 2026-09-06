import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import WebSocket from "ws";
import { createDebugService } from "../src/service.mjs";

test("unverified remote debug cleanup reports recovery instead of a successful exit", async t => {
  let child;
  const debug = createDebugService({ ownerForRequest: () => "synthetic-owner", workspaceStore: { get: () => ({ files: { "main.py": "print(1)" } }) },
    containerDebugBroker: { openContainerDebugProcess: async () => ({
      child: child = spawn(process.execPath, ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], { stdio: ["pipe", "pipe", "pipe"] }),
      program: "/synthetic/main.py", visibleRoot: "/synthetic", sandbox: { kind: "synthetic-broker" }, adapterId: "synthetic",
      cleanup: async () => { throw Object.assign(new Error("synthetic secret must not appear in public errors"), { code: "remote_terminal_recovery_required" }); },
    }) } });
  const server = createServer(); server.on("upgrade", debug.handleUpgrade); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = `127.0.0.1:${server.address().port}`, messages = [];
  const socket = new WebSocket(`ws://${address}/runtime/debug?projectId=project&activePath=main.py&runtimeId=0123456789abcdef01234567`, "ynx-code-dap-v1", { headers: { origin: `http://${address}` } });
  socket.on("error", () => {}); socket.on("message", raw => messages.push(JSON.parse(raw)));
  t.after(async () => { socket.terminate(); await debug.close().catch(() => {}); if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL"); await new Promise(resolve => server.close(resolve)); });
  for (let i = 0; i < 300 && !messages.some(value => value.type === "ready"); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(messages.some(value => value.type === "ready")); await assert.rejects(debug.close(), { code: "interactive_cleanup_failed" });
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(messages.some(value => value.type === "exit"), false);
  assert.equal(messages.some(value => value.code === "debug_recovery_required"), true);
  assert.equal(JSON.stringify(messages).includes("synthetic secret"), false); assert.equal(debug.status().cleanupFailures, 1);
});
