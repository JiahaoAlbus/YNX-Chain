import assert from "node:assert/strict";
import test from "node:test";
import {loadEndpointMigration, verifyLiveMigration} from "./testnet-endpoint-migration-check.mjs";

const config = loadEndpointMigration();

test("live migration compares one block and representative state", async () => {
  const calls = [];
  const proof = await verifyLiveMigration(config, {fetchImpl: fixtureFetch(calls)});
  assert.equal(proof.chainId, "0x1917");
  assert.equal(proof.networkId, "6423");
  assert.equal(proof.comparisonHeight, 100);
  assert.equal(proof.transactionProof, "0xabc");
  assert.equal(proof.faucetBuild, "a".repeat(40));
  assert.ok(calls.some((call) => call.method === "eth_getBlockByNumber" && call.params[0] === "0x64"));
  assert.ok(calls.some((call) => call.method === "eth_getCode" && call.params[1] === "0x64"));
});

test("live migration rejects a same-height fork", async () => {
  await assert.rejects(
    verifyLiveMigration(config, {fetchImpl: fixtureFetch([], {targetBlockHash: "0xdef"})}),
    /same-height block hash differs/,
  );
});

test("live migration rejects different Faucet releases", async () => {
  await assert.rejects(
    verifyLiveMigration(config, {fetchImpl: fixtureFetch([], {targetFaucetCommit: "b".repeat(40)})}),
    /Faucet aliases do not expose the same build/,
  );
});

function fixtureFetch(calls, overrides = {}) {
  return async (url, options = {}) => {
    if (String(url).endsWith("/health")) {
      const target = String(url).includes("faucet-testnet");
      return jsonResponse({
        build: {commit: target ? overrides.targetFaucetCommit || "a".repeat(40) : "a".repeat(40)},
        chainId: 6423,
        nativeSymbol: "YNXT",
        ok: true,
        requestPath: "/request",
        requestStatusPath: "/request-status",
        upstreamOk: true,
      });
    }
    const request = JSON.parse(options.body);
    calls.push({method: request.method, params: request.params, url: String(url)});
    const target = String(url).includes("rpc-testnet");
    const results = {
      eth_blockNumber: target ? "0x65" : "0x64",
      eth_chainId: "0x1917",
      eth_getBalance: "0x123",
      eth_getCode: "0x6000",
      eth_getTransactionByHash: {blockHash: "0xbeef", hash: "0xabc"},
      eth_getTransactionCount: "0x2",
      net_version: "6423",
    };
    let result = results[request.method];
    if (request.method === "eth_getBlockByNumber") {
      result = {hash: target ? overrides.targetBlockHash || "0xbeef" : "0xbeef", number: request.params[0], transactions: ["0xabc"]};
    }
    return jsonResponse({id: request.id, jsonrpc: "2.0", result});
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {headers: {"content-type": "application/json"}, status: 200});
}
