import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseAuthorizationRequest, requestDigest, signAuthorization, verifyAuthorization, walletIdentity } from "../src/index.js";
import { ACCOUNT_SECRET, NOW, REGISTRY, request } from "./fixtures.mjs";

test("signer vector binds the native account to the exact request", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const identity = walletIdentity(ACCOUNT_SECRET);
  const response = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, account: identity.account, issuedAt: NOW.toISOString() });
  assert.equal(response.requestDigest, requestDigest(parsed));
  assert.equal(response.account, "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80");
  assert.equal(response.walletSignature.length, 128);
  assert.equal(verifyAuthorization(response, {
    ...parsed,
    requestDigest: response.requestDigest,
    productClientId: parsed.productClientId,
    bundleId: parsed.bundleId,
    productDeviceKey: parsed.productDeviceKey,
    callback: parsed.callback,
    now: NOW,
  }).account, identity.account);
});

test("tampered response does not verify", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const response = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  assert.throws(() => verifyAuthorization({ ...response, purpose: "A substituted purpose" }, { ...parsed, requestDigest: response.requestDigest, now: NOW }), /signature|match/);
  assert.throws(() => verifyAuthorization({ ...response, callback: "attacker://wallet-auth/callback" }, { ...parsed, requestDigest: response.requestDigest, now: NOW }), /match/);
});

test("published signer vector is deterministic and verifies", async () => {
  const vector = JSON.parse(await readFile(new URL("../testdata/signer-v1.json", import.meta.url), "utf8"));
  const parsed = parseAuthorizationRequest(vector.request, { now: NOW, registry: REGISTRY });
  assert.equal(requestDigest(parsed), vector.requestDigest);
  assert.deepEqual(signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() }), vector.approval);
  assert.equal(verifyAuthorization(vector.approval, { ...vector.request, requestDigest: vector.requestDigest, now: NOW }).account, vector.approval.account);
});
