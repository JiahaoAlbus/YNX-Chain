import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJSON, WALLET_SESSION_CONTROL_AUDIENCE } from "@ynx-chain/wallet-auth";
import { WalletSessionInventoryClient } from "./sessionInventory";

const SERVER_TIME = "2026-09-19T09:00:30.000Z";
function client(fetchImpl: typeof fetch, random = new Uint8Array(32).fill(7)) {
  return new WalletSessionInventoryClient({
    fetch: fetchImpl, randomBytes: async length => { assert.equal(length, 32); return random.slice(); },
    authorize: async () => {}, accountSecret: async () => { throw new Error("Authority time must not read an account key"); }, timeoutMs: 1_000,
  });
}
function reply(requestId: string) {
  return new Response(canonicalJSON({ ok: true, requestId, result: { serverTime: SERVER_TIME }, schemaVersion: 2 }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId } });
}

test("Finance authority time uses the exact verified Auth endpoint without key access", async () => {
  let calls = 0;
  const value = await client(async (input, init) => {
    calls++; assert.equal(String(input), `${WALLET_SESSION_CONTROL_AUDIENCE}/v2/product-sessions/time`); assert.equal(init?.method, "GET");
    const requestId = (init?.headers as Record<string,string>)["x-request-id"]!; assert.match(requestId, /^req_[0-9a-f]{64}$/); return reply(requestId);
  }).currentTime();
  assert.equal(value.toISOString(), SERVER_TIME); assert.equal(calls, 1);
});

test("a cancelled Wallet operation cannot use a late Auth time", async () => {
  let release!: () => void, current = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = client(async (_input, init) => { await gate; return reply((init?.headers as Record<string,string>)["x-request-id"]!); }).currentTime(() => { if (!current) throw new Error("cancelled"); });
  current = false; release(); await assert.rejects(pending, /cancelled/);
});
