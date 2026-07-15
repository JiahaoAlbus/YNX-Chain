import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatConversationResult, parseChatConversations, parseChatDevices, parseChatMessages } from "./chat";

const alice = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80";
const bob = "ynx1llllllllllllllllllllllllllllllllyj698f";
const conversation = { id: "conv_test_1", members: [alice, bob], createdBy: alice, createdAt: "2026-07-15T08:00:00Z", updatedAt: "2026-07-15T08:01:00Z" };

test("parses bounded Chat API records", () => {
  assert.equal(parseChatConversations({ conversations: [conversation] })[0]?.members[1], bob);
  assert.equal(parseChatConversationResult({ record: conversation, replayed: false }).id, "conv_test_1");
  assert.equal(parseChatDevices({ devices: [{ id: "bob-device", account: bob, signingPublicKey: "QQ", encryptionPublicKey: "Qg", status: "active", createdAt: "2026-07-15T08:00:00Z", updatedAt: "2026-07-15T08:00:00Z" }] })[0]?.status, "active");
  assert.equal(parseChatMessages({ messages: [{ id: "message_test_1", conversationId: "conv_test_1", sender: alice, senderDeviceId: "alice-device", algorithm: "x25519-hkdf-sha256-xchacha20poly1305", nonce: "Mw", ciphertext: "RA", ciphertextHash: "a".repeat(64), createdAt: "2026-07-15T08:02:00Z", deliveredAt: {}, readAt: {} }] })[0]?.sender, alice);
});

test("rejects malformed Chat API records", () => {
  assert.throws(() => parseChatConversations({ conversations: [{ ...conversation, members: [alice] }] }), /members/);
  assert.throws(() => parseChatDevices({ devices: [{ id: "bob-device", account: bob, signingPublicKey: "QQ", encryptionPublicKey: "Qg", status: "unknown", createdAt: "2026-07-15T08:00:00Z", updatedAt: "2026-07-15T08:00:00Z" }] }), /status/);
  assert.throws(() => parseChatMessages({ messages: [{ algorithm: "plaintext" }] }), /algorithm/);
});
