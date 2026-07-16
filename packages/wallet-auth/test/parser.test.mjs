import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAuthorizationRequest, WalletAuthError } from "../src/index.js";
import { NOW, PRODUCT_DEVICE_KEY, REGISTRY, request } from "./fixtures.mjs";

const parse = (value) => parseAuthorizationRequest(value, { now: NOW, registry: REGISTRY });
const rejects = (value, code) => assert.throws(() => parse(value), (error) => error instanceof WalletAuthError && error.code === code);

test("strictly parses a five-minute product- and device-bound request", () => {
  const parsed = parse(JSON.stringify(request()));
  assert.equal(parsed.chainId, "ynx_6423-1");
  assert.equal(parsed.productDeviceKey, PRODUCT_DEVICE_KEY);
  assert.equal(parsed.productDeviceAlgorithm, "p256-sha256");
  assert.deepEqual(parsed.scopes, ["account:read", "profile:link"]);
  assert.equal(Object.isFrozen(parsed), true);
});

test("rejects unknown fields and missing required fields", () => {
  rejects({ ...request(), unknown: true }, "UNKNOWN_OR_MISSING_FIELD");
  const { purpose: _purpose, ...missing } = request();
  rejects(missing, "UNKNOWN_OR_MISSING_FIELD");
});

test("rejects wrong network, expiry over five minutes, expired and future requests", () => {
  rejects(request({ chainId: "ynx_1-1" }), "WRONG_NETWORK");
  rejects(request({ expiresAt: "2026-07-15T12:04:00.001Z" }), "INVALID_EXPIRY");
  rejects(request({ issuedAt: "2026-07-15T11:50:00.000Z", expiresAt: "2026-07-15T11:55:00.000Z" }), "EXPIRED");
  rejects(request({ issuedAt: "2026-07-15T12:00:31.000Z", expiresAt: "2026-07-15T12:04:00.000Z" }), "ISSUED_IN_FUTURE");
});

test("rejects product, callback, bundle and scope substitution", () => {
  rejects(request({ requestingProduct: "pay" }), "PRODUCT_MISMATCH");
  rejects(request({ bundleId: "com.attacker.app" }), "PRODUCT_MISMATCH");
  rejects(request({ callback: "attacker://wallet-auth/callback" }), "CALLBACK_MISMATCH");
  rejects(request({ scopes: ["account:read", "payments:write"] }), "SCOPE_NOT_ALLOWED");
  rejects(request({ scopes: ["profile:link", "account:read"] }), "INVALID_SCOPES");
  rejects(request({ productDeviceAlgorithm: "ed25519" }), "UNSUPPORTED_DEVICE_ALGORITHM");
  rejects(request({ productDeviceKey: "A".repeat(44) }), "INVALID_DEVICE_KEY");
});
