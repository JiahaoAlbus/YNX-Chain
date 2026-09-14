import assert from "node:assert/strict";
import test from "node:test";
import { parseAuthorizationRequest } from "@ynx-chain/wallet-auth";
import { IncomingAuthorizationStore } from "./incomingAuthorizationStore";

class Memory {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async deleteItem(key: string) { this.values.delete(key); }
}

const productDeviceKey = "AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv";
const registry = {
  "ynx-social-v1": {
    requestingProduct: "social", bundleId: "com.ynx.social", origins: ["https://social.ynxweb4.com"], callbacks: ["ynx-social://com.ynx.social"], scopes: ["account:read", "profile:link"], maxScopes: 2,
  },
};
function request() {
  return parseAuthorizationRequest({
    version: "2", nonce: "nonce_abcdefghijklmnopqrstuvwxyz12", chainId: "ynx_6423-1", requestingProduct: "social", productClientId: "ynx-social-v1", bundleId: "com.ynx.social", productDeviceAlgorithm: "p256-sha256", productDeviceKey, origin: "https://social.ynxweb4.com",
    callback: "ynx-social://com.ynx.social", scopes: ["account:read", "profile:link"], purpose: "Link this YNX account to Social.", issuedAt: "2026-08-20T00:00:00.000Z", expiresAt: "2026-08-20T00:05:00.000Z",
  }, { now: new Date("2026-08-20T00:01:00.000Z"), registry });
}

test("incoming authorization survives a cold start and retains the exact request digest", async () => {
  const storage = new Memory();
  const saved = await new IncomingAuthorizationStore(storage).capture(request(), new Date("2026-08-20T00:01:00.000Z"));
  const resumed = await new IncomingAuthorizationStore(storage).restore({ now: new Date("2026-08-20T00:02:00.000Z"), registry });
  assert.equal(resumed?.requestDigest, saved.requestDigest);
  assert.equal(resumed?.request.nonce, request().nonce);
});

test("expired or substituted durable pending state fails closed and is removed", async () => {
  const storage = new Memory();
  await new IncomingAuthorizationStore(storage).capture(request(), new Date("2026-08-20T00:01:00.000Z"));
  await assert.rejects(() => new IncomingAuthorizationStore(storage).restore({ now: new Date("2026-08-20T00:06:00.000Z"), registry }), /expired/i);
  assert.equal(storage.values.size, 0);
  await new IncomingAuthorizationStore(storage).capture(request(), new Date("2026-08-20T00:01:00.000Z"));
  const raw = JSON.parse(storage.values.values().next().value as string);
  raw.requestDigest = "0".repeat(64);
  storage.values.set("ynx.wallet.incoming-authorization.v1", JSON.stringify(raw));
  await assert.rejects(() => new IncomingAuthorizationStore(storage).restore({ now: new Date("2026-08-20T00:02:00.000Z"), registry }), /digest/i);
  assert.equal(storage.values.size, 0);
});
