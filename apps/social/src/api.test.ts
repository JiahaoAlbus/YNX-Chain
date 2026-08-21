import assert from "node:assert/strict";
import test from "node:test";

import {
  adoptRotatedSession,
  SocialAPI,
  SocialAPIError,
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

test("public version read retries one transport failure and returns exact runtime identity", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network details must not escape");
    return new Response(JSON.stringify({
      service: "ynx-social",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      releaseId: "social-testnet-01234567",
      walletAuth: "canonical-signed-envelope-v1",
      walletGateway: "persistent-p256-challenge-v1",
      chainId: "ynx_6423-1",
      evmChainId: 6423,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const actual = await new SocialAPI("https://social.example").version();
  assert.equal(calls, 2);
  assert.equal(actual.sourceCommit, "0123456789abcdef0123456789abcdef01234567");
});

test("mutating requests never retry an ambiguous transport failure", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new TypeError("socket details"); };
  const api = new SocialAPI("https://social.example");
  await assert.rejects(
    api.request("/social/v1/profile", { method: "PUT", body: {}, auth: false }),
    (error: unknown) => error instanceof SocialAPIError && error.code === "NETWORK_UNAVAILABLE" && error.retryable,
  );
  assert.equal(calls, 1);
});

test("server fail-closed diagnostics preserve a safe typed code without retry", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      code: "SOURCE_IDENTITY_UNAVAILABLE",
      error: "Social runtime source identity is unavailable",
      retryable: false,
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  };
  await assert.rejects(
    new SocialAPI("https://social.example").version(),
    (error: unknown) => error instanceof SocialAPIError && error.code === "SOURCE_IDENTITY_UNAVAILABLE" && !error.retryable && error.status === 503,
  );
  assert.equal(calls, 1);
});
