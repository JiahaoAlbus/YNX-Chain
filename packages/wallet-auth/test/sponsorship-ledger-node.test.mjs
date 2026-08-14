import assert from "node:assert/strict";
import { access, chmod, link, lstat, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { DurableSponsorshipAuthorizationLedger, recoverStaleSponsorshipStateLock } from "../src/sponsorship-ledger-node.js";
import { userOperationDigest, WalletAuthError } from "../src/index.js";
import { vector } from "./fixtures/sponsorship-vector.mjs";

const roots = [];
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

test("pre-ack SIGKILL leaves one durable sponsorship nonce and restart rejects replay", async () => {
  const root = await privateRoot();
  const statePath = join(root, "sponsorship-state.json");
  const child = spawn(process.execPath, [new URL("./fixtures/sponsorship-ledger-child.mjs", import.meta.url).pathname, statePath], { stdio: "ignore" });
  const result = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  assert.equal(result.signal === "SIGKILL" || result.code === 137, true);
  const ledger = new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 2 });
  assert.equal(ledger.size, 1);
  const initial = vector(); initial[1].userOperationDigest = userOperationDigest(initial[0]);
  assert.throws(() => ledger.authorize(...initial), walletError("SPONSORSHIP_REPLAY"));
  assert.equal(ledger.size, 1);
  const [operation, request, policy, binding, at] = vector(); request.userOperationDigest = userOperationDigest(operation);
  assert.equal(ledger.authorize(operation, { ...request, requestNonce: "07".repeat(32) }, policy, binding, at).eligible, true);
  assert.equal(ledger.size, 2);
  assert.throws(() => ledger.authorize(operation, { ...request, requestNonce: "08".repeat(32) }, policy, binding, at), walletError("SPONSORSHIP_LEDGER_FULL"));
  assert.equal(ledger.size, 2);
  const raw = await readFile(statePath, "utf8");
  assert.equal(`${JSON.stringify(JSON.parse(raw))}\n`, raw);
  assert.equal((await lstat(statePath)).mode & 0o777, 0o600);
});

test("durable ledger rejects symlink state without changing its target", async () => {
  const root = await privateRoot();
  const target = join(root, "target.json");
  const statePath = join(root, "sponsorship-state.json");
  await writeFile(target, "owner-data", { mode: 0o600 });
  await symlink(target, statePath);
  assert.throws(() => new DurableSponsorshipAuthorizationLedger({ statePath }), walletError("SPONSORSHIP_STATE_UNSAFE"));
  assert.equal(await readFile(target, "utf8"), "owner-data");
});

test("durable ledger rejects broad mode, hard links, noncanonical JSON and oversize state", async () => {
  for (const fixture of ["broad", "hardlink", "noncanonical", "oversize"]) {
    const root = await privateRoot();
    const statePath = join(root, "sponsorship-state.json");
    await writeFile(statePath, '{"consumed":[],"schemaVersion":1}\n', { mode: fixture === "broad" ? 0o644 : 0o600 });
    if (fixture === "hardlink") await link(statePath, join(root, "second-link.json"));
    if (fixture === "noncanonical") await writeFile(statePath, '{ "schemaVersion": 1, "consumed": [] }\n', { mode: 0o600 });
    if (fixture === "oversize") await truncate(statePath, 32 * 1024 * 1024 + 1);
    const code = fixture === "noncanonical" ? "SPONSORSHIP_STATE_INVALID" : fixture === "oversize" ? "SPONSORSHIP_STATE_TOO_LARGE" : "SPONSORSHIP_STATE_UNSAFE";
    assert.throws(() => new DurableSponsorshipAuthorizationLedger({ statePath }), walletError(code));
  }
});

test("independent processes preserve every distinct sponsorship nonce", async () => {
  const root = await privateRoot();
  const statePath = join(root, "sponsorship-state.json");
  new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 32 });
  const startPath = join(root, "start");
  const children = Array.from({ length: 8 }, (_, index) => {
    const readyPath = join(root, `ready-${index}`);
    const child = spawn(process.execPath, [new URL("./fixtures/sponsorship-ledger-concurrent-child.mjs", import.meta.url).pathname, statePath, String(index + 10), readyPath, startPath], { stdio: "ignore" });
    return { child, readyPath };
  });
  await Promise.all(children.map(({ readyPath }) => waitFor(readyPath)));
  await writeFile(startPath, "go", { mode: 0o600 });
  const results = await Promise.all(children.map(({ child }) => new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })))));
  assert.deepEqual(results, Array.from({ length: 8 }, () => ({ code: 0, signal: null })));
  const restarted = new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 32 });
  assert.equal(restarted.size, 8);
});

test("independent processes produce exactly one winner for the same sponsorship nonce", async () => {
  const root = await privateRoot();
  const statePath = join(root, "sponsorship-state.json");
  new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 32 });
  const startPath = join(root, "start");
  const children = Array.from({ length: 8 }, (_, index) => {
    const readyPath = join(root, `ready-${index}`);
    const child = spawn(process.execPath, [new URL("./fixtures/sponsorship-ledger-concurrent-child.mjs", import.meta.url).pathname, statePath, "42", readyPath, startPath], { stdio: "ignore" });
    return { child, readyPath };
  });
  await Promise.all(children.map(({ readyPath }) => waitFor(readyPath)));
  await writeFile(startPath, "go", { mode: 0o600 });
  const results = await Promise.all(children.map(({ child }) => new Promise((resolve) => child.once("exit", (code) => resolve(code)))));
  assert.equal(results.filter((code) => code === 0).length, 1);
  assert.equal(results.filter((code) => code === 1).length, 7);
  assert.equal(new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 32 }).size, 1);
});

test("dead-owner stale lock requires explicit age-gated recovery with unchanged replay state", async () => {
  const root = await privateRoot();
  const statePath = join(root, "sponsorship-state.json");
  const ledger = new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 8 });
  const [operation, request, policy, binding, at] = vector(); request.userOperationDigest = userOperationDigest(operation);
  ledger.authorize(operation, request, policy, binding, at);
  const before = await readFile(statePath, "utf8");
  const readyPath = join(root, "stale-ready");
  const child = spawn(process.execPath, [new URL("./fixtures/sponsorship-ledger-stale-lock-child.mjs", import.meta.url).pathname, statePath, readyPath], { stdio: "ignore" });
  await waitFor(readyPath);
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  assert.throws(() => recoverStaleSponsorshipStateLock(statePath, { minimumAgeMs: 5_000 }), walletError("SPONSORSHIP_STALE_LOCK_TOO_YOUNG"));
  assert.throws(() => new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 8 }), walletError("SPONSORSHIP_STATE_LOCKED"));
  const recovered = recoverStaleSponsorshipStateLock(statePath, { minimumAgeMs: 250 });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.ownerPid, child.pid);
  assert.equal(await readFile(statePath, "utf8"), before);
  const restarted = new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 8 });
  assert.throws(() => restarted.authorize(operation, request, policy, binding, at), walletError("SPONSORSHIP_REPLAY"));
});

test("stale-lock recovery rejects a live or PID-reused owner without touching state", async () => {
  const root = await privateRoot();
  const statePath = join(root, "sponsorship-state.json");
  new DurableSponsorshipAuthorizationLedger({ statePath });
  const before = await readFile(statePath, "utf8");
  const lock = { acquiredAt: new Date(Date.now() - 60_000).toISOString(), pid: process.pid, schemaVersion: 1, token: "00000000-0000-4000-8000-000000000000" };
  await writeFile(`${statePath}.lock`, `${JSON.stringify(lock)}\n`, { mode: 0o600 });
  assert.throws(() => recoverStaleSponsorshipStateLock(statePath, { minimumAgeMs: 250 }), walletError("SPONSORSHIP_STALE_LOCK_OWNER_ALIVE"));
  assert.equal(await readFile(statePath, "utf8"), before);
  assert.equal((await lstat(`${statePath}.lock`)).isFile(), true);
});

test("packaged stale-lock CLI emits canonical redacted errors and recovers one dead owner", async () => {
  const script = fileURLToPath(new URL("../scripts/ynx-wallet-sponsorship-state-lock.mjs", import.meta.url));
  const missing = spawnSync(process.execPath, [script, "recover"], { encoding: "utf8", env: {} });
  assert.equal(missing.status, 2);
  assert.equal(missing.stdout, "");
  assert.deepEqual(JSON.parse(missing.stderr), { error: { code: "MISSING_ENVIRONMENT", message: "YNX_WALLET_SPONSORSHIP_STATE_PATH is required" }, ok: false });
  assert.equal(`${JSON.stringify(JSON.parse(missing.stderr))}\n`, missing.stderr);
  assert.doesNotMatch(missing.stderr, /(?:\/private\/|\.mjs:\d+|\n\s+at )/);

  const root = await privateRoot();
  const statePath = join(root, "sponsorship-state.json");
  new DurableSponsorshipAuthorizationLedger({ statePath });
  const before = await readFile(statePath, "utf8");
  const readyPath = join(root, "cli-ready");
  const child = spawn(process.execPath, [new URL("./fixtures/sponsorship-ledger-stale-lock-child.mjs", import.meta.url).pathname, statePath, readyPath], { stdio: "ignore" });
  await waitFor(readyPath);
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  const tooYoung = spawnSync(process.execPath, [script, "recover"], { encoding: "utf8", env: { YNX_WALLET_SPONSORSHIP_LOCK_MINIMUM_AGE_MS: "5000", YNX_WALLET_SPONSORSHIP_STATE_PATH: statePath } });
  assert.equal(tooYoung.status, 2);
  assert.equal(JSON.parse(tooYoung.stderr).error.code, "SPONSORSHIP_STALE_LOCK_TOO_YOUNG");
  assert.doesNotMatch(tooYoung.stderr, new RegExp(root));
  await new Promise((resolve) => setTimeout(resolve, 275));
  const recovered = spawnSync(process.execPath, [script, "recover"], { encoding: "utf8", env: { YNX_WALLET_SPONSORSHIP_LOCK_MINIMUM_AGE_MS: "250", YNX_WALLET_SPONSORSHIP_STATE_PATH: statePath } });
  assert.equal(recovered.status, 0);
  assert.equal(recovered.stderr, "");
  const output = JSON.parse(recovered.stdout);
  assert.deepEqual(Object.keys(output).sort(), ["ageMs", "ownerPid", "recovered"]);
  assert.equal(output.recovered, true);
  assert.equal(output.ownerPid, child.pid);
  assert.equal(`${JSON.stringify(output)}\n`, recovered.stdout);
  assert.doesNotMatch(recovered.stdout, new RegExp(root));
  assert.equal(await readFile(statePath, "utf8"), before);
});

async function privateRoot() { const root = await mkdtemp(join(tmpdir(), "ynx-sponsorship-ledger-")); roots.push(root); await chmod(root, 0o700); return realpath(root); }
async function waitFor(path) { for (let attempt = 0; attempt < 500; attempt += 1) { try { await access(path); return; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); } } throw new Error("child readiness timeout"); }
function walletError(code) { return (error) => error instanceof WalletAuthError && error.code === code; }
