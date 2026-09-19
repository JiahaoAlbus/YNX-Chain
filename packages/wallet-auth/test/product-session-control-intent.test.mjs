import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { digestHex } from "../src/canonical.js";
import {
  canonicalJSON, createProductSessionRequest, createWalletSessionControlProof, deviceBinding,
  httpBodyDigest, ProductSessionAuthority, ProductSessionGatewayKernel,
  parseProductSessionGatewaySnapshot, signProductSessionApproval, signProductSessionChallenge,
} from "../src/index.js";
import {
  assertProductSessionControlApprovalAllowed, assertProductSessionControlPlanBase,
  assertProductSessionControlSessionAllowed, migrateProductSessionControlSnapshotV2,
  observeDurableProductSessionControlIntent, parseProductSessionControlIntent,
  parseProductSessionControlSnapshot, prepareProductSessionControlIntent,
  productSessionControlIntentDigest,
} from "../src/product-session-control-intent.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-09-06T10:00:00.000Z"), at = (offset = 0) => new Date(NOW + offset);
const OWNER = "1".padStart(64, "0"), OTHER = "2".padStart(64, "0");
const token = (label) => createHash("sha256").update(label).digest("base64url");
const secret = Buffer.alloc(32, 49), secretText = secret.toString("base64url");
const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
const clone = (value) => JSON.parse(canonicalJSON(value));
function pending(label, { owner = OWNER, offset = 0, productId = "creator-studio", deviceId = "shared-control-device" } = {}) {
  const product = registry.products.find((item) => item.productId === productId);
  const request = createProductSessionRequest(registry, { productId, platform: "web", deviceId, deviceKey, scopes: [product.scopes[0]], purpose: "Verify fixed logout intent and durable receipt boundaries.", nonce: token(`${label}-nonce`), state: token(`${label}-state`) }, at(offset));
  const approval = signProductSessionApproval(registry, request, { accountSecret: owner, scopes: request.scopes, expiresAt: request.expiresAt }, at(offset));
  return { request, approval };
}
function intent(account, label, device, issued = 0, expires = 600_000) {
  return parseProductSessionControlIntent({ account, operation: device ? "device-logout" : "account-logout", body: { intentId: token(label), intentIssuedAt: at(issued).toISOString(), intentExpiresAt: at(expires).toISOString(), ...(device ? { deviceBinding: device } : {}) } });
}
function projectV2(state) {
  const { controlIntents, ...gateway } = state;
  const { revokedDeviceScopes, ...authority } = gateway.authority;
  return parseProductSessionGatewaySnapshot({ ...gateway, schemaVersion: 2, authority: { ...authority, schemaVersion: 2 } });
}
function fixture() {
  let sequence = 0;
  // Deterministic tokens keep candidate fixtures reproducible. Mixed-token
  // ordering and restart behavior have dedicated server regression coverage.
  const gateway = new ProductSessionGatewayKernel(registry, () => (++sequence).toString(16).padStart(64, "0"));
  const sessions = {}, approvals = {}, challenges = {};
  const options = { owner: {}, second: {}, dex: { productId: "dex" }, other: { owner: OTHER }, device: { deviceId: "different-control-device" }, pending: {}, foreignPending: { owner: OTHER } };
  for (const [label, binding] of Object.entries(options)) {
    const input = pending(label, binding);
    const challengeResponse = gateway.dispatch({ requestId: `req_control_${label}_challenge`, method: "POST", path: "/v2/product-sessions/challenge", body: input, proof: null, networkAvailable: true }, at());
    assert.equal(challengeResponse.status, 200, `${label}: ${challengeResponse.body}`);
    const challenge = JSON.parse(challengeResponse.body).result;
    approvals[label] = input; challenges[label] = challenge;
    if (label.endsWith("Pending") || label === "pending") continue;
    const response = gateway.dispatch({ requestId: `req_control_${label}_complete`, method: "POST", path: "/v2/product-sessions/complete", body: { ...input, completion: signProductSessionChallenge(challenge, secretText) }, proof: null, networkAvailable: true }, at());
    assert.equal(response.status, 200, `${label}: ${response.body}`);
    sessions[label] = JSON.parse(response.body).result;
  }
  const path = "/v2/product-sessions/wallet/sessions", body = {};
  const proof = createWalletSessionControlProof({ accountSecret: OWNER, method: "POST", path, bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token("control-inventory-proof"), issuedAt: at().toISOString(), expiresAt: at(30_000).toISOString() });
  assert.equal(gateway.dispatch({ requestId: "req_control_owner_inventory", method: "POST", path, body, proof: null, walletControlProof: proof, networkAvailable: true }, at()).status, 200);
  const v2 = gateway.snapshot();
  return { v2, state: migrateProductSessionControlSnapshotV2(v2), sessions, approvals, challenges };
}
function addSession(state, label, offset, options = {}) {
  const input = pending(label, { ...options, offset });
  assertProductSessionControlApprovalAllowed(state, registry, input.request, input.approval, at(offset));
  const authority = new ProductSessionAuthority(registry, projectV2(state).authority);
  const challenge = authority.issueChallenge({ ...input, challenge: token(`${label}-challenge`) }, at(offset));
  const session = authority.complete({ ...input, completion: signProductSessionChallenge(challenge, secretText) }, at(offset));
  const next = parseProductSessionControlSnapshot({ ...state, authority: { ...authority.snapshot(), schemaVersion: 3, revokedDeviceScopes: state.authority.revokedDeviceScopes } });
  return { state: next, session, input };
}
function allowed(state, session, offset) { return assertProductSessionControlSessionAllowed(state, session.sessionBinding, at(offset)); }

test("explicit v2 migration preserves real cache, proof/clock, audit and legacy tombstones without changing wire envelopes", () => {
  const setup = fixture(), authority = new ProductSessionAuthority(registry, setup.v2.authority);
  authority.revokeDevice(setup.sessions.other.deviceBinding);
  authority.revokeAccount(setup.sessions.other.account, at());
  const old = parseProductSessionGatewaySnapshot({ ...setup.v2, authority: authority.snapshot() });
  const before = canonicalJSON(old), migrated = migrateProductSessionControlSnapshotV2(old);
  assert.equal(canonicalJSON(projectV2(migrated)), before);
  assert.equal(canonicalJSON(old), before);
  assert.ok(old.consumedProofs.length >= 2);
  assert.ok(old.idempotency.length > 0 && old.audit.length > 0);
  assert.ok(migrated.idempotency.every((entry) => JSON.parse(entry.responseBody).schemaVersion === 2));
  assert.deepEqual(migrated.controlIntents, []);
  assert.deepEqual(migrated.authority.revokedDeviceScopes, []);
  assert.throws(() => parseProductSessionGatewaySnapshot(migrated));
  assert.throws(() => migrateProductSessionControlSnapshotV2(migrated));
  const invalid = clone(old); invalid.authority.sessions[0].deviceBinding = "0".repeat(64);
  assert.throws(() => migrateProductSessionControlSnapshotV2(invalid));
});

test("device logout fixes only the owning exact product/device scope even with shared keys across accounts", () => {
  const { state, sessions, challenges } = fixture();
  const command = intent(sessions.owner.account, "device-first", sessions.owner.deviceBinding);
  const before = canonicalJSON(state), prepared = prepareProductSessionControlIntent(state, command, at(10));
  assert.equal(prepared.status, "prepared"); assert.equal(prepared.revocationConfirmed, false);
  assert.equal(prepared.receipt, undefined); assert.equal(canonicalJSON(state), before);
  assert.ok(Object.isFrozen(prepared.candidate.authority.revokedDeviceScopes[0]));
  assert.deepEqual(prepared.preparedReceipt.sessionBindings, [sessions.owner.sessionBinding, sessions.second.sessionBinding].sort());
  assert.deepEqual(prepared.preparedReceipt.challengeIds, [challenges.pending.challenge]);
  assert.equal(prepared.preparedReceipt.revokedSessionCount, 2);
  assert.equal(prepared.preparedReceipt.cancelledChallengeCount, 1);
  assert.deepEqual(prepared.candidate.authority.issuedChallenges, state.authority.issuedChallenges);
  assert.deepEqual(prepared.candidate.authority.revokedDevices, state.authority.revokedDevices);
  for (const label of ["owner", "second"]) assert.throws(() => allowed(prepared.candidate, sessions[label], 10), { code: "SESSION_REVOKED" });
  for (const label of ["dex", "other", "device"]) assert.equal(allowed(prepared.candidate, sessions[label], 10).sessionBinding, sessions[label].sessionBinding);
});

test("account logout covers every product/device of that account while preserving other accounts", () => {
  const { state, sessions, challenges } = fixture();
  const prepared = prepareProductSessionControlIntent(state, intent(sessions.owner.account, "account-first"), at(10));
  assert.deepEqual(prepared.preparedReceipt.sessionBindings, ["owner", "second", "dex", "device"].map((label) => sessions[label].sessionBinding).sort());
  assert.deepEqual(prepared.preparedReceipt.challengeIds, [challenges.pending.challenge]);
  assert.deepEqual(prepared.candidate.authority.revokedAccounts, [{ account: sessions.owner.account, before: at(10).toISOString() }]);
  assert.equal(allowed(prepared.candidate, sessions.other, 10).account, sessions.other.account);
});

test("foreign and unknown device bindings have identical denial; an owned pending challenge alone proves scope", () => {
  const { state, sessions, approvals, challenges } = fixture();
  const before = canonicalJSON(state);
  const errors = [sessions.other.deviceBinding, "0".repeat(64)].map((binding) => {
    try { prepareProductSessionControlIntent(state, intent(sessions.owner.account, "bad-device", binding), at(10)); } catch (error) { return { code: error.code, message: error.message }; }
    assert.fail("Expected device denial");
  });
  assert.deepEqual(errors[0], errors[1]); assert.equal(errors[0].code, "DEVICE_NOT_FOUND");
  assert.equal(canonicalJSON(state), before);
  const authority = new ProductSessionAuthority(registry);
  const challenge = authority.issueChallenge({ ...approvals.pending, challenge: challenges.pending.challenge }, at());
  const emptyGateway = new ProductSessionGatewayKernel(registry, () => token("pending-only"));
  const pendingOnly = migrateProductSessionControlSnapshotV2({ ...emptyGateway.snapshot(), authority: authority.snapshot() });
  const prepared = prepareProductSessionControlIntent(pendingOnly, intent(approvals.pending.approval.account, "pending-only", deviceBinding(challenge, challenge.account)), at(10));
  assert.equal(prepared.preparedReceipt.revokedSessionCount, 0);
  assert.deepEqual(prepared.preparedReceipt.challengeIds, [challenge.challenge]);
  assert.throws(() => assertProductSessionControlApprovalAllowed(prepared.candidate, registry, approvals.pending.request, approvals.pending.approval, at(20)), { code: "SESSION_REVOKED" });
});

for (const device of [false, true]) test(`${device ? "device" : "account"} cutoff rejects old/same-millisecond approvals but permits a new explicit signature on the same credential`, () => {
  const { state, sessions, approvals } = fixture();
  const prepared = prepareProductSessionControlIntent(state, intent(sessions.owner.account, `boundary-${device}`, device ? sessions.owner.deviceBinding : undefined), at(10));
  for (const offset of [9, 10]) {
    const signed = signProductSessionApproval(registry, approvals.pending.request, { accountSecret: OWNER, scopes: approvals.pending.request.scopes, expiresAt: approvals.pending.request.expiresAt }, at(offset));
    assert.throws(() => assertProductSessionControlApprovalAllowed(prepared.candidate, registry, approvals.pending.request, signed, at(20)), { code: "SESSION_REVOKED" });
  }
  const fresh = signProductSessionApproval(registry, approvals.pending.request, { accountSecret: OWNER, scopes: approvals.pending.request.scopes, expiresAt: approvals.pending.request.expiresAt }, at(11));
  assert.equal(assertProductSessionControlApprovalAllowed(prepared.candidate, registry, approvals.pending.request, fresh, at(20)).issuedAt, at(11).toISOString());
  const reconnected = addSession(prepared.candidate, `reconnect-${device}`, 11);
  assert.equal(reconnected.session.deviceBinding, sessions.owner.deviceBinding);
  assert.equal(allowed(reconnected.state, reconnected.session, 20).sessionBinding, reconnected.session.sessionBinding);
  const forged = { ...fresh, walletSignature: "0".repeat(128) };
  assert.throws(() => assertProductSessionControlApprovalAllowed(prepared.candidate, registry, approvals.pending.request, forged, at(20)), { code: "INVALID_SIGNATURE" });
});

for (const device of [false, true]) test(`${device ? "device" : "account"} lost-ACK Retry freezes receipt and leaves post-cutoff login active, even after a newer intent`, () => {
  const { state, sessions } = fixture();
  const command = intent(sessions.owner.account, `lost-${device}`, device ? sessions.owner.deviceBinding : undefined);
  const first = prepareProductSessionControlIntent(state, command, at(10));
  const receipt = canonicalJSON(first.preparedReceipt);
  const fresh = addSession(first.candidate, `later-${device}`, 11);
  const replay = prepareProductSessionControlIntent(fresh.state, command, at(20));
  assert.equal(replay.mutationRequired, false); assert.equal(canonicalJSON(replay.preparedReceipt), receipt);
  assert.equal(canonicalJSON(replay.candidate), canonicalJSON(fresh.state));
  assert.equal(allowed(replay.candidate, fresh.session, 20).sessionBinding, fresh.session.sessionBinding);
  const next = prepareProductSessionControlIntent(replay.candidate, intent(sessions.owner.account, `newer-${device}`, device ? sessions.owner.deviceBinding : undefined), at(30));
  assert.deepEqual(next.preparedReceipt.sessionBindings, [fresh.session.sessionBinding]);
  const again = prepareProductSessionControlIntent(next.candidate, command, at(40));
  assert.equal(canonicalJSON(again.preparedReceipt), receipt); assert.equal(again.mutationRequired, false);
  const cutoff = device ? again.candidate.authority.revokedDeviceScopes[0].before : again.candidate.authority.revokedAccounts.find((item) => item.account === sessions.owner.account).before;
  assert.equal(cutoff, at(30).toISOString());
  assert.throws(() => allowed(again.candidate, fresh.session, 40), { code: "SESSION_REVOKED" });
});

test("same account+intent ID cannot change operation, target or lifetime; another account has an independent ID namespace", () => {
  const { state, sessions } = fixture();
  const command = intent(sessions.owner.account, "shared-intent-id", sessions.owner.deviceBinding);
  const first = prepareProductSessionControlIntent(state, command, at(10));
  for (const changed of [
    intent(sessions.owner.account, "shared-intent-id"),
    intent(sessions.owner.account, "shared-intent-id", sessions.dex.deviceBinding),
    intent(sessions.owner.account, "shared-intent-id", sessions.owner.deviceBinding, 1),
  ]) {
    assert.throws(() => prepareProductSessionControlIntent(first.candidate, changed, at(600_001)), { code: "IDEMPOTENCY_CONFLICT" });
    assert.throws(() => observeDurableProductSessionControlIntent(first.candidate, changed, at(600_001)), { code: "IDEMPOTENCY_CONFLICT" });
  }
  const other = intent(sessions.other.account, "shared-intent-id", sessions.other.deviceBinding);
  const next = prepareProductSessionControlIntent(first.candidate, other, at(20));
  assert.equal(next.candidate.controlIntents.length, 2);
  assert.notEqual(productSessionControlIntentDigest(command), productSessionControlIntentDigest(other));
  assert.throws(() => parseProductSessionControlIntent({ ...command, body: { ...command.body, account: sessions.other.account } }));
});

test("zero-session account logout still blocks unseen old approvals and advances the authority clock floor", () => {
  const gateway = new ProductSessionGatewayKernel(registry, () => token("empty"));
  const state = migrateProductSessionControlSnapshotV2(gateway.snapshot()), input = pending("unseen-approval");
  const command = intent(input.approval.account, "empty-intent");
  const first = prepareProductSessionControlIntent(state, command, at(10));
  assert.equal(first.preparedReceipt.revokedSessionCount, 0); assert.equal(first.preparedReceipt.cancelledChallengeCount, 0);
  assert.equal(first.candidate.audit.length, 0); assert.equal(first.candidate.consumedProofs.length, 0);
  assert.throws(() => assertProductSessionControlApprovalAllowed(first.candidate, registry, input.request, input.approval, at(20)), { code: "SESSION_REVOKED" });
  for (const operation of [
    () => prepareProductSessionControlIntent(first.candidate, intent(input.approval.account, "clock-regression"), at(9)),
    () => observeDurableProductSessionControlIntent(first.candidate, command, at(9)),
  ]) assert.throws(operation, { code: "CLOCK_UNAVAILABLE" });
});

test("unknown expired intent never reapplies; durable committed receipt remains confirmable after body expiry", () => {
  const { state, sessions } = fixture(), command = intent(sessions.owner.account, "expiry-intent", undefined, 0, 30);
  const first = prepareProductSessionControlIntent(state, command, at(10));
  assert.deepEqual(observeDurableProductSessionControlIntent(state, command, at(20)), { status: "unknown", revocationConfirmed: false, reason: "not-recorded", retryAllowed: true });
  assert.deepEqual(observeDurableProductSessionControlIntent(state, command, at(30)), { status: "unknown", revocationConfirmed: false, reason: "intent-expired", retryAllowed: false });
  assert.throws(() => prepareProductSessionControlIntent(state, command, at(30)), { code: "INTENT_EXPIRED" });
  const observed = observeDurableProductSessionControlIntent(first.candidate, command, at(600_001));
  assert.equal(observed.status, "confirmed"); assert.equal(observed.revocationConfirmed, true);
  assert.equal(canonicalJSON(observed.receipt), canonicalJSON(first.preparedReceipt));
  assert.equal(prepareProductSessionControlIntent(first.candidate, command, at(600_001)).mutationRequired, false);
});

test("before-write failure remains unknown and after-write/ACK failure reconciles the same durable transaction", () => {
  const { state, sessions } = fixture(), command = intent(sessions.owner.account, "atomic-intent");
  const prepared = prepareProductSessionControlIntent(state, command, at(10));
  let durable = state;
  const persistFixture = (fault) => {
    const candidate = assertProductSessionControlPlanBase(prepared, durable);
    // The real adapter must compose its verified nonce and audit in this same
    // transaction. This fixture has no I/O and makes no persistence claim.
    const composed = parseProductSessionControlSnapshot({ ...candidate, consumedProofs: [...candidate.consumedProofs, "0".repeat(64)].sort(), audit: [...candidate.audit, { sequence: candidate.audit.length + 1, requestId: "req_control_atomic_fixture", path: "/v2/product-sessions/wallet/sessions/revoke-all", outcome: "ok", code: null, subject: command.body.intentId, at: at(10).toISOString() }] });
    if (fault === "before") throw new Error("persist failed before commit");
    durable = composed;
    if (fault === "after") throw new Error("response lost after atomic commit");
  };
  assert.throws(() => persistFixture("before"));
  assert.equal(observeDurableProductSessionControlIntent(durable, command, at(10)).status, "unknown");
  assert.equal(canonicalJSON(durable), canonicalJSON(state));
  assert.throws(() => persistFixture("after"));
  const readback = parseProductSessionControlSnapshot(clone(durable));
  assert.equal(observeDurableProductSessionControlIntent(readback, command, at(20)).status, "confirmed");
  assert.ok(readback.consumedProofs.includes("0".repeat(64)));
  assert.equal(readback.audit.at(-1).subject, command.body.intentId);
  assert.equal(prepareProductSessionControlIntent(readback, command, at(20)).mutationRequired, false);
});

test("a never-persisted preparation establishes no cutoff; the first durable application fixes its own receipt", () => {
  const { state, sessions } = fixture(), command = intent(sessions.owner.account, "never-persisted-intent");
  const abandoned = prepareProductSessionControlIntent(state, command, at(10));
  assert.equal(abandoned.revocationConfirmed, false);
  assert.equal(observeDurableProductSessionControlIntent(state, command, at(10)).status, "unknown");
  const meanwhile = addSession(state, "before-first-durable-logout", 11);
  const firstDurable = prepareProductSessionControlIntent(meanwhile.state, command, at(20));
  assert.equal(firstDurable.preparedReceipt.cutoff, at(20).toISOString());
  assert.notEqual(firstDurable.preparedReceipt.cutoff, abandoned.preparedReceipt.cutoff);
  assert.ok(firstDurable.preparedReceipt.sessionBindings.includes(meanwhile.session.sessionBinding));
  const committed = assertProductSessionControlPlanBase(firstDurable, meanwhile.state);
  const observation = observeDurableProductSessionControlIntent(committed, command, at(30));
  assert.equal(observation.status, "confirmed");
  assert.equal(observation.receipt.cutoff, at(20).toISOString());
  assert.equal(prepareProductSessionControlIntent(committed, command, at(40)).mutationRequired, false);
});

test("concurrent prepares cannot overwrite newer state and same intent converges on the first committed receipt", () => {
  const { state, sessions } = fixture(), command = intent(sessions.owner.account, "concurrent-intent");
  const early = prepareProductSessionControlIntent(state, command, at(10));
  const late = prepareProductSessionControlIntent(state, command, at(11));
  const committed = assertProductSessionControlPlanBase(early, state);
  assert.throws(() => assertProductSessionControlPlanBase(late, committed), { code: "STALE_CONTROL_STATE" });
  const fresh = addSession(committed, "concurrent-new-login", 12);
  assert.throws(() => assertProductSessionControlPlanBase(late, fresh.state), { code: "STALE_CONTROL_STATE" });
  const retry = prepareProductSessionControlIntent(fresh.state, command, at(20));
  assert.equal(retry.preparedReceipt.cutoff, at(10).toISOString());
  assert.equal(allowed(retry.candidate, fresh.session, 20).sessionBinding, fresh.session.sessionBinding);
  assert.deepEqual(assertProductSessionControlPlanBase(retry, fresh.state), retry.candidate);
});

test("capacity, future intent and authority regression fail before any candidate mutation; known receipt survives full capacity", () => {
  const { state, sessions } = fixture(), command = intent(sessions.owner.account, "capacity-one");
  const first = prepareProductSessionControlIntent(state, command, at(10), 1), before = canonicalJSON(first.candidate);
  assert.throws(() => prepareProductSessionControlIntent(first.candidate, intent(sessions.owner.account, "capacity-two"), at(20), 1), { code: "CONTROL_INTENT_CAPACITY" });
  assert.equal(prepareProductSessionControlIntent(first.candidate, command, at(20), 1).mutationRequired, false);
  assert.throws(() => prepareProductSessionControlIntent(state, intent(sessions.owner.account, "future", undefined, 30), at(20)), { code: "ISSUED_IN_FUTURE" });
  assert.equal(canonicalJSON(first.candidate), before);
});

test("a recomputed plan digest cannot smuggle unrelated replay/audit removal or an extra revocation into the commit", () => {
  const { state, sessions } = fixture();
  const prepared = prepareProductSessionControlIntent(state, intent(sessions.owner.account, "plan-integrity", sessions.owner.deviceBinding), at(10));
  for (const corrupt of [
    (candidate) => { candidate.consumedProofs = []; candidate.audit = []; },
    (candidate) => { candidate.authority.revokedSessions.push(sessions.other.sessionBinding); candidate.authority.revokedSessions.sort(); },
  ]) {
    const tampered = clone(prepared); corrupt(tampered.candidate);
    // All receipt relations still parse, and the attacker can compute hashes.
    // The exact transition comparison, rather than hash secrecy, rejects it.
    parseProductSessionControlSnapshot(tampered.candidate);
    tampered.candidateStateDigest = digestHex("YNX_PRODUCT_SESSION_CONTROL_STATE_V3", tampered.candidate);
    assert.throws(() => assertProductSessionControlPlanBase(tampered, state), { code: "INVALID_CONTROL_PLAN" });
  }
  assert.throws(() => assertProductSessionControlPlanBase({ ...prepared, revocationConfirmed: true }, state), { code: "INVALID_CONTROL_PLAN" });
});

test("a newer account cutoff cannot make dropping an older still-retriable intent a valid transition", () => {
  const { state, sessions } = fixture(), firstIntent = intent(sessions.owner.account, "retain-earlier-intent");
  const first = prepareProductSessionControlIntent(state, firstIntent, at(10));
  const next = prepareProductSessionControlIntent(first.candidate, intent(sessions.owner.account, "retain-newer-intent"), at(20));
  const tampered = clone(next);
  tampered.candidate.controlIntents = tampered.candidate.controlIntents.filter((record) => record.intent.body.intentId !== firstIntent.body.intentId);
  // Legacy account cutoffs mean an isolated snapshot cannot establish the
  // completeness of historical receipts. The serialized transition must.
  parseProductSessionControlSnapshot(tampered.candidate);
  tampered.candidateStateDigest = digestHex("YNX_PRODUCT_SESSION_CONTROL_STATE_V3", tampered.candidate);
  assert.throws(() => assertProductSessionControlPlanBase(tampered, first.candidate), { code: "INVALID_CONTROL_PLAN" });
  assert.equal(observeDurableProductSessionControlIntent(next.candidate, firstIntent, at(20)).receipt.cutoff, at(10).toISOString());
});

test("device cutoff and imported account cutoff enforce clock floors even with no new v2 audit or clock anchor", () => {
  const { state, sessions } = fixture();
  const device = prepareProductSessionControlIntent(state, intent(sessions.owner.account, "device-clock", sessions.owner.deviceBinding), at(100));
  assert.deepEqual(device.candidate.audit, state.audit);
  assert.deepEqual(device.candidate.consumedProofs, state.consumedProofs);
  assert.throws(() => prepareProductSessionControlIntent(device.candidate, intent(sessions.other.account, "other-account-clock"), at(99)), { code: "CLOCK_UNAVAILABLE" });
  const authority = new ProductSessionAuthority(registry, projectV2(state).authority);
  authority.revokeAccount(sessions.owner.account, at(100));
  const imported = migrateProductSessionControlSnapshotV2({ ...projectV2(state), authority: authority.snapshot() });
  assert.throws(() => prepareProductSessionControlIntent(imported, intent(sessions.owner.account, "imported-clock"), at(99)), { code: "CLOCK_UNAVAILABLE" });
  const sameInstant = prepareProductSessionControlIntent(imported, intent(sessions.owner.account, "imported-clock"), at(100));
  assert.equal(sameInstant.candidate.authority.revokedAccounts.find((item) => item.account === sessions.owner.account).before, at(100).toISOString());
});

test("legacy permanent device tombstones stay permanent after new timestamped logout", () => {
  const { v2, sessions } = fixture(), authority = new ProductSessionAuthority(registry, v2.authority);
  authority.revokeDevice(sessions.owner.deviceBinding);
  const state = migrateProductSessionControlSnapshotV2({ ...v2, authority: authority.snapshot() });
  const first = prepareProductSessionControlIntent(state, intent(sessions.owner.account, "legacy-permanent", sessions.owner.deviceBinding), at(10));
  assert.equal(first.preparedReceipt.revokedSessionCount, 0);
  const fresh = pending("legacy-still-revoked", { offset: 11 });
  assert.throws(() => assertProductSessionControlApprovalAllowed(first.candidate, registry, fresh.request, fresh.approval, at(20)), { code: "SESSION_REVOKED" });
  assert.deepEqual(first.candidate.authority.revokedDevices, state.authority.revokedDevices);
});

test("candidate parser rejects cross-account/product receipt targets, duplicate lists, changed counts, partial cutoffs and missing exact tombstones", () => {
  const { state, sessions, challenges } = fixture();
  const first = prepareProductSessionControlIntent(state, intent(sessions.owner.account, "malformed-device", sessions.owner.deviceBinding), at(10));
  const corruptions = [
    (next) => { next.controlIntents[0].receipt.revokedSessionCount++; },
    (next) => { const receipt = next.controlIntents[0].receipt; receipt.sessionBindings.push(receipt.sessionBindings[0]); receipt.sessionBindings.sort(); receipt.revokedSessionCount++; },
    (next) => { const receipt = next.controlIntents[0].receipt; receipt.sessionBindings = [sessions.other.sessionBinding]; receipt.revokedSessionCount = 1; next.authority.revokedSessions.push(sessions.other.sessionBinding); next.authority.revokedSessions.sort(); },
    (next) => { const receipt = next.controlIntents[0].receipt; receipt.sessionBindings = [sessions.dex.sessionBinding]; receipt.revokedSessionCount = 1; next.authority.revokedSessions.push(sessions.dex.sessionBinding); next.authority.revokedSessions.sort(); },
    (next) => { next.controlIntents[0].receipt.challengeIds = [challenges.foreignPending.challenge]; },
    (next) => { next.authority.revokedDeviceScopes = []; },
    (next) => { next.authority.revokedDeviceScopes[0].before = at(20).toISOString(); },
    (next) => { next.controlIntents = []; },
    (next) => { next.authority.revokedSessions = next.authority.revokedSessions.filter((id) => id !== sessions.owner.sessionBinding); },
    (next) => { next.controlIntents[0].receipt.target.account = sessions.other.account; },
    (next) => { next.controlIntents[0].intent.body.intentExpiresAt = at(500_000).toISOString(); },
  ];
  for (const corrupt of corruptions) { const next = clone(first.candidate); corrupt(next); assert.throws(() => parseProductSessionControlSnapshot(next)); }
  const later = prepareProductSessionControlIntent(first.candidate, intent(sessions.owner.account, "later-account-logout"), at(20));
  const missing = clone(later.candidate);
  missing.authority.revokedSessions = missing.authority.revokedSessions.filter((id) => id !== sessions.owner.sessionBinding);
  assert.throws(() => parseProductSessionControlSnapshot(missing), { code: "INVALID_CONTROL_STORE" });
});

test("confirmed receipt remains historical; newer same-account login is never added by observation", () => {
  const { state, sessions } = fixture(), command = intent(sessions.owner.account, "historical-observation");
  const first = prepareProductSessionControlIntent(state, command, at(10)), fresh = addSession(first.candidate, "historical-new-login", 11);
  const confirmation = observeDurableProductSessionControlIntent(fresh.state, command, at(20));
  assert.equal(confirmation.revocationConfirmed, true);
  assert.equal(confirmation.receipt.sessionBindings.includes(fresh.session.sessionBinding), false);
  assert.equal(allowed(fresh.state, fresh.session, 20).sessionBinding, fresh.session.sessionBinding);
});
