import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { terminalIdentity, createLxdTerminalSessions, TERMINAL_SESSION_PYTHON } from "../src/lxd-terminal-session.mjs";
import { createLxdAdapter } from "../src/service.mjs";

const identity = terminalIdentity({ owner: "qa-owner", runtimeId: "a".repeat(24), projectId: "qa-project", sessionId: "00000000-0000-4000-8000-000000000001" });
const context = { containerName: `ynx-${createHash("sha256").update("qa-owner").digest("hex").slice(0,10)}-${identity.runtimeId}`, projectId: identity.projectId, terminalIdentity: identity };
test("production adapter implements exact session launch and stop with protected client environment", async () => {
  const calls = [], adapter = createLxdAdapter({ run: async (command, args, options) => { calls.push({ command, args, options }); return { stdout: JSON.stringify({ stopped: true, identity, startTime: "1234" }) }; } });
  const launch = adapter.terminalLaunch(context);
  assert.equal(launch.command, "lxc"); assert.equal(launch.args[1], context.containerName); assert.equal(launch.args.at(-2), JSON.stringify(identity));
  assert.equal(launch.args.includes("/bin/bash"), false); assert.equal(Object.hasOwn(launch.env, "HOME"), false);
  const stopped = await adapter.assertTerminalStopped(context); assert.equal(stopped.stopped, true);
  assert.equal(calls[0].args[1], context.containerName); assert.equal(calls[0].args.at(-2), "stop"); assert.equal(calls[0].args.at(-1), JSON.stringify(identity));
  assert.equal(calls[0].args.includes("--force"), false); assert.equal(calls[0].options.timeout, 25_000);
});
test("missing legacy identity and substituted owner/runtime/container never execute a stop", async () => {
  let calls = 0; const sessions = createLxdTerminalSessions({ run: async () => { calls++; }, environment: () => ({}) });
  for (const changed of [{ ...context, terminalIdentity: null }, { ...context, containerName: `ynx-${"b".repeat(10)}-${identity.runtimeId}` }, { ...context, projectId: "another-project" }, { ...context, terminalIdentity: { ...identity, runtimeId: "b".repeat(24) } }]) await assert.rejects(sessions.stop(changed), { code: "remote_terminal_recovery_required" });
  assert.equal(calls, 0);
});
test("remote child remains and a forged receipt protect recovery", async () => {
  const blocked = createLxdTerminalSessions({ run: async () => { throw new Error("Terminal children remain"); }, environment: () => ({}) });
  await assert.rejects(blocked.stop(context), { code: "remote_terminal_recovery_required" });
  const forged = createLxdTerminalSessions({ run: async () => ({ stdout: JSON.stringify({ stopped: true, identity: { ...identity, sessionId: "another" } }) }), environment: () => ({}) });
  await assert.rejects(forged.stop(context), { code: "remote_terminal_recovery_required" });
});
test("fixed supervisor is valid Python and never uses a project path to choose a kill target", t => {
  const parsed = spawnSync(process.platform === "darwin" ? "/usr/bin/python3" : "python3", ["-c", "import ast,sys;ast.parse(sys.stdin.read())"], { input: TERMINAL_SESSION_PYTHON, encoding: "utf8" });
  if (parsed.error) return t.skip("Python AST verifier unavailable");
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.match(TERMINAL_SESSION_PYTHON, /\['systemctl','stop',unit\]/);
  assert.match(TERMINAL_SESSION_PYTHON, /st_uid!=0/); assert.match(TERMINAL_SESSION_PYTHON, /KillMode=control-group/); assert.match(TERMINAL_SESSION_PYTHON, /--uid=ynx-terminal/);
});
