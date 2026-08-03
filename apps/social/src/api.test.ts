import assert from "node:assert/strict";
import test from "node:test";

import {
  adoptRotatedSession,
  type DeviceRotationResponse,
  type Session,
} from "./api";

test("device rotation adopts the replacement session token without losing profile state", () => {
  const previous: Session = {
    token: "token-old",
    session: {
      id: "session-old",
      account: "ynx1socialaccount",
      deviceId: "device-old",
      scopes: ["social.profile", "social.messaging"],
      createdAt: "2026-07-27T12:00:00Z",
      expiresAt: "2026-07-28T12:00:00Z",
    },
    profile: {
      id: "ynx1socialaccount",
      handle: "alice",
      displayName: "Alice",
    },
  };
  const result: DeviceRotationResponse = {
    record: { id: "rotation-1" },
    replayed: false,
    token: "token-new",
    session: {
      ...previous.session,
      id: "session-new",
      deviceId: "device-new",
    },
  };

  const next = adoptRotatedSession(previous, result);

  assert.notStrictEqual(next, previous);
  assert.equal(next.token, result.token);
  assert.strictEqual(next.session, result.session);
  assert.strictEqual(next.profile, previous.profile);
  assert.equal(previous.token, "token-old");
  assert.equal(previous.session.deviceId, "device-old");
});
