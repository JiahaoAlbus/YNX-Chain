import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

test("native window precedes recovery and Workbench cannot mount before successful snapshot read", async () => {
  const source = await readFile(new URL("../desktop/macos/main.m", import.meta.url), "utf8");
  const launch = source.slice(source.indexOf("- (void)applicationDidFinishLaunching:"), source.indexOf("- (void)beginWorkspaceRestore"));
  assert.ok(launch.indexOf("makeKeyAndOrderFront") < launch.indexOf("[self beginWorkspaceRestore]"));
  assert.doesNotMatch(launch, /YNXReadWorkspaceSnapshot|launchServer/);
  assert.match(source, /if\(!_workspaceBridge\.restoreComplete\)return;/);
  assert.match(source, /if\(!_restoreComplete \|\| _restoring \|\| _readError\)/);
  assert.match(source, /if\(error\)\{\[self showWorkspaceRestoreIssue:NO\];return;\}/);
  assert.match(source, /10\*NSEC_PER_SEC/);
  assert.match(source, /Keep Waiting/);
  assert.match(source, /Try Again/);
});

test("blocked file recovery leaves the native main queue responsive and cannot overwrite saved data", { skip: process.platform !== "darwin", timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-async-recovery-"));t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "async-recovery-proof"), exec = promisify(execFile);
  await exec("/usr/bin/clang", ["-fobjc-arc", "-mmacosx-version-min=13.5", "-Werror=unguarded-availability", "-Werror=unguarded-availability-new", `-fmodules-cache-path=${root}/module-cache`, fileURLToPath(new URL("./fixtures/macos-async-recovery.m", import.meta.url)), "-o", binary, "-framework", "Cocoa", "-framework", "Security", "-framework", "WebKit"], { timeout: 45000 });
  const { stdout } = await exec(binary, [join(root, "support")], { timeout: 8000 });
  assert.match(stdout, /pending\/failed reads reject writes/);
  assert.match(stdout, /late restore and serialized save preserve the project/);
});
