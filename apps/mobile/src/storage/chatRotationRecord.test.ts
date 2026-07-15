import assert from "node:assert/strict";
import test from "node:test";
import { decodePendingChatRotation, encodePendingChatRotation } from "./chatRotationRecord";

const account = `ynx1${"q".repeat(38)}`;

test("round-trips a bounded pending Chat rotation", () => {
  const encoded = encodePendingChatRotation({ account, authorizingDeviceId: "device-primary", newDeviceSecret: new Uint8Array(32).fill(7), idempotencyKey: "rotate-exact-retry" });
  const decoded = decodePendingChatRotation(encoded);
  assert.equal(decoded.account, account);
  assert.equal(decoded.authorizingDeviceId, "device-primary");
  assert.deepEqual(decoded.newDeviceSecret, new Uint8Array(32).fill(7));
  assert.equal(decoded.idempotencyKey, "rotate-exact-retry");
});

test("rejects malformed, extra-field, and unbounded pending rotations", () => {
  assert.throws(() => decodePendingChatRotation("not-json"), /unreadable/);
  assert.throws(() => decodePendingChatRotation(JSON.stringify({ version: 1, account, authorizingDeviceId: "device-primary", newDeviceSecret: "00".repeat(32), idempotencyKey: "rotate-exact-retry", extra: true })), /malformed/);
  assert.throws(() => encodePendingChatRotation({ account, authorizingDeviceId: "x", newDeviceSecret: new Uint8Array(32), idempotencyKey: "rotate-exact-retry" }), /authorizer/);
  assert.throws(() => encodePendingChatRotation({ account, authorizingDeviceId: "device-primary", newDeviceSecret: new Uint8Array(31), idempotencyKey: "rotate-exact-retry" }), /secret/);
});
