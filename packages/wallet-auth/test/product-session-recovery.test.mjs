import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionReturnURL, httpBodyDigest, ProductSessionAuthority,
  RecoverableProductSessionClient, signProductSessionApproval, verifyProductSessionProofV2,
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
    async challenge({ requestId, request, approval }) {
      assert.match(requestId, /^req_ps_c_[A-Za-z0-9_-]{32,64}$/);
      return authority.issueChallenge({ request, approval, challenge: token(`recovery-challenge-${challengeIndex++}`) }, NOW);
    },
    async complete({ requestId, ...input }) { assert.match(requestId, /^req_ps_f_[A-Za-z0-9_-]{32,64}$/); assert.equal("deviceSecret" in input, false); return authority.complete(input, NOW); },
    async introspect({ requestId, sessionBinding, requiredScopes, proof }) {
      assert.match(requestId, /^req_ps_i_[A-Za-z0-9_-]{32,64}$/);
      const session = authority.snapshot().sessions.find((item) => item.sessionBinding === sessionBinding);
      if (!session) throw new WalletAuthError("SESSION_NOT_FOUND", "missing session");
      const body = { requiredScopes };
      verifyProductSessionProofV2(proof, session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(canonicalJSON(body)) }, NOW);
      return authority.introspect(sessionBinding, { chainId: session.chainId, productId: session.productId, clientId: session.clientId, platform: session.platform, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, requiredScopes }, NOW);
    },
    async revoke({ requestId, sessionBinding, proof }) {
      assert.match(requestId, /^req_ps_r_[A-Za-z0-9_-]{32,64}$/);
      const session = authority.snapshot().sessions.find((item) => item.sessionBinding === sessionBinding);
      if (!session) throw new WalletAuthError("SESSION_NOT_FOUND", "missing session");
      verifyProductSessionProofV2(proof, session, { method: "POST", path: "/v2/product-sessions/revoke", bodyDigest: httpBodyDigest(canonicalJSON({})) }, NOW);
      authority.introspect(sessionBinding, { chainId: session.chainId, productId: session.productId, clientId: session.clientId, platform: session.platform, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, requiredScopes: [] }, NOW);
      authority.revokeSession(sessionBinding);
      return { revoked: sessionBinding };
    },
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

test("disconnect revokes the authoritative Gateway session before removing protected state", async () => {
  const setup = harness();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const connected = await setup.client.handleReturn(callback);
  assert.equal(connected.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  const disconnected = await setup.client.disconnect();
  assert.equal(disconnected.status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.deepEqual(setup.authority.snapshot().revokedSessions, [connected.session.sessionBinding]);
  assert.equal(await setup.storage.get(setup.client.storageKey), null);
});

test("lost revoke acknowledgement clears protected state only after exact SESSION_REVOKED retry", async () => {
  const setup = harness(); let loseAcknowledgement = true;
  const gateway = {
    ...setup.gateway,
    async revoke(input) {
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        await setup.gateway.revoke(input);
        throw new WalletAuthError("NETWORK_UNAVAILABLE", "revoke persisted but acknowledgement was lost");
      }
      return setup.gateway.revoke(input);
    },
  };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`lost-revoke-ack-${i++}`); })(), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  assert.equal((await client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal((await client.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.notEqual(await setup.storage.get(client.storageKey), null);
  assert.equal((await client.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(await setup.storage.get(client.storageKey), null);
});

test("revoke retries retain protected state for SESSION_NOT_FOUND and every non-terminal error", async () => {
  for (const code of ["SESSION_NOT_FOUND", "SESSION_EXPIRED", "INVALID_GATEWAY_RESPONSE"]) {
    const setup = harness();
    const gateway = { ...setup.gateway, async revoke() { throw new WalletAuthError(code, "must remain fail closed"); } };
    const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`revoke-nonterminal-${code}-${i++}`); })(), clock: () => NOW });
    const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
    const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
    assert.equal((await client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
    assert.equal((await client.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
    assert.notEqual(await setup.storage.get(client.storageKey), null);
  }
});

test("callback verification is single-flight and rejects a different concurrent return", async () => {
  const setup = harness(); let releaseChallenge; let challengeStarted; let challengeCalls = 0;
  const blocked = new Promise((resolve) => { releaseChallenge = resolve; });
  const started = new Promise((resolve) => { challengeStarted = resolve; });
  const gateway = { ...setup.gateway, async challenge(input) { challengeCalls += 1; challengeStarted(); await blocked; return setup.gateway.challenge(input); } };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`callback-single-flight-${i++}`); })(), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const first = client.handleReturn(callback);
  await started;
  const duplicate = client.handleReturn(callback);
  await assert.rejects(() => client.handleReturn(`${callback}x`), code("CONCURRENT_CALLBACK"));
  releaseChallenge();
  assert.equal((await first).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal((await duplicate).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(challengeCalls, 1);
  assert.equal(setup.authority.snapshot().sessions.length, 1);
});

test("disconnect racing Wallet approval revokes once and cannot resurrect the Product Session", async () => {
  const setup = harness(); let releaseChallenge; let challengeStarted; let revokeCalls = 0;
  const blocked = new Promise((resolve) => { releaseChallenge = resolve; });
  const started = new Promise((resolve) => { challengeStarted = resolve; });
  const gateway = {
    ...setup.gateway,
    async challenge(input) { challengeStarted(); await blocked; return setup.gateway.challenge(input); },
    async revoke(input) { revokeCalls += 1; return setup.gateway.revoke(input); },
  };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`disconnect-race-${i++}`); })(), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const completion = client.handleReturn(callback);
  await started;
  const firstDisconnect = client.disconnect();
  const duplicateDisconnect = client.disconnect();
  releaseChallenge();
  assert.equal((await completion).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal((await firstDisconnect).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal((await duplicateDisconnect).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(client.current.status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(revokeCalls, 1);
  assert.equal(setup.authority.snapshot().sessions.length, 1);
  assert.equal(setup.authority.snapshot().revokedSessions.length, 1);
  assert.equal(await setup.storage.get(client.storageKey), null);
});

test("disconnect revokes a protected session issued before an introspection outage", async () => {
  const setup = harness(); let introspectionOffline = true;
  const gateway = { ...setup.gateway, async introspect(input) { if (introspectionOffline) throw new WalletAuthError("NETWORK_UNAVAILABLE", "temporary confirm outage"); return setup.gateway.introspect(input); } };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`confirm-outage-revoke-${i++}`); })(), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await client.handleReturn(callback)).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal(setup.authority.snapshot().sessions.length, 1);
  assert.notEqual(await setup.storage.get(client.storageKey), null);
  introspectionOffline = false;
  assert.equal((await client.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(setup.authority.snapshot().revokedSessions.length, 1);
  assert.equal(await setup.storage.get(client.storageKey), null);
});

test("network transition after Gateway completion protects the session for Retry and disconnect", async () => {
  const protectedStorage = storage(); let client; let transitionAfterSessionWrite = true;
  const set = protectedStorage.set.bind(protectedStorage);
  protectedStorage.set = async (key, value) => {
    await set(key, value);
    if (transitionAfterSessionWrite && key === client.storageKey) {
      transitionAfterSessionWrite = false;
      client.setNetworkAvailable(false);
    }
  };
  const setup = harness(protectedStorage); client = setup.client;
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await client.handleReturn(callback)).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal(setup.authority.snapshot().sessions.length, 1);
  assert.notEqual(await protectedStorage.get(client.storageKey), null);
  client.setNetworkAvailable(true);
  assert.equal((await client.retry({ walletInstalled: true, schemeRegistered: true })).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal((await client.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(setup.authority.snapshot().revokedSessions.length, 1);
  assert.equal(await protectedStorage.get(client.storageKey), null);
});

test("restore and Retry share one second-launch re-introspection", async () => {
  const first = harness();
  const connecting = await first.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  assert.equal((await first.client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  let releaseIntrospection; let markStarted; let introspectionCalls = 0;
  const introspectionStarted = new Promise((resolve) => { markStarted = resolve; });
  const release = new Promise((resolve) => { releaseIntrospection = resolve; });
  const gateway = { ...first.gateway, async introspect(input) { introspectionCalls += 1; markStarted(); await release; return first.gateway.introspect(input); } };
  const second = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: first.storage, gateway, device, tokenFactory: () => token("recovery-single-flight"), clock: () => NOW });
  const restoring = second.restore(true);
  await introspectionStarted;
  const retrying = second.retry({ walletInstalled: true, schemeRegistered: true });
  releaseIntrospection();
  assert.equal((await restoring).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal((await retrying).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(introspectionCalls, 1);
});

test("disconnect waits a second-launch recovery and cannot leave it connected", async () => {
  const first = harness();
  const connecting = await first.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  assert.equal((await first.client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  let releaseIntrospection; let markStarted;
  const introspectionStarted = new Promise((resolve) => { markStarted = resolve; });
  const release = new Promise((resolve) => { releaseIntrospection = resolve; });
  const gateway = { ...first.gateway, async introspect(input) { markStarted(); await release; return first.gateway.introspect(input); } };
  const second = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: first.storage, gateway, device, tokenFactory: () => token("disconnect-recovery-race"), clock: () => NOW });
  const restoring = second.restore(true);
  await introspectionStarted;
  const disconnecting = second.disconnect();
  releaseIntrospection();
  assert.equal((await restoring).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal((await disconnecting).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(second.current.status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(first.authority.snapshot().revokedSessions.length, 1);
  assert.equal(await first.storage.get(second.storageKey), null);
});

test("network transition during Gateway challenge cannot publish a late connected state", async () => {
  const setup = harness(); let releaseChallenge; let completionCalls = 0;
  const challengeReady = new Promise((resolve) => { releaseChallenge = resolve; });
  const gateway = {
    ...setup.gateway,
    async challenge(input) { await challengeReady; return setup.gateway.challenge(input); },
    async complete(input) { completionCalls += 1; return setup.gateway.complete(input); },
  };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`network-race-${i++}`); })(), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const returning = client.handleReturn(callback);
  assert.equal(client.setNetworkAvailable(false).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  releaseChallenge();
  const result = await returning;
  assert.equal(result.status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal(completionCalls, 0);
  assert.equal(await setup.storage.get(client.storageKey), null);
  assert.notEqual(await setup.storage.get(`${client.storageKey}:return`), null);
  assert.equal("session" in result, false);
});

test("network transition during second-launch introspection retains storage without publishing connection", async () => {
  const first = harness();
  const connecting = await first.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await first.client.handleReturn(callback)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  let releaseIntrospection; let markStarted;
  const introspectionStarted = new Promise((resolve) => { markStarted = resolve; });
  const release = new Promise((resolve) => { releaseIntrospection = resolve; });
  const gateway = { ...first.gateway, async introspect(input) { markStarted(); await release; return first.gateway.introspect(input); } };
  const second = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: first.storage, gateway, device, tokenFactory: () => token("restore-network-race"), clock: () => NOW });
  const restoring = second.restore(true);
  await introspectionStarted;
  assert.equal(second.setNetworkAvailable(false).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  releaseIntrospection();
  const result = await restoring;
  assert.equal(result.status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal("session" in result, false);
  assert.notEqual(await first.storage.get(second.storageKey), null);
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
    async introspect(input) { if (networkUnavailable) throw new WalletAuthError("NETWORK_UNAVAILABLE", "temporary outage"); return first.gateway.introspect(input); },
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

test("an unmounted canonical Gateway route retains the approved callback for explicit Retry", async () => {
  const setup = harness(); let mounted = false;
  const gateway = { ...setup.gateway, async challenge(input) { if (!mounted) throw new WalletAuthError("ROUTE_NOT_MOUNTED", "old Gateway deployment"); return setup.gateway.challenge(input); } };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`route-not-mounted-${i++}`); })(), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const unavailable = await client.handleReturn(callback);
  assert.equal(unavailable.status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.match(unavailable.message, /route is not mounted/);
  assert.notEqual(await setup.storage.get(`${client.storageKey}:pending`), null);
  assert.equal(await setup.storage.get(`${client.storageKey}:return`), callback);
  mounted = true;
  assert.equal((await client.retry({ walletInstalled: true, schemeRegistered: true })).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
});

test("device secret never crosses the Gateway adapter boundary", async () => {
  const setup = harness(); const seen = [];
  const gateway = {
    ...setup.gateway,
    async challenge(input) { seen.push(input); return setup.gateway.challenge(input); },
    async complete(input) { seen.push(input); return setup.gateway.complete(input); },
    async introspect(input) { seen.push(input); return setup.gateway.introspect(input); },
  };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`secret-boundary-${i++}`); })(), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  assert.equal((await client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(JSON.stringify(seen).includes(device.secret), false);
  assert.equal(seen.some((input) => Object.hasOwn(input, "deviceSecret")), false);
});

test("platform secure signer covers challenge, introspection, restart and revoke without exposing a secret", async () => {
  const setup = harness(); const purposes = [];
  const secureDevice = {
    id: device.id, key: device.key, scopes: device.scopes, purpose: device.purpose,
    async sign(input) {
      purposes.push(input.purpose);
      assert.equal(input.algorithm, "p256-sha256");
      assert.equal(input.deviceKey, device.key);
      return Buffer.from(p256.sign(Buffer.from(input.payload, "base64url"), deviceSecret, { format: "der" })).toString("base64url");
    },
  };
  let tokenIndex = 0;
  const first = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway: setup.gateway, device: secureDevice, tokenFactory: () => token(`secure-signer-${tokenIndex++}`), clock: () => NOW });
  const connecting = await first.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  assert.equal((await first.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  const restarted = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway: setup.gateway, device: secureDevice, tokenFactory: () => token(`secure-signer-${tokenIndex++}`), clock: () => NOW });
  assert.equal((await restarted.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal((await restarted.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.deepEqual(purposes, ["challenge", "http-proof", "http-proof", "http-proof"]);
  assert.equal(Object.hasOwn(secureDevice, "secret"), false);
  assert.equal(setup.authority.snapshot().revokedSessions.length, 1);
});

test("platform signer failure or wrong-key signature fails closed before completion", async () => {
  for (const sign of [
    async () => { throw new Error("platform denied"); },
    async ({ payload }) => Buffer.from(p256.sign(Buffer.from(payload, "base64url"), Buffer.alloc(32, 11), { format: "der" })).toString("base64url"),
  ]) {
    const setup = harness(); let completionCalls = 0;
    const gateway = { ...setup.gateway, async complete(input) { completionCalls += 1; return setup.gateway.complete(input); } };
    const secureDevice = { id: device.id, key: device.key, sign, scopes: device.scopes, purpose: device.purpose };
    const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device: secureDevice, tokenFactory: () => token(`secure-signer-failure-${completionCalls}`), clock: () => NOW });
    const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
    const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
    assert.equal((await client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
    assert.equal(completionCalls, 0);
    assert.equal(await setup.storage.get(client.storageKey), null);
  }
});

test("network transition during platform challenge signing sends no late completion", async () => {
  const setup = harness(); let releaseSigning; let markSigning; let completionCalls = 0; let shouldBlock = true;
  const signingStarted = new Promise((resolve) => { markSigning = resolve; });
  const signingRelease = new Promise((resolve) => { releaseSigning = resolve; });
  const secureDevice = {
    id: device.id, key: device.key, scopes: device.scopes, purpose: device.purpose,
    async sign(input) {
      if (input.purpose === "challenge" && shouldBlock) { shouldBlock = false; markSigning(); await signingRelease; }
      return Buffer.from(p256.sign(Buffer.from(input.payload, "base64url"), deviceSecret, { format: "der" })).toString("base64url");
    },
  };
  const gateway = { ...setup.gateway, async complete(input) { completionCalls += 1; return setup.gateway.complete(input); } };
  let tokenIndex = 0;
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device: secureDevice, tokenFactory: () => token(`signing-network-complete-${tokenIndex++}`), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const returning = client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW));
  await signingStarted;
  client.setNetworkAvailable(false); releaseSigning();
  assert.equal((await returning).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal(completionCalls, 0);
  assert.notEqual(await setup.storage.get(`${client.storageKey}:return`), null);
  client.setNetworkAvailable(true);
  assert.equal((await client.retry({ walletInstalled: true, schemeRegistered: true })).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
});

test("network transition during platform proof signing sends no late introspection or revoke", async () => {
  const setup = harness(); let blockPurpose = null; let releaseSigning; let markSigning; let signingStarted; let introspectionCalls = 0; let revokeCalls = 0;
  function blockNextProof() {
    blockPurpose = "http-proof";
    signingStarted = new Promise((resolve) => { markSigning = resolve; });
    return signingStarted;
  }
  const secureDevice = {
    id: device.id, key: device.key, scopes: device.scopes, purpose: device.purpose,
    async sign(input) {
      if (input.purpose === blockPurpose) {
        blockPurpose = null; markSigning();
        await new Promise((resolve) => { releaseSigning = resolve; });
      }
      return Buffer.from(p256.sign(Buffer.from(input.payload, "base64url"), deviceSecret, { format: "der" })).toString("base64url");
    },
  };
  const gateway = {
    ...setup.gateway,
    async introspect(input) { introspectionCalls += 1; return setup.gateway.introspect(input); },
    async revoke(input) { revokeCalls += 1; return setup.gateway.revoke(input); },
  };
  let tokenIndex = 0;
  const first = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device: secureDevice, tokenFactory: () => token(`signing-network-proof-${tokenIndex++}`), clock: () => NOW });
  const connecting = await first.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  assert.equal((await first.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);

  const second = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device: secureDevice, tokenFactory: () => token(`signing-network-proof-${tokenIndex++}`), clock: () => NOW });
  const restoreSigning = blockNextProof(); const restoring = second.restore(true); await restoreSigning;
  const introspectionBefore = introspectionCalls;
  second.setNetworkAvailable(false); releaseSigning();
  assert.equal((await restoring).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal(introspectionCalls, introspectionBefore);
  assert.notEqual(await setup.storage.get(second.storageKey), null);
  second.setNetworkAvailable(true);
  assert.equal((await second.retry({ walletInstalled: true, schemeRegistered: true })).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);

  const revokeSigning = blockNextProof(); const disconnecting = second.disconnect(); await revokeSigning;
  second.setNetworkAvailable(false); releaseSigning();
  assert.equal((await disconnecting).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal(revokeCalls, 0);
  assert.notEqual(await setup.storage.get(second.storageKey), null);
  second.setNetworkAvailable(true);
  assert.equal((await second.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(revokeCalls, 1);
});

test("substituted Gateway challenge fails before device signing or completion", async () => {
  const setup = harness(); let completionCalls = 0;
  const gateway = {
    ...setup.gateway,
    async challenge(input) { return { ...(await setup.gateway.challenge(input)), origin: "https://attacker.example" }; },
    async complete(input) { completionCalls += 1; return setup.gateway.complete(input); },
  };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`challenge-substitution-${i++}`); })(), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const result = await client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW));
  assert.equal(result.status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.equal(completionCalls, 0);
  assert.equal(await setup.storage.get(client.storageKey), null);
});

test("expired Gateway challenge is rejected before device signing", async () => {
  const setup = harness(); let completionCalls = 0; let current = NOW;
  const gateway = { ...setup.gateway, async complete(input) { completionCalls += 1; return setup.gateway.complete(input); } };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: setup.storage, gateway, device, tokenFactory: (() => { let i = 0; return () => token(`challenge-expiry-${i++}`); })(), clock: () => current });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret, scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  current = new Date(NOW.getTime() + 61_000);
  assert.equal((await client.handleReturn(callback)).status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.equal(completionCalls, 0);
});

test("dangling or malformed protected callbacks fail closed and are removed", async () => {
  const setup = harness();
  await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const malformed = await setup.client.handleReturn("ynx-social");
  assert.equal(malformed.status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.equal(malformed.message, "Return to the product and start a new Wallet request");
  assert.equal(await setup.storage.get(`${setup.client.storageKey}:return`), null);
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
  const { challenge: _challenge, ...missingChallenge } = valid.gateway;
  assert.throws(() => new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage: valid.storage, gateway: missingChallenge, device, tokenFactory: () => token("y"), clock: () => NOW }), code("INVALID_GATEWAY"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
