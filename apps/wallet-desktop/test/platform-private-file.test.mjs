import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrivateFilePolicy } from "../src/platform-private-file.mjs";

const code = error => error?.code === "PRIVATE_FILE_UNAVAILABLE";
const proof = operation => ({ version: "ynx-private-file-v1", operation, private: true, durableMove: operation === "replace" });
async function directory(t) { const value = await fs.mkdtemp(path.join(tmpdir(), "ynx-private-policy-")); t.after(() => fs.rm(value, { recursive: true, force: true })); return value; }
async function writePrivate(policy, file, text) {
  const handle = await fs.open(file, "wx", 0o600);
  try { await policy.protect(file); await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
}

test(`${process.platform} native private publication and actual permission widening are verified`, async t => {
  const folder = await directory(t), policy = new PrivateFilePolicy(), source = path.join(folder, "candidate.tmp"), target = path.join(folder, "vault.json");
  await policy.directory(folder); await writePrivate(policy, source, "public synthetic ciphertext");
  await policy.replace(source, target);
  assert.equal(await fs.readFile(target, "utf8"), "public synthetic ciphertext");
  assert.equal((await policy.assertPrivate(target)).protection, process.platform === "win32" ? "windows-dacl" : "posix-mode");
  if (process.platform === "win32") {
    // Deliberately broaden only this synthetic test file. chmod cannot test a DACL.
    const script = "$ErrorActionPreference='Stop'; $p=$env:YNX_TEST_PRIVATE_FILE; $a=Get-Acl -LiteralPath $p; $sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0'); $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'Read','Allow')); Set-Acl -LiteralPath $p -AclObject $a";
    await promisify(execFile)(path.win32.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, env: { ...process.env, YNX_TEST_PRIVATE_FILE: target } });
  } else await fs.chmod(target, 0o644);
  await assert.rejects(policy.assertPrivate(target), code);
});

test("Windows mode bits never substitute for a successful DACL inspection", async t => {
  const folder = await directory(t), file = path.join(folder, "file"), calls = [];
  await fs.writeFile(file, "fixture", { mode: 0o666 });
  const policy = new PrivateFilePolicy({ platform: "win32", windows: async operation => { calls.push(operation); return operation === "inspect" ? { ...proof(operation), private: false } : proof(operation); } });
  await assert.rejects(policy.assertPrivate(file), code); assert.deepEqual(calls, ["probe", "inspect"]);
});

test("missing, malformed or non-durable Windows commit responses never use a POSIX rename fallback", async () => {
  for (const response of [undefined, { ...proof("replace"), durableMove: false }, { ...proof("replace"), operation: "inspect" }]) {
    let renames = 0;
    const policy = new PrivateFilePolicy({ platform: "win32", io: { rename: async () => { renames++; } }, windows: async operation => operation === "probe" ? proof(operation) : response });
    await assert.rejects(policy.replace("C:\\fixture\\source", "C:\\fixture\\target"), code); assert.equal(renames, 0);
  }
});

test("unavailable native storage fails during availability before a candidate file is created", async () => {
  let creates = 0;
  const policy = new PrivateFilePolicy({ platform: "win32", io: { mkdir: async () => { creates++; } }, windows: async () => { throw Object.assign(new Error("fixture native API denied"), { code: "PRIVATE_FILE_UNAVAILABLE" }); } });
  await assert.rejects(policy.directory("C:\\fixture"), code); assert.equal(creates, 0);
});

test("private-file checks reject hard links even when the bytes and mode match", async t => {
  const folder = await directory(t), file = path.join(folder, "original"), link = path.join(folder, "linked"), policy = new PrivateFilePolicy();
  await policy.directory(folder); await writePrivate(policy, file, "public fixture"); await fs.link(file, link);
  await assert.rejects(policy.assertPrivate(file), code);
});

test("actual missing publication source never replaces an existing file", async t => {
  const folder = await directory(t), target = path.join(folder, "original"), policy = new PrivateFilePolicy();
  await policy.directory(folder); await writePrivate(policy, target, "preserve original");
  await assert.rejects(policy.replace(path.join(folder, "missing"), target)); assert.equal(await fs.readFile(target, "utf8"), "preserve original");
});

test("POSIX directory fsync failure after rename remains an explicit publication failure", async t => {
  // A simulated POSIX filesystem adapter is explicit; this runs on Windows too.
  const folder = await directory(t), source = path.join(folder, "candidate"), target = path.join(folder, "original");
  await fs.writeFile(source, "durable candidate", { mode: 0o600 }); let synced = false;
  const policy = new PrivateFilePolicy({ platform: "linux", io: { ...fs, open: async file => { assert.equal(file, folder); return { sync: async () => { synced = true; throw new Error("fixture directory fsync failed"); }, close: async () => {} }; } } });
  await assert.rejects(policy.replace(source, target), /directory fsync failed/); assert.equal(synced, true); assert.equal(await fs.readFile(target, "utf8"), "durable candidate");
});
