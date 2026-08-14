import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionReturnURL, ProductSessionAuthority,
  RecoverableProductSessionClient, signProductSessionApproval, signProductSessionChallenge,
  PRODUCT_SESSION_CLIENT_STATE, WalletAuthError,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T01:00:00.000Z");
const deviceSecret = Buffer.alloc(32, 9);
const accountSecret = "1".padStart(64, "0");
const device = {
  id: "recovery-device-001", key: Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url"),
  secret: deviceSecret.toString("base64url"), scopes: ["account:read", "profile:link"],
  purpose: "Connect YNX Social to this exact device.",
};

function token(label) { return createHash("sha256").update(label).digest("base64url"); }
function storage() { const values = new Map(); return { securityLevel: "os-protected", async get(key) { return values.get(key) ?? null; }, async set(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, values }; }
function harness(sharedStorage = storage()) {
  const authority = new ProductSessionAuthority(registry);
  let challengeIndex = 0;
  const gateway = {
    async walletInstalled() { return true; }, async schemeRegistered() { return true; },
    async complete({ request, approval, deviceSecret: supplied }) {
      const challenge = authority.issueChallenge({ request, approval, challenge: token(`recovery-challenge-${challengeIndex++}`) }, NOW);
      return authority.complete({ request, approval, completion: signProductSessionChallenge(challenge, supplied) }, NOW);
    },
    async introspect(binding, context) { return authority.introspect(binding, context, NOW); },
  };
  let tokenIndex = 0;
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: sharedStorage, gateway, device, tokenFactory: () => token(`client-${tokenIndex++}`), clock: () => NOW });
  return { authority, client, gateway, storage: sharedStorage };
}

test("approved session is stored in protected storage and restored on the second launch only after introspection", async () => {
  const first = harness();
  const connecting = await first.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await first.client.handleReturn(callback)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  const second = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: first.storage, gateway: first.gateway, device, tokenFactory: () => token("second-launch"), clock: () => NOW });
  assert.equal((await second.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
});

test("revoked stored session fails closed and starts only one controlled reconnect before explicit Retry", async () => {
  const first = harness(); const connecting = await first.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const connected = await first.client.handleReturn(callback); first.authority.revokeSession(connected.session.sessionBinding);
  const second = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: first.storage, gateway: first.gateway, device, tokenFactory: (() => { let i = 0; return () => token(`controlled-${i++}`); })(), clock: () => NOW });
  assert.equal((await second.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTING);
  assert.equal(second.current.automatic, true);
  assert.equal((await second.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.equal((await second.retry({ walletInstalled: true, schemeRegistered: true })).automatic, false);
});

test("network loss, rejection and Guest mode never synthesize identity, balance, transaction or Chain state", async () => {
  const setup = harness();
  assert.equal(setup.client.setNetworkAvailable(false).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal((await setup.client.restore(false)).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  setup.client.setNetworkAvailable(true);
  const connecting = await setup.client.retry({ walletInstalled: true, schemeRegistered: true });
  const rejection = createProductSessionReturnURL(registry, connecting.request, { result: "rejected", reason: "user_rejected" }, NOW);
  assert.equal((await setup.client.handleReturn(rejection)).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  const guest = setup.client.enterGuest();
  assert.equal(guest.status, PRODUCT_SESSION_CLIENT_STATE.GUEST);
  assert.deepEqual(guest.limitations, ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"]);
  assert.equal("session" in guest, false);
});

test("second-launch Gateway outage preserves protected session and Retry re-introspects without new approval", async () => {
  const first = harness();
  const connecting = await first.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  assert.equal((await first.client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  let networkUnavailable = true; let completionCalls = 0;
  const gateway = {
    ...first.gateway,
    async complete(input) { completionCalls += 1; return first.gateway.complete(input); },
    async introspect(binding, context) { if (networkUnavailable) throw new WalletAuthError("NETWORK_UNAVAILABLE", "temporary outage"); return first.gateway.introspect(binding, context); },
  };
  const second = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: first.storage, gateway, device, tokenFactory: () => token("network-retry"), clock: () => NOW });
  const unavailable = await second.restore(true);
  assert.equal(unavailable.status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal("session" in unavailable, false);
  assert.notEqual(await first.storage.get(second.storageKey), null);
  networkUnavailable = false;
  assert.equal((await second.retry({ walletInstalled: true, schemeRegistered: true })).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(completionCalls, 0);
});

test("approved callback survives a completion outage and resumes from protected storage after restart", async () => {
  const setup = harness(); let networkUnavailable = true; let completionCalls = 0;
  const gateway = {
    ...setup.gateway,
    async complete(input) { completionCalls += 1; if (networkUnavailable) throw new WalletAuthError("NETWORK_UNAVAILABLE", "temporary outage"); return setup.gateway.complete(input); },
  };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`callback-outage-${i++}`); })(), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await client.handleReturn(callback)).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.notEqual(await setup.storage.get(`${client.storageKey}:pending`), null);
  assert.equal(await setup.storage.get(`${client.storageKey}:return`), callback);
  networkUnavailable = false;
  const restarted = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: () => token("callback-restart"), clock: () => NOW });
  assert.equal((await restarted.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(completionCalls, 2);
  assert.equal(await setup.storage.get(`${client.storageKey}:pending`), null);
  assert.equal(await setup.storage.get(`${client.storageKey}:return`), null);
});

test("dangling or malformed protected callbacks fail closed and are removed", async () => {
  const setup = harness();
  await setup.storage.set(`${setup.client.storageKey}:return`, "ynx-social://com.ynx.social?result=approved");
  assert.equal((await setup.client.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.equal(await setup.storage.get(`${setup.client.storageKey}:return`), null);
  await setup.storage.set(`${setup.client.storageKey}:pending`, "not-json");
  await setup.storage.set(`${setup.client.storageKey}:return`, "ynx-social://com.ynx.social?result=approved");
  assert.equal((await setup.client.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.equal(await setup.storage.get(`${setup.client.storageKey}:pending`), null);
  assert.equal(await setup.storage.get(`${setup.client.storageKey}:return`), null);
});

test("insecure storage and fake Gateway adapters are rejected", () => {
  const valid = harness();
  assert.throws(() => new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: { securityLevel: "local", get() {}, set() {}, remove() {} }, gateway: valid.gateway, device, tokenFactory: () => token("x"), clock: () => NOW }), code("INSECURE_STORAGE"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
