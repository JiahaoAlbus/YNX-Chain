import assert from "node:assert/strict";
import { test } from "node:test";
import { monitorPublicERC4337Deployment } from "../src/index.js";

const RPC = "https://evm.test.invalid/rpc";
const BUNDLER = "https://bundler.test.invalid/rpc";
const EP = "0x1111111111111111111111111111111111111111";
const FACTORY = "0x2222222222222222222222222222222222222222";
const PAYMASTER = "0x3333333333333333333333333333333333333333";
const TXS = ["0x" + "a1".repeat(32), "0x" + "b2".repeat(32), "0x" + "c3".repeat(32)];
const CODES = ["0x6001", "0x6002", "0x6003"];
const SHAS = ["9e67b12fd8c58953460459cad7a6d4dd7d6d57594affce8206d1397c9c4db543", "1a33f434c3fc58e156600f1814ef65f7c14ef8f9d2647208ff106b232120c871", "07060149296c18b5684056facdb3e0172823fde3a737f2446b86d8b85cc6f1ba"];
const NOW = new Date("2026-08-14T08:00:00.000Z");

test("deployment monitor binds fresh block and fail-closed Paymaster state", async () => {
  const calls = [];
  const result = await monitorPublicERC4337Deployment(configuration(fixture(), calls));
  assert.equal(result.healthy, true);
  assert.equal(result.checks.blockFresh, true);
  assert.equal(result.checks.sponsorshipEnabledMatches, true);
  assert.equal(result.checks.depositMeetsMinimum, true);
  assert.equal(result.checks.paymasterEventLogQueryVerified, true);
  assert.equal(result.paymaster.events.length, 0);
  assert.equal(result.paymaster.sponsorshipEnabled, false);
  assert.equal(result.paymaster.depositWei, "0");
  assert.equal(calls.some(call => call.startsWith("eth_send") || call === "eth_sign"), false);
});

test("stale block, unexpected enablement and insufficient deposit are unhealthy", async () => {
  for (const routes of [
    fixture({ timestamp: 1786690000 }),
    fixture({ enabled: true }),
    fixture({ deposit: 9n }),
  ]) {
    const config = configuration(routes);
    if (routes.deposit === 9n) config.minimumDepositWei = "10";
    const result = await monitorPublicERC4337Deployment(config);
    assert.equal(result.healthy, false);
    assert.equal(result.releaseClaims.monitoringPublic, false);
  }
});

test("malformed block, Paymaster values and event logs remain bounded false evidence", async () => {
  for (const routes of [fixture({ block: { number: "0x10", timestamp: "latest" } }), fixture({ enabledResult: "0x02" }), fixture({ depositResult: "0x00" }), fixture({ logs: [{ address: FACTORY, topics: ["0xa905917f60d605b78de2f22f23aa555c55cb7aadf4979d7976930ea86451b5a2"], data: "0x", blockNumber: "0x10", transactionHash: TXS[2], logIndex: "0x0", removed: false }] })]) {
    const result = await monitorPublicERC4337Deployment(configuration(routes));
    assert.equal(result.healthy, false);
  }
});

function configuration(routes, calls = []) { return { rpcEndpoint: RPC, bundlerEndpoint: BUNDLER, manifest: manifest(), expectedSponsorshipEnabled: false, minimumDepositWei: "0", maximumBlockAgeSeconds: 30, now: NOW, fetchImpl: fetchFrom(routes, calls) }; }
function manifest() { return { schemaVersion: 1, sourceCommit: "1".repeat(40), chainId: 6423, entryPoint: contract(EP, TXS[0], SHAS[0]), factory: contract(FACTORY, TXS[1], SHAS[1]), paymaster: contract(PAYMASTER, TXS[2], SHAS[2]) }; }
function contract(address, transactionHash, runtimeSha256) { return { address, transactionHash, runtimeSha256 }; }
function fixture(overrides = {}) { return { timestamp: 1786694395, enabled: false, deposit: 0n, ...overrides }; }
function fetchFrom(routes, calls) { let receiptIndex = 0, codeIndex = 0, relationshipIndex = 0; return async (url, options) => { const { method, params } = JSON.parse(options.body); calls.push(method); if (method === "eth_chainId") return rpc("0x1917"); if (method === "eth_supportedEntryPoints") return rpc([EP]); if (method === "eth_getTransactionReceipt") return rpc(receipt([EP, FACTORY, PAYMASTER][receiptIndex], TXS[receiptIndex++])); if (method === "eth_getCode") return rpc(CODES[codeIndex++]); if (method === "eth_getBlockByNumber") return rpc(routes.block ?? { number: "0x10", timestamp: `0x${routes.timestamp.toString(16)}` }); if (method === "eth_getLogs") return rpc(routes.logs ?? []); if (method === "eth_call") { const selector = params[0].data; if (selector === "0xb0d691fe") return rpc(word(EP, relationshipIndex++)); if (selector === "0x21d34c42") return rpc(routes.enabledResult ?? `0x${(routes.enabled ? 1 : 0).toString(16).padStart(64, "0")}`); if (selector === "0xc399ec88") return rpc(routes.depositResult ?? `0x${routes.deposit.toString(16).padStart(64, "0")}`); } throw new Error(`unexpected ${method}`); }; }
function receipt(address, transactionHash) { return { transactionHash, status: "0x1", contractAddress: address, blockHash: "0x" + "d4".repeat(32), blockNumber: "0x10", logs: address === PAYMASTER ? [{ address, topics: ["0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0", "0x" + "0".repeat(64), word("0x4444444444444444444444444444444444444444")], data: "0x" }] : [] }; }
function word(address) { return "0x" + "0".repeat(24) + address.slice(2); }
function rpc(result) { return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }) }; }
