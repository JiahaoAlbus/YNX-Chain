import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const exec = promisify(execFile);
test("native app snapshot survives separate processes, is private, and preserves corrupt input", { skip: process.platform !== "darwin", timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-workspace-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "storage-proof"), record = join(root, "profile", "workspace-ui", "project-v1.json");
  await exec("/usr/bin/clang", ["-fobjc-arc", `-fmodules-cache-path=${root}/module-cache`, fileURLToPath(new URL("./fixtures/macos-workspace-storage.m", import.meta.url)), "-o", executable, "-framework", "Cocoa", "-framework", "Security", "-framework", "WebKit"], { timeout: 45000 });
  await exec(executable, ["write", record]);
  await exec(executable, ["read", record]);
  const valid = await readFile(record, "utf8");
  assert.equal(JSON.parse(valid).project.id, "same-project-id");
  assert.equal(JSON.parse(valid).project.walletSession, undefined);
  await writeFile(record, "invalid existing recovery record", { mode: 0o600 });
  await exec(executable, ["corrupt", record]);
  assert.equal(await readFile(record, "utf8"), "invalid existing recovery record");
});
