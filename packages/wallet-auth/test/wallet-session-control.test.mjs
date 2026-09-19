import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  canonicalJSON, createProductSessionRequest, signProductSessionApproval, signProductSessionChallenge,
  createWalletSessionControlProof, verifyWalletSessionControlProof, encodeWalletSessionControlProofHeader,
  decodeWalletSessionControlProofHeader, walletSessionControlReplayKey, httpBodyDigest, walletIdentity,
  ProductSessionAuthority, ProductSessionGatewayHttpHandler, createProductSessionProofV2,
  encodeProductSessionGatewayProofHeaderV2, walletSessionControlReplayExpiry,
} from "../src/index.js";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";
import { walletSessionControlClockAnchor, walletSessionControlClockAnchorTime, walletSessionControlClockFloor } from "../src/wallet-session-control.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-09-06T10:00:00.000Z"), OWNER = "1".padStart(64, "0"), OTHER = "2".padStart(64, "0");
const INVENTORY = "/v2/product-sessions/wallet/sessions", REVOKE = `${INVENTORY}/revoke`;
const token = label => createHash("sha256").update(label).digest("base64url");
const deviceSecret = Buffer.alloc(32, 29), deviceKey = Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url");

function fixture() {
  const authority = new ProductSessionAuthority(registry);
  const sessions = [OWNER, OTHER].map((accountSecret, index) => {
    const request = createProductSessionRequest(registry, { productId: "creator-studio", platform: "web", deviceId: `owner-control-device-${index}`, deviceKey, scopes: ["creator:account"], purpose: "Verify Wallet session control.", nonce: token(`request-${index}`), state: token(`state-${index}`) }, NOW);
    const approval = signProductSessionApproval(registry, request, { accountSecret, scopes: request.scopes, expiresAt: request.expiresAt }, NOW);
    const challenge = authority.issueChallenge({ request, approval, challenge: token(`challenge-${index}`) }, NOW);
    return authority.complete({ request, approval, completion: signProductSessionChallenge(challenge, deviceSecret.toString("base64url")) }, NOW);
  });
  const snapshot = { schemaVersion: 2, authority: authority.snapshot(), consumedProofs: [], idempotency: [], audit: [] };
  return { sessions, snapshot, handler: new ProductSessionGatewayHttpHandler(registry, () => token("unused"), snapshot) };
}
function ownerProof(path = INVENTORY, body = {}, label = "owner-control", accountSecret = OWNER, at = NOW) {
  return createWalletSessionControlProof({ accountSecret, method: "POST", path, bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token(label), issuedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 30_000).toISOString() });
}
function call(handler, path = INVENTORY, body = {}, proof = ownerProof(path, body), at = NOW, additional = {}) {
  return handler.handle({ requestId: `req_owner_${proof.nonce}`, method: "POST", path, contentType: "application/json", body: canonicalJSON(body), proofHeader: null, walletControlProofHeader: encodeWalletSessionControlProofHeader(proof), networkAvailable: true, ...additional }, at);
}
function payload(response) { return JSON.parse(response.body); }

test("owner signatures are domain-bound, exact, short-lived and cannot be replaced by device signatures", () => {
  const proof = ownerProof(), context = { method: "POST", path: INVENTORY, bodyDigest: httpBodyDigest("{}") };
  assert.deepEqual(decodeWalletSessionControlProofHeader(encodeWalletSessionControlProofHeader(proof)), proof);
  assert.deepEqual(verifyWalletSessionControlProof(proof, context, NOW), proof);
  assert.throws(() => verifyWalletSessionControlProof(proof, context, new Date(NOW.getTime() - 1)), { code: "ISSUED_IN_FUTURE" });
  assert.throws(() => verifyWalletSessionControlProof(proof, context, new Date(NOW.getTime() + 30_000)), { code: "SESSION_EXPIRED" });
  for (const changed of [{ audience: "https://attacker.example" }, { chainId: "other" }, { method: "GET" }, { path: "/v2/product-sessions/revoke" }, { expiresAt: new Date(NOW.getTime() + 30_001).toISOString() }]) assert.throws(() => verifyWalletSessionControlProof({ ...proof, ...changed }, context, NOW));
  for (const changed of [{ bodyDigest: "a".repeat(64) }, { account: walletIdentity(OTHER).account }, { signature: "0".repeat(128) }, { accountPublicKey: Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("hex") }]) assert.throws(() => verifyWalletSessionControlProof({ ...proof, ...changed }, context, NOW));
  const { signature: _signature, ...unsigned } = proof;
  const wrongDomain = Buffer.from(p256.sign(Buffer.from(canonicalJSON(unsigned)), deviceSecret, { format: "compact" })).toString("hex");
  assert.throws(() => verifyWalletSessionControlProof({ ...proof, signature: wrongDomain }, context, NOW), { code: "INVALID_SIGNATURE" });
  for (const prefix of ["", "YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n", "YNX_WALLET_SESSION_CONTROL_PROOF_V2"]) {
    const signature = Buffer.from(secp256k1.sign(sha256(Buffer.from(prefix + canonicalJSON(unsigned))), Buffer.from(OWNER, "hex"), { prehash: false, format: "compact", lowS: true })).toString("hex");
    assert.throws(() => verifyWalletSessionControlProof({ ...proof, signature }, context, NOW), { code: "INVALID_SIGNATURE" });
  }
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = proof.signature.slice(0, 64) + (order - BigInt(`0x${proof.signature.slice(64)}`)).toString(16).padStart(64, "0");
  assert.throws(() => verifyWalletSessionControlProof({ ...proof, signature: highS }, context, NOW), { code: "INVALID_SIGNATURE" });
  assert.throws(() => decodeWalletSessionControlProofHeader(Buffer.from(JSON.stringify(proof, null, 2)).toString("base64url")), { code: "INVALID_PROOF_HEADER" });
});

test("inventory is account-private and only a successful signed query can return empty", () => {
  const { handler, sessions } = fixture();
  const response = call(handler), result = payload(response).result;
  assert.equal(response.status, 200); assert.equal(result.account, walletIdentity(OWNER).account); assert.equal(result.asOf, NOW.toISOString());
  assert.equal(result.sessions.length, 1); assert.equal(result.sessions[0].sessionBinding, sessions[0].sessionBinding);
  assert.equal(result.sessions[0].displayName, "YNX Creator Studio"); assert.equal(result.sessions[0].applicationId, "com.ynxweb4.creator-studio.web");
  assert.equal(result.sessions[0].active, true); assert.deepEqual(result.sessions[0].inactiveReasons, []);
  assert.equal(response.body.includes(sessions[1].sessionBinding), false); assert.equal(response.body.includes(sessions[1].account), false);
  assert.equal("deviceKey" in result.sessions[0], false); assert.equal("purpose" in result.sessions[0], false);
  const empty = call(handler, INVENTORY, {}, ownerProof(INVENTORY, {}, "empty-owner", "3".padStart(64, "0")));
  assert.equal(empty.status, 200); assert.deepEqual(payload(empty).result.sessions, []);
  const missing = call(handler, INVENTORY, {}, ownerProof(INVENTORY, {}, "missing-proof"), NOW, { walletControlProofHeader: null });
  assert.equal(missing.status, 403); assert.equal(payload(missing).error.code, "PROOF_REQUIRED"); assert.equal("result" in payload(missing), false);
});

test("owner revoke changes only the owned target and a fresh proof reconciles a lost acknowledgement", () => {
  const { handler, sessions } = fixture();
  const otherBody = { sessionBinding: sessions[1].sessionBinding };
  const denied = call(handler, REVOKE, otherBody, ownerProof(REVOKE, otherBody, "cross-account"));
  assert.equal(denied.status, 404); assert.equal(handler.snapshot().authority.revokedSessions.length, 0);
  const body = { sessionBinding: sessions[0].sessionBinding }, proof = ownerProof(REVOKE, body, "revoke-owned");
  const revoked = call(handler, REVOKE, body, proof);
  assert.equal(revoked.status, 200);
  assert.deepEqual(payload(revoked).result, { account: sessions[0].account, sessionBinding: sessions[0].sessionBinding, revoked: true, alreadyRevoked: false, asOf: NOW.toISOString() });
  const replay = call(handler, REVOKE, body, proof);
  assert.equal(replay.status, 409); assert.equal(payload(replay).error.code, "REPLAY");
  const retry = call(handler, REVOKE, body, ownerProof(REVOKE, body, "lost-ack-retry"));
  assert.equal(payload(retry).result.alreadyRevoked, true);
  assert.deepEqual(handler.snapshot().authority.revokedSessions, [sessions[0].sessionBinding]);
  const inventory = payload(call(handler, INVENTORY, {}, ownerProof(INVENTORY, {}, "after-revoke"))).result;
  assert.equal(inventory.sessions[0].active, false); assert.deepEqual(inventory.sessions[0].inactiveReasons, ["session-revoked"]);
  const productProof = createProductSessionProofV2(sessions[0], { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest('{"requiredScopes":[]}'), nonce: token("product-after-owner-revoke"), issuedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 30_000).toISOString() }, deviceSecret.toString("base64url"));
  const productResult = handler.handle({ requestId: "req_product_post_owner_revoke", method: "POST", path: "/v2/product-sessions/introspect", body: '{"requiredScopes":[]}', contentType: "application/json", proofHeader: encodeProductSessionGatewayProofHeaderV2(productProof), networkAvailable: true }, NOW);
  assert.equal(payload(productResult).error.code, "SESSION_REVOKED");
});

test("nonce reuse is blocked across control operations, scoped to its account and separate from product proof digests", () => {
  const { handler, sessions } = fixture(), first = ownerProof(INVENTORY, {}, "same-nonce");
  assert.equal(call(handler, INVENTORY, {}, first).status, 200);
  const body = { sessionBinding: sessions[0].sessionBinding }, second = ownerProof(REVOKE, body, "same-nonce");
  assert.equal(walletSessionControlReplayKey(first), walletSessionControlReplayKey(second));
  assert.equal(payload(call(handler, REVOKE, body, second)).error.code, "REPLAY");
  const other = ownerProof(INVENTORY, {}, "same-nonce", OTHER);
  assert.notEqual(walletSessionControlReplayKey(first), walletSessionControlReplayKey(other));
  assert.equal(call(handler, INVENTORY, {}, other).status, 200);
  assert.deepEqual(handler.snapshot().authority.revokedSessions, []);
});

test("body widening, substitution and combined or misplaced proof headers fail without consuming owner authority", () => {
  const { handler, sessions } = fixture(), proof = ownerProof();
  assert.equal(handler.handle(null, NOW).status, 400);
  const productProof = createProductSessionProofV2(sessions[0], { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest('{"requiredScopes":[]}'), nonce: token("wrong-header-product"), issuedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 30_000).toISOString() }, deviceSecret.toString("base64url"));
  const productHeader = encodeProductSessionGatewayProofHeaderV2(productProof);
  const cases = [
    call(handler, INVENTORY, { account: sessions[1].account }, ownerProof(INVENTORY, { account: sessions[1].account }, "widened")),
    call(handler, REVOKE, { sessionBinding: sessions[0].sessionBinding }, proof),
    call(handler, INVENTORY, {}, proof, NOW, { proofHeader: productHeader }),
    call(handler, INVENTORY, {}, proof, NOW, { proofHeader: productHeader, walletControlProofHeader: null }),
    call(handler, "/v2/product-sessions/introspect", { requiredScopes: [] }, proof),
  ];
  for (const response of cases) assert.ok(response.status >= 400);
  assert.deepEqual(handler.snapshot().consumedProofs, []); assert.deepEqual(handler.snapshot().authority.revokedSessions, []);
});

test("inventory derives expired, device-revoked and account-revoked state from the same v2 authority", () => {
  const { snapshot, sessions } = fixture();
  const authority = new ProductSessionAuthority(registry, snapshot.authority);
  authority.revokeDevice(sessions[0].deviceBinding); authority.revokeAccount(sessions[0].account, NOW);
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), { ...snapshot, authority: authority.snapshot() });
  const later = new Date(Date.parse(sessions[0].expiresAt));
  const result = payload(call(handler, INVENTORY, {}, ownerProof(INVENTORY, {}, "expired-inventory", OWNER, later), later)).result;
  assert.equal(result.sessions[0].active, false);
  assert.deepEqual(result.sessions[0].inactiveReasons, ["device-revoked", "account-revoked", "expired"]);
});

test("control replay records expire without permitting old proofs or touching product replay records", () => {
  const { snapshot } = fixture(), legacy = "1".repeat(64);
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), { ...snapshot, consumedProofs: [legacy] });
  const first = ownerProof(INVENTORY, {}, "expires-and-restarts");
  assert.equal(call(handler, INVENTORY, {}, first).status, 200);
  const changedExpiry = createWalletSessionControlProof({ accountSecret: OWNER, method: "POST", path: INVENTORY, bodyDigest: httpBodyDigest("{}"), nonce: first.nonce, issuedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 29_000).toISOString() });
  assert.equal(payload(call(handler, INVENTORY, {}, changedExpiry)).error.code, "REPLAY");
  const restarted = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), handler.snapshot());
  assert.equal(payload(call(restarted, INVENTORY, {}, first)).error.code, "REPLAY");
  assert.equal(walletSessionControlReplayExpiry(walletSessionControlReplayKey(first)), NOW.getTime() + 30_000);
  const afterExpiry = new Date(NOW.getTime() + 30_000);
  assert.equal(payload(call(restarted, INVENTORY, {}, first, afterExpiry)).error.code, "SESSION_EXPIRED");
  assert.deepEqual(restarted.snapshot().consumedProofs, [legacy, walletSessionControlClockAnchor(afterExpiry)].sort());
  const newlySigned = ownerProof(INVENTORY, {}, "expires-and-restarts", OWNER, afterExpiry);
  assert.equal(call(restarted, INVENTORY, {}, newlySigned, afterExpiry).status, 200);
  assert.equal(restarted.snapshot().consumedProofs.includes(legacy), true);
});

test("many empty inventories hit only the bounded control quota and leave product authorization available", () => {
  const { handler, sessions } = fixture();
  const unknownOwner = "3".padStart(64, "0");
  for (let index = 0; index < 512; index++) {
    const response = call(handler, INVENTORY, {}, ownerProof(INVENTORY, {}, `empty-quota-${index}`, unknownOwner));
    assert.equal(response.status, 200); assert.deepEqual(payload(response).result.sessions, []);
  }
  const rejected = call(handler, INVENTORY, {}, ownerProof(INVENTORY, {}, "empty-quota-over", unknownOwner));
  assert.equal(payload(rejected).error.code, "CAPACITY"); assert.equal(handler.snapshot().consumedProofs.length, 513);
  assert.equal(handler.snapshot().consumedProofs.filter(record => walletSessionControlReplayExpiry(record) !== null).length, 512);
  const productBody = { requiredScopes: ["creator:account"] };
  const proof = createProductSessionProofV2(sessions[0], { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(canonicalJSON(productBody)), nonce: token("product-after-empty-quota"), issuedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 30_000).toISOString() }, deviceSecret.toString("base64url"));
  const response = handler.handle({ requestId: "req_product_survives_owner_quota", method: "POST", path: proof.path, body: canonicalJSON(productBody), contentType: "application/json", proofHeader: encodeProductSessionGatewayProofHeaderV2(proof), networkAvailable: true }, NOW);
  assert.equal(response.status, 200); assert.equal(payload(response).result.active, true);
  const revokeProof = createProductSessionProofV2(sessions[0], { method: "POST", path: "/v2/product-sessions/revoke", bodyDigest: httpBodyDigest("{}"), nonce: token("product-revoke-after-empty-quota"), issuedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 30_000).toISOString() }, deviceSecret.toString("base64url"));
  const revoked = handler.handle({ requestId: "req_product_revokes_after_owner_quota", method: "POST", path: revokeProof.path, body: "{}", contentType: "application/json", proofHeader: encodeProductSessionGatewayProofHeaderV2(revokeProof), networkAvailable: true }, NOW);
  assert.equal(revoked.status, 200); assert.equal(payload(revoked).result.revoked, sessions[0].sessionBinding);
});

test("control admission stops at 18000 total records and expired control cleanup preserves legacy capacity", () => {
  const { snapshot } = fixture();
  const legacy = Array.from({ length: 17_998 }, (_, index) => index.toString(16).padStart(64, "0"));
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), { ...snapshot, consumedProofs: legacy });
  assert.equal(call(handler, INVENTORY, {}, ownerProof(INVENTORY, {}, "last-control-slot")).status, 200);
  assert.equal(handler.snapshot().consumedProofs.length, 18_000);
  assert.equal(payload(call(handler, INVENTORY, {}, ownerProof(INVENTORY, {}, "reserved-product-budget"))).error.code, "CAPACITY");
  assert.equal(handler.snapshot().consumedProofs.length, 18_000);
  const afterExpiry = new Date(NOW.getTime() + 30_000);
  assert.equal(call(handler, INVENTORY, {}, ownerProof(INVENTORY, {}, "new-window", OWNER, afterExpiry), afterExpiry).status, 200);
  assert.deepEqual(handler.snapshot().consumedProofs.filter(record => walletSessionControlReplayExpiry(record) === null && walletSessionControlClockAnchorTime(record) === null), legacy);
  const withAnchor = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), { ...snapshot, consumedProofs: [...legacy, walletSessionControlClockAnchor(NOW)].sort() });
  assert.equal(call(withAnchor, INVENTORY, {}, ownerProof(INVENTORY, {}, "last-with-anchor")).status, 200);
  assert.equal(withAnchor.snapshot().consumedProofs.length, 18_000);
  const withoutAnchor = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), { ...snapshot, consumedProofs: [...legacy, "a".repeat(64)].sort() });
  assert.equal(payload(call(withoutAnchor, INVENTORY, {}, ownerProof(INVENTORY, {}, "two-slots-needed"))).error.code, "CAPACITY");
  assert.equal(withoutAnchor.snapshot().consumedProofs.length, 17_999);
});

test("expired nonce cleanup cannot re-enable proofs after clock rollback or audit rollover and restart", () => {
  const { handler } = fixture(), proof = ownerProof(INVENTORY, {}, "clock-rollback");
  assert.equal(call(handler, INVENTORY, {}, proof).status, 200);
  const afterExpiry = new Date(NOW.getTime() + 31_000), regressed = new Date(NOW.getTime() + 29_000);
  assert.equal(payload(call(handler, INVENTORY, {}, proof, afterExpiry)).error.code, "SESSION_EXPIRED");
  assert.deepEqual(handler.snapshot().consumedProofs, [walletSessionControlClockAnchor(afterExpiry)]);
  const denied = call(handler, INVENTORY, {}, proof, regressed);
  assert.equal(denied.status, 503); assert.equal(payload(denied).error.code, "CLOCK_UNAVAILABLE");
  assert.equal(handler.snapshot().audit.at(-1).at, afterExpiry.toISOString());
  const snapshot = handler.snapshot();
  const fullAudit = Array.from({ length: 20_000 }, (_, index) => ({ sequence: index + 1, requestId: `req_rollover_clock_${String(index).padStart(6, "0")}`, path: INVENTORY, outcome: "rejected", code: "SESSION_EXPIRED", subject: "none", at: (index === 0 ? afterExpiry : NOW).toISOString() }));
  const rolling = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), { ...snapshot, audit: fullAudit });
  assert.equal(payload(call(rolling, INVENTORY, {}, proof, regressed)).error.code, "CLOCK_UNAVAILABLE");
  const rolled = rolling.snapshot();
  assert.equal(rolled.audit.length, 20_000); assert.equal(rolled.audit[0].at, NOW.toISOString());
  assert.equal(rolled.audit.at(-1).at, afterExpiry.toISOString());
  const restarted = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), rolled);
  assert.equal(payload(call(restarted, INVENTORY, {}, proof, regressed)).error.code, "CLOCK_UNAVAILABLE");
  assert.equal(payload(call(restarted, INVENTORY, {}, proof, afterExpiry)).error.code, "SESSION_EXPIRED");
  assert.equal(call(restarted, INVENTORY, {}, ownerProof(INVENTORY, {}, "clock-caught-up", OWNER, afterExpiry), afterExpiry).status, 200);
});

test("clock anchors preserve audit maxima and transitional control records before any cleanup", () => {
  const { snapshot } = fixture(), proof = ownerProof(INVENTORY, {}, "transition-without-anchor");
  const later = new Date(NOW.getTime() + 31_000), regressed = new Date(NOW.getTime() + 29_000);
  const lookalike = walletSessionControlClockAnchor(NOW).slice(0, -1) + "1";
  assert.equal(walletSessionControlClockAnchorTime(lookalike), null);
  const transitional = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), { ...snapshot, consumedProofs: [lookalike, walletSessionControlReplayKey(proof)].sort() });
  assert.equal(payload(call(transitional, INVENTORY, {}, proof, later)).error.code, "SESSION_EXPIRED");
  assert.deepEqual(transitional.snapshot().consumedProofs, [lookalike, walletSessionControlClockAnchor(later)].sort());
  assert.equal(payload(call(transitional, INVENTORY, {}, proof, regressed)).error.code, "CLOCK_UNAVAILABLE");
  const aheadAudit = { ...transitional.snapshot(), consumedProofs: [walletSessionControlClockAnchor(NOW)] };
  const oldAnchor = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), aheadAudit);
  assert.equal(payload(call(oldAnchor, INVENTORY, {}, proof, regressed)).error.code, "CLOCK_UNAVAILABLE");
  assert.deepEqual(oldAnchor.snapshot().consumedProofs, [walletSessionControlClockAnchor(later)]);
  const auditLost = { ...oldAnchor.snapshot(), audit: [] };
  assert.equal(walletSessionControlClockFloor(auditLost), later.getTime());
  const restarted = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), auditLost);
  assert.equal(payload(call(restarted, INVENTORY, {}, proof, regressed)).error.code, "CLOCK_UNAVAILABLE");
  const full = [...Array.from({ length: 19_999 }, (_, index) => index.toString(16).padStart(64, "0")), walletSessionControlReplayKey(proof)].sort();
  const atCapacity = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), { ...snapshot, consumedProofs: full });
  assert.equal(payload(call(atCapacity, INVENTORY, {}, proof, later)).error.code, "CAPACITY");
  assert.deepEqual(atCapacity.snapshot().consumedProofs, full);
});

test("future and bad signatures never clear active owner nonces or legacy proof digests", () => {
  const { snapshot } = fixture(), legacy = "a".repeat(64);
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token("unused"), { ...snapshot, consumedProofs: [legacy] });
  const first = ownerProof(INVENTORY, {}, "active-kept");
  assert.equal(call(handler, INVENTORY, {}, first).status, 200);
  const before = handler.snapshot().consumedProofs;
  const future = ownerProof(INVENTORY, {}, "future-keeps-active", OWNER, new Date(NOW.getTime() + 1));
  assert.equal(payload(call(handler, INVENTORY, {}, future)).error.code, "ISSUED_IN_FUTURE");
  assert.deepEqual(handler.snapshot().consumedProofs, before);
  assert.equal(payload(call(handler, INVENTORY, {}, { ...first, signature: "0".repeat(128) })).error.code, "INVALID_SIGNATURE");
  assert.deepEqual(handler.snapshot().consumedProofs, before);
  assert.equal(payload(call(handler, INVENTORY, {}, first)).error.code, "REPLAY");
});

test("Node time refuses a regressed authority clock without rewriting state or audit", async () => {
  const { handler } = fixture(), proof = ownerProof(INVENTORY, {}, "time-clock-rollback");
  assert.equal(call(handler, INVENTORY, {}, proof).status, 200);
  const later = new Date(NOW.getTime() + 31_000);
  assert.equal(payload(call(handler, INVENTORY, {}, proof, later)).error.code, "SESSION_EXPIRED");
  // A rolled-back runtime may have replaced every audit event; the anchor alone must guard /time.
  const snapshot = { ...handler.snapshot(), audit: [] }, directory = mkdtempSync(join(tmpdir(), "ynx-wallet-clock-control-")); chmodSync(directory, 0o700);
  const statePath = join(directory, "state.json");
  writeFileSync(statePath, canonicalJSON({ schemaVersion: 1, snapshotDigest: createHash("sha256").update(canonicalJSON(snapshot)).digest("hex"), snapshot }), { mode: 0o600 });
  let at = new Date(NOW.getTime() + 29_000);
  const newHost = () => new ProductSessionGatewayNodeHost(registry, { statePath, now: () => at, tokenFactory: () => token("unused") });
  try {
    for (let restart = 0; restart < 2; restart++) {
      const host = newHost(), beforeState = readFileSync(statePath, "utf8"), beforeStat = statSync(statePath), beforeSnapshot = canonicalJSON(host.snapshot());
      await serve(host, async endpoint => {
        const response = await fetch(`${endpoint}/v2/product-sessions/time`, { headers: { origin: "https://wallet.ynxweb4.com", "x-request-id": "req_wallet_regressed_time_0001" } });
        assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "CLOCK_UNAVAILABLE");
        assert.equal(response.headers.get("cache-control"), "no-store");
      });
      assert.equal(readFileSync(statePath, "utf8"), beforeState); assert.equal(canonicalJSON(host.snapshot()), beforeSnapshot);
      const afterStat = statSync(statePath); assert.equal(afterStat.ino, beforeStat.ino); assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
    }
    at = later;
    await serve(newHost(), async endpoint => {
      const response = await fetch(`${endpoint}/v2/product-sessions/time`, { headers: { "x-request-id": "req_wallet_time_recovered_0001" } });
      assert.equal(response.status, 200); assert.equal((await response.json()).result.serverTime, later.toISOString());
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Node owner control restricts browser origins, persists revocation/replay across restart and fails closed on persist failure", async () => {
  const { snapshot, sessions } = fixture(), directory = mkdtempSync(join(tmpdir(), "ynx-wallet-owner-control-")); chmodSync(directory, 0o700);
  const statePath = join(directory, "state.json"), snapshotDigest = createHash("sha256").update(canonicalJSON(snapshot)).digest("hex");
  writeFileSync(statePath, canonicalJSON({ schemaVersion: 1, snapshotDigest, snapshot }), { mode: 0o600 });
  const newHost = () => new ProductSessionGatewayNodeHost(registry, { statePath, now: () => NOW, tokenFactory: () => token("unused") });
  const target = { sessionBinding: sessions[0].sessionBinding }, revokeProof = ownerProof(REVOKE, target, "node-owner-revoke");
  try {
    const host = newHost();
    await serve(host, async endpoint => {
      const preflight = headers => fetch(`${endpoint}${INVENTORY}`, { method: "OPTIONS", headers: { origin: "https://wallet.ynxweb4.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-request-id,x-ynx-wallet-control-proof-v2", ...headers } });
      assert.equal((await preflight({})).status, 204);
      assert.equal((await preflight({ origin: "https://creator.ynxweb4.com" })).status, 403);
      assert.equal((await preflight({ "access-control-request-headers": "x-ynx-product-session-proof-v2" })).status, 400);
      assert.equal((await fetch(`${endpoint}/v2/product-sessions/time`, { headers: { origin: "https://wallet.ynxweb4.com", "x-request-id": "req_wallet_time_cors_0001" } })).status, 200);
      const readProof = ownerProof(INVENTORY, {}, "node-wallet-origin");
      assert.equal((await postOwner(endpoint, INVENTORY, {}, readProof, { origin: "https://creator.ynxweb4.com" })).status, 403);
      assert.equal((await postOwner(endpoint, INVENTORY, {}, readProof, { origin: "https://wallet.ynxweb4.com" })).status, 200);
      const both = await postOwner(endpoint, REVOKE, target, revokeProof, { "x-ynx-product-session-proof-v2": "unexpected" });
      assert.equal(both.status, 400); assert.equal((await both.json()).error.code, "UNEXPECTED_PROOF");
      const before = canonicalJSON(host.snapshot()), persisted = readFileSync(statePath, "utf8");
      chmodSync(directory, 0o755); // Reads remain possible, but the atomic persistence policy must reject this directory.
      const denied = await postOwner(endpoint, REVOKE, target, revokeProof);
      assert.equal(denied.status, 500); assert.equal((await denied.json()).error.code, "STATE_PERMISSIONS");
      assert.equal(canonicalJSON(host.snapshot()), before); assert.equal(readFileSync(statePath, "utf8"), persisted);
      chmodSync(directory, 0o700);
      const accepted = await postOwner(endpoint, REVOKE, target, revokeProof);
      assert.equal(accepted.status, 200); assert.equal((await accepted.json()).result.alreadyRevoked, false);
    });
    await serve(newHost(), async endpoint => {
      const replay = await postOwner(endpoint, REVOKE, target, revokeProof);
      assert.equal(replay.status, 409); assert.equal((await replay.json()).error.code, "REPLAY");
      const retry = await postOwner(endpoint, REVOKE, target, ownerProof(REVOKE, target, "node-revoke-lost-ack"));
      assert.equal(retry.status, 200); assert.equal((await retry.json()).result.alreadyRevoked, true);
      const inventory = await postOwner(endpoint, INVENTORY, {}, ownerProof(INVENTORY, {}, "node-restart-inventory"));
      const result = (await inventory.json()).result;
      assert.equal(result.sessions[0].active, false); assert.deepEqual(result.sessions[0].inactiveReasons, ["session-revoked"]);
    });
  } finally { chmodSync(directory, 0o700); rmSync(directory, { recursive: true, force: true }); }
});

function postOwner(endpoint, path, body, proof, extraHeaders = {}) {
  return fetch(`${endpoint}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": `req_node_owner_${proof.nonce}`, "x-ynx-wallet-control-proof-v2": encodeWalletSessionControlProofHeader(proof), ...extraHeaders }, body: canonicalJSON(body) });
}
async function serve(host, operation) {
  const server = createServer(host.handler()); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await operation(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}
