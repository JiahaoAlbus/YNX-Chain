import assert from "node:assert/strict";
import { test } from "node:test";
import { probePublicERC4337Readiness, WalletAuthError } from "../src/index.js";

const RPC = "https://evm.test.invalid/rpc";
const BUNDLER = "https://bundler.test.invalid/rpc";
const ENTRY_POINT = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
const CODE = "0x6001600055";
const CODE_SHA256 = "8880a54d03747df9eda6b310443a788558dc080c804db3fde94aee0382f66ea9";

test("public ERC-4337 readiness requires exact RPC, Bundler, EntryPoint and runtime bindings", async () => {
  const result = await probePublicERC4337Readiness(configuration(fixture()));
  assert.equal(result.ready, true);
  assert.equal(result.observedRuntimeSha256, CODE_SHA256);
  assert.equal(result.observedRuntimeBytes, 5);
  assert.equal(result.checks.entryPointSupported, true);
  assert.equal(result.releaseClaims.entryPointDeployedPublic, true);
  assert.equal(result.releaseClaims.bundlerDeployedPublic, true);
  assert.equal(result.releaseClaims.paymasterDeployedPublic, false);
  assert.equal(result.secretMaterialRecorded, false);
});

test("wrong network, runtime substitution and unsupported EntryPoint remain not ready", async () => {
  for (const routes of [
    fixture({ rpcChain: "0x1" }),
    fixture({ code: "0x6002" }),
    fixture({ supported: ["0x1111111111111111111111111111111111111111"] }),
  ]) {
    const result = await probePublicERC4337Readiness(configuration(routes));
    assert.equal(result.ready, false);
    assert.equal(result.releaseClaims.bundlerDeployedPublic, false);
    if (routes.rpcChain !== "0x1917" || routes.code !== CODE) assert.equal(result.releaseClaims.entryPointDeployedPublic, false);
    assert.equal(result.releaseClaims.sponsoredReceiptPublic, false);
  }
});

test("unavailable deployment and RPC errors are bounded evidence, not success", async () => {
  const routes = fixture({
    bundlerHTTP: { status: 404, headers: { "x-vercel-error": "DEPLOYMENT_NOT_FOUND" }, text: "provider response body must not be recorded" },
    codeRPCError: { code: -32601, message: "method missing\ninternal provider detail" },
  });
  const result = await probePublicERC4337Readiness(configuration(routes));
  assert.equal(result.ready, false);
  assert.deepEqual(result.observations.bundlerChain, { status: "http-error", httpStatus: 404, deploymentError: "DEPLOYMENT_NOT_FOUND" });
  assert.equal(JSON.stringify(result).includes("provider response body"), false);
  assert.equal(result.observations.entryPointCode.rpcCode, -32601);
  assert.equal(result.observations.entryPointCode.rpcMessage.includes("\n"), false);
});

test("missing frozen EntryPoint stays false without guessing an address", async () => {
  const result = await probePublicERC4337Readiness({ rpcEndpoint: RPC, bundlerEndpoint: BUNDLER, fetchImpl: fetchFrom(fixture()) });
  assert.equal(result.ready, false);
  assert.equal(result.entryPoint, null);
  assert.equal(result.observations.entryPointCode.status, "not-configured");
  assert.equal(result.releaseClaims.entryPointDeployedPublic, false);
});

test("credentialed endpoints and partial EntryPoint configuration fail closed", async () => {
  for (const config of [
    { rpcEndpoint: "https://user:secret@evm.invalid", bundlerEndpoint: BUNDLER },
    { rpcEndpoint: RPC, bundlerEndpoint: "https://bundler.invalid/rpc?apiKey=secret" },
    { rpcEndpoint: RPC, bundlerEndpoint: BUNDLER, entryPoint: ENTRY_POINT },
    { rpcEndpoint: RPC, bundlerEndpoint: BUNDLER, expectedRuntimeSha256: CODE_SHA256 },
  ]) await assert.rejects(probePublicERC4337Readiness(config), error("INVALID_CONFIG"));
});

function configuration(routes) { return { rpcEndpoint: RPC, bundlerEndpoint: BUNDLER, entryPoint: ENTRY_POINT, expectedRuntimeSha256: CODE_SHA256, fetchImpl: fetchFrom(routes) }; }
function fixture(overrides = {}) { return { rpcChain: "0x1917", bundlerChain: "0x1917", supported: [ENTRY_POINT], code: CODE, ...overrides }; }
function fetchFrom(routes) { return async (url, options) => { const request = JSON.parse(options.body); if (url === BUNDLER && routes.bundlerHTTP) return response(routes.bundlerHTTP); if (request.method === "eth_chainId") return rpc(url === RPC ? routes.rpcChain : routes.bundlerChain); if (request.method === "eth_supportedEntryPoints") return rpc(routes.supported); if (request.method === "eth_getCode") return routes.codeRPCError ? rpcError(routes.codeRPCError) : rpc(routes.code); throw new Error("unexpected fixture method"); }; }
function rpc(result) { return response({ status: 200, text: JSON.stringify({ jsonrpc: "2.0", id: 1, result }) }); }
function rpcError(value) { return response({ status: 200, text: JSON.stringify({ jsonrpc: "2.0", id: 1, error: value }) }); }
function response(value) { const headers = new Map(Object.entries(value.headers ?? {}).map(([key, item]) => [key.toLowerCase(), item])); return { ok: value.status >= 200 && value.status < 300, status: value.status, headers: { get: (key) => headers.get(key.toLowerCase()) ?? null }, text: async () => value.text ?? "" }; }
function error(code) { return value => value instanceof WalletAuthError && value.code === code; }
