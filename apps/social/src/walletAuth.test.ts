import assert from "node:assert/strict";
import test from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  BUNDLE_ID,
  CALLBACK,
  PRODUCT_CLIENT_ID,
  createWalletRequest,
  encodeBase64URL,
  parseWalletCallback,
  requestDigest,
  signGatewayChallenge,
  walletRequestURL,
  type WalletApproval,
  type ProductSessionChallenge,
} from "./walletAuth";

const now = new Date("2026-07-15T12:00:00.000Z"),
  productSecret = new Uint8Array(32).fill(0x42),
  walletSecret = Uint8Array.from([...new Uint8Array(31), 1]);
const request = createWalletRequest(
  "nonce_social_canonical_envelope_0001",
  encodeBase64URL(p256.getPublicKey(productSecret, true)),
  now,
);
function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}
function approval(overrides: Partial<WalletApproval> = {}): WalletApproval {
  const unsigned = {
    version: "1",
    requestDigest: requestDigest(request),
    nonce: request.nonce,
    chainId: request.chainId,
    requestingProduct: request.requestingProduct,
    productClientId: request.productClientId,
    bundleId: request.bundleId,
    productDeviceAlgorithm: request.productDeviceAlgorithm,
    productDeviceKey: request.productDeviceKey,
    callback: request.callback,
    account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",
    accountPublicKey:
      "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    grantedScopes: [...request.scopes],
    purpose: request.purpose,
    issuedAt: "2026-07-15T12:00:00.000Z",
    expiresAt: "2026-07-15T12:04:00.000Z",
    ...overrides,
  };
  const signature = secp256k1.sign(
    sha256(utf8ToBytes(`YNX_WALLET_AUTH_APPROVAL_V1\n${canonical(unsigned)}`)),
    walletSecret,
    { prehash: false, format: "compact", lowS: true },
  );
  return {
    ...unsigned,
    walletSignature: bytesToHex(signature),
  } as WalletApproval;
}
function callback(value = approval()) {
  return `${CALLBACK}?response=${encodeBase64URL(utf8ToBytes(canonical(value)))}`;
}

test("emits only the canonical signed-envelope request field", () => {
  const value = walletRequestURL(request),
    parsed = new URL(value);
  assert.equal(parsed.protocol, "ynxwallet:");
  assert.equal(parsed.hostname, "authorize");
  assert.deepEqual([...parsed.searchParams.keys()], ["request"]);
  assert.ok(parsed.searchParams.get("request"));
  assert.equal(parsed.searchParams.has("clientId"), false);
  assert.equal(request.productClientId, PRODUCT_CLIENT_ID);
  assert.equal(request.bundleId, BUNDLE_ID);
});
test("verifies exact callback binding, account derivation, and compact low-S signature", () => {
  assert.equal(
    parseWalletCallback(callback(), request, now).account,
    approval().account,
  );
  assert.throws(
    () => parseWalletCallback(`${CALLBACK}?assertion=legacy`, request, now),
    /route|fields/,
  );
  assert.throws(
    () =>
      parseWalletCallback(
        callback(
          approval({
            callback: "ynxsocial://evil/callback" as typeof CALLBACK,
          }),
        ),
        request,
        now,
      ),
    /binding/,
  );
  const tampered = approval();
  assert.throws(
    () =>
      parseWalletCallback(
        callback({
          ...tampered,
          walletSignature: `0${tampered.walletSignature.slice(1)}`,
        }),
        request,
        now,
      ),
    /signature/,
  );
});
test("signs the server challenge with the exact bound P-256 product key", () => {
  const challenge: ProductSessionChallenge = {
    version: "1",
    challenge: "gateway_challenge_nonce_000000000001",
    requestDigest: requestDigest(request),
    productClientId: PRODUCT_CLIENT_ID,
    bundleId: BUNDLE_ID,
    productDeviceAlgorithm: "p256-sha256",
    productDeviceKey: request.productDeviceKey,
    account: approval().account,
    scopes: [...request.scopes],
    issuedAt: "2026-07-15T12:00:00.000Z",
    expiresAt: "2026-07-15T12:02:00.000Z",
  };
  const completion = signGatewayChallenge(challenge, productSecret, now);
  assert.match(completion.deviceSignature, /^[A-Za-z0-9_-]+$/);
  assert.throws(
    () =>
      signGatewayChallenge(
        { ...challenge, bundleId: "com.evil.social" },
        productSecret,
        now,
      ),
    /binding/,
  );
});
