import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJSON, signProductSessionChallenge } from "../src/index.js";
import { parseProductSessionControlSnapshot } from "../src/product-session-control-intent.js";
import { walletSessionControlReplayExpiry } from "../src/wallet-session-control.js";
import { ACCOUNT_PATH, DEVICE_PATH, OTHER, at, deviceSecret, input, intentBody, introspect, kernel, ownerInput, pending, result, session, token } from "./fixtures/product-session-control-v3-fixture.mjs";

for (const operation of ["account", "device"]) test(`real ${operation} kernel blocks late completion and cached success, retains cancelled challenge history and permits fresh approval`, () => {
  const gateway = kernel(), original = session(gateway, `${operation}-original`);
  const waiting = pending(`${operation}-waiting`), unseen = pending(`${operation}-unseen`);
  const issuedInput = input("/v2/product-sessions/challenge", waiting), challenge = result(gateway.dispatch(issuedInput, at())).result;
  const path = operation === "account" ? ACCOUNT_PATH : DEVICE_PATH;
  const body = intentBody(`${operation}-intent`, operation === "device" ? original.session.deviceBinding : undefined);
  const first = gateway.dispatch(ownerInput(path, body, { offset: 10 }), at(10));
  assert.equal(first.status, 200, first.body);
  const prepared = result(first).result;
  assert.equal(prepared.status, "prepared"); assert.equal(prepared.revocationConfirmed, false);
  assert.equal(prepared.preparedReceipt.revokedSessionCount, 1); assert.equal(prepared.preparedReceipt.cancelledChallengeCount, 1);
  const originalCache = gateway.snapshot().idempotency.find(entry => entry.requestId === original.completeInput.requestId).responseBody;
  for (const request of [original.completeInput, original.challengeInput, issuedInput, input("/v2/product-sessions/complete", { ...waiting, completion: signProductSessionChallenge(challenge, deviceSecret) }), input("/v2/product-sessions/challenge", unseen)]) {
    const denied = gateway.dispatch(request, at(11)); assert.equal(denied.status, 403, denied.body); assert.equal(result(denied).error.code, "SESSION_REVOKED");
  }
  assert.equal(gateway.snapshot().idempotency.find(entry => entry.requestId === original.completeInput.requestId).responseBody, originalCache);
  assert.ok(gateway.snapshot().authority.issuedChallenges.some(item => item.challenge === challenge.challenge));
  assert.equal(introspect(gateway, original.session, 11).status, 403);
  const atCutoff = pending(`${operation}-same-millisecond`, { offset: 10 });
  assert.equal(gateway.dispatch(input("/v2/product-sessions/challenge", atCutoff), at(11)).status, 403);
  const fresh = session(gateway, `${operation}-fresh`, { offset: 12 });
  assert.equal(introspect(gateway, fresh.session, 12).status, 200);
  const restarted = kernel(parseProductSessionControlSnapshot(gateway.snapshot()));
  const priorAudits = restarted.snapshot().audit.length;
  const retried = result(restarted.dispatch(ownerInput(path, body, { offset: 20 }), at(20))).result;
  assert.equal(canonicalJSON(retried.preparedReceipt), canonicalJSON(prepared.preparedReceipt));
  assert.equal(introspect(restarted, fresh.session, 21).status, 200);
  assert.equal(restarted.snapshot().controlIntents.length, 1);
  assert.equal(restarted.snapshot().consumedProofs.filter(value => walletSessionControlReplayExpiry(value) !== null).length, 2);
  assert.equal(restarted.snapshot().audit.length, priorAudits + 2);
});

test("device logout isolates same-key accounts/products; owner body substitution and failed validation cannot consume a later valid nonce", () => {
  const gateway = kernel(), own = session(gateway, "isolation-own"), foreign = session(gateway, "isolation-other", { owner: OTHER }), product = session(gateway, "isolation-dex", { productId: "dex" });
  const body = intentBody("isolation-intent", own.session.deviceBinding), nonce = token("same-proof-nonce");
  const wrongBody = { ...body, account: foreign.session.account };
  const failed = gateway.dispatch(ownerInput(DEVICE_PATH, wrongBody, { offset: 10, nonce }), at(10));
  assert.equal(failed.status, 400); assert.equal(gateway.snapshot().controlIntents.length, 0);
  assert.equal(gateway.dispatch(ownerInput(DEVICE_PATH, body, { offset: 11, nonce }), at(11)).status, 200);
  assert.equal(introspect(gateway, own.session, 12).status, 403);
  assert.equal(introspect(gateway, foreign.session, 12).status, 200);
  assert.equal(introspect(gateway, product.session, 12).status, 200);
  assert.equal(gateway.snapshot().authority.revokedDevices.length, 0);
  const duplicate = gateway.dispatch(ownerInput(DEVICE_PATH, body, { offset: 12, nonce }), at(12));
  assert.equal(duplicate.status, 409); assert.equal(result(duplicate).error.code, "REPLAY");
});

test("intent conflict wins over expired body while an uncommitted expired intent and clock rollback never acquire a receipt", () => {
  const gateway = kernel(), current = session(gateway, "expiry");
  const body = intentBody("expiry-intent", undefined, { expires: 15 });
  assert.equal(gateway.dispatch(ownerInput(ACCOUNT_PATH, body, { offset: 10 }), at(10)).status, 200);
  const changed = { ...body, deviceBinding: current.session.deviceBinding };
  const conflict = gateway.dispatch(ownerInput(DEVICE_PATH, changed, { offset: 20 }), at(20));
  assert.equal(conflict.status, 409); assert.equal(result(conflict).error.code, "IDEMPOTENCY_CONFLICT");
  const expired = gateway.dispatch(ownerInput(ACCOUNT_PATH, intentBody("new-expired", undefined, { expires: 15 }), { offset: 21 }), at(21));
  assert.equal(expired.status, 409); assert.equal(result(expired).error.code, "INTENT_EXPIRED");
  const backwards = gateway.dispatch(ownerInput(ACCOUNT_PATH, body, { offset: 9 }), at(9));
  assert.equal(backwards.status, 503); assert.equal(gateway.snapshot().controlIntents.length, 1);
  assert.equal(result(gateway.dispatch(ownerInput(ACCOUNT_PATH, body, { offset: 22 }), at(22))).result.preparedReceipt.cutoff, at(10).toISOString());
});
