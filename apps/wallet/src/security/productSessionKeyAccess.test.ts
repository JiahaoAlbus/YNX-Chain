import assert from "node:assert/strict";
import test from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { createProductSessionRequest, encodeProductSessionWalletURL, parseProductSessionReturnURL, walletIdentity } from "@ynx-chain/wallet-auth";
import { ProductSessionController, PRODUCT_SESSION_REPLAY_KEY } from "../protocol/productSessionController";
import { PRODUCT_SESSION_REGISTRY as registry } from "../protocol/registry";
import { createPlatformSecureStorage, AUTHENTICATED_SECRET_SERVICE, type NativeSecureStore } from "../storage/secureStoragePolicy";
import { WalletRepository, MANIFEST_KEY } from "../storage/walletRepository";
import { WalletOperationLifecycle } from "./operationLifecycle";
import { createProductSessionKeyAccess } from "./productSessionKeyAccess";

// Synthetic module fixtures only. The adapter models OS cancellation; these
// counts do not claim that a device prompt or hardware keystore was exercised.
const SECRET = "0".repeat(63) + "1";
const identity = walletIdentity(SECRET);
const AUTH_KEY = `ynx.wallet.account.auth.v3.${identity.account}`;
const LEGACY_KEY = `ynx.wallet.account.v2.${identity.account}`;
const PROTECTION_KEY = `ynx.wallet.protection.v1.${identity.account}`;
const NOW = Date.parse("2026-09-06T00:00:00.000Z");
type Event = { method: "get" | "set" | "delete"; key: string; authenticated: boolean };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

async function fixture(legacy = false) {
  const values = new Map<string, string>();
  const events: Event[] = [];
  const state = {
    now: NOW, checks: 0, legacyAuthorizations: 0, failLegacy: false, failOpen: false,
    opens: [] as string[], audits: [] as string[],
    before: null as ((event: Event) => Promise<void>) | null,
    after: null as ((event: Event) => Promise<void>) | null,
    auditGate: null as ReturnType<typeof deferred> | null,
    auditStarted: null as ReturnType<typeof deferred> | null,
  };
  const event = async (method: Event["method"], key: string, options: Parameters<NativeSecureStore["getItemAsync"]>[1]) => {
    const item = { method, key, authenticated: options?.requireAuthentication === true };
    events.push(item);
    if (key === AUTH_KEY) {
      assert.equal(options?.requireAuthentication, true);
      assert.equal(options?.keychainService, AUTHENTICATED_SECRET_SERVICE);
    }
    await state.before?.(item); return item;
  };
  const native: NativeSecureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 99,
    async getItemAsync(key, options) { const item = await event("get", key, options); const result = values.get(key) ?? null; await state.after?.(item); return result; },
    async setItemAsync(key, value, options) { const item = await event("set", key, options); values.set(key, value); await state.after?.(item); },
    async deleteItemAsync(key, options) { const item = await event("delete", key, options); values.delete(key); await state.after?.(item); },
  };
  const storage = createPlatformSecureStorage(native), repository = new WalletRepository(storage);
  const manifest = await repository.addAccount({ secretHex: SECRET, label: "Synthetic account", createdAt: new Date(NOW).toISOString(), backupConfirmed: true });
  if (legacy) {
    values.delete(AUTH_KEY); values.delete(PROTECTION_KEY);
    values.set(LEGACY_KEY, JSON.stringify({ schemaVersion: 2, account: identity.account, secretHex: SECRET }));
  }
  const operations = new WalletOperationLifecycle(() => state.now); operations.setAccount(identity.account);
  const withAccountSecret = createProductSessionKeyAccess({
    operations, repository,
    checkBiometrics: async guard => { guard(); state.checks++; await Promise.resolve(); guard(); },
    authorizeLegacyMigration: async () => { state.legacyAuthorizations++; if (state.failLegacy) throw new Error("Legacy biometric authorization cancelled"); },
  });
  const makeController = () => new ProductSessionController({
    platform: "android", storage, selectedAccount: () => manifest.accounts[0]!, now: () => new Date(state.now), withAccountSecret,
    audit: async (_review, action) => { state.audits.push(action); state.auditStarted?.resolve(); await state.auditGate?.promise; },
    openURL: async url => { state.opens.push(url); if (state.failOpen) throw new Error("Product return unavailable"); },
  });
  const request = createProductSessionRequest(registry, {
    productId: "pay", platform: "android", deviceId: "synthetic-device-product-001",
    deviceKey: Buffer.from(p256.getPublicKey(Buffer.from("0".repeat(63) + "3", "hex"))).toString("base64url"),
    scopes: ["account:read"], purpose: "Review the original synthetic request", nonce: "n".repeat(32), state: "s".repeat(32),
  }, new Date(NOW));
  const url = encodeProductSessionWalletURL(registry, request, new Date(NOW));
  const controller = makeController(); events.length = 0;
  const review = await controller.receive(url);
  return { state, values, events, storage, repository, operations, controller, makeController, request, review, url };
}

test("protected sign-in uses one native authenticated key read and no legacy JS authorization", async () => {
  const f = await fixture();
  assert.equal(f.events.some(e => e.authenticated), false);
  await f.controller.approve(f.review.id);
  assert.equal(f.state.checks, 1); assert.equal(f.state.legacyAuthorizations, 0);
  assert.deepEqual(f.events.filter(e => e.key === AUTH_KEY).map(e => e.method), ["get"]);
  const result = parseProductSessionReturnURL(registry, f.request, f.state.opens[0]!, new Date(f.state.now));
  assert.equal(result.status, "ready"); assert.equal((result.approval as any).requestDigest, f.review.id);
  assert.equal(f.values.get(PRODUCT_SESSION_REPLAY_KEY)?.includes(SECRET), false);
});

test("OS decryption cancellation preserves the exact request and only an explicit retry accesses the key again", async () => {
  const f = await fixture(); let deny = true;
  f.state.before = async e => { if (e.key === AUTH_KEY && e.method === "get" && deny) throw new Error("Native biometric authentication cancelled"); };
  await assert.rejects(f.controller.approve(f.review.id), /cancelled/);
  assert.equal(f.controller.current, f.review); assert.equal(f.controller.hasReturn(f.review.id), false);
  assert.equal(f.values.has(PRODUCT_SESSION_REPLAY_KEY), false); assert.deepEqual(f.state.audits, []); assert.deepEqual(f.state.opens, []);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.state.checks, 1);
  deny = false; await f.controller.approve(f.review.id);
  assert.equal(f.state.checks, 2); assert.equal(f.state.legacyAuthorizations, 0);
  const result = parseProductSessionReturnURL(registry, f.request, f.state.opens[0]!, new Date(f.state.now));
  assert.equal((result.approval as any).requestDigest, f.review.id);
});

test("legacy-only authorization is required before reading an unprotected legacy key; cancellation is retryable", async () => {
  const f = await fixture(true); f.state.failLegacy = true;
  await assert.rejects(f.controller.approve(f.review.id), /Legacy.*cancelled/);
  assert.equal(f.events.some(e => e.key === LEGACY_KEY), false);
  assert.equal(f.events.some(e => e.key === AUTH_KEY && e.method === "set"), false);
  assert.equal(f.values.has(PRODUCT_SESSION_REPLAY_KEY), false);
  f.state.failLegacy = false; await f.controller.approve(f.review.id);
  assert.equal(f.state.legacyAuthorizations, 2); assert.equal(f.values.has(LEGACY_KEY), false);
  assert.deepEqual(f.events.filter(e => e.key === AUTH_KEY).map(e => e.method), ["get", "get", "set", "get"]);
  assert.equal((await f.repository.load()).manifest.accounts[0]!.label, "Synthetic account");
});

for (const phase of ["write", "readback"] as const) test(`legacy native ${phase} cancellation retains the public account and unconsumed request`, async () => {
  const f = await fixture(true); let deny = true;
  f.state.before = async e => {
    if (deny && e.key === AUTH_KEY && (phase === "write" ? e.method === "set" : e.method === "get" && f.values.has(AUTH_KEY))) throw new Error("Native migration cancelled");
  };
  await assert.rejects(f.controller.approve(f.review.id), /cancelled/);
  assert.equal(f.values.has(PRODUCT_SESSION_REPLAY_KEY), false); assert.equal(f.values.has(LEGACY_KEY), true);
  assert.equal((await f.repository.load()).manifest.accounts.length, 1); assert.equal(f.controller.current, f.review);
  deny = false; await f.controller.approve(f.review.id);
  assert.equal(f.values.has(LEGACY_KEY), false); assert.equal(f.state.opens.length, 1);
});

test("invalidated protected key never falls back to a retained legacy record or requests legacy authorization", async () => {
  const f = await fixture(); f.values.delete(AUTH_KEY);
  f.values.set(LEGACY_KEY, JSON.stringify({ schemaVersion: 2, account: identity.account, secretHex: SECRET }));
  await assert.rejects(f.controller.approve(f.review.id), /protected key is unavailable/);
  assert.equal(f.state.legacyAuthorizations, 0); assert.equal(f.events.some(e => e.key === LEGACY_KEY), false);
  assert.equal(f.values.has(PRODUCT_SESSION_REPLAY_KEY), false); assert.equal((await f.repository.load()).manifest.accounts.length, 1);
});

for (const stage of ["os-read", "audit", "replay-write", "replay-readback"] as const) for (const change of ["background", "expiry"] as const) test(`${change} during ${stage} cannot produce an approval or callback; completed consumption stays recorded`, async () => {
  const f = await fixture(), started = deferred(), finish = deferred();
  if (stage === "audit") { f.state.auditStarted = started; f.state.auditGate = finish; }
  else f.state.before = async e => {
    const match = stage === "os-read" ? e.key === AUTH_KEY && e.method === "get"
      : e.key === PRODUCT_SESSION_REPLAY_KEY && (stage === "replay-write" ? e.method === "set" : e.method === "get" && f.values.has(PRODUCT_SESSION_REPLAY_KEY));
    if (match) { started.resolve(); await finish.promise; }
  };
  const approving = f.controller.approve(f.review.id); await started.promise;
  // Deliberately do not call controller.cancel: the key operation lease itself
  // must reject late work, independent of the root App's cancellation handler.
  if (change === "background") f.operations.setAppState("background"); else f.state.now += 300_000;
  finish.resolve(); await assert.rejects(approving, /cancelled|expired/);
  assert.equal(f.controller.hasReturn(f.review.id), false); assert.deepEqual(f.state.opens, []);
  assert.equal(f.values.has(PRODUCT_SESSION_REPLAY_KEY), stage.startsWith("replay"));
  if (stage.startsWith("replay")) {
    f.state.now = NOW; f.operations.setAppState("active");
    await assert.rejects(f.makeController().receive(f.url), /consumed/);
  }
});

for (const failure of ["write-ack", "readback-error", "readback-mismatch"] as const) test(`${failure} after replay storage keeps committed consumption and prevents a second key prompt`, async () => {
  const f = await fixture();
  f.state.after = async e => {
    if (e.key !== PRODUCT_SESSION_REPLAY_KEY) return;
    if (failure === "write-ack" && e.method === "set") throw new Error("Replay write ACK unavailable");
    if (failure === "readback-error" && e.method === "get" && f.values.has(PRODUCT_SESSION_REPLAY_KEY)) throw new Error("Replay readback unavailable");
  };
  if (failure === "readback-mismatch") f.state.after = async e => {
    if (e.key === PRODUCT_SESSION_REPLAY_KEY && e.method === "set") {
      const raw = JSON.parse(f.values.get(PRODUCT_SESSION_REPLAY_KEY)!);
      f.values.set(PRODUCT_SESSION_REPLAY_KEY, JSON.stringify(raw, null, 2));
    }
  };
  await assert.rejects(f.controller.approve(f.review.id), /unavailable|could not be verified/);
  assert.equal(f.values.has(PRODUCT_SESSION_REPLAY_KEY), true); assert.equal(f.controller.hasReturn(f.review.id), false); assert.deepEqual(f.state.opens, []);
  f.state.after = null; const reads = f.events.filter(e => e.key === AUTH_KEY).length;
  await assert.rejects(f.controller.approve(f.review.id), /consumed/);
  assert.equal(f.events.filter(e => e.key === AUTH_KEY).length, reads);
  await assert.rejects(f.makeController().receive(f.url), /consumed/);
});

test("callback retry returns identical signed bytes without another key read or authorization", async () => {
  const f = await fixture(); f.state.failOpen = true;
  await assert.rejects(f.controller.approve(f.review.id), /unavailable/);
  assert.equal(f.controller.hasReturn(f.review.id), true);
  const reads = f.events.filter(e => e.key === AUTH_KEY).length;
  f.state.failOpen = false; await f.controller.retryReturn(f.review.id);
  assert.equal(f.state.opens.length, 2); assert.equal(f.state.opens[0], f.state.opens[1]);
  assert.equal(f.events.filter(e => e.key === AUTH_KEY).length, reads); assert.equal(f.state.checks, 1);
  assert.equal(f.values.get(MANIFEST_KEY)?.includes(SECRET), false);
});
