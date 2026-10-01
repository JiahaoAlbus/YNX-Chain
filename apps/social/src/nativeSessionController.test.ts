import test from "node:test";
import assert from "node:assert/strict";
import { p256 } from "@noble/curves/nist.js";
import registry from "./vendor/product-session-registry.json";
import { createNativeSessionController } from "./nativeSessionController";

function fixture() {
  const records = new Map<string, string>();
  let exists = false, created = 0, opened = 0, probes = 0, tokens = 0;
  const key = Buffer.from(p256.getPublicKey(new Uint8Array(32).fill(7), true)).toString("base64url");
  const storage = {
    securityLevel: "os-protected" as const,
    async get(key: string) { return records.get(key) ?? null; },
    async set(key: string, value: string) { records.set(key, value); },
    async remove(key: string) { records.delete(key); },
  };
  const unavailable = async () => { throw new Error("No live authorization in this synthetic test"); };
  const config = {
    registry, platform: "android" as const, scopes: ["account:read", "profile:link"], storage,
    gateway: {
      currentTime: async () => new Date(),
      walletInstalled: async () => { probes++; throw new Error("Unverified installation"); },
      schemeRegistered: async () => { probes++; throw new Error("Unverified scheme"); },
      challenge: unavailable, complete: unavailable, introspect: unavailable, revoke: unavailable,
    },
    async device(create: boolean) {
      if (create && !exists) { created++; exists = true; }
      return exists ? { id: "social-fixture-device-0001", key, sign: unavailable } : null;
    },
    tokenFactory: () => `${++tokens}`.padStart(43, "A"),
    async openURL() { opened++; },
  };
  return { records, client: createNativeSessionController(config), cold: () => createNativeSessionController(config), counts: () => ({ created, opened, probes }) };
}

test("fresh guest restore creates no device, request, probe or Wallet launch", async () => {
  const f = fixture();
  assert.equal((await f.client.restore()).status, "guest");
  assert.deepEqual(f.counts(), { created: 0, opened: 0, probes: 0 });
  assert.equal(f.records.size, 0);
});

test("explicit SDK request survives cold restore without replacing bytes or opening Wallet", async () => {
  const f = fixture();
  const state = await f.client.begin();
  assert.equal(state.status, "connecting");
  assert.equal(state.canOpen, true);
  const pending = [...f.records.entries()].find(([key]) => key.endsWith(":pending"));
  assert.ok(pending);
  const request = JSON.parse(pending[1]);
  assert.equal(request.origin, "app://android/com.ynx.social");
  assert.equal(request.applicationId, "com.ynx.social");
  assert.deepEqual(request.scopes, ["account:read", "profile:link"]);
  const restored = await f.cold().restore();
  assert.equal(restored.status, "connecting");
  assert.equal(f.records.get(pending[0]), pending[1]);
  assert.deepEqual(f.counts(), { created: 1, opened: 0, probes: 0 });
});

test("only an explicit open action launches the retained SDK route", async () => {
  const f = fixture();
  await f.client.begin();
  await f.client.open();
  assert.equal(f.counts().opened, 1);
});

test("pending identity never authorizes messaging and disconnect suspends proofs", async () => {
  const f = fixture();
  await f.client.begin();
  await assert.rejects(f.client.proof(["social.messaging"]));
  const disconnect = f.client.disconnect();
  assert.equal(f.client.current.canOpen, false);
  await disconnect;
  await assert.rejects(f.client.proof(["account:read"]));
  assert.equal(f.counts().opened, 0);
});
