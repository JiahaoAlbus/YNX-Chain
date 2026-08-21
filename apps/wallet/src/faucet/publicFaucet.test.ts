import assert from "node:assert/strict";
import test from "node:test";
import { FaucetEndpointError, loadPublicFaucetHealth, requestPublicFaucet } from "./publicFaucet";

const account = "ynx1m72s7l4r8m96q696jnmtn7ltdv44u855drqcql";
const health = { ok: true, service: "ynx-faucetd", upstreamMode: "authoritative", upstreamOk: true, chainId: 6423, nativeSymbol: "YNXT", defaultAmount: 100, maxAmount: 100, rateLimit: "1 per 1h", requestPath: "/request", truthfulStatus: "rpc-backed-faucet" };

test("public faucet health requires a safe health response plus a public release identity", async () => {
  let calls = 0;
  assert.equal((await loadPublicFaucetHealth(async () => json(calls++ === 0 ? health : version))).service, "ynx-faucetd");
  await assert.rejects(() => loadPublicFaucetHealth(async () => json({ ...health, rpcUrl: "http://127.0.0.1:6420" })), (error: unknown) => error instanceof FaucetEndpointError && error.code === "FAUCET_VERSION_INCOMPATIBLE");
  await assert.rejects(() => loadPublicFaucetHealth(async () => json({ ...health, chainId: 1 })), (error: unknown) => error instanceof FaucetEndpointError && error.code === "FAUCET_VERSION_INCOMPATIBLE");
  await assert.rejects(() => loadPublicFaucetHealth(async (_url) => json(health, 404)), (error: unknown) => error instanceof FaucetEndpointError && error.code === "FAUCET_UNAVAILABLE");
  await assert.rejects(() => loadPublicFaucetHealth(async (url) => url.endsWith("/health") ? json(health) : json({ service: "ynx-faucetd" }, 200)), (error: unknown) => error instanceof FaucetEndpointError && error.code === "FAUCET_VERSION_INCOMPATIBLE");
});

test("faucet request binds the exact Wallet address and only accepts a real transaction hash", async () => {
  let observed = "";
  const result = await requestPublicFaucet(account, async (_url, init) => { observed = String(init?.body); return json({ transaction: { hash: "0x" + "a".repeat(64) }, amount: 100, nativeSymbol: "YNXT", truthfulStatus: "rpc-backed-faucet" }); });
  assert.equal(result.amount, 100);
  assert.equal(observed, JSON.stringify({ address: account }));
  await assert.rejects(() => requestPublicFaucet(account, async () => json({ transaction: { hash: "bad" }, amount: 100, nativeSymbol: "YNXT", truthfulStatus: "rpc-backed-faucet" })), /invalid/i);
});

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
const version = { service: "ynx-faucetd", build: { commit: "abcdef123", release: "ynx-chain-abcdef123", buildTime: "2026-08-20T00:00:00Z" } };
