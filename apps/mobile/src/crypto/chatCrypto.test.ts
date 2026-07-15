import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64RawToBytes, bytesToBase64Raw } from "./encoding";
import { CHAT_ALGORITHM, chatDeviceRegistration, chatEncryptionPublicKey, createChatDeviceRotation, createChatEnvelopeSet, decryptChatDeviceEnvelope, decryptChatMessage, encryptChatMessage, signChatRequest, verifyChatEnvelopeSetSignature } from "./chatCrypto";

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

test("matches the Go multi-device envelope and sender-signature vector", () => {
  const tabletSecret = new Uint8Array(32).fill(0x43);
  const result = createChatEnvelopeSet({
    deviceSecret: aliceSecret,
    senderAccount: aliceAccount,
    senderDeviceId: "alice-mobile",
    conversationId: "conv_multi_vector",
    messageId: "message_multi_vector",
    plaintext: "multi device native chat",
    recipients: [
      { account: "ynx1llllllllllllllllllllllllllllllllyj698f", deviceId: "bob-tablet", encryptionPublicKey: chatEncryptionPublicKey(tabletSecret) },
      { account: "ynx1llllllllllllllllllllllllllllllllyj698f", deviceId: "bob-phone", encryptionPublicKey: chatEncryptionPublicKey(bobSecret) },
    ],
    entropy: new Uint8Array(32).fill(0x44),
  });
  assert.equal(result.envelopes[0]?.recipientDeviceId, "bob-phone");
  assert.equal(result.envelopes[0]?.ephemeralPublicKey, "/y7kVgHsG2cxDHeQQEWFrmlzMe7hwfjPJBlzHB//Pms");
  assert.equal(result.envelopes[0]?.nonce, "KyIspY1eGst2yX8X9O4DdOnlLYx8BeID");
  assert.equal(result.envelopes[0]?.ciphertext, "ppnLcfWhGrFmXB/wkXZ34+x0UE0qbLLOhKFVQ8Z2uon2BsuRZ//A0Q");
  assert.equal(result.envelopes[1]?.ciphertext, "sEq8c0gf2yOph3xLZPBMLjuBijpkSKvcrQzfbZtMUlXFqOLJL7uScw");
  assert.equal(result.senderSignature, "eQQoXodUn0aY7FU1Ruy4G6SFZuFGyXkRXUzveFhHtTQvDPXvvDJaqfPGFnsVwZoecHI4Mme1goaQ/H2wyg/9Aw");
  assert.equal(verifyChatEnvelopeSetSignature({ conversationId: "conv_multi_vector", messageId: result.messageId, senderAccount: aliceAccount, senderDeviceId: "alice-mobile", envelopes: result.envelopes, senderSignature: result.senderSignature, senderSigningPublicKey: bytesToBase64Raw(ed25519.getPublicKey(aliceSecret)) }), true);
  assert.equal(decryptChatDeviceEnvelope({ deviceSecret: bobSecret, conversationId: "conv_multi_vector", messageId: result.messageId, senderDeviceId: "alice-mobile", envelope: result.envelopes[0]! }), "multi device native chat");
  assert.equal(decryptChatDeviceEnvelope({ deviceSecret: tabletSecret, conversationId: "conv_multi_vector", messageId: result.messageId, senderDeviceId: "alice-mobile", envelope: result.envelopes[1]! }), "multi device native chat");
});

test("creates independently verifiable old-device authorization and new-device proof", () => {
  const nextSecret = new Uint8Array(32).fill(0x55);
  const request = createChatDeviceRotation({ account: aliceAccount, authorizingDeviceId: "alice-mobile", replacedDeviceId: "alice-mobile", authorizingDeviceSecret: aliceSecret, newDeviceSecret: nextSecret, idempotencyKey: "rotate-alice-mobile", newDeviceId: "alice-next" });
  const document = JSON.stringify({ account: aliceAccount, authorizingDeviceId: "alice-mobile", replacedDeviceId: "alice-mobile", idempotencyKey: request.idempotencyKey, newDeviceId: request.newDeviceId, signingPublicKey: request.signingPublicKey, encryptionPublicKey: request.encryptionPublicKey });
  assert.equal(ed25519.verify(base64RawToBytes(request.authorizationSignature), new TextEncoder().encode(`ynx-chat-device-rotation-authorize-v1\n${document}`), ed25519.getPublicKey(aliceSecret)), true);
  assert.equal(ed25519.verify(base64RawToBytes(request.newDeviceProofSignature), new TextEncoder().encode(`ynx-chat-device-rotation-new-device-v1\n${document}`), ed25519.getPublicKey(nextSecret)), true);
});
