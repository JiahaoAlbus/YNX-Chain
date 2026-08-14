import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { WalletAuthError } from "./canonical.js";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_COMMIT = /^[0-9a-f]{40}$/;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/;
const ENTRY_POINT_SELECTOR = "0xb0d691fe";

export function createWalletTestnetDeploymentManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !SOURCE_COMMIT.test(input.sourceCommit ?? "") || input.chainId !== 6423) fail("INVALID_DEPLOYMENT_EVIDENCE", "deployment identity is invalid");
  const result = { schemaVersion: 1, sourceCommit: input.sourceCommit, chainId: input.chainId };
  const addresses = new Set();
  for (const name of ["entryPoint", "factory", "paymaster"]) {
    const value = input[name];
    if (!value || typeof value !== "object" || Array.isArray(value) || !ADDRESS.test(value.address ?? "") || !HASH.test(value.transactionHash ?? "") || !HEX_DATA.test(value.runtimeCode ?? "") || value.runtimeCode === "0x") fail("INVALID_DEPLOYMENT_EVIDENCE", `${name} deployment evidence is invalid`);
    if (addresses.has(value.address)) fail("INVALID_DEPLOYMENT_EVIDENCE", "deployment contract addresses must be distinct");
    addresses.add(value.address);
    const receipt = value.receipt;
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || receipt.transactionHash !== value.transactionHash || receipt.status !== "0x1" || receipt.contractAddress !== value.address || !HASH.test(receipt.blockHash ?? "") || !/^0x[1-9a-f][0-9a-f]*$/.test(receipt.blockNumber ?? "") || !Array.isArray(receipt.logs)) fail("INVALID_DEPLOYMENT_EVIDENCE", `${name} mined receipt is invalid`);
    result[name] = Object.freeze({ address: value.address, transactionHash: value.transactionHash, runtimeSha256: runtimeSha256(value.runtimeCode) });
  }
  return Object.freeze(result);
}

export async function verifyPublicERC4337Deployment(config) {
  const rpcEndpoint = endpoint(config?.rpcEndpoint, "RPC endpoint");
  const bundlerEndpoint = endpoint(config?.bundlerEndpoint, "Bundler endpoint");
  const manifest = deploymentManifest(config?.manifest);
  const timeoutMs = integer(config?.timeoutMs ?? 10_000, 250, 30_000, "verification timeout");
  const fetchImpl = config?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") fail("INVALID_CONFIG", "verification fetch implementation is invalid");

  const rpcChain = await jsonRpc(fetchImpl, rpcEndpoint, "eth_chainId", [], timeoutMs);
  const bundlerChain = await jsonRpc(fetchImpl, bundlerEndpoint, "eth_chainId", [], timeoutMs);
  const supported = await jsonRpc(fetchImpl, bundlerEndpoint, "eth_supportedEntryPoints", [], timeoutMs);
  const contracts = {};
  for (const name of ["entryPoint", "factory", "paymaster"]) {
    const expected = manifest[name];
    const receipt = await jsonRpc(fetchImpl, rpcEndpoint, "eth_getTransactionReceipt", [expected.transactionHash], timeoutMs);
    const code = await jsonRpc(fetchImpl, rpcEndpoint, "eth_getCode", [expected.address, "latest"], timeoutMs);
    contracts[name] = contractEvidence(expected, receipt, code);
  }
  const factoryEntryPoint = await jsonRpc(fetchImpl, rpcEndpoint, "eth_call", [{ to: manifest.factory.address, data: ENTRY_POINT_SELECTOR }, "latest"], timeoutMs);
  const paymasterEntryPoint = await jsonRpc(fetchImpl, rpcEndpoint, "eth_call", [{ to: manifest.paymaster.address, data: ENTRY_POINT_SELECTOR }, "latest"], timeoutMs);

  const supportedEntryPoints = supported.ok && Array.isArray(supported.result) && supported.result.every(value => typeof value === "string" && ADDRESS.test(value)) ? supported.result : [];
  const checks = Object.freeze({
    rpcChainMatches: rpcChain.ok && rpcChain.result === "0x1917",
    bundlerChainMatches: bundlerChain.ok && bundlerChain.result === "0x1917",
    entryPointSupported: supported.ok && supportedEntryPoints.length === supported.result.length && supportedEntryPoints.includes(manifest.entryPoint.address),
    entryPointReceiptAndRuntime: contracts.entryPoint.verified,
    factoryReceiptAndRuntime: contracts.factory.verified,
    paymasterReceiptAndRuntime: contracts.paymaster.verified,
    factoryEntryPointMatches: returnedAddress(factoryEntryPoint) === manifest.entryPoint.address,
    paymasterEntryPointMatches: returnedAddress(paymasterEntryPoint) === manifest.entryPoint.address,
  });
  const ready = Object.values(checks).every(Boolean);
  const releaseClaims = Object.freeze({
    entryPointDeployedPublic: ready,
    factoryDeployedPublic: ready,
    paymasterDeployedPublic: ready,
    bundlerDeployedPublic: ready,
  });
  return Object.freeze({
    schemaVersion: 1,
    verification: "wallet-auth-public-erc4337-deployment",
    environment: "public-testnet",
    sourceCommit: manifest.sourceCommit,
    chainId: manifest.chainId,
    endpoints: Object.freeze({ rpc: publicEndpoint(rpcEndpoint), bundler: publicEndpoint(bundlerEndpoint) }),
    contracts: Object.freeze(contracts),
    checks,
    ready,
    releaseClaims,
    readOnlyMethods: Object.freeze(["eth_chainId", "eth_supportedEntryPoints", "eth_getTransactionReceipt", "eth_getCode", "eth_call"]),
    secretMaterialRecorded: false,
  });
}

function deploymentManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schemaVersion !== 1 || !SOURCE_COMMIT.test(input.sourceCommit ?? "") || input.chainId !== 6423) fail("INVALID_CONFIG", "deployment manifest identity is invalid");
  const result = { schemaVersion: 1, sourceCommit: input.sourceCommit, chainId: input.chainId };
  const addresses = new Set();
  for (const name of ["entryPoint", "factory", "paymaster"]) {
    const value = input[name];
    if (!value || typeof value !== "object" || Array.isArray(value) || !ADDRESS.test(value.address ?? "") || !HASH.test(value.transactionHash ?? "") || !SHA256.test(value.runtimeSha256 ?? "")) fail("INVALID_CONFIG", `${name} deployment binding is invalid`);
    if (addresses.has(value.address)) fail("INVALID_CONFIG", "deployment contract addresses must be distinct");
    addresses.add(value.address);
    result[name] = Object.freeze({ address: value.address, transactionHash: value.transactionHash, runtimeSha256: value.runtimeSha256 });
  }
  return Object.freeze(result);
}

function contractEvidence(expected, receipt, code) {
  const receiptValue = receipt.ok && receipt.result && typeof receipt.result === "object" && !Array.isArray(receipt.result) ? receipt.result : null;
  const receiptMatches = receiptValue !== null && receiptValue.transactionHash === expected.transactionHash && receiptValue.status === "0x1" && receiptValue.contractAddress === expected.address && HASH.test(receiptValue.blockHash ?? "") && /^0x[1-9a-f][0-9a-f]*$/.test(receiptValue.blockNumber ?? "") && Array.isArray(receiptValue.logs);
  const runtime = runtimeEvidence(code);
  return Object.freeze({ address: expected.address, transactionHash: expected.transactionHash, receiptMatches, runtimeBytes: runtime.bytes, observedRuntimeSha256: runtime.sha256, runtimeMatches: runtime.sha256 === expected.runtimeSha256, verified: receiptMatches && runtime.sha256 === expected.runtimeSha256 });
}

function runtimeEvidence(value) {
  if (!value.ok || typeof value.result !== "string" || !HEX_DATA.test(value.result) || value.result === "0x") return { bytes: null, sha256: null };
  const raw = value.result.slice(2);
  const bytes = Uint8Array.from({ length: raw.length / 2 }, (_, index) => Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16));
  return { bytes: bytes.length, sha256: bytesToHex(sha256(bytes)) };
}
function runtimeSha256(value) { const raw = value.slice(2); const bytes = Uint8Array.from({ length: raw.length / 2 }, (_, index) => Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16)); return bytesToHex(sha256(bytes)); }

function returnedAddress(value) { return value.ok && typeof value.result === "string" && /^0x0{24}[0-9a-f]{40}$/.test(value.result) ? `0x${value.result.slice(-40)}` : null; }
async function jsonRpc(fetchImpl, url, method, params, timeoutMs) {
  let response;
  try { response = await fetchImpl(url.href, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { return { ok: false, status: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "unavailable" }; }
  if (!response?.ok) return { ok: false, status: "http-error", httpStatus: response?.status ?? null };
  let body;
  try { const text = await response.text(); if (new TextEncoder().encode(text).byteLength > 1_048_576) return { ok: false, status: "response-too-large" }; body = JSON.parse(text); } catch { return { ok: false, status: "invalid-json" }; }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || body.id !== 1 || Object.keys(body).sort().join("\n") !== "id\njsonrpc\nresult") return { ok: false, status: "invalid-json-rpc" };
  return { ok: true, status: "success", result: body.result };
}
function endpoint(value, label) { let parsed; try { parsed = new URL(value); } catch { fail("INVALID_CONFIG", `${label} is invalid`); } const loopback = parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname); if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash || !["/", "/rpc"].includes(parsed.pathname)) fail("INVALID_CONFIG", `${label} must be canonical and credential-free`); return parsed; }
function publicEndpoint(value) { return `${value.protocol}//${value.host}${value.pathname}`; }
function integer(value, minimum, maximum, label) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_CONFIG", `${label} is invalid`); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
