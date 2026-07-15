import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base64RawToBytes, bytesToBase64Raw } from "./encoding";
import { accountIdentity, addressIdentity, createNativeTransferPreview, deviceIdentifier, deviceIdentity, exportAccountSecret, importAccountSecret, signNativeTransfer, signOwnershipChallenge, signSquareRequest, squareDeviceRegistration } from "./ynxSigner";

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

test("normalizes checksummed ynx1 and EVM compatibility addresses", () => {
  const expected = accountIdentity(accountSecret);
  assert.deepEqual(addressIdentity(expected.account), { ynxAddress: expected.account, evmAddress: expected.evmAddress });
  assert.deepEqual(addressIdentity(expected.evmAddress.toUpperCase().replace("0X", "0x")), { ynxAddress: expected.account, evmAddress: expected.evmAddress });
  assert.throws(() => addressIdentity(expected.account.slice(0, -1) + "q"), /checksum/);
  assert.throws(() => addressIdentity("ynx1qqqqqq"), /checksum/);
  assert.throws(() => addressIdentity("0x1234"), /prefix|checksum|address/);
});

test("creates the canonical Go-compatible native YNXT transfer envelope", () => {
  const recipient = "ynx1llllllllllllllllllllllllllllllllyj698f";
  const preview = createNativeTransferPreview({ from: accountIdentity(accountSecret).account, to: recipient, amount: 25, nonce: 7, balance: 100 });
  assert.deepEqual(preview, {
    chainId: 6423,
    from: { ynxAddress: accountIdentity(accountSecret).account, evmAddress: accountIdentity(accountSecret).evmAddress },
    to: { ynxAddress: recipient, evmAddress: "0xffffffffffffffffffffffffffffffffffffffff" },
    amount: 25,
    fee: 1,
    total: 26,
    nonce: 7,
  });
  const signed = signNativeTransfer({ accountSecret, preview });
  assert.equal(signed.payload, JSON.stringify(signed.transaction));
  assert.equal(signed.transaction.version, 1);
  assert.equal(signed.transaction.chainId, 6423);
  assert.equal(signed.transaction.type, "transfer");
  assert.equal(signed.transaction.from, accountIdentity(accountSecret).evmAddress);
  assert.equal(signed.transaction.to, "0xffffffffffffffffffffffffffffffffffffffff");
  assert.equal(signed.transaction.fee, 1);
  assert.equal(signed.hash, "0x5bd5da6a2960e6afed4e39ec739e833894fba1f2921952f725c56cebdd89dc03");

  const signDocument = {
    domain: "YNX_NATIVE_TX_V1",
    version: 1,
    chainId: 6423,
    type: "transfer",
    from: signed.transaction.from,
    to: signed.transaction.to,
    amount: 25,
    fee: 1,
    nonce: 7,
    publicKey: signed.transaction.publicKey,
  };
  assert.equal(secp256k1.verify(hexToBytes(signed.transaction.signature), sha256(utf8ToBytes(JSON.stringify(signDocument))), hexToBytes(signed.transaction.publicKey), { format: "der", lowS: true, prehash: false }), true);
});

test("rejects unsafe native transfer previews before signing", () => {
  const identity = accountIdentity(accountSecret);
  const recipient = "0x1111111111111111111111111111111111111111";
  assert.throws(() => createNativeTransferPreview({ from: identity.account, to: identity.account, amount: 1, nonce: 1, balance: 10 }), /different/);
  assert.throws(() => createNativeTransferPreview({ from: identity.account, to: recipient, amount: 10, nonce: 1, balance: 10 }), /Insufficient/);
  assert.throws(() => createNativeTransferPreview({ from: identity.account, to: recipient, amount: 1.5, nonce: 1, balance: 10 }), /whole number/);
  assert.throws(() => createNativeTransferPreview({ from: identity.account, to: recipient, amount: 1, nonce: 0, balance: 10 }), /nonce/);
});
