import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { test } from "node:test";
import { encodeRequestDeepLink } from "@ynx-chain/wallet-auth";
import { CANONICAL_AUTH_BRIDGE_UNAVAILABLE, CALLBACK_PROTOCOL_SOURCE, evaluateWalletCallback } from "../src/callback-policy.mjs";

const now = new Date("2026-08-21T08:00:00.000Z");
const productDevice = createECDH("prime256v1");
productDevice.setPrivateKey(Buffer.alloc(32, 0x42));
const request = {
  version: "1",
  nonce: "nonce_abcdefghijklmnopqrstuvwxyz12",
  chainId: "ynx_6423-1",
  requestingProduct: "social",
  productClientId: "ynx-social-v1",
  bundleId: "com.ynx.social",
  productDeviceAlgorithm: "p256-sha256",
  productDeviceKey: productDevice.getPublicKey(null, "compressed").toString("base64url"),
  callback: "ynx-social://com.ynx.social",
  scopes: ["account:read", "profile:link"],
  purpose: "Link this YNX account to the selected Social profile on this device.",
  issuedAt: "2026-08-21T07:59:00.000Z",
  expiresAt: "2026-08-21T08:04:00.000Z"
};

test("macOS consumes the exact frozen callback route and identity", () => {
  const review = evaluateWalletCallback(encodeRequestDeepLink(request), { now });
  assert.equal(CALLBACK_PROTOCOL_SOURCE.protocolCommit, "a9dea929c42d0f59162be5872be9ae41ad2875d4");
  assert.equal(CALLBACK_PROTOCOL_SOURCE.bundleIdentifier, "com.ynxweb4.wallet.macos");
  assert.equal(CALLBACK_PROTOCOL_SOURCE.associatedDomainsAuthorized, false);
  assert.equal(review.acceptedForReview, true);
  assert.equal(review.code, CANONICAL_AUTH_BRIDGE_UNAVAILABLE);
  assert.equal(review.displayName, "YNX Social");
  assert.equal(review.callbackEmitted, false);
  assert.equal(review.authorityGranted, false);
});

test("missing, malformed, expired and substituted routes fail closed", () => {
  for (const url of [
    "ynxwallet://authorize",
    "ynxwallet://authorize?request=%25",
    encodeRequestDeepLink({ ...request, expiresAt: "2026-08-21T07:59:30.000Z" }),
    encodeRequestDeepLink(request).replace("authorize", "approve")
  ]) {
    const result = evaluateWalletCallback(url, { now });
    assert.equal(result.acceptedForReview, false);
    assert.equal(result.callbackEmitted, false);
    assert.equal(result.authorityGranted, false);
  }
});
