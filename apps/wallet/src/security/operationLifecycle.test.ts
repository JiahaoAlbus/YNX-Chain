import assert from "node:assert/strict";
import {test} from "node:test";
import {WalletOperationLifecycle, WalletOperationCancelled} from "./operationLifecycle";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return {promise, resolve}; }
function unlocked() { const lifecycle = new WalletOperationLifecycle(); lifecycle.setAccount("account-one"); const lease = lifecycle.scope().begin({requireUnlocked: false}); lifecycle.unlock(lease); lease.finish(); return lifecycle; }

test("background, lock, switch and modal close prevent late unlock success", async () => {
  for (const cancel of [(_: WalletOperationLifecycle, scope: ReturnType<WalletOperationLifecycle["scope"]>) => scope.cancel(), (lifecycle: WalletOperationLifecycle) => lifecycle.lock(), (lifecycle: WalletOperationLifecycle) => lifecycle.setAppState("background"), (lifecycle: WalletOperationLifecycle) => lifecycle.setAccount("account-two")]) {
    const lifecycle = new WalletOperationLifecycle(); lifecycle.setAccount("account-one"); const scope = lifecycle.scope(), lease = scope.begin({requireUnlocked: false}), auth = deferred<void>();
    const operation = lease.step(() => auth.promise).then(() => lifecycle.unlock(lease)); cancel(lifecycle, scope); auth.resolve();
    await assert.rejects(operation, WalletOperationCancelled); assert.equal(lifecycle.isUnlocked(), false);
  }
});

test("every awaited send stage is cancelled before the next secret, signature or broadcast", async () => {
  for (const cancelAt of ["authorize", "account", "secret", "broadcast"]) {
    const lifecycle = unlocked(), lease = lifecycle.scope().begin(), waiting = deferred<void>(), calls: string[] = [];
    const step = async (name: string) => { calls.push(name); if (name === cancelAt) await waiting.promise; };
    const operation = (async () => {
      await lease.step(() => step("authorize")); await lease.step(() => step("account"));
      const signed = await lease.withSecret(async () => { await step("secret"); return "public-test-material"; }, () => { calls.push("sign"); return "fixture-payload"; });
      await lease.step(() => step("broadcast")); return signed;
    })();
    while (!calls.includes(cancelAt)) await Promise.resolve(); lifecycle.lock(); waiting.resolve();
    await assert.rejects(operation, WalletOperationCancelled);
    if (cancelAt !== "broadcast") assert.equal(calls.includes("broadcast"), false);
    if (["authorize", "account", "secret"].includes(cancelAt)) assert.equal(calls.includes("sign"), false);
  }
});

test("modal reopen cannot inherit an old completion and duplicate submission is rejected", async () => {
  const lifecycle = unlocked(), scope = lifecycle.scope(), old = scope.begin(); assert.throws(() => scope.begin(), /already/);
  scope.cancel(); const next = scope.begin(); old.finish(); next.assert(); assert.throws(old.assert, WalletOperationCancelled); next.finish();
});

test("temporary biometric inactivity cannot complete until active; background never revives", () => {
  const lifecycle = unlocked(), lease = lifecycle.scope().begin(); lifecycle.setAppState("inactive"); assert.throws(lease.assert, WalletOperationCancelled);
  lifecycle.setAppState("active"); lease.assert(); lifecycle.setAppState("background"); lifecycle.setAppState("active"); assert.throws(lease.assert, WalletOperationCancelled);
});

test("expired leases and recovery display lifetimes cannot reveal a late secret", async () => {
  let now = 0; const lifecycle = new WalletOperationLifecycle(() => now); lifecycle.setAccount("one"); const lease = lifecycle.scope().begin({requireUnlocked:false,ttlMs:60_000}), waiting = deferred<string>(); let shown = false;
  const operation = lease.withSecret(() => waiting.promise, () => { shown = true; }); now = 60_000; waiting.resolve("public-test-material"); await assert.rejects(operation, WalletOperationCancelled); assert.equal(shown, false);
});

test("held import material is unavailable immediately after lock, modal close or completion", () => {
  for (const cancel of ["lock", "close", "complete"]) {
    const lifecycle = unlocked(), scope = lifecycle.scope(), lease = scope.begin(), material = lease.holdSecret("public-test-material");
    assert.equal(material.read(), "public-test-material");
    if (cancel === "lock") lifecycle.lock(); else if (cancel === "close") scope.cancel(); else lease.finish();
    assert.throws(material.read, WalletOperationCancelled);
  }
});
