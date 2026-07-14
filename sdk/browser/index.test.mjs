import assert from "node:assert/strict";
import {test} from "node:test";
import {ed25519} from "@noble/curves/ed25519.js";
import {secp256k1} from "@noble/curves/secp256k1.js";
import {sha256} from "@noble/hashes/sha2.js";
import {hexToBytes} from "@noble/hashes/utils.js";
import {
  YNXBrowserSignerError,
  YNXSquareAppClient,
  accountIdentity,
  deviceIdentity,
  deviceIdentifier,
  exportAccountSecret,
  importAccountSecret,
  openSignerVault,
  sealSignerVault,
  signOwnershipChallenge,
  signSquareRequest,
  squareDeviceRegistration,
  zeroize,
} from "./index.js";

const accountSecret = Uint8Array.from({length: 32}, (_, index) => index === 31 ? 1 : 0);
const deviceSecret = new Uint8Array(32).fill(0x41);

test("derives the shared private-key-one YNX address", () => {
  assert.deepEqual(accountIdentity(accountSecret), {
    account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",
    accountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    evmAddress: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
  });
  assert.equal(exportAccountSecret(importAccountSecret(exportAccountSecret(accountSecret))), exportAccountSecret(accountSecret));
});

test("creates Go-compatible low-S ownership and Ed25519 signatures", () => {
  const signPayload = new TextEncoder().encode('{"domain":"YNX_APP_ACCOUNT_OWNERSHIP_V1","version":1,"chainId":6423}');
  const signBytes = Buffer.from(signPayload).toString("base64url");
  const signed = signOwnershipChallenge({accountSecret, deviceSecret, signBytes});
  assert.equal(signed.accountPublicKey, accountIdentity(accountSecret).accountPublicKey);
  assert.equal(secp256k1.verify(hexToBytes(signed.accountSignature), sha256(signPayload), hexToBytes(signed.accountPublicKey), {format: "der", lowS: true, prehash: false}), true);
  assert.equal(ed25519.verify(Buffer.from(signed.deviceSignature, "base64url"), signPayload, Buffer.from(deviceIdentity(deviceSecret).deviceSigningPublicKey, "base64url")), true);
  assert.match(signed.accountSignature, /^30[0-9a-f]+$/);
});

test("binds Square registration and HTTP signatures to exact fields", () => {
  const account = accountIdentity(accountSecret).account;
  const registration = squareDeviceRegistration({account, deviceId: "device-browser-1", deviceSecret, idempotencyKey: "register-browser-1"});
  const registrationPayload = new TextEncoder().encode([
    "ynx-square-device-register-v1",
    account,
    "device-browser-1",
    registration.signingPublicKey,
    "register-browser-1",
  ].join("\n"));
  assert.equal(ed25519.verify(Buffer.from(registration.proofSignature, "base64url"), registrationPayload, Buffer.from(registration.signingPublicKey, "base64url")), true);

  const body = JSON.stringify({idempotencyKey: "post-browser-1", content: "ownership-bound"});
  const timestamp = "2026-07-14T12:00:00Z";
  const signature = signSquareRequest({method: "POST", requestUri: "/square/posts", timestamp, body, deviceSecret});
  const digest = Buffer.from(sha256(new TextEncoder().encode(body))).toString("hex");
  const requestPayload = new TextEncoder().encode(["ynx-square-http-v1", "POST", "/square/posts", timestamp, digest].join("\n"));
  assert.equal(ed25519.verify(Buffer.from(signature, "base64url"), requestPayload, Buffer.from(registration.signingPublicKey, "base64url")), true);
  assert.notEqual(signature, signSquareRequest({method: "POST", requestUri: "/square/posts?mode=changed", timestamp, body, deviceSecret}));
});

test("derives a stable bounded browser device identifier", () => {
  assert.equal(deviceIdentifier(deviceSecret), "web-9a92d2b54a9a5402de3e65a0");
  assert.equal(deviceIdentifier(deviceSecret), deviceIdentifier(deviceSecret));
});

test("rejects malformed inputs and zeroizes caller-owned buffers", () => {
  assert.throws(() => importAccountSecret("01"), (error) => error instanceof YNXBrowserSignerError && error.code === "INVALID_ACCOUNT_SECRET");
  assert.throws(() => signSquareRequest({method: "DELETE", requestUri: "/square/posts", timestamp: "2026-07-14T12:00:00Z", body: "", deviceSecret}), /method/);
  assert.throws(() => signSquareRequest({method: "POST", requestUri: "/app/square/posts", timestamp: "2026-07-14T12:00:00Z", body: "", deviceSecret}), /request URI/);
  const disposable = new Uint8Array([1, 2, 3]);
  zeroize(disposable);
  assert.deepEqual(disposable, new Uint8Array(3));
});

test("encrypts signer secrets and rejects wrong passwords or tampering", async () => {
  const vault = await sealSignerVault({accountSecret, deviceSecret}, "correct horse battery staple");
  const serialized = JSON.stringify(vault);
  assert.equal(serialized.includes(exportAccountSecret(accountSecret)), false);
  assert.equal(serialized.includes(Buffer.from(deviceSecret).toString("base64")), false);
  const unlocked = await openSignerVault(vault, "correct horse battery staple");
  assert.deepEqual(unlocked.accountSecret, accountSecret);
  assert.deepEqual(unlocked.deviceSecret, deviceSecret);
  await assert.rejects(openSignerVault(vault, "wrong password value"), /unlock failed/);
  const tamperedBytes = Buffer.from(vault.ciphertext, "base64url");
  tamperedBytes[Math.floor(tamperedBytes.length / 2)] ^= 0x01;
  const tampered = {...vault, ciphertext: tamperedBytes.toString("base64").replace(/=+$/u, "")};
  await assert.rejects(openSignerVault(tampered, "correct horse battery staple"), /unlock failed/);
  await assert.rejects(openSignerVault({...vault, extra: true}, "correct horse battery staple"), /vault is invalid/);
  zeroize(unlocked.accountSecret, unlocked.deviceSecret);
});

test("establishes a bound session and signs Square requests without sending private keys", async () => {
  const requests = [];
  const identity = accountIdentity(accountSecret);
  const device = deviceIdentity(deviceSecret);
  const signPayload = new TextEncoder().encode('{"domain":"YNX_APP_ACCOUNT_OWNERSHIP_V1","version":1,"chainId":6423}');
  const signBytes = Buffer.from(signPayload).toString("base64url");
  let challengeCount = 0;
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({path, options});
    if (path === "/app/session/challenges") {
      challengeCount += 1;
      return jsonResponse(201, {challengeId: `challenge-browser-${challengeCount}`, account: identity.account, signBytes, signDocument: {account: identity.account, deviceId: "device-browser-1", deviceSigningPublicKey: device.deviceSigningPublicKey, chainId: 6423}});
    }
    if (/^\/app\/session\/challenges\/challenge-browser-\d+\/verify$/.test(path)) return jsonResponse(201, {account: identity.account, deviceId: "device-browser-1", token: "s".repeat(43), expiresAt: "2026-07-14T12:30:00Z"});
    if (path === "/app/square/devices") return jsonResponse(201, {record: {id: "device-browser-1"}});
    if (path === "/app/square/posts") return jsonResponse(201, {record: {id: "post-browser-1"}});
    if (path === "/app/square/devices/device-browser-1/revoke") return jsonResponse(200, {record: {status: "revoked"}});
    if (path === "/app/session/revoke") return jsonResponse(200, {revoked: true});
    return jsonResponse(404, {error: "not found"});
  };
  const client = new YNXSquareAppClient({baseURL: "https://api.ynxweb4.com", accountSecret, deviceSecret, deviceId: "device-browser-1", fetchImpl, now: () => new Date("2026-07-14T12:00:00Z")});
  assert.equal((await client.connect()).connected, true);
  assert.equal((await client.createPost({content: "first signed browser post", idempotencyKey: "post-browser-1"})).record.id, "post-browser-1");
  await client.disconnect();
  assert.equal(client.connected, false);
  assert.equal((await client.connect()).connected, true);
  await client.disconnect({revokeDevice: true});
  assert.equal(client.connected, false);
  assert.deepEqual(requests.map((request) => request.path), [
    "/app/session/challenges",
    "/app/session/challenges/challenge-browser-1/verify",
    "/app/square/devices",
    "/app/square/posts",
    "/app/session/revoke",
    "/app/session/challenges",
    "/app/session/challenges/challenge-browser-2/verify",
    "/app/square/devices",
    "/app/square/devices/device-browser-1/revoke",
    "/app/session/revoke",
  ]);
  const serializedRequests = JSON.stringify(requests);
  assert.equal(serializedRequests.includes(exportAccountSecret(accountSecret)), false);
  assert.equal(serializedRequests.includes(Buffer.from(deviceSecret).toString("base64")), false);
  const postRequest = requests.find((request) => request.path === "/app/square/posts");
  assert.equal(postRequest.options.headers["X-YNX-App-Session"], "s".repeat(43));
  assert.match(postRequest.options.headers["X-YNX-Device-Signature"], /^[A-Za-z0-9+/]+$/);
  const registrations = requests.filter((request) => request.path === "/app/square/devices").map((request) => request.options.body);
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0], registrations[1]);
  client.lock();
  await assert.rejects(client.createPost({content: "blocked", idempotencyKey: "post-blocked-1"}), /not connected/);
});

function jsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  };
}
