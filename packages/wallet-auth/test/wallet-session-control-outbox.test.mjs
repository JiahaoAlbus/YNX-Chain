import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJSON } from "../src/canonical.js";
import { httpBodyDigest } from "../src/session-proof.js";
import { ProductSessionGatewayKernel } from "../src/product-session-gateway.js";
import { migrateProductSessionControlSnapshotV2, prepareProductSessionControlIntent, productSessionControlIntentDigest } from "../src/product-session-control-intent.js";
import { WALLET_SESSION_CONTROL_AUDIENCE, WALLET_SESSION_CONTROL_INTENT_PATHS } from "../src/wallet-session-control.js";
import {
  assertWalletSessionControlOutboxPlanBase as assertBase,
  compareWalletSessionControlOutboxReadback as readback,
  createWalletSessionControlOutbox as create,
  parseWalletSessionControlOutbox as parse,
  prepareWalletSessionControlOutbox as prepare,
  summarizeWalletSessionControlOutbox as summarize,
  walletSessionControlOutboxRequestCandidate as requestCandidate,
  walletSessionControlOutboxKey as key,
} from "../src/wallet-session-control-outbox.js";

const SCOPE = { authority: WALLET_SESSION_CONTROL_AUDIENCE, chainId: "ynx_6423-1", account: `ynx1${"q".repeat(38)}` };
const NOW = Date.parse("2026-09-06T12:00:00.000Z"), time = (ms = 0) => new Date(NOW + ms).toISOString();
const token = (value) => createHash("sha256").update(value).digest("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => JSON.parse(canonicalJSON(value));
const epoch = token("process-one"), stamp = (ms = 1000, run = epoch) => ({ epoch: run, monotonicMs: ms });
const clock = (offset = 0, owner = SCOPE, run = epoch) => ({ authority: owner.authority, chainId: owner.chainId, requestId: `req_time_${token(String(offset))}`, serverTime: time(offset), epoch: run, receivedAtMs: 1000, roundTripMs: 20 });
function intent(label = "first", device = null, owner = SCOPE) { return { account: owner.account, operation: device ? "device-logout" : "account-logout", body: { intentId: token(label), intentIssuedAt: time(), intentExpiresAt: time(600_000), ...(device ? { deviceBinding: device } : {}) } }; }
const eventAttempt = (original, label = "attempt-one", offset = 0, owner = SCOPE, run = epoch) => ({ type: "attempt", intentId: original.body.intentId, requestId: `req_${token(label)}`, nonce: token(`${label}-nonce`), clock: clock(offset, owner, run), at: stamp(1000, run) });
function step(state, event, owner = state.scope) { return prepare(state, owner, event).candidate; }
function setup(original = intent(), owner = SCOPE) {
  const initial = create(owner), queued = step(initial, { type: "enqueue", intent: original }, owner);
  const attemptEvent = eventAttempt(original, "attempt-one", 0, owner);
  const attemptPlan = prepare(queued, owner, attemptEvent), prepared = attemptPlan.candidate;
  const dispatchEvent = { type: "dispatch", intentId: original.body.intentId, requestId: attemptEvent.requestId, at: stamp() };
  const sent = step(prepared, dispatchEvent, owner);
  return { initial, original, queued, attemptEvent, attemptPlan, prepared, dispatchEvent, sent };
}
function receipt(original, changes = {}) {
  return { version: 1, account: original.account, intentId: original.body.intentId, intentDigest: productSessionControlIntentDigest(original), operation: original.operation, target: { account: original.account, ...(original.body.deviceBinding ? { deviceBinding: original.body.deviceBinding } : {}) }, cutoff: time(10), appliedAt: time(10), revoked: true, sessionBindings: [hash("session")], challengeIds: [token("challenge")], revokedSessionCount: 1, cancelledChallengeCount: 1, ...changes };
}
function response(state, requestId, body, status = 200) {
  const record = state.records.find((entry) => entry.attempts.some((attempt) => attempt.requestId === requestId));
  return { url: `${state.scope.authority}${record.path}`, redirected: false, status, requestId, contentType: "application/json; charset=utf-8", cacheControl: "no-store", bodyText: canonicalJSON(body) };
}
function success(state, requestId, suppliedReceipt = receipt(state.records[0].intent)) { return response(state, requestId, { ok: true, requestId, schemaVersion: 2, result: { status: "confirmed", revocationConfirmed: true, receipt: suppliedReceipt } }); }
function error(state, requestId, code = "DEVICE_NOT_FOUND", status = 404, extra = {}) { return response(state, requestId, { ok: false, requestId, schemaVersion: 2, error: { code, message: "Fixture exact owner error" }, ...extra }, status); }
const observeEvent = (original, requestId, response) => ({ type: "observe", intentId: original.body.intentId, requestId, response });
const status = (state) => summarize(state, state.scope).records.at(-1);

test("owner key and mandatory expected owner isolate account, authority and chain", () => {
  const variants = [SCOPE, { ...SCOPE, account: `ynx1${"p".repeat(38)}` }, { ...SCOPE, authority: "https://another-auth.example" }, { ...SCOPE, chainId: "ynx_6424-1" }];
  assert.equal(new Set(variants.map(key)).size, 4);
  for (const owner of variants.slice(1)) assert.throws(() => parse(create(SCOPE), owner), { code: "OUTBOX_OWNER_MISMATCH" });
  for (const authority of ["https://wallet-auth.ynxweb4.com/", "https://WALLET-auth.ynxweb4.com", "https://user:pass@wallet-auth.ynxweb4.com", "http://wallet-auth.ynxweb4.com", "https://wallet-auth.ynxweb4.com?x=1"]) assert.throws(() => create({ ...SCOPE, authority }));
  assert.throws(() => parse(create(SCOPE)), /scope|object/i);
});

test("exact original canonical body, path and protocol digests survive serialization; no secrets are stored", () => {
  for (const device of [null, hash("product-bound-device")]) {
    const original = intent("body", device), { sent } = setup(original);
    const restored = parse(canonicalJSON(sent), SCOPE), entry = restored.records[0];
    assert.equal(entry.bodyText, canonicalJSON(original.body));
    assert.equal(entry.bodyDigest, httpBodyDigest(entry.bodyText));
    assert.equal(entry.intentDigest, productSessionControlIntentDigest(original));
    assert.equal(entry.path, WALLET_SESSION_CONTROL_INTENT_PATHS[device ? 1 : 0]);
    assert.equal(status(restored).status, "unknown");
    assert.equal(summarize(restored, SCOPE).revocationConfirmed, false);
    assert.ok(Object.isFrozen(entry.intent.body));
    for (const field of ["accountSecret", "signature", "privateKey"]) {
      const bad = clone(sent); bad.records[0][field] = "forbidden"; assert.throws(() => parse(bad, SCOPE));
    }
    assert.throws(() => parse(`${canonicalJSON(sent)}\n`, SCOPE));
  }
});

test("changed ID body/operation conflicts before expiry; unknown owner prevents replacement", () => {
  const { original, sent } = setup();
  assert.throws(() => prepare(sent, SCOPE, { type: "enqueue", intent: intent("second") }), { code: "OUTBOX_PENDING" });
  assert.throws(() => prepare(sent, SCOPE, { type: "enqueue", intent: { ...original, operation: "device-logout", body: { ...original.body, deviceBinding: hash("new-device") } } }), { code: "IDEMPOTENCY_CONFLICT" });
  const modified = clone(original); modified.body.intentIssuedAt = time(-600_000); modified.body.intentExpiresAt = time();
  assert.throws(() => prepare(sent, SCOPE, { type: "enqueue", intent: modified }), { code: "IDEMPOTENCY_CONFLICT" });
  assert.throws(() => prepare(sent, SCOPE, { type: "enqueue", intent: original }), { code: "OUTBOX_INTENT_EXISTS" });
});

test("owner isolation allows independent work but unsupported authority never creates a signing context", () => {
  const other = { ...SCOPE, account: `ynx1${"p".repeat(38)}` };
  const a = setup(), b = setup(intent("other", hash("shared-device"), other), other);
  assert.notEqual(key(a.sent.scope), key(b.sent.scope));
  assert.throws(() => prepare(a.sent, other, { type: "cancel", intentId: a.original.body.intentId }), { code: "OUTBOX_OWNER_MISMATCH" });
  for (const foreign of [{ ...SCOPE, authority: "https://other-auth.example" }, { ...SCOPE, chainId: "ynx_6424-1" }]) {
    const original = intent("foreign", null, foreign), state = step(create(foreign), { type: "enqueue", intent: original }, foreign);
    assert.throws(() => prepare(state, foreign, eventAttempt(original, "foreign-proof", 0, foreign)), { code: "UNSUPPORTED_CONTROL_AUTHORITY" });
  }
});

test("Retry after restart retains exact expired intent body but requests a fresh 30-second proof", () => {
  const { sent, original, attemptPlan } = setup(), restored = parse(canonicalJSON(sent), SCOPE);
  const newEpoch = token("restarted-process"), retry = eventAttempt(original, "after-expiry-retry", 700_000, SCOPE, newEpoch);
  const plan = prepare(restored, SCOPE, retry);
  assert.equal(plan.candidate.records[0].bodyText, sent.records[0].bodyText);
  assert.equal(plan.signingInput.bodyDigest, attemptPlan.signingInput.bodyDigest);
  assert.notEqual(plan.signingInput.nonce, attemptPlan.signingInput.nonce);
  assert.equal(plan.signingInput.issuedAt, time(700_000));
  assert.equal(plan.signingInput.expiresAt, time(730_000));
  assert.equal(plan.revocationConfirmed, false); assert.equal(plan.localCommitConfirmed, false);
  const dispatched = step(plan.candidate, { type: "dispatch", intentId: original.body.intentId, requestId: retry.requestId, at: stamp(1000, newEpoch) });
  const observed = step(dispatched, observeEvent(original, retry.requestId, success(dispatched, retry.requestId)));
  assert.equal(status(observed).observation.receipt.cutoff, time(10));
  assert.equal(status(observed).status, "receipt-observed");
  assert.equal(summarize(observed, SCOPE).revocationConfirmed, false);
});

test("time freshness is exact authority plus same-process monotonic age, never browser wall clock", () => {
  const { queued, original, prepared, dispatchEvent } = setup();
  for (const at of [stamp(999), stamp(5981), stamp(1000, token("another-process"))]) assert.throws(() => prepare(queued, SCOPE, { ...eventAttempt(original), at }), { code: "OUTBOX_CLOCK_STALE" });
  assert.doesNotThrow(() => prepare(queued, SCOPE, { ...eventAttempt(original), at: stamp(5980) }));
  assert.throws(() => prepare(queued, SCOPE, { ...eventAttempt(original), clock: { ...clock(), authority: "https://other.example" } }), { code: "OUTBOX_CLOCK_BINDING" });
  assert.throws(() => prepare(prepared, SCOPE, { ...dispatchEvent, at: stamp(5981) }), { code: "OUTBOX_CLOCK_STALE" });
  assert.throws(() => prepare(parse(canonicalJSON(prepared), SCOPE), SCOPE, { ...dispatchEvent, at: stamp(1000, token("reload")) }), { code: "OUTBOX_CLOCK_STALE" });
});

test("same request ID or nonce cannot be reused across an owner's attempts or retained cancelled history", () => {
  const { sent, original, attemptEvent } = setup();
  for (const extra of [{ nonce: attemptEvent.nonce }, { requestId: attemptEvent.requestId }]) assert.throws(() => prepare(sent, SCOPE, { ...eventAttempt(original, "retry", 1000), ...extra }), { code: "OUTBOX_REPLAY" });
  const { prepared } = setup();
  const cancelled = step(prepared, { type: "cancel", intentId: original.body.intentId });
  const second = intent("second"), next = step(cancelled, { type: "enqueue", intent: second });
  assert.throws(() => prepare(next, SCOPE, { ...eventAttempt(second, "next"), nonce: attemptEvent.nonce }), { code: "OUTBOX_REPLAY" });
});

test("cancellation before dispatch is local only; cancellation after marker remains unknown and blocks replacement", () => {
  const { original, queued, prepared, sent, dispatchEvent } = setup();
  for (const state of [queued, prepared]) {
    const cancelled = step(state, { type: "cancel", intentId: original.body.intentId });
    assert.equal(status(cancelled).status, "cancelled-before-dispatch");
    assert.equal(summarize(cancelled, SCOPE).revocationConfirmed, false);
    assert.doesNotThrow(() => prepare(cancelled, SCOPE, { type: "enqueue", intent: intent("new-after-local-cancel") }));
    assert.throws(() => prepare(cancelled, SCOPE, dispatchEvent));
  }
  const unknown = step(sent, { type: "cancel", intentId: original.body.intentId });
  assert.equal(status(unknown).status, "unknown"); assert.equal(status(unknown).cancelRequested, true);
  assert.throws(() => prepare(unknown, SCOPE, { type: "enqueue", intent: intent("new") }), { code: "OUTBOX_PENDING" });
  const explicitRetry = prepare(unknown, SCOPE, eventAttempt(original, "user-authorized-retry", 1000));
  assert.equal(explicitRetry.candidate.records[0].cancelRequested, false);
  assert.equal(status(explicitRetry.candidate).unknownHistory, true);
});

test("late response uses original attempt; cancel/retry revisions invalidate old write plans", () => {
  const { original, sent, attemptEvent } = setup();
  const event = observeEvent(original, attemptEvent.requestId, success(sent, attemptEvent.requestId));
  const oldPlan = prepare(sent, SCOPE, event);
  const cancelled = step(sent, { type: "cancel", intentId: original.body.intentId });
  assert.throws(() => assertBase(oldPlan, cancelled, SCOPE), { code: "STALE_CONTROL_OUTBOX" });
  const retry = step(cancelled, eventAttempt(original, "later-try", 1000));
  const latestPlan = prepare(retry, SCOPE, event);
  assert.equal(assertBase(latestPlan, retry, SCOPE).records[0].attempts.length, 2);
  assert.equal(status(latestPlan.candidate).status, "receipt-observed");
  assert.throws(() => prepare(latestPlan.candidate, SCOPE, { type: "dispatch", intentId: original.body.intentId, requestId: retry.records[0].attempts.at(-1).requestId, at: stamp() }), { code: "OUTBOX_ATTEMPT_CANCELLED" });
});

test("CAS plan recomputation rejects altered requirements, unrelated history, bytes and fake confirmation", () => {
  const { original, queued } = setup(), plan = prepare(queued, SCOPE, eventAttempt(original));
  assert.deepEqual(assertBase(plan, queued, SCOPE), plan.candidate);
  for (const mutate of [value => value.requirements.splice(0), value => value.revocationConfirmed = true, value => value.localCommitConfirmed = true, value => value.candidate.revision++, value => value.candidateText += "\n", value => value.signingInput.path = WALLET_SESSION_CONTROL_INTENT_PATHS[1]]) {
    const bad = clone(plan); mutate(bad); assert.throws(() => assertBase(bad, queued, SCOPE), { code: "INVALID_OUTBOX_PLAN" });
  }
});

test("write/readback equality is explicitly not authentication or durable confirmation", () => {
  const { attemptPlan } = setup(), observed = readback(attemptPlan, attemptPlan.candidateText, SCOPE);
  assert.equal(observed.bytesMatch, true); assert.equal(observed.localCommitConfirmed, false); assert.equal(observed.revocationConfirmed, false);
  for (const text of [null, "", `${attemptPlan.candidateText}\n`, canonicalJSON(attemptPlan.candidate.records)]) assert.throws(() => readback(attemptPlan, text, SCOPE), { code: "OUTBOX_READBACK_UNKNOWN" });
});

test("final dispatch candidate rechecks fresh clock and original revision after readback/signing awaits", () => {
  const { original, sent, attemptEvent } = setup();
  const context = { intentId: original.body.intentId, requestId: attemptEvent.requestId, revision: sent.revision, at: stamp() };
  const candidate = requestCandidate(sent, SCOPE, context);
  assert.equal(candidate.bodyText, sent.records[0].bodyText);
  assert.equal(candidate.dispatchAuthorized, false); assert.equal(candidate.revocationConfirmed, false);
  assert.throws(() => requestCandidate(sent, SCOPE, { ...context, at: stamp(5981) }), { code: "OUTBOX_CLOCK_STALE" });
  assert.throws(() => requestCandidate(sent, SCOPE, { ...context, at: stamp(1000, token("reloaded")) }), { code: "OUTBOX_CLOCK_STALE" });
  const cancelled = step(sent, { type: "cancel", intentId: original.body.intentId });
  assert.throws(() => requestCandidate(cancelled, SCOPE, context), { code: "STALE_CONTROL_OUTBOX" });
  assert.throws(() => requestCandidate(cancelled, SCOPE, { ...context, revision: cancelled.revision }), { code: "OUTBOX_ATTEMPT_CANCELLED" });
  const retry = step(sent, eventAttempt(original, "new-attempt", 1000));
  assert.throws(() => requestCandidate(retry, SCOPE, { ...context, revision: retry.revision }), { code: "OUTBOX_ATTEMPT_CANCELLED" });
});

test("arbitrary structurally correct HTTP200 remains a receipt candidate and cannot clear the owner gate", () => {
  const { sent, original, attemptEvent } = setup();
  const plan = prepare(sent, SCOPE, observeEvent(original, attemptEvent.requestId, success(sent, attemptEvent.requestId)));
  assert.ok(plan.requirements.includes("authenticate-original-exchange"));
  assert.equal(plan.localCommitConfirmed, false); assert.equal(plan.revocationConfirmed, false);
  const summary = summarize(parse(plan.candidateText, SCOPE), SCOPE);
  assert.equal(summary.authenticationConfirmed, false); assert.equal(summary.revocationConfirmed, false);
  assert.equal(summary.records[0].status, "receipt-observed");
  assert.throws(() => prepare(plan.candidate, SCOPE, { type: "enqueue", intent: intent("must-not-auto-clear") }), { code: "OUTBOX_PENDING" });
  assert.throws(() => prepare(sent, SCOPE, { ...observeEvent(original, attemptEvent.requestId, success(sent, attemptEvent.requestId)), authenticated: true }));
});

test("receipt is validated against the actual server reducer's zero-target first durable cutoff", () => {
  const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
  const kernel = new ProductSessionGatewayKernel(registry, () => token("server-fixture"));
  const serverState = migrateProductSessionControlSnapshotV2(kernel.snapshot());
  const { sent, original, attemptEvent } = setup();
  const serverPlan = prepareProductSessionControlIntent(serverState, original, new Date(time(1234)));
  const observed = step(sent, observeEvent(original, attemptEvent.requestId, success(sent, attemptEvent.requestId, serverPlan.preparedReceipt)));
  assert.equal(status(observed).observation.receipt.cutoff, time(1234));
  assert.equal(status(observed).observation.receipt.revokedSessionCount, 0);
  assert.equal(summarize(observed, SCOPE).revocationConfirmed, false); // Server pure plan is not durable either.
});

test("receipt rejects changed owner, path, device, intent, time, counts, duplicates and mixed-case sort drift", () => {
  const { sent, original, attemptEvent } = setup(intent("device", hash("owned-scope")));
  const mutations = [
    r => r.account = `ynx1${"p".repeat(38)}`, r => r.intentId = token("another"), r => r.intentDigest = hash("bad"),
    r => r.operation = "account-logout", r => r.target.deviceBinding = hash("other-product-device"), r => r.target.account = `ynx1${"p".repeat(38)}`,
    r => r.cutoff = time(11), r => { r.cutoff = r.appliedAt = time(600_000); }, r => { r.cutoff = r.appliedAt = time(-1); },
    r => r.revokedSessionCount++, r => r.cancelledChallengeCount++, r => { r.sessionBindings.push(r.sessionBindings[0]); r.revokedSessionCount++; },
    r => { r.challengeIds = ["a".repeat(32), "Z".repeat(32)]; r.cancelledChallengeCount = 2; }, r => r.revoked = false, r => r.extra = true,
  ];
  for (const mutate of mutations) { const bad = receipt(original); mutate(bad); assert.throws(() => prepare(sent, SCOPE, observeEvent(original, attemptEvent.requestId, success(sent, attemptEvent.requestId, bad)))); }
  const mixed = receipt(original, { challengeIds: ["Z".repeat(32), "a".repeat(32)], cancelledChallengeCount: 2 });
  assert.doesNotThrow(() => prepare(sent, SCOPE, observeEvent(original, attemptEvent.requestId, success(sent, attemptEvent.requestId, mixed))));
});

test("transport observations bind original URL/redirect/status/header/envelope/request exactly, without claiming trust", () => {
  const { sent, original, attemptEvent } = setup(), good = success(sent, attemptEvent.requestId);
  for (const changes of [{ url: "https://evil.example" }, { url: `${SCOPE.authority}${WALLET_SESSION_CONTROL_INTENT_PATHS[1]}` }, { redirected: true }, { redirected: null }, { requestId: `req_${token("other")}` }, { contentType: "text/plain" }, { cacheControl: "public" }, { status: 201 }, { bodyText: `${good.bodyText}\n` }]) assert.throws(() => prepare(sent, SCOPE, observeEvent(original, attemptEvent.requestId, { ...good, ...changes })));
  for (const mutate of [b => b.error = null, b => b.schemaVersion = 3, b => b.requestId = `req_${token("other")}`, b => b.result.status = "prepared", b => b.result.revocationConfirmed = false]) {
    const body = JSON.parse(good.bodyText); mutate(body); assert.throws(() => prepare(sent, SCOPE, observeEvent(original, attemptEvent.requestId, { ...good, bodyText: canonicalJSON(body) })));
  }
  assert.throws(() => prepare(sent, SCOPE, observeEvent(original, `req_${token("unknown-attempt")}`, good)), { code: "OUTBOX_ATTEMPT_NOT_FOUND" });
});

test("404, conflict, auth rejection and durable-write unknown all preserve original unknown history", () => {
  for (const [code, httpStatus, extra] of [["DEVICE_NOT_FOUND", 404, {}], ["IDEMPOTENCY_CONFLICT", 409, {}], ["REPLAY", 409, {}], ["INVALID_SIGNATURE", 403, {}], ["STATE_WRITE_UNKNOWN", 503, { status: "unknown", revocationConfirmed: false }]]) {
    const { sent, original, attemptEvent } = setup();
    const observed = step(sent, observeEvent(original, attemptEvent.requestId, error(sent, attemptEvent.requestId, code, httpStatus, extra)));
    assert.equal(status(observed).status, "unknown", code); assert.equal(status(observed).unknownHistory, true);
    const restored = parse(canonicalJSON(observed), SCOPE);
    assert.equal(restored.records[0].bodyText, sent.records[0].bodyText);
    assert.throws(() => prepare(restored, SCOPE, { type: "enqueue", intent: intent("replacement") }), { code: "OUTBOX_PENDING" });
    assert.doesNotThrow(() => prepare(restored, SCOPE, eventAttempt(original, "explicit-retry", 1000)));
  }
});

test("INTENT_EXPIRED is only an exact unapplied candidate, never revocation, and retains original history", () => {
  const { sent, original, attemptEvent } = setup();
  assert.throws(() => prepare(sent, SCOPE, observeEvent(original, attemptEvent.requestId, error(sent, attemptEvent.requestId, "INTENT_EXPIRED", 409))), { code: "OUTBOX_RESPONSE_BINDING" });
  const retry = eventAttempt(original, "expired-retry", 600_000), pending = step(sent, retry);
  const dispatched = step(pending, { type: "dispatch", intentId: original.body.intentId, requestId: retry.requestId, at: stamp() });
  const expired = step(dispatched, observeEvent(original, retry.requestId, error(dispatched, retry.requestId, "INTENT_EXPIRED", 409)));
  assert.equal(status(expired).status, "expiry-observed"); assert.equal(status(expired).observation.type, "unapplied-expiry");
  assert.equal(status(expired).unknownHistory, true); assert.equal(expired.records[0].attempts.length, 2);
  assert.equal(expired.records[0].bodyText, sent.records[0].bodyText);
  assert.equal(summarize(expired, SCOPE).revocationConfirmed, false);
  assert.throws(() => prepare(dispatched, SCOPE, observeEvent(original, retry.requestId, error(dispatched, retry.requestId, "INTENT_EXPIRED", 404))), { code: "OUTBOX_RESPONSE_BINDING" });
});

test("later retry cannot replace frozen cutoff/targets or turn a receipt into expired", () => {
  const { original, sent, attemptEvent } = setup();
  const retry = eventAttempt(original, "simultaneous-retry", 700_000);
  let state = step(step(sent, retry), { type: "dispatch", intentId: original.body.intentId, requestId: retry.requestId, at: stamp() });
  state = step(state, observeEvent(original, attemptEvent.requestId, success(state, attemptEvent.requestId)));
  assert.throws(() => prepare(state, SCOPE, observeEvent(original, retry.requestId, success(state, retry.requestId, receipt(original, { cutoff: time(20), appliedAt: time(20) })))), { code: "OUTBOX_RESPONSE_CONFLICT" });
  assert.throws(() => prepare(state, SCOPE, observeEvent(original, retry.requestId, error(state, retry.requestId, "INTENT_EXPIRED", 409))), { code: "OUTBOX_RESPONSE_CONFLICT" });
  const same = step(state, observeEvent(original, retry.requestId, success(state, retry.requestId)));
  assert.equal(status(same).observation.receipt.cutoff, time(10));
  const badReload = clone(same); const body = JSON.parse(badReload.records[0].attempts[1].response.bodyText); body.result.receipt.cutoff = body.result.receipt.appliedAt = time(20); badReload.records[0].attempts[1].response.bodyText = canonicalJSON(body);
  assert.throws(() => parse(badReload, SCOPE), { code: "OUTBOX_RESPONSE_CONFLICT" });
});

test("snapshot validation rejects mutated original body/digests/stages and duplicate history", () => {
  const { sent } = setup();
  for (const mutate of [s => s.records[0].bodyText += " ", s => s.records[0].bodyDigest = hash("different"), s => s.records[0].intent.body.intentId = token("changed"), s => s.records[0].attempts[0].expiresAt = time(31_000), s => s.records.push(clone(s.records[0])), s => s.revision = Number.MAX_SAFE_INTEGER + 1]) { const bad = clone(sent); mutate(bad); assert.throws(() => parse(bad, SCOPE)); }
  const bad = clone(sent); bad.records[0].attempts[0].stage = "prepared"; bad.records[0].cancelRequested = true;
  assert.throws(() => parse(bad, SCOPE));
});

// Concrete reference adapter CALL ORDER, not a production adapter. Every store
// read uses structuredClone semantics; fake signature/transport only count calls.
// This test has no account secrets, cryptographic signing or external requests.
class FixtureAdapter {
  constructor(state) { this.owner = state.scope; this.text = canonicalJSON(state); this.signs = 0; this.posts = []; this.fail = null; this.trace = []; }
  read() { this.trace.push("read"); return parse(this.text, this.owner); }
  async commit(plan) {
    const latest = this.read(); assertBase(plan, latest, this.owner);
    this.trace.push("write");
    if (this.fail === "before-write") throw new Error("disk offline");
    this.text = plan.candidateText;
    if (this.fail === "after-write") throw new Error("write ACK lost");
    this.trace.push("readback"); readback(plan, this.fail === "bad-readback" ? "" : this.text, this.owner);
    return this.read();
  }
  async send(original, attemptEvent, failurePoint = null) {
    const plan = prepare(this.read(), this.owner, attemptEvent);
    this.fail = failurePoint?.phase === "attempt" ? failurePoint.failure : null;
    const prepared = await this.commit(plan);
    this.trace.push("authenticated-time-and-owner-lease"); this.signs++; // fixture only
    const dispatchPlan = prepare(prepared, this.owner, { type: "dispatch", intentId: original.body.intentId, requestId: attemptEvent.requestId, at: attemptEvent.at });
    this.fail = failurePoint?.phase === "dispatch" ? failurePoint.failure : null;
    const marked = await this.commit(dispatchPlan);
    this.trace.push("final-lease-clock-check");
    const request = requestCandidate(marked, this.owner, { intentId: original.body.intentId, requestId: attemptEvent.requestId, revision: marked.revision, at: attemptEvent.at });
    this.trace.push("POST"); this.posts.push(request.bodyText);
    throw new Error("network ACK lost");
  }
}

test("adapter contract: attempt persistence faults prevent signing/POST; marker faults prevent POST and preserve latest", async () => {
  for (const phase of ["attempt", "dispatch"]) for (const failure of ["before-write", "after-write", "bad-readback"]) {
    const { queued, original } = setup(), adapter = new FixtureAdapter(queued);
    await assert.rejects(adapter.send(original, eventAttempt(original), { phase, failure }));
    assert.equal(adapter.posts.length, 0, `${phase}/${failure}`);
    assert.equal(adapter.signs, phase === "attempt" ? 0 : 1);
    const latest = adapter.read();
    if (phase === "dispatch" && failure !== "before-write") assert.equal(status(latest).status, "unknown");
    assert.equal(latest.records[0].bodyText, queued.records[0].bodyText);
  }
});

test("adapter contract: both durable markers precede POST; lost ACK restart only retries original bytes with new proof context", async () => {
  const { queued, original } = setup(), adapter = new FixtureAdapter(queued);
  await assert.rejects(adapter.send(original, eventAttempt(original)), /network ACK lost/);
  assert.equal(adapter.trace.filter(value => value === "readback").length, 2);
  assert.equal(adapter.trace.at(-1), "POST"); assert.equal(status(adapter.read()).status, "unknown");
  const restart = new FixtureAdapter(adapter.read()), newEpoch = token("fixture-new-process");
  await assert.rejects(restart.send(original, eventAttempt(original, "explicit-retry", 700_000, SCOPE, newEpoch)), /network ACK lost/);
  assert.equal(restart.posts[0], adapter.posts[0]); assert.equal(restart.read().records[0].attempts.length, 2);
  assert.notEqual(restart.read().records[0].attempts[0].nonce, restart.read().records[0].attempts[1].nonce);
});

test("adapter contract: response write ACK lost retains latest candidate and never fabricates confirmation", async () => {
  const { sent, original, attemptEvent } = setup(), adapter = new FixtureAdapter(sent);
  const plan = prepare(sent, SCOPE, observeEvent(original, attemptEvent.requestId, success(sent, attemptEvent.requestId)));
  adapter.fail = "after-write"; await assert.rejects(adapter.commit(plan), /write ACK lost/);
  assert.equal(status(adapter.read()).status, "receipt-observed");
  assert.equal(summarize(adapter.read(), SCOPE).revocationConfirmed, false);
  assert.throws(() => assertBase(plan, adapter.read(), SCOPE), { code: "STALE_CONTROL_OUTBOX" });
});

test("history capacity fails closed without dropping a cancelled original body", () => {
  const state = clone(create(SCOPE));
  for (let index = 0; index < 128; index++) {
    const original = intent(`cancelled-${index}`), single = step(step(create(SCOPE), { type: "enqueue", intent: original }), { type: "cancel", intentId: original.body.intentId });
    state.records.push(clone(single.records[0]));
  }
  const before = canonicalJSON(state);
  assert.throws(() => prepare(state, SCOPE, { type: "enqueue", intent: intent("overflow") }), { code: "OUTBOX_CAPACITY" });
  assert.equal(canonicalJSON(state), before);
});
