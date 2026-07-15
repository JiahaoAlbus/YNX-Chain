import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64RawToBytes } from "./encoding";
import { CHAT_ALGORITHM, chatDeviceRegistration, chatEncryptionPublicKey, decryptChatMessage, encryptChatMessage, signChatRequest } from "./chatCrypto";

const aliceSecret = new Uint8Array(32).fill(0x41);
const bobSecret = new Uint8Array(32).fill(0x42);
const aliceAccount = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80";

test("encrypts and decrypts an authenticated Chat envelope", () => {
  const envelope = encryptChatMessage({
    deviceSecret: aliceSecret,
    recipientPublicKey: chatEncryptionPublicKey(bobSecret),
    conversationId: "conv_mobile_vector",
    messageId: "message_mobile_vector",
    plaintext: "native chat message",
    nonce: new Uint8Array(24).fill(0x33),
  });
  assert.equal(envelope.algorithm, CHAT_ALGORITHM);
  assert.equal(decryptChatMessage({
    deviceSecret: bobSecret,
    peerPublicKey: chatEncryptionPublicKey(aliceSecret),
    conversationId: "conv_mobile_vector",
    messageId: "message_mobile_vector",
    envelope,
  }), "native chat message");
  assert.throws(() => decryptChatMessage({
    deviceSecret: bobSecret,
    peerPublicKey: chatEncryptionPublicKey(aliceSecret),
    conversationId: "conv_mobile_vector",
    messageId: "message_changed",
    envelope,
  }), /authentication failed/);
});

test("creates verifiable Chat registration and HTTP signatures", () => {
  const registration = chatDeviceRegistration({ account: aliceAccount, deviceId: "mobile-device-1", deviceSecret: aliceSecret, idempotencyKey: "register-mobile-chat" });
  const registrationPayload = new TextEncoder().encode(["ynx-chat-device-register-v1", registration.account, registration.deviceId, registration.signingPublicKey, registration.encryptionPublicKey, registration.idempotencyKey].join("\n"));
  assert.equal(ed25519.verify(base64RawToBytes(registration.proofSignature), registrationPayload, base64RawToBytes(registration.signingPublicKey)), true);

  const timestamp = "2026-07-15T08:00:00Z";
  const signature = signChatRequest({ method: "GET", requestUri: "/chat/conversations", timestamp, deviceSecret: aliceSecret });
  const digest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const requestPayload = new TextEncoder().encode(["ynx-chat-http-v1", "GET", "/chat/conversations", timestamp, digest].join("\n"));
  assert.equal(ed25519.verify(base64RawToBytes(signature), requestPayload, ed25519.getPublicKey(aliceSecret)), true);
});
