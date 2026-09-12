import assert from "node:assert/strict";
import test from "node:test";
import { acknowledgeQueued, pendingFor, queueMessage, readOutbox, type PendingMessage } from "./messageOutbox";

const entry = (messageId: string, conversationId = "chat-a", deviceId = "device-a"): PendingMessage => ({
  account: "account-a", deviceId, conversationId,
  request: { messageId, envelopes: [], senderSignature: "signed-ciphertext" },
});
test("queued messages survive unrelated acknowledgements and round-trip storage", () => {
  const a = entry("one"), b = entry("two", "chat-b"), c = entry("three");
  const queue = readOutbox(JSON.stringify(queueMessage(queueMessage([a], b), c)));
  const remaining = acknowledgeQueued(queue, b);
  assert.deepEqual(remaining, [a, c]);
  assert.equal(pendingFor(remaining, a.account, a.deviceId, a.conversationId)?.messageId, "one");
  assert.equal(pendingFor(acknowledgeQueued(remaining, a), a.account, a.deviceId, a.conversationId)?.messageId, "three");
});
test("retries preserve exact ciphertext and separate devices and accounts", () => {
  const a = entry("one");
  assert.deepEqual(queueMessage([a], a), [a]);
  assert.throws(() => queueMessage([a], { ...a, request: { ...a.request, senderSignature: "different" } }), /different ciphertext/);
  assert.equal(pendingFor([a], a.account, "device-b", a.conversationId), null);
  assert.equal(pendingFor([a], "account-b", a.deviceId, a.conversationId), null);
  assert.equal(acknowledgeQueued([a], entry("one", "chat-a", "device-b")).length, 1);
});
test("legacy data is preserved without being silently assigned to a new device", () => {
  const { deviceId, ...legacy } = entry("old");
  const restored = readOutbox(JSON.stringify(legacy));
  assert.equal(restored.length, 1);
  assert.equal(pendingFor(restored, legacy.account, deviceId, legacy.conversationId), null);
  assert.equal(queueMessage(restored, entry("new")).length, 2);
  assert.throws(() => readOutbox('{"broken":true}'), /invalid/);
});
