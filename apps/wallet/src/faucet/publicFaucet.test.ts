import assert from "node:assert/strict";
import test from "node:test";
import { loadPublicFaucetHealth, requestPublicFaucet } from "./publicFaucet";

const account = "ynx1m72s7l4r8m96q696jnmtn7ltdv44u855drqcql";
const health = { ok: true, service: "ynx-faucetd", upstreamMode: "authoritative", upstreamOk: true, chainId: 6423, nativeSymbol: "YNXT", defaultAmount: 100, maxAmount: 100, rateLimit: "1 per 1h", requestPath: "/request", truthfulStatus: "rpc-backed-faucet" };

test("public faucet health requires the safe discovered contract and rejects loopback-era fields", async () => {
  assert.equal((await loadPublicFaucetHealth(async () => json(health))).service, "ynx-faucetd");
  await assert.rejects(() => loadPublicFaucetHealth(async () => json({ ...health, rpcUrl: "http://127.0.0.1:6420" })), /leaks/i);
  await assert.rejects(() => loadPublicFaucetHealth(async () => json({ ...health, chainId: 1 })), /invalid/i);
});

test("faucet request binds the exact Wallet address and only accepts a real transaction hash", async () => {
  let observed = "";
  const result = await requestPublicFaucet(account, async (_url, init) => { observed = String(init?.body); return json({ transaction: { hash: "0x" + "a".repeat(64) }, amount: 100, nativeSymbol: "YNXT", truthfulStatus: "rpc-backed-faucet" }); });
  assert.equal(result.amount, 100);
  assert.equal(observed, JSON.stringify({ address: account }));
  await assert.rejects(() => requestPublicFaucet(account, async () => json({ transaction: { hash: "bad" }, amount: 100, nativeSymbol: "YNXT", truthfulStatus: "rpc-backed-faucet" })), /invalid/i);
});

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
