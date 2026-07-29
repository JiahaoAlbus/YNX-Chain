import assert from "node:assert/strict";
import { test } from "node:test";
import { EvmSimulationClient } from "./evmSimulation";

const FROM = "0x1111111111111111111111111111111111111111";
const TARGET = "0x2222222222222222222222222222222222222222";

function rpcFixture(results: Record<string, unknown>) {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    assert.equal(url, "http://127.0.0.1:8545");
    assert.equal(init?.method, "POST");
    const request = JSON.parse(String(init?.body));
    calls.push({ method: request.method, params: request.params });
    const result = results[request.method];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { fetcher, calls };
}

test("strict EVM simulation verifies chain, deployed code, eth_call and gas without signing", async () => {
  const fixture = rpcFixture({
    eth_chainId: "0x1917",
    eth_blockNumber: "0x2a",
    eth_getCode: "0x6001600055",
    eth_call: "0x0000000000000000000000000000000000000000000000000000000000000001",
    eth_estimateGas: "0x5208",
  });
  const client = new EvmSimulationClient("http://127.0.0.1:8545", fixture.fetcher, () => new Date("2026-07-25T06:30:00.000Z"));
  const result = await client.simulate({ from: FROM, to: TARGET, data: "0xa9059cbb", valueWei: "0" });
  assert.deepEqual(fixture.calls.map((call) => call.method), ["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call", "eth_estimateGas"]);
  assert.deepEqual(fixture.calls[2]?.params, [TARGET, "0x2a"]);
  assert.deepEqual(fixture.calls[3]?.params, [{ from: FROM, to: TARGET, data: "0xa9059cbb", value: "0x0" }, "0x2a"]);
  assert.equal(result.chainId, 6423);
  assert.equal(result.blockNumber, 42);
  assert.equal(result.methodSelector, "0xa9059cbb");
  assert.equal(result.gasEstimate, "21000");
  assert.equal(result.contractCodeBytes, 5);
  assert.match(result.contractCodeHash, /^0x[0-9a-f]{64}$/);
  assert.equal(result.truthfulStatus, "read-only-evm-simulation-no-sign-no-broadcast");
  assert.equal(Object.isFrozen(result), true);
});

test("wrong chain and missing contract code fail closed before call simulation", async () => {
  const wrong = rpcFixture({ eth_chainId: "0x1" });
  await assert.rejects(new EvmSimulationClient("http://127.0.0.1:8545", wrong.fetcher).simulate({ from: FROM, to: TARGET, data: "0x", valueWei: "0" }), /chain mismatch/);
  assert.deepEqual(wrong.calls.map((call) => call.method), ["eth_chainId"]);

  const missing = rpcFixture({ eth_chainId: "0x1917", eth_blockNumber: "0x1", eth_getCode: "0x" });
  await assert.rejects(new EvmSimulationClient("http://127.0.0.1:8545", missing.fetcher).simulate({ from: FROM, to: TARGET, data: "0x", valueWei: "0" }), /no deployed contract code/);
  assert.deepEqual(missing.calls.map((call) => call.method), ["eth_chainId", "eth_blockNumber", "eth_getCode"]);
});

test("input canonicalization rejects address, calldata, value and field widening", async () => {
  const fixture = rpcFixture({});
  const client = new EvmSimulationClient("http://127.0.0.1:8545", fixture.fetcher);
  await assert.rejects(client.simulate({ from: FROM.toUpperCase(), to: TARGET, data: "0x", valueWei: "0" }), /lowercase canonical/);
  await assert.rejects(client.simulate({ from: FROM, to: TARGET, data: "0x0", valueWei: "0" }), /even-length/);
  await assert.rejects(client.simulate({ from: FROM, to: TARGET, data: "0x", valueWei: "01" }), /canonical unsigned/);
  await assert.rejects(client.simulate({ from: FROM, to: TARGET, data: "0x", valueWei: (1n << 256n).toString() }), /uint256/);
  await assert.rejects(client.simulate({ from: FROM, to: TARGET, data: "0x", valueWei: "0", extra: true } as any), /unknown or missing/);
  assert.equal(fixture.calls.length, 0);
});

test("RPC binding, canonical quantities, provider errors and response bounds fail closed", async () => {
  const unknownField = async (_url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x1917", extra: true }));
  };
  await assert.rejects(new EvmSimulationClient("http://127.0.0.1:8545", unknownField).simulate({ from: FROM, to: TARGET, data: "0x", valueWei: "0" }), /binding/);

  const nonCanonical = rpcFixture({ eth_chainId: "0x01917" });
  await assert.rejects(new EvmSimulationClient("http://127.0.0.1:8545", nonCanonical.fetcher).simulate({ from: FROM, to: TARGET, data: "0x", valueWei: "0" }), /canonical hex quantity/);

  const providerError = async (_url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "method unavailable" } }));
  };
  await assert.rejects(new EvmSimulationClient("http://127.0.0.1:8545", providerError).simulate({ from: FROM, to: TARGET, data: "0x", valueWei: "0" }), /-32601/);

  const oversized = async () => new Response("{}", { headers: { "Content-Length": String(300 * 1024) } });
  await assert.rejects(new EvmSimulationClient("http://127.0.0.1:8545", oversized).simulate({ from: FROM, to: TARGET, data: "0x", valueWei: "0" }), /exceeds Wallet policy/);
});
