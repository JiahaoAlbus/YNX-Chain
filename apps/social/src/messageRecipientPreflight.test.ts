import assert from "node:assert/strict";
import test from "node:test";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { createEnvelopeSet, type ChatDevice } from "./chatCrypto";
import { assertPendingRecipients, type PendingMessage } from "./messageOutbox";

const alice = `ynx1${"a".repeat(38)}`, bob = `ynx1${"b".repeat(38)}`;
const seed = new Uint8Array(32).fill(7);
const raw = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").replace(/=+$/, "");
function fixture() {
  const devices: ChatDevice[] = [alice, bob].map((account, index) => ({
    id: `device-${index}`, account, status: "active", createdAt: "", updatedAt: "",
    signingPublicKey: raw(ed25519.getPublicKey(seed)),
    encryptionPublicKey: raw(x25519.getPublicKey(new Uint8Array(32).fill(index + 2))),
  }));
  const request = createEnvelopeSet({ signingSeed: seed, senderAccount: alice, senderDeviceId: "device-0",
    conversationId: "conversation-test", messageId: "message-test", plaintext: "private message", devices,
    entropy: new Uint8Array(32).fill(11) });
  const pending: PendingMessage = { account: alice, deviceId: "device-0", conversationId: "conversation-test", request };
  return { devices, pending };
}
test("current recipients and exact signed retry are accepted", () => {
  const { devices, pending } = fixture();
  assert.doesNotThrow(() => assertPendingRecipients(pending, devices));
  assert.doesNotThrow(() => assertPendingRecipients(pending, [...devices].reverse()));
});
test("removed members and revoked or newly added devices block stale retries", () => {
  const { devices, pending } = fixture();
  assert.throws(() => assertPendingRecipients(pending, devices.slice(0, 1)), /membership changed/);
  assert.throws(() => assertPendingRecipients(pending, [devices[0]!, { ...devices[1]!, status: "revoked" }]), /membership changed/);
  assert.throws(() => assertPendingRecipients(pending, [...devices, { ...devices[1]!, id: "new-device" }]), /membership changed/);
  assert.throws(() => assertPendingRecipients(pending, [{ ...devices[0]!, status: "revoked" }, devices[1]!]), /sending device/);
});
test("tampering with sender, context or signature cannot be retried", () => {
  const { devices, pending } = fixture();
  assert.throws(() => assertPendingRecipients({ ...pending, account: bob }, devices), /sending device/);
  assert.throws(() => assertPendingRecipients({ ...pending, conversationId: "other-conversation" }, devices), /verification failed/);
  assert.throws(() => assertPendingRecipients({ ...pending, request: { ...pending.request, senderSignature: "invalid" } }, devices), /verification failed/);
});
