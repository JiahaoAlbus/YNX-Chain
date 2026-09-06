import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createProductSessionRequest, encodeProductSessionWalletURL, parseProductSessionReturnURL, ProductSessionAuthority, signProductSessionChallenge, walletIdentity } from "@ynx-chain/wallet-auth";
import { p256 } from "@noble/curves/nist.js";
import { AuthorizationAuditStore } from "./authorizationAudit";
import { PRODUCT_SESSION_REGISTRY as registry } from "./registry";
import { ProductSessionController, PRODUCT_SESSION_REPLAY_KEY } from "./productSessionController";
import type { SecureStorageAdapter, WalletAccount } from "../storage/walletRepository";

// Synthetic, deterministic local test identities; no device or user keys are loaded.
const secretA = "0".repeat(63) + "1", secretB = "0".repeat(63) + "2";
const deviceSecret = "0".repeat(63) + "3";
const deviceKey = Buffer.from(p256.getPublicKey(Buffer.from(deviceSecret, "hex"))).toString("base64url");
const NOW = new Date("2026-09-06T00:00:00.000Z");
const accountA: WalletAccount = Object.freeze({ ...walletIdentity(secretA), label: "Test A", backupConfirmed: true, createdAt: NOW.toISOString() });
const accountB: WalletAccount = Object.freeze({ ...walletIdentity(secretB), label: "Test B", backupConfirmed: true, createdAt: NOW.toISOString() });
function memoryStorage(): SecureStorageAdapter & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: async (key) => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, deleteItem: async (key) => { values.delete(key); } };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function request(platform: "android" | "ios" | "web" = "android", overrides: Record<string, unknown> = {}) {
  return createProductSessionRequest(registry, {
    productId: "pay", platform, deviceId: "test-product-device-001", deviceKey, scopes: ["account:read"],
    purpose: "Connect the selected test account", nonce: "n".repeat(32), state: "s".repeat(32), ...overrides,
  }, NOW);
}
function unsafeURL(value: unknown) { return "ynxwallet://authorize?request=" + Buffer.from(JSON.stringify(value)).toString("base64url"); }
function fixture(platform: "android" | "ios" = "android", storage = memoryStorage()) {
  const state = { selected: accountA as WalletAccount | null, now: NOW, authorizations: 0, reads: 0, opens: [] as string[], secret: secretA, failOpen: false, authorizeGate: null as ReturnType<typeof deferred> | null, readGate: null as ReturnType<typeof deferred> | null };
  const audit = new AuthorizationAuditStore(storage);
  const controller = new ProductSessionController({
    platform, storage, selectedAccount: () => state.selected, now: () => state.now,
    authorize: async () => { state.authorizations++; await state.authorizeGate?.promise; },
    accountSecret: async (account) => { assert.equal(account, accountA.account); state.reads++; await state.readGate?.promise; return state.secret; },
    openURL: async (url) => { state.opens.push(url); if (state.failOpen) throw new Error("Target app unavailable"); },
    audit: (review, action, at) => audit.appendProductSession(review, { action, account: review.account.account, at: at.toISOString() }),
  });
  return { controller, state, storage, audit };
}

for (const platform of ["android", "ios"] as const) test(`${platform} explicit approval completes the authoritative v2 challenge contract`, async () => {
  const f = fixture(platform), req = request(platform);
  const review = await f.controller.receive(encodeProductSessionWalletURL(registry, req, NOW));
  assert.equal(f.state.authorizations, 0); assert.equal(f.state.reads, 0); assert.equal(f.state.opens.length, 0);
  assert.equal(review.account.account, accountA.account);
  assert.equal(review.request.packageId, platform === "android" ? "com.ynxweb4.pay" : null);
  assert.equal(review.request.bundleId, platform === "ios" ? "com.ynxweb4.pay" : null);
  await f.controller.approve(review.id);
  const returned = parseProductSessionReturnURL(registry, req, f.state.opens[0]!, NOW);
  assert.equal(returned.status, "ready");
  const approval = returned.approval as Record<string, unknown>;
  assert.equal(approval.account, accountA.account); assert.equal(approval.requestDigest, review.id);
  for (const field of ["productId", "clientId", "platform", "applicationId", "origin", "callback", "deviceId", "deviceKey", "nonce", "state", "scopes"]) assert.deepEqual(approval[field], req[field], field);
  const authority = new ProductSessionAuthority(registry);
  const challenge = authority.issueChallenge({ request: req, approval, challenge: "c".repeat(32) }, NOW);
  const session = authority.complete({ request: req, approval, completion: signProductSessionChallenge(challenge, Buffer.from(deviceSecret, "hex").toString("base64url")) }, NOW);
  assert.equal(session.account, accountA.account); assert.equal(session.platform, platform);
  assert.deepEqual((await f.audit.load()).map((record) => record.action), ["intent-approved", "approval-returned"]);
  assert.equal(f.controller.current, null);
  assert.equal(JSON.stringify([...f.storage.values.values()]).includes(secretA), false);
});

test("explicit rejection returns nonce and state to the canonical product without key access", async () => {
  const f = fixture(), req = request();
  const review = await f.controller.receive(unsafeURL(req));
  await f.controller.reject(review.id);
  const url = new URL(f.state.opens[0]!);
  assert.equal(url.protocol + "//" + url.host + url.pathname, req.callback);
  assert.equal(url.searchParams.get("result"), "rejected");
  assert.equal(url.searchParams.get("nonce"), req.nonce); assert.equal(url.searchParams.get("state"), req.state);
  assert.equal(parseProductSessionReturnURL(registry, req, url.toString(), NOW).status, "user-rejected");
  assert.equal(f.state.authorizations, 0); assert.equal(f.state.reads, 0);
  assert.equal((await f.audit.load())[0]?.action, "request-rejected");
});

test("v1, spoofed bindings, widened scopes and malformed routes fail before approval", async () => {
  const req = request();
  const mutations = [{ version: "1" }, { productClientId: "ynx-pay-v1" }, { productId: "unknown-product" }, { clientId: "ynx-card-v1" }, { packageId: "com.attacker.app" }, { bundleId: "com.ynxweb4.pay" }, { origin: "https://evil.example" }, { callback: "evil://wallet-auth/callback" }, { scopes: ["account:read", "wallet:all"] }, { chainId: "ynx_1-1" }, { deviceAlgorithm: "secp256k1" }, { state: "short" }];
  for (const change of mutations) {
    const f = fixture(); await assert.rejects(f.controller.receive(unsafeURL({ ...req, ...change })));
    assert.equal(f.controller.current, null); assert.equal(f.state.reads, 0); assert.equal(f.state.opens.length, 0);
  }
  for (const url of ["ynxwallet://authorize?request=bad", unsafeURL(req) + "&request=duplicate", unsafeURL(req).replace("authorize?", "other?"), unsafeURL(req) + "#fragment", unsafeURL(req).replace("authorize?", "authorize:9999?")]) await assert.rejects(fixture().controller.receive(url));
});

test("mobile Wallet accepts web origins but rejects another native operating system", async () => {
  await assert.rejects(fixture().controller.receive(unsafeURL(request("ios"))), /platform/);
  const f = fixture(), req = request("web");
  const review = await f.controller.receive(unsafeURL(req)); await f.controller.reject(review.id);
  assert.equal(new URL(f.state.opens[0]!).origin, "https://pay.ynxweb4.com");
});

test("expiry is revalidated after biometric confirmation", async () => {
  const f = fixture(); f.state.authorizeGate = deferred();
  const review = await f.controller.receive(unsafeURL(request())); const approving = f.controller.approve(review.id);
  f.state.now = new Date(NOW.getTime() + 300_000); f.state.authorizeGate.resolve();
  await assert.rejects(approving, /expired/); assert.equal(f.state.reads, 0); assert.equal(f.state.opens.length, 0);
});

for (const action of ["switch", "background"] as const) test(`${action} while biometrics are pending cancels approval`, async () => {
  const f = fixture(); f.state.authorizeGate = deferred();
  const review = await f.controller.receive(unsafeURL(request())); const approving = f.controller.approve(review.id);
  if (action === "switch") f.state.selected = accountB; else f.controller.cancel();
  f.state.authorizeGate.resolve(); await assert.rejects(approving, /changed|cancelled/);
  assert.equal(f.state.reads, 0); assert.equal(f.state.opens.length, 0);
});

test("a key read resolving after an account change cannot sign or return for the replacement account", async () => {
  const f = fixture(); f.state.readGate = deferred();
  const review = await f.controller.receive(unsafeURL(request())); const approving = f.controller.approve(review.id);
  while (!f.state.reads) await new Promise((resolve) => setImmediate(resolve));
  f.state.selected = accountB; f.state.readGate.resolve();
  await assert.rejects(approving, /changed/); assert.equal(f.state.opens.length, 0);
  await assert.rejects(fixture("android", f.storage).controller.receive(unsafeURL(request())), /consumed/);
});

test("a storage adapter returning a different signing key is rejected", async () => {
  const f = fixture(); f.state.secret = secretB;
  const review = await f.controller.receive(unsafeURL(request()));
  await assert.rejects(f.controller.approve(review.id), /does not match/); assert.equal(f.state.opens.length, 0);
});

test("duplicate links retain the same review and another link cannot replace an active request", async () => {
  const f = fixture(), url = unsafeURL(request()); const review = await f.controller.receive(url);
  assert.equal(await f.controller.receive(url), review);
  await assert.rejects(f.controller.receive(unsafeURL(request("android", { nonce: "m".repeat(32), state: "t".repeat(32) }))), /current Wallet request/);
  assert.equal(f.controller.current, review); assert.equal(f.state.reads, 0);
});

test("overlapping approve and reject cannot produce contradictory decisions", async () => {
  const f = fixture(); f.state.authorizeGate = deferred(); const review = await f.controller.receive(unsafeURL(request()));
  const approving = f.controller.approve(review.id);
  await assert.rejects(f.controller.reject(review.id), /in progress/); f.state.authorizeGate.resolve(); await approving;
  assert.equal(f.state.opens.length, 1); assert.equal(f.state.reads, 1);
});

test("consumed request, nonce and state remain blocked after controller restart", async () => {
  const f = fixture(); const review = await f.controller.receive(unsafeURL(request())); await f.controller.reject(review.id);
  for (const overrides of [{}, { state: "t".repeat(32) }, { nonce: "m".repeat(32) }]) await assert.rejects(fixture("android", f.storage).controller.receive(unsafeURL(request("android", overrides))), /consumed/);
});

for (const decision of ["approve", "reject"] as const) test(`${decision} callback failure retries the identical result without new authorization`, async () => {
  const f = fixture(); f.state.failOpen = true; const review = await f.controller.receive(unsafeURL(request()));
  await assert.rejects(f.controller[decision](review.id), /unavailable/);
  assert.equal(f.controller.hasReturn(review.id), true);
  await assert.rejects(f.controller.approve(review.id), /already/); await assert.rejects(f.controller.reject(review.id), /already/);
  f.state.failOpen = false; await f.controller.retryReturn(review.id);
  assert.equal(f.state.opens[0], f.state.opens[1]);
  assert.equal(f.state.authorizations, decision === "approve" ? 1 : 0); assert.equal(f.state.reads, decision === "approve" ? 1 : 0);
});

test("unavailable or malformed durable replay storage fails before signing", async () => {
  const f = fixture(); const review = await f.controller.receive(unsafeURL(request()));
  f.storage.setItem = async (key, value) => { if (key === PRODUCT_SESSION_REPLAY_KEY) throw new Error("Secure storage unavailable"); f.storage.values.set(key, value); };
  await assert.rejects(f.controller.approve(review.id), /Secure storage unavailable/); assert.equal(f.state.reads, 0);
  for (const value of ["not-json", "{}", JSON.stringify({ schemaVersion: 2, consumed: [{ digest: "bad" }] })]) {
    const broken = fixture(); broken.storage.values.set(PRODUCT_SESSION_REPLAY_KEY, value);
    await assert.rejects(broken.controller.receive(unsafeURL(request())), /storage/); assert.equal(broken.state.reads, 0);
  }
});

test("no account and an unconfirmed backup cannot authorize a product", async () => {
  const f = fixture(); f.state.selected = null;
  await assert.rejects(f.controller.receive(unsafeURL(request())), /Create or import/);
  f.state.selected = { ...accountA, backupConfirmed: false };
  const review = await f.controller.receive(unsafeURL(request()));
  await assert.rejects(f.controller.approve(review.id), /backup/);
  assert.equal(f.state.authorizations, 0); assert.equal(f.state.reads, 0);
  await f.controller.reject(review.id);
  assert.equal(new URL(f.state.opens[0]!).searchParams.get("result"), "rejected");
});

test("cancellation during durable consumption prevents subsequent key access", async () => {
  const f = fixture(), writing = deferred(), written = deferred();
  const original = f.storage.setItem;
  f.storage.setItem = async (key, value) => {
    if (key === PRODUCT_SESSION_REPLAY_KEY) { writing.resolve(); await written.promise; }
    await original(key, value);
  };
  const review = await f.controller.receive(unsafeURL(request())); const approving = f.controller.approve(review.id);
  await writing.promise; f.controller.cancel(); written.resolve(); await assert.rejects(approving, /cancelled/);
  assert.equal(f.state.reads, 0); assert.equal(f.state.opens.length, 0);
  await assert.rejects(fixture("android", f.storage).controller.receive(unsafeURL(request())), /consumed/);
});

test("a completed approval cannot be retried after expiry or account switch", async () => {
  for (const change of ["expiry", "account"] as const) {
    const f = fixture(); f.state.failOpen = true; const review = await f.controller.receive(unsafeURL(request()));
    await assert.rejects(f.controller.approve(review.id), /unavailable/); f.state.failOpen = false;
    if (change === "expiry") f.state.now = new Date(NOW.getTime() + 300_000); else f.state.selected = accountB;
    await assert.rejects(f.controller.retryReturn(review.id), /expired|changed/);
    assert.equal(f.state.reads, 1); assert.equal(f.state.opens.length, 1);
  }
});

test("native cold and warm entrypoints use only the v2 controller and cancel pending work on background", async () => {
  const source = await readFile(new URL("../../App.tsx", import.meta.url), "utf8");
  for (const legacy of ["parseWalletDeepLink", "signAuthorization", "createCallbackURL", "PersistentNonceStore"]) assert.equal(source.includes(legacy), false);
  for (const marker of ["Linking.getInitialURL()", 'Linking.addEventListener("url"', "productSessions.receive(url)", 'next==="background"', "controller[action](review.id)", 'decide("reject")']) assert.equal(source.includes(marker), true, marker);
});
