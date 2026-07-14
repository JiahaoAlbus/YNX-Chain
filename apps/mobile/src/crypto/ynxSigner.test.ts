import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base64RawToBytes, bytesToBase64Raw } from "./encoding";
import { accountIdentity, deviceIdentifier, deviceIdentity, exportAccountSecret, importAccountSecret, signOwnershipChallenge, signSquareRequest, squareDeviceRegistration } from "./ynxSigner";

const accountSecret = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 1 : 0);
const deviceSecret = new Uint8Array(32).fill(0x41);

test("matches the canonical browser and Go YNX identity vector", () => {
  assert.deepEqual(accountIdentity(accountSecret), {
    account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",
    accountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    evmAddress: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
  });
  assert.equal(exportAccountSecret(importAccountSecret(exportAccountSecret(accountSecret))), exportAccountSecret(accountSecret));
  assert.equal(deviceIdentifier(deviceSecret), "mobile-9a92d2b54a9a5402de3e65a0");
});

test("creates ownership and Square signatures compatible with the shared protocol", () => {
  const payload = utf8ToBytes('{"domain":"YNX_APP_ACCOUNT_OWNERSHIP_V1","version":1,"chainId":6423}');
  const signed = signOwnershipChallenge({ accountSecret, deviceSecret, signBytes: bytesToBase64Raw(payload) });
  assert.equal(secp256k1.verify(hexToBytes(signed.accountSignature), sha256(payload), hexToBytes(signed.accountPublicKey), { format: "der", lowS: true, prehash: false }), true);
  assert.equal(ed25519.verify(base64RawToBytes(signed.deviceSignature), payload, base64RawToBytes(deviceIdentity(deviceSecret).deviceSigningPublicKey)), true);

  const account = accountIdentity(accountSecret).account;
  const registration = squareDeviceRegistration({ account, deviceId: "mobile-vector-1", deviceSecret, idempotencyKey: "register-mobile-1" });
  const registrationPayload = utf8ToBytes(["ynx-square-device-register-v1", account, "mobile-vector-1", registration.signingPublicKey, "register-mobile-1"].join("\n"));
  assert.equal(ed25519.verify(base64RawToBytes(registration.proofSignature), registrationPayload, base64RawToBytes(registration.signingPublicKey)), true);

  const timestamp = "2026-07-14T12:00:00Z";
  const body = JSON.stringify({ idempotencyKey: "post-mobile-1", content: "native" });
  const signature = signSquareRequest({ method: "POST", requestUri: "/square/posts", timestamp, body, deviceSecret });
  const requestPayload = utf8ToBytes(["ynx-square-http-v1", "POST", "/square/posts", timestamp, Buffer.from(sha256(utf8ToBytes(body))).toString("hex")].join("\n"));
  assert.equal(ed25519.verify(base64RawToBytes(signature), requestPayload, base64RawToBytes(registration.signingPublicKey)), true);
});

test("base64 codec round-trips without browser globals", () => {
  for (const length of [1, 2, 3, 31, 32, 64]) {
    const value = Uint8Array.from({ length }, (_, index) => (index * 17 + length) & 255);
    assert.deepEqual(base64RawToBytes(bytesToBase64Raw(value)), value);
  }
});
