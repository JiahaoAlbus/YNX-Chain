import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { FaucetFlow, faucetStatusCopy, productionFaucetConfiguration, type FaucetConfiguration } from "./faucetFlow";
import { WalletOperationLifecycle } from "../security/operationLifecycle";
import { SecureStorageHealth, STORAGE_WRITE_UNCERTAIN } from "../storage/secureStorageHealth";
import { FaucetClaimController, FAUCET_REQUEST_MODEL, type FaucetClaimRPC } from "../chain/faucetClaim";
import { faucetAdmissionHash, type FaucetAdmissionTransport } from "../chain/faucetAdmission";
import { NATIVE_FAUCET_AUTHORITY, NATIVE_FAUCET_CHAIN_ORIGIN } from "../chain/faucetNativeSession";
import { NATIVE_DURABILITY_MODEL } from "../chain/nativeDurability";

// Synthetic public identifiers and in-memory transport only. No keys, accounts
// on a node, biometric prompts, HTTP, native dispatch or production activation.
const address = "0x" + "29".repeat(20), account = ynxAddressFromEVM(address);
const scope = { authority: NATIVE_FAUCET_AUTHORITY, chainId: "0x1917" as const, recipient: account };
const actions = ["review", "submit", "check", "complete"] as const;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function durable(hash: string) { return { version: NATIVE_DURABILITY_MODEL.version, scope: "local-snapshot", status: "durable", transactionHash: hash,
  blockNumber: "0x1", blockHash: "0x" + "ab".repeat(32), checkpointBlockNumber: "0x1", checkpointBlockHash: "0x" + "ab".repeat(32), snapshotIntegrity: "0x" + "cd".repeat(32) }; }
function accepted(r: Parameters<FaucetAdmissionTransport>[0]) {
  const original = JSON.parse(r.body), hash = faucetAdmissionHash(r.requestId);
  return { url: r.url, redirected: false, status: 201, contentType: "application/json", cacheControl: "no-store", body: JSON.stringify({
    transaction: { hash, type: "faucet", from: "ynx_faucet", to: address, amount: original.amount, fee: 0, nonce: 0 },
    address, amount: original.amount, nativeSymbol: "YNXT", requestId: r.requestId, truthfulStatus: "rpc-backed-faucet", transactionHash: hash, status: "accepted" }) };
}
function fixture(t: TestContext, enabled = true) {
  const operations = new WalletOperationLifecycle(), health = new SecureStorageHealth(), rows = new Map<string, string>();
  operations.setAccount(account); const lease = operations.scope().begin({ requireUnlocked: false }); operations.unlock(lease); lease.finish();
  const counts = { get: 0, set: 0, delete: 0, entropy: 0, session: 0, rpc: 0 }, signals: AbortSignal[] = [], posts: Parameters<FaucetAdmissionTransport>[0][] = [];
  const hooks: { get?: () => Promise<void>; set?: (key: string, value: string) => Promise<void>; random?: () => Promise<Uint8Array>;
    post?: FaucetAdmissionTransport; rpc?: FaucetClaimRPC["request"]; nullSession?: boolean } = {};
  const storage = { async getItem(key: string) { counts.get++; await hooks.get?.(); return rows.get(key) ?? null; },
    async setItem(key: string, value: string) { counts.set++; await hooks.set?.(key, value); rows.set(key, value); },
    async deleteItem() { counts.delete++; throw Error("Faucet must retain journals"); } };
  const rpc: FaucetClaimRPC = { origin: NATIVE_FAUCET_CHAIN_ORIGIN, async request(method, params) {
    counts.rpc++; if (hooks.rpc) return hooks.rpc(method, params);
    if (method === "eth_chainId") return "0x1917";
    if (method === "ynx_getFaucetModel") return FAUCET_REQUEST_MODEL;
    if (method === "ynx_getDurabilityModel") return NATIVE_DURABILITY_MODEL;
    if (method === "ynx_getTransactionDurability") return durable(params[0]!);
    return { transactionHash: params[0], from: "ynx_faucet", to: address, status: "0x1", contractAddress: null,
      transactionIndex: "0x0", blockNumber: "0x1", blockHash: "0x" + "ab".repeat(32), ynxDurability: durable(params[0]!),
      ynxNativeTransaction: { type: "faucet", amountYNXT: "100", feeYNXT: "0", nonce: "0x0" } };
  } };
  const transport: FaucetAdmissionTransport = async r => { posts.push(r); return hooks.post ? hooks.post(r) : accepted(r); };
  const config: FaucetConfiguration = { amount: 100, createSession(signal) { counts.session++; signals.push(signal); return hooks.nullSession ? null : { rpc, transport }; } };
  const make = (configuration: FaucetConfiguration | null = enabled ? config : productionFaucetConfiguration()) => {
    const flow = new FaucetFlow({ account, operations, health, storage, configuration,
      async randomBytesAsync() { counts.entropy++; return hooks.random ? hooks.random() : new Uint8Array(32).fill(counts.entropy); } });
    const detach = flow.attach(); t.after(detach); return flow;
  };
  const local = new FaucetClaimController(storage, scope, NATIVE_FAUCET_CHAIN_ORIGIN, { randomBytes: n => new Uint8Array(n).fill(71), rpc, transport });
  return { flow: make(), make, config, counts, hooks, rows, storage, operations, health, signals, posts, local };
}

test("production-off open/reopen and direct repeated handlers never create an intent or session", async t => {
  const f = fixture(t, false); assert.equal(productionFaucetConfiguration(), null);
  for (let i = 0; i < 3; i++) {
    await f.flow.load(); assert.equal(f.flow.snapshot().phase, "ready"); assert.equal(f.flow.snapshot().view?.entry, null);
    await Promise.all(actions.flatMap(a => [f.flow.act(a), f.flow.act(a)])); f.flow.cancel();
  }
  assert.ok(f.counts.get > 0);
  assert.deepEqual({ ...f.counts, get: 0 }, { get: 0, set: 0, delete: 0, entropy: 0, session: 0, rpc: 0 });
  assert.equal(f.posts.length, 0); assert.equal(f.rows.size, 0);
});
test("production-off reads an original request without changing any bytes", async t => {
  const f = fixture(t, false), original = (await f.local.prepare(100, () => {})).entry!;
  const before = [...f.rows]; f.counts.set = 0; await f.flow.load();
  assert.deepEqual(f.flow.snapshot().view?.entry, original);
  for (const action of actions) await f.flow.act(action);
  f.flow.cancel(); await f.flow.load();
  assert.deepEqual([...f.rows], before); assert.equal(f.counts.set, 0); assert.equal(f.counts.entropy, 0); assert.equal(f.counts.session, 0);
});
test("an unavailable actual session is checked before entropy or persistence", async t => {
  const f = fixture(t); f.hooks.nullSession = true; await f.flow.load(); await f.flow.act("review");
  assert.equal(f.flow.snapshot().available, false); assert.equal(f.flow.snapshot().error, "unavailable");
  assert.equal(f.counts.entropy, 0); assert.equal(f.counts.set, 0); assert.equal(f.counts.rpc, 0); assert.equal(f.signals[0]?.aborted, true);
});
test("explicit review, submit, receipt check and completion remain separate actions", async t => {
  const f = fixture(t); await f.flow.load(); await f.flow.act("review");
  const entry = f.flow.snapshot().view!.entry!;
  assert.equal(entry.phase, "prepared"); assert.equal(f.counts.rpc, 0); assert.equal(f.posts.length, 0);
  await f.flow.act("check"); await f.flow.act("complete"); assert.equal(f.counts.rpc, 0);
  await f.flow.act("submit"); assert.equal(f.posts.length, 1); assert.equal(f.flow.allowed("complete"), false);
  assert.equal(faucetStatusCopy(f.flow.snapshot().view!).title, "Request received");
  await f.flow.act("check"); assert.equal(faucetStatusCopy(f.flow.snapshot().view!).title, "Block receipt checked");
  assert.equal(f.flow.allowed("complete"), true); assert.equal(f.flow.snapshot().view!.balanceVerified, false);
  const reads = f.counts.rpc; await f.flow.act("complete"); assert.ok(f.counts.rpc > reads);
  assert.equal(f.flow.snapshot().view!.entry, null); assert.deepEqual(f.flow.snapshot().view!.completedRequestIds, [entry.requestId]);
  assert.equal(f.counts.entropy, 1); assert.equal(f.counts.delete, 0); assert.equal(f.posts.length, 1);
  assert.equal(new Set(f.signals).size, 4); assert.ok(f.signals.every(s => s.aborted));
});
test("same-tick repeated Review consumes one random buffer, and clears it after use", async t => {
  const f = fixture(t), bytes = new Uint8Array(32).fill(39); f.hooks.random = async () => bytes;
  await f.flow.load(); await Promise.all([f.flow.act("review"), f.flow.act("review")]);
  assert.equal(f.counts.entropy, 1); assert.equal(f.counts.set, 1); assert.ok(bytes.every(b => b === 0));
  assert.equal(f.flow.snapshot().view!.entry!.requestId, "wallet_" + "27".repeat(32));
});
for (const mode of ["close", "lock", "account", "health"]) test(`${mode} during entropy wait cancels and zeroes late bytes without prepare`, async t => {
  const f = fixture(t), ready = deferred<void>(), random = deferred<Uint8Array>();
  f.hooks.random = () => { ready.resolve(); return random.promise; };
  await f.flow.load(); const pending = f.flow.act("review"); await ready.promise;
  if (mode === "close") f.flow.cancel();
  if (mode === "lock") f.operations.lock();
  if (mode === "account") f.operations.setAccount(ynxAddressFromEVM("0x" + "30".repeat(20)));
  if (mode === "health") f.health.observe({ code: STORAGE_WRITE_UNCERTAIN });
  const bytes = new Uint8Array(32).fill(43); random.resolve(bytes); await pending;
  assert.ok(bytes.every(b => b === 0)); assert.equal(f.counts.set, 0); assert.equal(f.counts.rpc, 0);
  assert.equal(f.flow.snapshot().phase, "paused"); assert.equal(f.signals[0]?.aborted, true);
});
test("an old finally cannot clear the new local-read busy owner", async t => {
  const f = fixture(t), start = deferred<void>(), entropy = deferred<Uint8Array>();
  f.hooks.random = () => { start.resolve(); return entropy.promise; };
  await f.flow.load(); const old = f.flow.act("review"); await start.promise; f.flow.cancel();
  const reading = deferred<void>(), read = deferred<void>(); f.hooks.get = () => { reading.resolve(); return read.promise; };
  const next = f.flow.load(); await reading.promise; entropy.resolve(new Uint8Array(32)); await old;
  assert.equal(f.flow.snapshot().busy, "read"); assert.equal(f.flow.snapshot().phase, "loading");
  read.resolve(); await next; assert.equal(f.flow.snapshot().phase, "ready");
});
for (const moment of ["busy", "loading"]) test(`a synchronous ${moment} subscriber cancellation cannot revive loading or read storage`, async t => {
  const f = fixture(t);
  const remove = f.flow.subscribe(() => {
    const value = f.flow.snapshot();
    if (value.busy === "read" && (moment === "busy" || value.phase === "loading")) f.flow.cancel();
  });
  await f.flow.load(); remove();
  assert.equal(f.flow.snapshot().phase, "paused"); assert.equal(f.counts.get, 0);
});
test("a synchronous old abort listener cannot clear a newer loading state", async t => {
  const f = fixture(t), entropy = deferred<Uint8Array>(), start = deferred<void>(), read = deferred<void>();
  f.hooks.random = () => { start.resolve(); return entropy.promise; };
  await f.flow.load(); const old = f.flow.act("review"); await start.promise;
  f.hooks.get = () => read.promise; let next: Promise<void> | undefined;
  f.signals[0]!.addEventListener("abort", () => { next = f.flow.load(); }, { once: true });
  f.flow.cancel(); assert.equal(f.flow.snapshot().busy, "read"); assert.equal(f.flow.snapshot().phase, "loading");
  entropy.resolve(new Uint8Array(32)); await old; assert.equal(f.flow.snapshot().busy, "read");
  read.resolve(); await next; assert.equal(f.flow.snapshot().phase, "ready");
});
test("cancellation during original marker persistence retains it and stops POST", async t => {
  const f = fixture(t); await f.flow.load(); await f.flow.act("review"); const original = f.flow.snapshot().view!.entry!;
  f.hooks.set = async (_key, value) => { if (JSON.parse(value).entries?.[0]?.phase === "unknown") f.flow.cancel(); };
  await f.flow.act("submit"); assert.equal(f.posts.length, 0); assert.equal(f.flow.snapshot().phase, "paused");
  f.hooks.set = undefined; await f.flow.load(); assert.equal(f.flow.snapshot().view!.entry!.phase, "unknown");
  assert.equal(f.flow.snapshot().view!.entry!.body, original.body);
});
test("lost response and restart retry only the original body, even after configured amount changes", async t => {
  const f = fixture(t); await f.flow.load(); await f.flow.act("review"); const original = f.flow.snapshot().view!.entry!;
  f.hooks.post = async () => { throw Error("synthetic lost response"); }; await f.flow.act("submit");
  assert.equal(f.flow.snapshot().view!.entry!.phase, "unknown"); assert.equal(f.flow.allowed("check"), false);
  f.flow.cancel(); const restored = f.make({ ...f.config, amount: 50 }); await restored.load(); f.hooks.post = undefined;
  await restored.act("submit"); assert.deepEqual(f.posts.map(p => p.body), [original.body, original.body]); assert.equal(f.counts.entropy, 1);
});
for (const status of ["request_id_conflict", "stored_receipt_invalid", "rate_limited", "transaction_result_uncertain"]) test(`${status} applies handler-level original retry policy`, async t => {
  const f = fixture(t); await f.flow.load(); await f.flow.act("review");
  f.hooks.post = async r => ({ ...accepted(r), status: status === "request_id_conflict" ? 409 : status === "rate_limited" ? 429 : 503,
    body: JSON.stringify({ error: "synthetic", requestId: r.requestId, transactionHash: faucetAdmissionHash(r.requestId), status,
      retrySameRequest: status !== "request_id_conflict" && status !== "stored_receipt_invalid" }) });
  await f.flow.act("submit"); assert.equal(f.flow.snapshot().view!.entry!.lastResult, status);
  const blocked = status === "request_id_conflict" || status === "stored_receipt_invalid";
  assert.equal(f.flow.allowed("submit"), !blocked); await f.flow.act("submit"); assert.equal(f.posts.length, blocked ? 1 : 2);
  assert.equal(f.flow.allowed("check"), false); assert.equal(f.counts.entropy, 1);
});
test("a saved receipt snapshot does not enable completion or show current success", async t => {
  const f = fixture(t); await f.flow.load(); await f.flow.act("review"); await f.flow.act("submit"); await f.flow.act("check");
  f.flow.cancel(); await f.flow.load(); assert.equal(f.flow.snapshot().view!.verification, "stored-snapshot");
  assert.equal(faucetStatusCopy(f.flow.snapshot().view!).title, "Saved receipt copy — check again");
  const before = f.counts.rpc; await f.flow.act("complete"); assert.equal(f.counts.rpc, before);
});
test("new checks demote previous proof while pending, and changed node status cannot complete", async t => {
  const f = fixture(t); await f.flow.load(); await f.flow.act("review"); await f.flow.act("submit"); await f.flow.act("check");
  const start = deferred<void>(), finish = deferred<void>();
  f.hooks.rpc = async (method, params) => {
    if (method === "eth_chainId") { start.resolve(); await finish.promise; return "0x1917"; }
    if (method === "ynx_getFaucetModel") return FAUCET_REQUEST_MODEL;
    if (method === "ynx_getDurabilityModel") return NATIVE_DURABILITY_MODEL;
    return { version: NATIVE_DURABILITY_MODEL.version, scope: "local-snapshot", status: "not_found", transactionHash: params[0] };
  };
  const pending = f.flow.act("check"); await start.promise;
  assert.equal(f.flow.snapshot().view!.verification, "stored-snapshot"); finish.resolve(); await pending;
  assert.ok(f.flow.snapshot().view!.evidence); assert.equal(f.flow.snapshot().view!.verification, "unverified");
  assert.equal(f.flow.allowed("complete"), false); assert.equal(faucetStatusCopy(f.flow.snapshot().view!).title, "Result not confirmed");
});
test("read failure disables all actions and cannot appear as an empty history", async t => {
  const f = fixture(t); f.hooks.get = async () => { throw Error("synthetic read failure"); };
  await f.flow.load(); assert.equal(f.flow.snapshot().phase, "failed"); assert.equal(f.flow.snapshot().error, "read");
  for (const action of actions) { assert.equal(f.flow.allowed(action), false); await f.flow.act(action); }
  assert.equal(f.counts.set, 0); assert.equal(f.counts.session, 0); assert.equal(f.counts.entropy, 0);
});
test("persistence failure never restores an earlier UI or re-reads under quarantine", async t => {
  for (const quarantine of [false, true]) {
    const f = fixture(t); await f.flow.load(); let atFailure = 0;
    f.hooks.set = async () => { atFailure = f.counts.get; if (quarantine) f.health.observe({ code: STORAGE_WRITE_UNCERTAIN }); throw Error("synthetic disk fault"); };
    await f.flow.act("review");
    assert.equal(f.flow.snapshot().phase, quarantine ? "paused" : "failed"); assert.equal(f.flow.snapshot().view, null);
    assert.equal(f.counts.get, atFailure); assert.equal(f.counts.delete, 0); assert.equal(f.posts.length, 0);
  }
});
