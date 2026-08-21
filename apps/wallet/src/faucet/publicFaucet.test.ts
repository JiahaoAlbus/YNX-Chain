import assert from "node:assert/strict";
import test from "node:test";
import { ACCEPTED_FAUCET_MANIFEST, FaucetEndpointError, loadPublicFaucetHealth, requestPublicFaucet } from "./publicFaucet";

const account = "ynx1m72s7l4r8m96q696jnmtn7ltdv44u855drqcql";
const build = {commit:"ea0e068becd9",release:"ynx-chain-ea0e068becd9",buildTime:"2026-08-21T00:46:46Z"};
const health = { ok: true, service: "ynx-faucetd", upstreamOk: true, chainId: 6423, height: 101, nativeSymbol: "YNXT", dependencies:[{name:"chain-rpc",required:true,ok:true}], build, startedAt:"2026-08-21T00:46:00Z", truthfulStatus: "rpc-backed-faucet" };

test("public faucet health requires a safe health response plus a public release identity", async () => {
  let calls = 0;
  assert.equal(ACCEPTED_FAUCET_MANIFEST.payloadSha256,"886ae7a2f4ef691301483da037cd4f5e1274b697865834769f20f0e799952157");
  assert.equal((await loadPublicFaucetHealth(async () => json(calls++ === 0 ? health : version))).service, "ynx-faucetd");
  await assert.rejects(() => loadPublicFaucetHealth(async () => json({ ...health, rpcUrl: "http://127.0.0.1:6420" })), (error: unknown) => error instanceof FaucetEndpointError && error.code === "FAUCET_VERSION_INCOMPATIBLE");
  await assert.rejects(() => loadPublicFaucetHealth(async () => json({ ...health, chainId: 1 })), (error: unknown) => error instanceof FaucetEndpointError && error.code === "FAUCET_VERSION_INCOMPATIBLE");
  await assert.rejects(() => loadPublicFaucetHealth(async (_url) => json(health, 404)), (error: unknown) => error instanceof FaucetEndpointError && error.code === "FAUCET_UNAVAILABLE");
  await assert.rejects(() => loadPublicFaucetHealth(async () => json({...health,defaultAmount:100})), (error: unknown) => error instanceof FaucetEndpointError && error.diagnostic === "HEALTH_CONTRACT_INVALID");
  await assert.rejects(() => loadPublicFaucetHealth(async (url) => url.endsWith("/health") ? json(health) : json({ ...version, build:{...version.build,commit:"bad"} }, 200)), (error: unknown) => error instanceof FaucetEndpointError && error.code === "FAUCET_VERSION_INCOMPATIBLE" && error.diagnostic === "VERSION_PROOF_INCOMPLETE" && /Only Testnet Faucet is degraded/i.test(error.message));
});

test("faucet request binds the exact Wallet address and only accepts a real transaction hash", async () => {
  let observed = "";
  const result = await requestPublicFaucet(account, async (_url, init) => { observed = String(init?.body); return json({ transaction: { hash: "0x" + "a".repeat(64) }, amount: 100, nativeSymbol: "YNXT", truthfulStatus: "rpc-backed-faucet" }); });
  assert.equal(result.amount, 100);
  assert.equal(observed, JSON.stringify({ address: account }));
  await assert.rejects(() => requestPublicFaucet(account, async () => json({ transaction: { hash: "bad" }, amount: 100, nativeSymbol: "YNXT", truthfulStatus: "rpc-backed-faucet" })), /invalid/i);
});

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
const version = { service: "ynx-faucetd", build, startedAt:"2026-08-21T00:46:00Z", dependencies:[{name:"chain-rpc",required:true,ok:true}] };
