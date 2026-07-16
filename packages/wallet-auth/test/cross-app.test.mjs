import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createCallbackURL, createGatewayChallenge, gatewayChallengeSignBytes, OneTimeNonceStore, parseAuthorizationRequest,
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
  const challenge = createGatewayChallenge(verified, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
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
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  const attackerSecret = Buffer.alloc(32, 0x24).toString("base64url");
  assert.throws(() => signGatewayChallenge(challenge, attackerSecret), (error) => error instanceof WalletAuthError && error.code === "DEVICE_MISMATCH");
  assert.throws(() => parseCallbackURL(createCallbackURL(approval).replace("ynxsocial:", "attacker:"), parsed.callback), /substituted/);
});

test("a product session cannot be reused across another App binding", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  const completion = signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET);
  assert.throws(() => verifyGatewayCompletion(completion, { ...approval, productClientId: "ynx-pay-v1" }, NOW), (error) => error instanceof WalletAuthError && error.code === "SESSION_BINDING_MISMATCH");
});

test("a product key holder cannot escalate, substitute, or reorder approved scopes", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  for (const scopes of [["account:read", "payments:write", "profile:link"], ["account:read", "profile:write"]]) {
    const completion = signGatewayChallenge({ ...challenge, scopes }, PRODUCT_DEVICE_SECRET);
    assert.throws(() => verifyGatewayCompletion(completion, approval, NOW), (error) => error instanceof WalletAuthError && error.code === "SESSION_SCOPE_MISMATCH");
  }
  assert.throws(() => signGatewayChallenge({ ...challenge, scopes: ["profile:link", "account:read"] }, PRODUCT_DEVICE_SECRET), (error) => error instanceof WalletAuthError && error.code === "INVALID_SCOPES");
});

test("a product key holder cannot extend a challenge beyond Wallet approval expiry", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  assert.throws(() => createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:04:00.001Z" }, NOW), (error) => error instanceof WalletAuthError && error.code === "INVALID_CHALLENGE_EXPIRY");
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  const completion = signGatewayChallenge({ ...challenge, expiresAt: "2026-07-15T12:04:00.001Z" }, PRODUCT_DEVICE_SECRET);
  assert.throws(() => verifyGatewayCompletion(completion, approval, NOW), (error) => error instanceof WalletAuthError && error.code === "SESSION_LIFETIME_MISMATCH");
});

test("Gateway challenge and completion schemas fail closed on malformed or unknown fields", () => {
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  const completion = signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET);
  assert.throws(() => signGatewayChallenge({ ...challenge, issuedAt: "2026-07-15T12:00:00Z" }, PRODUCT_DEVICE_SECRET), (error) => error instanceof WalletAuthError && error.code === "INVALID_FIELD");
  assert.throws(() => signGatewayChallenge({ ...challenge, unknown: true }, PRODUCT_DEVICE_SECRET), (error) => error instanceof WalletAuthError && error.code === "UNKNOWN_OR_MISSING_FIELD");
  assert.throws(() => verifyGatewayCompletion({ ...completion, unknown: true }, approval, NOW), (error) => error instanceof WalletAuthError && error.code === "UNKNOWN_OR_MISSING_FIELD");
  assert.throws(() => verifyGatewayCompletion({ challenge: { ...challenge, productDeviceAlgorithm: "ed25519" }, deviceSignature: completion.deviceSignature }, approval, NOW), WalletAuthError);
});

test("published P-256 Gateway vector uses the canonical Android-compatible signing domain", async () => {
  const vector = JSON.parse(await readFile(new URL("../testdata/gateway-p256-v1.json", import.meta.url), "utf8"));
  assert.equal(gatewayChallengeSignBytes(vector.challenge), vector.signBytes);
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  assert.deepEqual(signGatewayChallenge(vector.challenge, vector.productDeviceSecret).deviceSignature, vector.deviceSignature);
  assert.deepEqual(verifyGatewayCompletion({ challenge: vector.challenge, deviceSignature: vector.deviceSignature }, approval, NOW), vector.session);
});
