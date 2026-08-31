import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthorizationRejection,
  createCallbackURL,
  encodeRequestDeepLink,
  parseAuthorizationCallbackURL,
  parseAuthorizationRequest,
  parseWalletDeepLink,
  signAuthorization,
  WalletAuthError,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, REGISTRY, request } from "./fixtures.mjs";

for (const platform of ["android", "ios"]) {
  test(`${platform} deep link parses the exact Wallet authorization route`, () => {
    const parsed = parseWalletDeepLink(encodeRequestDeepLink(request()), platform, { now: NOW, registry: REGISTRY });
    assert.equal(parsed.platform, platform);
    assert.equal(parsed.request.bundleId, "com.ynx.social");
    assert.equal(parsed.request.productDeviceAlgorithm, "p256-sha256");
  });
}

test("deep links reject route, query and encoding tampering", () => {
  const valid = encodeRequestDeepLink(request());
  assert.throws(() => parseWalletDeepLink(valid.replace("authorize", "approve"), "android", { now: NOW, registry: REGISTRY }), WalletAuthError);
  assert.throws(() => parseWalletDeepLink(`${valid}&redirect=attacker`, "ios", { now: NOW, registry: REGISTRY }), WalletAuthError);
  assert.throws(() => parseWalletDeepLink("ynxwallet://authorize?request=%25", "android", { now: NOW, registry: REGISTRY }), WalletAuthError);
});

test("bare and payload-free Wallet authorization routes fail with an actionable code", () => {
  for (const value of [
    "ynxwallet://authorize",
    "ynxwallet://authorize?",
    "ynxwallet://authorize?request=",
    "ynxwallet://authorize#request",
    "ynxwallet://authorize?redirect=https%3A%2F%2Fattacker.example",
  ]) {
    assert.throws(
      () => parseWalletDeepLink(value, "android", { now: NOW, registry: REGISTRY }),
      (error) => error instanceof WalletAuthError && error.code === "MISSING_AUTHORIZATION_REQUEST",
    );
  }
});

test("approve and reject callbacks are parsed and bound to the exact request", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const rejection = createAuthorizationRejection(parsed, { decisionCode: "USER_REJECTED", rejectedAt: NOW.toISOString() });
  assert.deepEqual(parseAuthorizationCallbackURL(createCallbackURL(approval), parsed, NOW), approval);
  assert.deepEqual(parseAuthorizationCallbackURL(createCallbackURL(rejection), parsed, NOW), rejection);
  assert.throws(
    () => parseAuthorizationCallbackURL(createCallbackURL({ ...rejection, productClientId: "ynx-pay-v1" }), parsed, NOW),
    (error) => error instanceof WalletAuthError && error.code === "AUTHORIZATION_REJECTION_MISMATCH",
  );
});
