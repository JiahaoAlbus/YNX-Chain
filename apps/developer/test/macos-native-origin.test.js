import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import test from "node:test";

test("all native message, injection and asynchronous reply paths bind to the owning local webview", async () => {
  const source = await readFile(new URL("../desktop/macos/main.m", import.meta.url), "utf8");
  assert.equal((source.match(/if\(!YNXTrustedMessage\(message,_webView,_port\)/g) || []).length, 2);
  assert.match(source, /message\.webView==webView/);
  assert.match(source, /frame\.mainFrame/);
  assert.match(source, /origin\.port==port/);
  for (const script of ["script", "availabilityScript", "workspaceScript"]) assert.ok(source.includes(`initWithSource:YNXOriginBoundScript(${script},_port)`));
  assert.equal((source.match(/evaluateJavaScript:/g) || []).length, 1, "all delayed evaluations must use the origin-guarded helper");
  assert.match(source, /evaluateJavaScript:YNXOriginBoundScript\(source,port\)/);
  assert.match(source, /_webView\.navigationDelegate=self/);
  assert.equal((source.match(/view!=_webView \|\| !\[self trustedFrame:frame\]/g) || []).length, 4);
});

test("compiled native handlers reject foreign messages before payload/OS access and delayed JS replies reject navigation", { skip: process.platform !== "darwin", timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-native-origin-"));t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "native-origin-proof"), exec = promisify(execFile);
  await exec("/usr/bin/clang", ["-fobjc-arc", "-mmacosx-version-min=13.5", "-Werror=unguarded-availability", "-Werror=unguarded-availability-new", `-fmodules-cache-path=${root}/module-cache`, fileURLToPath(new URL("./fixtures/macos-native-origin.m", import.meta.url)), "-o", binary, "-framework", "Cocoa", "-framework", "Security", "-framework", "WebKit"], { timeout: 45000 });
  const { stdout } = await exec(binary, [], { timeout: 8000 });
  assert.match(stdout, /Rejected 72 foreign-origin\/frame\/view\/name messages before payload access/);
  assert.match(stdout, /Rejected 138 malformed body\/action\/job\/payload messages before native effects/);
  const script = stdout.match(/^BOUND_SCRIPT:(.+)$/m)?.[1];assert.ok(script);
  for (const origin of ["https://foreign.example", "http://127.0.0.1:4178", "null"]) {
    const sandbox = { location: { origin } };runInNewContext(script, sandbox);assert.equal(sandbox.delivered, undefined);
  }
  const trusted = { location: { origin: "http://127.0.0.1:4177" } };runInNewContext(script, trusted);assert.equal(trusted.delivered, 1);
});
