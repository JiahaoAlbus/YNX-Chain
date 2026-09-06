import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  canonicalJSON, decodeWalletSessionControlProofHeader, httpBodyDigest, verifyWalletSessionControlProof, walletIdentity,
  type WalletSessionControlProof,
} from "@ynx-chain/wallet-auth";
import { WalletOperationCancelled, WalletOperationLifecycle, type WalletOperationLease } from "../security/operationLifecycle";
import type { WalletAccount } from "../storage/walletRepository";
import { WalletSessionInventoryClient, WalletSessionRevocationUnknown } from "./sessionInventory";

// Public, independent fixture material; never an installed Wallet account.
const SECRET = "1".padStart(64, "0");
const ACCOUNT: WalletAccount = Object.freeze({ ...walletIdentity(SECRET), label: "Independent fixture", createdAt: "2026-07-26T07:00:00.000Z", backupConfirmed: true });
const OTHER = walletIdentity("2".padStart(64, "0"));
const NOW = "2026-07-26T08:00:00.000Z";
const SESSION = "a".repeat(64), DEVICE = "c".repeat(64);
const INVENTORY = "/v2/product-sessions/wallet/sessions", REVOKE = `${INVENTORY}/revoke`;
function inventory() {
  return { account: ACCOUNT.account, asOf: NOW, sessions: [{ sessionBinding: SESSION, productId: "ynx-creator-studio", clientId: "ynx-creator-studio-web", displayName: "YNX Creator Studio", platform: "web", applicationId: "com.ynxweb4.creator.web", origin: "https://creator.ynxweb4.com", callback: "https://creator.ynxweb4.com/wallet-auth/callback", deviceId: "fixture-browser-device", deviceBinding: DEVICE, scopes: ["profile:read"], issuedAt: "2026-07-26T07:55:00.000Z", expiresAt: "2026-07-26T09:00:00.000Z", active: true, inactiveReasons: [] as string[] }] };
}
function response(result: unknown, requestId: string, overrides: Record<string, string> = {}) {
  return new Response(canonicalJSON({ ok: true, result, requestId, schemaVersion: 2 }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": requestId, ...overrides } });
}
function unlocked() {
  const operations = new WalletOperationLifecycle(); operations.setAccount(ACCOUNT.account);
  const lease = operations.scope().begin({ requireUnlocked: false }); operations.unlock(lease); lease.finish();
  return { operations, scope: operations.scope() };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

type FixtureOptions = {
  stage?: (name: string) => Promise<void>;
  secret?: string;
  clock?: unknown;
  result?: (path: string, requestId: string, proof: WalletSessionControlProof) => Response | Promise<Response>;
};
function fixture(options: FixtureOptions = {}) {
  const calls: string[] = [], proofs: WalletSessionControlProof[] = [], requests: { url: string; init?: RequestInit }[] = [];
  let randomCount = 0, timeCount = 0, revoked = false, authorityTime = NOW;
  const stage = async (name: string) => { calls.push(name); await options.stage?.(name); };
  const client = new WalletSessionInventoryClient({
    authorize: async (purpose) => { await stage(purpose); },
    randomBytes: async (length) => { await stage(["time-request-id", "nonce", "fresh-time-request-id"][randomCount++ % 3]!); return Uint8Array.from(randomBytes(length)); },
    accountSecret: async (account, assertCurrent) => { assert.equal(account, ACCOUNT.account); assertCurrent(); await stage("secret"); assertCurrent(); return options.secret ?? SECRET; },
    fetch: async (input, init) => {
      const url = String(input); requests.push({ url, init });
      assert.equal(new URL(url).origin, "https://wallet-auth.ynxweb4.com");
      assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "error");
      const headers = new Headers(init?.headers), requestId = headers.get("x-request-id")!;
      assert.match(requestId, /^req_[0-9a-f]{64}$/);
      assert.equal(headers.get("x-ynx-product-session-proof-v2"), null); assert.equal(headers.get("origin"), null);
      const path = new URL(url).pathname;
      if (path.endsWith("/time")) {
        assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); assert.equal(headers.get("x-ynx-wallet-control-proof-v2"), null);
        await stage(++timeCount % 2 ? "time" : "fresh-time"); const clock = typeof options.clock === "function" ? options.clock() : options.clock ?? NOW; authorityTime = clock as string; return response({ serverTime: clock }, requestId);
      }
      assert.equal(init?.method, "POST"); assert.equal(headers.get("content-type"), "application/json");
      const proof = decodeWalletSessionControlProofHeader(headers.get("x-ynx-wallet-control-proof-v2"));
      verifyWalletSessionControlProof(proof, { method: "POST", path: path as typeof INVENTORY, bodyDigest: httpBodyDigest(init!.body as string) }, new Date(authorityTime));
      assert.equal(proof.account, ACCOUNT.account); assert.equal(proof.accountPublicKey, ACCOUNT.accountPublicKey);
      assert.equal(Date.parse(proof.expiresAt) - Date.parse(proof.issuedAt), 30_000);
      proofs.push(proof); await stage("post");
      if (options.result) return options.result(path, requestId, proof);
      if (path === INVENTORY) { assert.equal(init?.body, "{}"); return response({ ...inventory(), asOf: authorityTime }, requestId); }
      assert.equal(path, REVOKE); assert.equal(init?.body, canonicalJSON({ sessionBinding: SESSION }));
      const alreadyRevoked = revoked; revoked = true;
      return response({ account: ACCOUNT.account, sessionBinding: SESSION, revoked: true, alreadyRevoked, asOf: authorityTime }, requestId);
    },
  });
  return { client, calls, proofs, requests };
}
async function useLease<T>(scope: ReturnType<typeof unlocked>["scope"], action: (lease: WalletOperationLease) => Promise<T>) {
  const lease = scope.begin(); try { return await action(lease); } finally { lease.finish(); }
}

test("Connected Apps requires an explicit authorized call and signs only the selected account with fresh Auth time", async () => {
  const f = fixture(), { scope } = unlocked(); assert.deepEqual(f.calls, []); assert.deepEqual(f.requests, []);
  const result = await useLease(scope, (lease) => f.client.load(ACCOUNT, lease));
  assert.equal(result.account, ACCOUNT.account); assert.equal(result.sessions[0]?.displayName, "YNX Creator Studio");
  assert.equal(result.sessions[0]?.active, true); assert.equal(Object.isFrozen(result.sessions[0]), true); assert.equal(Object.isFrozen(result.sessions), true);
  assert.deepEqual(f.calls, ["wallet-sessions-view", "time-request-id", "time", "nonce", "fresh-time-request-id", "secret", "fresh-time", "post"]);
  assert.equal(f.proofs[0]?.issuedAt, NOW); // Deliberately unrelated to the actual device date.
  assert.equal(f.requests.length, 3);
});

test("legal native app origins and scheme callbacks remain visible alongside Web sessions", async () => {
  const sessions = ["android", "ios", "linux", "macos", "windows"].map((platform, index) => ({ ...inventory().sessions[0]!, sessionBinding: String(index + 1).repeat(64), platform, applicationId: "com.ynxweb4.creator", origin: `app://${platform}/com.ynxweb4.creator`, callback: "ynxcreator://wallet-auth/callback" }));
  const f = fixture({ result: (_, id) => response({ ...inventory(), sessions: [...sessions, ...inventory().sessions] }, id) }), { scope } = unlocked();
  const result = await useLease(scope, (lease) => f.client.load(ACCOUNT, lease));
  assert.equal(result.sessions.length, 6);
  assert.equal(result.sessions[0]?.origin, "app://android/com.ynxweb4.creator");
  assert.equal(result.sessions[1]?.callback, "ynxcreator://wallet-auth/callback");
});

test("empty inventory is returned only after an authenticated, verified authoritative response", async () => {
  const { scope } = unlocked();
  const f = fixture({ result: (_, requestId) => response({ ...inventory(), sessions: [] }, requestId) });
  assert.deepEqual((await useLease(scope, (lease) => f.client.load(ACCOUNT, lease))).sessions, []);
  const unavailable = fixture({ stage: async (name) => { if (name === "time") throw new Error("offline"); } });
  await assert.rejects(useLease(scope, (lease) => unavailable.client.load(ACCOUNT, lease)), /unavailable/);
  assert.equal(unavailable.calls.includes("secret"), false); assert.equal(unavailable.proofs.length, 0);
  const invalidTime = fixture({ clock: "2026-07-26T08:00:00Z" });
  await assert.rejects(useLease(scope, (lease) => invalidTime.client.load(ACCOUNT, lease)), /Auth time is invalid/);
  assert.equal(invalidTime.calls.includes("secret"), false);
});

test("account substitution is rejected before signing or sending a control proof", async () => {
  const { scope } = unlocked(), f = fixture();
  await assert.rejects(useLease(scope, (lease) => f.client.load({ ...ACCOUNT, ...OTHER }, lease)), /does not match/);
  assert.deepEqual(f.calls, []);
  const secretMismatch = fixture({ secret: "2".padStart(64, "0") });
  await assert.rejects(useLease(scope, (lease) => secretMismatch.client.load(ACCOUNT, lease)), /signing account changed/);
  assert.equal(secretMismatch.proofs.length, 0);
  const publicKeyMismatch = fixture();
  await assert.rejects(useLease(scope, (lease) => publicKeyMismatch.client.load({ ...ACCOUNT, accountPublicKey: OTHER.accountPublicKey }, lease)), /signing account changed/);
  assert.equal(publicKeyMismatch.proofs.length, 0);
});

test("inventory rejects another account, stale response, duplicates, impossible statuses and unknown reasons", async () => {
  const variants: unknown[] = [
    { ...inventory(), account: OTHER.account },
    { ...inventory(), asOf: "2026-07-26T07:59:59.999Z" },
    { ...inventory(), asOf: "2026-07-26T08:00:30.000Z" },
    { ...inventory(), sessions: [...inventory().sessions, ...inventory().sessions] },
    { ...inventory(), sessions: [{ ...inventory().sessions[0], active: false, inactiveReasons: [] }] },
    { ...inventory(), sessions: [{ ...inventory().sessions[0], active: false, inactiveReasons: ["unknown-reason"] }] },
    { ...inventory(), sessions: [{ ...inventory().sessions[0], active: false, inactiveReasons: ["expired"] }] },
    { ...inventory(), sessions: [{ ...inventory().sessions[0], scopes: [] }] },
    { ...inventory(), extra: true },
  ];
  for (const value of variants) {
    const { scope } = unlocked(), f = fixture({ result: (_, id) => response(value, id) });
    await assert.rejects(useLease(scope, (lease) => f.client.load(ACCOUNT, lease)));
  }
  const expired = fixture({ result: (_, id) => response({ ...inventory(), sessions: [{ ...inventory().sessions[0], expiresAt: "2026-07-26T07:59:59.999Z", active: false, inactiveReasons: ["expired", "session-revoked"] }] }, id) });
  const { scope } = unlocked();
  assert.deepEqual((await useLease(scope, (lease) => expired.client.load(ACCOUNT, lease))).sessions[0]?.inactiveReasons, ["expired", "session-revoked"]);
});

test("the transport rejects cached, unbound, redirected, noncanonical and widened success envelopes", async () => {
  const variants: ((id: string) => Response)[] = [
    (id) => response(inventory(), id, { "cache-control": "public, max-age=3600" }),
    (id) => response(inventory(), id, { "x-request-id": "req_wrong_request" }),
    (id) => new Response(JSON.stringify({ ok: true, requestId: id, result: inventory(), schemaVersion: 2 }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": id } }),
    (id) => new Response(canonicalJSON({ ok: true, requestId: id, result: inventory(), schemaVersion: 2, extra: true }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": id } }),
    (id) => { const result = response(inventory(), id); Object.defineProperty(result, "redirected", { value: true }); return result; },
  ];
  for (const variant of variants) {
    const { scope } = unlocked(), f = fixture({ result: (_, id) => variant(id) });
    await assert.rejects(useLease(scope, (lease) => f.client.load(ACCOUNT, lease)));
  }
});

test("revocation uses its own visible authorization and exact target, without automatically signing another inventory request", async () => {
  const { scope } = unlocked(), f = fixture();
  const result = await useLease(scope, (lease) => f.client.revoke(ACCOUNT, SESSION, lease));
  assert.deepEqual(result, { account: ACCOUNT.account, sessionBinding: SESSION, revoked: true, alreadyRevoked: false, asOf: NOW });
  assert.deepEqual(f.calls, ["wallet-session-revoke", "time-request-id", "time", "nonce", "fresh-time-request-id", "secret", "fresh-time", "post"]);
  assert.equal(f.proofs.length, 1); assert.equal(f.proofs[0]?.path, REVOKE);
  const second = await useLease(scope, (lease) => f.client.revoke(ACCOUNT, SESSION, lease));
  assert.equal(second.alreadyRevoked, true); assert.notEqual(f.proofs[0]?.nonce, f.proofs[1]?.nonce);
});

test("a lost revocation response stays unknown and a fresh proof retries the same already-revoked target", async () => {
  let revoked = false;
  const f = fixture({ result: (_, id) => {
    if (!revoked) { revoked = true; throw new Error("reply lost after durable revoke"); }
    return response({ account: ACCOUNT.account, sessionBinding: SESSION, revoked: true, alreadyRevoked: true, asOf: NOW }, id);
  } });
  const { scope } = unlocked();
  await assert.rejects(useLease(scope, (lease) => f.client.revoke(ACCOUNT, SESSION, lease)), (error: unknown) => error instanceof WalletSessionRevocationUnknown && error.sessionBinding === SESSION);
  const confirmed = await useLease(scope, (lease) => f.client.revoke(ACCOUNT, SESSION, lease));
  assert.equal(confirmed.alreadyRevoked, true); assert.notEqual(f.proofs[0]?.nonce, f.proofs[1]?.nonce);
  assert.equal(f.proofs[0]?.bodyDigest, f.proofs[1]?.bodyDigest); assert.equal(f.proofs.length, 2);
});

test("revocation cannot claim success from a mismatched, stale or unconfirmed receipt", async () => {
  const receipt = { account: ACCOUNT.account, sessionBinding: SESSION, revoked: true, alreadyRevoked: false, asOf: NOW };
  for (const variant of [{ ...receipt, account: OTHER.account }, { ...receipt, sessionBinding: DEVICE }, { ...receipt, revoked: false }, { ...receipt, alreadyRevoked: "yes" }, { ...receipt, asOf: "2026-07-26T07:59:59.999Z" }]) {
    const { scope } = unlocked(), f = fixture({ result: (_, id) => response(variant, id) });
    await assert.rejects(useLease(scope, (lease) => f.client.revoke(ACCOUNT, SESSION, lease)), WalletSessionRevocationUnknown);
  }
});

test("a rejected biometric or unavailable clock before submission does not report a revocation as sent", async () => {
  for (const deniedAt of ["wallet-session-revoke", "time"]) {
    const f = fixture({ stage: async (name) => { if (name === deniedAt) throw new Error("cancelled or unavailable"); } }), { scope } = unlocked();
    await assert.rejects(useLease(scope, (lease) => f.client.revoke(ACCOUNT, SESSION, lease)), (error: unknown) => error instanceof Error && !(error instanceof WalletSessionRevocationUnknown));
    assert.equal(f.proofs.length, 0); assert.equal(f.calls.includes("secret"), false);
  }
});

test("close, background and account switch at every awaited stage prevent late signing, POST or UI success", async () => {
  for (const action of ["load", "revoke"] as const) for (const cancelAt of [action === "load" ? "wallet-sessions-view" : "wallet-session-revoke", "time", "nonce", "fresh-time-request-id", "secret", "fresh-time", "post"]) for (const cancellation of ["close", "background", "switch"]) {
    const reached = deferred<void>(), release = deferred<void>(), { operations, scope } = unlocked();
    const f = fixture({ stage: async (name) => { if (name === cancelAt) { reached.resolve(); await release.promise; } } });
    const operation = useLease<unknown>(scope, (lease) => action === "load" ? f.client.load(ACCOUNT, lease) : f.client.revoke(ACCOUNT, SESSION, lease));
    await reached.promise;
    if (cancellation === "close") scope.cancel(); else if (cancellation === "background") operations.setAppState("background"); else operations.setAccount(OTHER.account);
    release.resolve(); await assert.rejects(operation, WalletOperationCancelled);
    if (cancelAt !== "post") assert.equal(f.proofs.length, 0);
    if (["wallet-sessions-view", "wallet-session-revoke", "time", "nonce"].includes(cancelAt)) assert.equal(f.calls.includes("secret"), false);
  }
});

test("the request timeout also covers an interrupted body stream", async () => {
  const { scope } = unlocked();
  // Keep real signed transport, shorten only the documented network deadline.
  const client = new WalletSessionInventoryClient({ fetch: async (input, init) => {
    const id = new Headers(init?.headers).get("x-request-id")!;
    if (String(input).endsWith("/time")) return response({ serverTime: NOW }, id);
    const result = response(inventory(), id); Object.defineProperty(result, "text", { value: () => new Promise<string>(() => {}) }); return result;
  }, randomBytes: async (length) => Uint8Array.from(randomBytes(length)), authorize: async () => {}, accountSecret: async () => SECRET, timeoutMs: 1_000 });
  await assert.rejects(useLease(scope, (lease) => client.load(ACCOUNT, lease)), /timed out/);
});

test("OS key decryption taking over 30 seconds still signs with the newly fetched authority time", async () => {
  let authorityTime = NOW;
  const { scope } = unlocked();
  const f = fixture({ clock: () => authorityTime, stage: async (name) => {
    if (name === "secret") authorityTime = "2026-07-26T08:00:45.000Z";
  } });
  const result = await useLease(scope, lease => f.client.load(ACCOUNT, lease));
  assert.equal(result.asOf, authorityTime);
  assert.equal(f.proofs[0]?.issuedAt, authorityTime);
  assert.equal(f.proofs[0]?.expiresAt, "2026-07-26T08:01:15.000Z");
  assert.equal(f.requests.filter(request => request.init?.method === "GET").length, 2);
});

test("unavailable or cancelled post-decryption clock does not sign or POST a control request", async () => {
  const unavailable = fixture({ stage: async name => { if (name === "fresh-time") throw new Error("offline after OS decryption"); } });
  const { scope } = unlocked();
  await assert.rejects(useLease(scope, lease => unavailable.client.revoke(ACCOUNT, SESSION, lease)), error => error instanceof Error && !(error instanceof WalletSessionRevocationUnknown));
  assert.equal(unavailable.calls.includes("secret"), true);
  assert.equal(unavailable.proofs.length, 0);
  assert.equal(unavailable.requests.some(request => request.init?.method === "POST"), false);
});
