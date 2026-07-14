import assert from "node:assert/strict";
import { test } from "node:test";
import { bytesToBase64Raw } from "../crypto/encoding";
import { accountIdentity, deviceIdentifier, deviceIdentity } from "../crypto/ynxSigner";
import { YNXMobileAppClient } from "./mobileSession";

const accountSecret = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 1 : 0);
const deviceSecret = new Uint8Array(32).fill(0x41);

test("establishes a native-bound session, signs a post, and revokes", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const account = accountIdentity(accountSecret).account;
  const deviceId = deviceIdentifier(deviceSecret);
  const publicKey = deviceIdentity(deviceSecret).deviceSigningPublicKey;
  const signBytes = bytesToBase64Raw(new TextEncoder().encode('{"domain":"YNX_APP_ACCOUNT_OWNERSHIP_V1"}'));
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    requests.push({ path, init });
    if (path === "/app/session/challenges") return jsonResponse(201, { challengeId: "native-challenge-1", account, signBytes, signDocument: { account, deviceId, deviceSigningPublicKey: publicKey, origin: "ynx-mobile://com.ynxweb4.mobile", chainId: 6423 } });
    if (path.endsWith("/verify")) return jsonResponse(201, { account, deviceId, token: "s".repeat(43), expiresAt: "2026-07-14T12:30:00Z" });
    return jsonResponse(201, { ok: true });
  };
  const client = new YNXMobileAppClient({ accountSecret, deviceSecret, fetchImpl, now: () => new Date("2026-07-14T12:00:00Z") });
  await client.connect();
  await client.createPost("native post", "post-native-1");
  await client.disconnect(true);
  assert.deepEqual(requests.map((request) => request.path), [
    "/app/session/challenges",
    "/app/session/challenges/native-challenge-1/verify",
    "/app/square/devices",
    "/app/square/posts",
    `/app/square/devices/${deviceId}/revoke`,
    "/app/session/revoke",
  ]);
  for (const request of requests) assert.equal((request.init?.headers as Record<string, string>)["X-YNX-Client"], "ynx-mobile-v1");
  const serialized = JSON.stringify(requests);
  assert.equal(serialized.includes(Buffer.from(accountSecret).toString("hex")), false);
  assert.equal(serialized.includes(Buffer.from(deviceSecret).toString("hex")), false);
  assert.match(String((requests[3]?.init?.headers as Record<string, string>)["X-YNX-Device-Signature"]), /^[A-Za-z0-9+/]+$/);
});

test("aborts a stalled native ownership request", async () => {
  const fetchImpl = async (_input: string, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
  });
  const client = new YNXMobileAppClient({ accountSecret, deviceSecret, fetchImpl, timeoutMs: 10 });
  await assert.rejects(client.connect(), /request aborted/);
  assert.equal(client.connected, false);
  client.lock();
});

function jsonResponse(status: number, value: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }));
}
