import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

// Execute the actual entrypoint through the first profile-dependent expression.
// A disabled sandbox must exit before this boundary, including an auto-injected
// launcher flag; the ordinary path must force sandboxing before reaching it.
const source = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
const prefix = source.slice(0, source.indexOf("function handleWalletIPC"))
  .replace(/^import .*;\n/gm, "")
  .replace("path.dirname(fileURLToPath(import.meta.url))", "selectProfileBoundary()");

test("actual startup refuses disabled sandbox before any Wallet setup", () => {
  const events = [], exited = new Error("native exit");
  assert.throws(() => runInNewContext(prefix, {
    app: { commandLine: { hasSwitch(name) { assert.equal(name, "no-sandbox"); return true; } },
      exit(code) { events.push(["exit", code]); throw exited; }, enableSandbox() { events.push(["enable"]); } },
    console: { error(message) { assert.match(message, /^YNX_WALLET_SANDBOX_REQUIRED:/); } },
    selectProfileBoundary() { events.push(["wallet-setup"]); }
  }), error => error === exited);
  assert.deepEqual(events, [["exit", 78]]);
});

test("a returning or failed exit cannot accidentally continue without sandbox", () => {
  let enabled = false, setup = false;
  assert.throws(() => runInNewContext(prefix, {
    app: { commandLine: { hasSwitch: () => true }, exit() {}, enableSandbox() { enabled = true; } },
    console: { error() {} }, selectProfileBoundary() { setup = true; }
  }), /YNX_WALLET_SANDBOX_REQUIRED/);
  assert.equal(enabled, false); assert.equal(setup, false);
});

test("normal startup forces sandbox before selecting a profile", () => {
  const events = [];
  runInNewContext(prefix, {
    app: { commandLine: { hasSwitch: () => false }, exit() { assert.fail("unexpected exit"); },
      enableSandbox() { events.push("sandbox"); } },
    selectProfileBoundary() { events.push("wallet-setup"); return "/synthetic"; }
  });
  assert.deepEqual(events, ["sandbox", "wallet-setup"]);
});
