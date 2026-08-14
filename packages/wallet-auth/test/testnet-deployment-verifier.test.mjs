import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPublicERC4337Deployment, WalletAuthError } from "../src/index.js";

const RPC = "https://evm.test.invalid/rpc";
const BUNDLER = "https://bundler.test.invalid/rpc";
const ENTRY_POINT = "0x1111111111111111111111111111111111111111";
const FACTORY = "0x2222222222222222222222222222222222222222";
const PAYMASTER = "0x3333333333333333333333333333333333333333";
const HASHES = ["0x" + "a1".repeat(32), "0x" + "b2".repeat(32), "0x" + "c3".repeat(32)];
const CODES = ["0x6001", "0x6002", "0x6003"];
const SHA256 = [
  "9e67b12fd8c58953460459cad7a6d4dd7d6d57594affce8206d1397c9c4db543",
  "1a33f434c3fc58e156600f1814ef65f7c14ef8f9d2647208ff106b232120c871",
  "07060149296c18b5684056facdb3e0172823fde3a737f2446b86d8b85cc6f1ba",
];

test("deployment verifier binds chain, receipts, runtime, EntryPoint relationships and Bundler", async () => {
  const calls = [];
  const result = await verifyPublicERC4337Deployment(configuration(fixture(), calls));
  assert.equal(result.ready, true);
  assert.deepEqual(result.releaseClaims, { entryPointDeployedPublic: true, factoryDeployedPublic: true, paymasterDeployedPublic: true, bundlerDeployedPublic: true });
  assert.equal(result.secretMaterialRecorded, false);
  assert.equal(calls.some(({ method }) => method.startsWith("eth_send") || method === "eth_sign"), false);
  assert.deepEqual(calls.map(({ method }) => method), ["eth_chainId", "eth_chainId", "eth_supportedEntryPoints", "eth_getTransactionReceipt", "eth_getCode", "eth_getTransactionReceipt", "eth_getCode", "eth_getTransactionReceipt", "eth_getCode", "eth_call", "eth_call"]);
});

test("receipt, bytecode, relationship and Bundler substitutions fail closed", async () => {
  for (const routes of [
    fixture({ receipts: [{ ...receipt(ENTRY_POINT, HASHES[0]), status: "0x0" }, receipt(FACTORY, HASHES[1]), receipt(PAYMASTER, HASHES[2])] }),
    fixture({ codes: [CODES[0], "0x6004", CODES[2]] }),
    fixture({ relationships: [word(PAYMASTER), word(ENTRY_POINT)] }),
    fixture({ supported: [FACTORY] }),
  ]) {
    const result = await verifyPublicERC4337Deployment(configuration(routes));
    assert.equal(result.ready, false);
    assert.equal(Object.values(result.releaseClaims).some(Boolean), false);
  }
});

test("missing deployment bindings and credentialed endpoints fail before RPC", async () => {
  for (const config of [
    { ...configuration(fixture()), manifest: { ...manifest(), sourceCommit: "short" } },
    { ...configuration(fixture()), rpcEndpoint: "https://user:secret@evm.invalid/rpc" },
    { ...configuration(fixture()), manifest: { ...manifest(), factory: { ...manifest().factory, address: ENTRY_POINT } } },
  ]) await assert.rejects(verifyPublicERC4337Deployment(config), error("INVALID_CONFIG"));
});

function configuration(routes, calls = []) { return { rpcEndpoint: RPC, bundlerEndpoint: BUNDLER, manifest: manifest(), fetchImpl: fetchFrom(routes, calls) }; }
function manifest() { return { schemaVersion: 1, sourceCommit: "1".repeat(40), chainId: 6423, entryPoint: contract(ENTRY_POINT, HASHES[0], SHA256[0]), factory: contract(FACTORY, HASHES[1], SHA256[1]), paymaster: contract(PAYMASTER, HASHES[2], SHA256[2]) }; }
function contract(address, transactionHash, runtimeSha256) { return { address, transactionHash, runtimeSha256 }; }
function fixture(overrides = {}) { return { rpcChain: "0x1917", bundlerChain: "0x1917", supported: [ENTRY_POINT], receipts: [receipt(ENTRY_POINT, HASHES[0]), receipt(FACTORY, HASHES[1]), receipt(PAYMASTER, HASHES[2])], codes: CODES, relationships: [word(ENTRY_POINT), word(ENTRY_POINT)], ...overrides }; }
function receipt(address, transactionHash) { return { transactionHash, status: "0x1", contractAddress: address, blockHash: "0x" + "d4".repeat(32), blockNumber: "0x10", logs: [] }; }
function word(address) { return "0x" + "0".repeat(24) + address.slice(2); }
function fetchFrom(routes, calls) { let receiptIndex = 0, codeIndex = 0, callIndex = 0; return async (url, options) => { const request = JSON.parse(options.body); calls.push({ url, method: request.method }); if (request.method === "eth_chainId") return rpc(url === RPC ? routes.rpcChain : routes.bundlerChain); if (request.method === "eth_supportedEntryPoints") return rpc(routes.supported); if (request.method === "eth_getTransactionReceipt") return rpc(routes.receipts[receiptIndex++]); if (request.method === "eth_getCode") return rpc(routes.codes[codeIndex++]); if (request.method === "eth_call") return rpc(routes.relationships[callIndex++]); throw new Error(`unexpected ${request.method}`); }; }
function rpc(result) { return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }) }; }
function error(code) { return value => value instanceof WalletAuthError && value.code === code; }
