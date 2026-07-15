import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCallbackURL, createGatewayChallenge, OneTimeNonceStore, parseAuthorizationRequest,
  parseCallbackURL, requestDigest, signAuthorization, signGatewayChallenge, verifyAuthorization,
  verifyGatewayCompletion, WalletAuthError,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, REGISTRY, request } from "./fixtures.mjs";

test("Social -> Wallet -> callback -> Gateway yields only a Social-device-bound session", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const nonces = new OneTimeNonceStore();
  nonces.consume(parsed, NOW);
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const callback = createCallbackURL(approval);
  const returned = parseCallbackURL(callback, parsed.callback);
  const verified = verifyAuthorization(returned, { ...parsed, requestDigest: requestDigest(parsed), now: NOW });
  const challenge = createGatewayChallenge(verified, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" });
  const completion = signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET);
  const session = verifyGatewayCompletion(completion, verified, NOW);
  assert.equal(session.productClientId, "ynx-social-v1");
  assert.equal(session.bundleId, "com.ynxweb4.social");
  assert.deepEqual(session.scopes, ["account:read", "profile:link"]);
  assert.throws(() => nonces.consume(parsed, NOW), (error) => error instanceof WalletAuthError && error.code === "REPLAY");
});

test("callback interception cannot complete the product-device challenge", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" });
  const attackerSecret = Buffer.alloc(32, 0x24).toString("base64url");
  assert.throws(() => signGatewayChallenge(challenge, attackerSecret), (error) => error instanceof WalletAuthError && error.code === "DEVICE_MISMATCH");
  assert.throws(() => parseCallbackURL(createCallbackURL(approval).replace("ynxsocial:", "attacker:"), parsed.callback), /substituted/);
});

test("a product session cannot be reused across another App binding", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" });
  const completion = signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET);
  assert.throws(() => verifyGatewayCompletion(completion, { ...approval, productClientId: "ynx-pay-v1" }, NOW), (error) => error instanceof WalletAuthError && error.code === "SESSION_BINDING_MISMATCH");
});
