import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRuntimeProfileService, createSshAdapter } from "../src/service.mjs";
import { createTerminalRecoveryJournal } from "../src/terminal-recovery.mjs";

for (const [name, secondOwner, secondHost] of [
  ["same owner and target with two profiles", "owner-a", "code.example.com"],
  ["different owners with the same project and target", "owner-b", "code.example.com"],
  ["different host aliases for the same remote account", "owner-a", "alias.example.com"],
]) test(`SSH never reuses protected physical directories: ${name}`, async t => {
  const root = await mkdtemp(join(tmpdir(), "ssh-directory-")), filename = join(root, "state.sqlite");
  const commands = [], handles = [], hostKey = Buffer.from("synthetic-host-key").toString("base64");
  const options = { filename, ownerForRequest: req => req.headers["x-owner"],
    encryptionKey: "synthetic-encryption-key-at-least-thirty-two-bytes",
    ssh: createSshAdapter({ resolve: async () => [{ address: "203.0.113.20", family: 4 }],
      run: async (command, args) => { commands.push({ command, args }); return { stdout: command === "ssh-keyscan" ? `${args.at(-1)} ssh-ed25519 ${hostKey}\n` : "", stderr: "" }; } }),
    lxd: { inventory: async () => ({ ready: false }) } };
  let service = createRuntimeProfileService(options);
  t.after(async () => { for (const handle of handles) await handle.release(); service.close(); await rm(root, { recursive: true, force: true }); });
  async function profile(owner, host) {
    const request = Readable.from([Buffer.from(JSON.stringify({ protocolVersion: "ynx-code-runtime/v1", approval: "connect-ssh-once", host, port: 22, user: "developer",
      reviewedHostKey: `${host} ssh-ed25519 ${hostKey}`, privateKey: "TEST-ONLY-NOT-A-KEY-" + "A".repeat(80), workspaceId: "a".repeat(48) }))]);
    Object.assign(request, { url: "/runtime/profiles/ssh", method: "POST", headers: { "x-owner": owner, host: "synthetic" } });
    let status, result;
    await service.handler(request, { writeHead(value) { status = value; }, end(value) { result = JSON.parse(value); } });
    assert.equal(status, 201); return `ssh-${result.profile.profileId}`;
  }
  const firstId = await profile("owner-a", "code.example.com"), secondId = await profile(secondOwner, secondHost);
  const snapshot = { files: { "main.js": "retained" }, folders: [] };
  const first = await service.openTerminal({ owner: "owner-a", runtimeId: firstId, projectId: "same-project", snapshot }); handles.push(first);
  await assert.rejects(first.assertStopped(), { code: "remote_terminal_recovery_required" });
  await first.release(); service.close(); service = createRuntimeProfileService(options);
  await assert.rejects(service.openTerminal({ owner: "owner-a", runtimeId: firstId, projectId: "same-project", snapshot }), { code: "terminal_recovery_required" });
  const second = await service.openTerminal({ owner: secondOwner, runtimeId: secondId, projectId: "same-project", snapshot }); handles.push(second);
  const preparations = commands.filter(value => value.command === "ssh" && value.args.at(-1).includes("mkdir"));
  assert.equal(preparations.length, 2);
  assert.ok(commands.every(value => !value.args.join(" ").includes("rm -rf")));
  const dirs = preparations.map(value => value.args.at(-1).match(/mkdir (\.ynx-code\/sessions\/([a-f0-9]{48}))$/));
  assert.ok(dirs.every(Boolean)); assert.notEqual(dirs[0][1], dirs[1][1]);
  const db = new DatabaseSync(filename);
  for (const [runtimeId, directory] of [[firstId, dirs[0]], [secondId, dirs[1]]]) {
    const row = db.prepare("SELECT workspace_id FROM terminal_recovery WHERE runtime_id=?").get(runtimeId);
    assert.equal(row.workspace_id, directory[2]); assert.notEqual(row.workspace_id, "a".repeat(48));
  }
  db.close(); assert.equal(service.recoveryCount(), 2);
});

test("legacy recovery rows are retained when introducing physical workspace identities", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE terminal_recovery(owner_id TEXT,runtime_id TEXT,project_id TEXT,token TEXT,opened_at TEXT,PRIMARY KEY(owner_id,runtime_id)); INSERT INTO terminal_recovery VALUES('owner','ssh-old','project','old-token','old-date')");
  const journal = createTerminalRecoveryJournal(db);
  assert.throws(() => journal.assertAvailable("owner", "ssh-old"), { code: "terminal_recovery_required" });
  assert.deepEqual({ ...db.prepare("SELECT * FROM terminal_recovery").get() }, { owner_id: "owner", runtime_id: "ssh-old", project_id: "project", token: "old-token", opened_at: "old-date", workspace_id: null });
  db.close();
});

test("SSH exclusive creation failure never removes or uploads into the existing directory", async () => {
  const calls = [], adapter = createSshAdapter({ run: async (command, args) => { calls.push({ command, args }); throw new Error("exclusive directory already exists"); } });
  await assert.rejects(adapter.openTerminal({ profile: { host: "code.example.com", port: 22, user: "developer", hostKey: "synthetic" }, privateKey: "synthetic", projectId: "project", workspaceId: "b".repeat(48), snapshot: { files: {}, folders: [] } }));
  assert.equal(calls.length, 1); assert.equal(calls[0].command, "ssh");
  assert.equal(calls[0].args.at(-1), `umask 077; mkdir -p .ynx-code/sessions && mkdir .ynx-code/sessions/${"b".repeat(48)}`);
});
