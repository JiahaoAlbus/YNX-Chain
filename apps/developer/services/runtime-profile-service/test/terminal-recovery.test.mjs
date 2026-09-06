import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createTerminalRecoveryJournal } from "../src/terminal-recovery.mjs";
import { createRuntimeProfileService } from "../src/service.mjs";

test("durable terminal guards isolate owners and stale acknowledgments cannot clear a newer session", async t => {
  const root = await mkdtemp(join(tmpdir(), "terminal-journal-")), path = join(root, "journal.sqlite");
  t.after(() => rm(root, { recursive: true, force: true }));
  let db = new DatabaseSync(path), journal = createTerminalRecoveryJournal(db);
  const oldAck = journal.begin("owner-a", "runtime", "project");
  assert.throws(() => journal.begin("owner-a", "runtime", "project"), { code: "terminal_recovery_required" });
  assert.equal(journal.pending("owner-b", "runtime"), false);
  const otherAck = journal.begin("owner-b", "runtime", "project");
  otherAck(); assert.equal(journal.pending("owner-a", "runtime"), true);
  oldAck(); journal.begin("owner-a", "runtime", "next-project"); oldAck();
  assert.equal(journal.pending("owner-a", "runtime"), true);
  db.close(); db = new DatabaseSync(path); journal = createTerminalRecoveryJournal(db);
  assert.throws(() => journal.assertAvailable("owner-a", "runtime"), { code: "terminal_recovery_required" });
  assert.equal(journal.pending("owner-b", "runtime"), false); db.close();
});

for (const kind of ["lxd", "ssh", "language", "debug"]) test(`${kind} restart refuses preparation and deletion of the only remote copy, with owner-scoped metadata`, async t => {
  const root = await mkdtemp(join(tmpdir(), `terminal-${kind}-restart-`));
  const filename = join(root, "profiles.sqlite"), events = [], secret = "TEST-ONLY-NOT-A-KEY-" + "A".repeat(80);
  const options = { filename, encryptionKey: "synthetic-encryption-key-at-least-thirty-two-bytes", ownerForRequest: req => req.headers["x-owner"],
    lxd: { inventory: async () => ({ installed: true, ready: true, storagePools: 1, profile: true }),
      create: async value => ({ containerName: value.containerName, network: "disabled" }),
      prepareTerminal: async () => events.push("prepare"), terminalLaunch: () => ({ command: "synthetic-shell" }),
      openLanguageProcess: async () => { events.push("prepare"); return { child: {}, cleanup: async () => events.push("unsafe-cleanup") }; },
      openDebugProcess: async () => { events.push("prepare"); return { child: {}, cleanup: async () => events.push("unsafe-cleanup") }; },
      collectTerminal: async () => { throw new Error("synthetic collection failure"); }, remove: async () => events.push("removed") },
    ssh: { inspect: async () => ({ hostKey: "code.example.com ssh-ed25519 AAAATEST", fingerprint: "SHA256:test" }), verify: async () => {},
      openTerminal: async () => { events.push("prepare"); return { launch: { command: "synthetic-ssh" }, collect: async () => { throw new Error("synthetic collection failure"); }, cleanup: async () => {} }; } },
  };
  let service = createRuntimeProfileService(options);
  const server = createServer((req, res) => service.handler(req, res).then(handled => { if (!handled) res.writeHead(404).end(); }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); service.close(); await rm(root, { recursive: true, force: true }); });
  async function call(owner, path, body, method = "POST") {
    const response = await fetch(base + path, { method, headers: { "x-owner": owner, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, value: await response.json() };
  }
  const created = kind !== "ssh"
    ? await call("owner-a", "/runtime/profiles/lxd/leases", { protocolVersion: "ynx-code-runtime/v1", approval: "create-container-once", projectId: "project", image: "ubuntu-24.04" })
    : await call("owner-a", "/runtime/profiles/ssh", { protocolVersion: "ynx-code-runtime/v1", approval: "connect-ssh-once", host: "code.example.com", port: 22, user: "developer", reviewedHostKey: "code.example.com ssh-ed25519 AAAATEST", privateKey: secret });
  assert.equal(created.status, 201);
  const profiles = (await call("owner-a", "/runtime/profiles", null, "GET")).value;
  const runtimeId = kind !== "ssh" ? profiles.leases[0].runtimeId : `ssh-${profiles.sshProfiles[0].profileId}`;
  const open = owner => (kind === "language" ? service.openContainerLanguageProcess : kind === "debug" ? service.openContainerDebugProcess : kind === "lxd" ? service.openContainerTerminal : service.openTerminal)({ owner, runtimeId, projectId: "project", files: { "main.py": "print(1)" }, activePath: "main.py", language: "python", config: { serverCandidates: ["pyright"], serverName: "pyright", serverArgs: [], environment: {} }, snapshot: { name: "Synthetic", revision: 1, folders: [], files: { "main.js": "before" }, open: ["main.js"], active: "main.js" } });
  const terminal = await open("owner-a");
  if (kind === "language" || kind === "debug") await assert.rejects(terminal.cleanup(), { code: "remote_terminal_recovery_required" });
  else {
    await assert.rejects(terminal.assertStopped(), { code: "remote_terminal_recovery_required" });
    await assert.rejects(terminal.collect()); await terminal.release();
  }
  await assert.rejects(open("owner-a"), { code: "terminal_recovery_required" });
  const live = (await call("owner-a", "/runtime/profiles", null, "GET")).value;
  assert.equal((kind !== "ssh" ? live.leases : live.sshProfiles)[0].recoveryRequired, true);
  assert.deepEqual(events, ["prepare"]); service.close(); service = createRuntimeProfileService(options);
  await assert.rejects(open("owner-a"), { code: "terminal_recovery_required" });
  await assert.rejects(open("owner-b"), error => error.code === (kind !== "ssh" ? "runtime_project_mismatch" : "ssh_profile_not_found"));
  const deletePath = kind !== "ssh" ? `/runtime/profiles/lxd/leases/${runtimeId}` : `/runtime/profiles/ssh/${runtimeId.slice(4)}`;
  assert.equal((await call("owner-a", deletePath, null, "DELETE")).status, 409);
  assert.equal((await call("owner-b", deletePath, null, "DELETE")).status, 404);
  const own = (await call("owner-a", "/runtime/profiles", null, "GET")).value;
  assert.equal((kind !== "ssh" ? own.leases : own.sshProfiles)[0].recoveryRequired, true);
  const other = (await call("owner-b", "/runtime/profiles", null, "GET")).value;
  assert.equal(other.leases.length + other.sshProfiles.length, 0);
  assert.equal(JSON.stringify(own).includes(secret), false); assert.equal(JSON.stringify(other).includes(runtimeId), false);
  assert.deepEqual(events, ["prepare"]);
});
