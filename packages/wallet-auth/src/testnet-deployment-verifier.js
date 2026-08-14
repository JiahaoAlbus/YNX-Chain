import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { WalletAuthError } from "./canonical.js";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_COMMIT = /^[0-9a-f]{40}$/;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/;
const ENTRY_POINT_SELECTOR = "0xb0d691fe";
const OWNERSHIP_TRANSFERRED_TOPIC = "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0";
const SPONSORSHIP_ENABLED_SELECTOR = "0x21d34c42";
const GET_DEPOSIT_SELECTOR = "0xc399ec88";
const PAYMASTER_EVENT_TOPICS = Object.freeze({
  "0xa905917f60d605b78de2f22f23aa555c55cb7aadf4979d7976930ea86451b5a2": "PolicySignerChanged",
  "0x8a4c3d5c99fbc4da196bac8072f707d54bdc729cda651f66409ef545afbf78c6": "RiskOfficerChanged",
  "0x66d316c8f89ce839462185ff30bcd4a3e386c44635f7aaa5dc46cae2bb2bc111": "GlobalSponsorshipChanged",
  "0x9c06bcf5ef1e82f2f44a7eccfb7853b840c472dabc4506b59336c34b370506fb": "ProductDisabled",
});

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
    if (name === "paymaster" && !paymasterOwnershipEvent(receipt, value.address)) fail("INVALID_DEPLOYMENT_EVIDENCE", "paymaster deployment event is invalid");
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
    contracts[name] = contractEvidence(name, expected, receipt, code);
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

export async function monitorPublicERC4337Deployment(config) {
  const rpcEndpoint = endpoint(config?.rpcEndpoint, "RPC endpoint");
  const timeoutMs = integer(config?.timeoutMs ?? 10_000, 250, 30_000, "monitor timeout");
  const maximumBlockAgeSeconds = integer(config?.maximumBlockAgeSeconds, 1, 3600, "maximum block age");
  if (typeof config?.expectedSponsorshipEnabled !== "boolean") fail("INVALID_CONFIG", "expected sponsorship state is invalid");
  if (typeof config?.minimumDepositWei !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(config.minimumDepositWei)) fail("INVALID_CONFIG", "minimum deposit is invalid");
  const now = config?.now ?? new Date();
  if (!(now instanceof Date) || !Number.isSafeInteger(now.getTime()) || Number.isNaN(now.getTime())) fail("INVALID_CONFIG", "monitor time is invalid");
  const fetchImpl = config?.fetchImpl ?? globalThis.fetch;
  const deployment = await verifyPublicERC4337Deployment({ ...config, timeoutMs, fetchImpl });
  const block = await jsonRpc(fetchImpl, rpcEndpoint, "eth_getBlockByNumber", ["latest", false], timeoutMs);
  const enabled = await jsonRpc(fetchImpl, rpcEndpoint, "eth_call", [{ to: deployment.contracts.paymaster.address, data: SPONSORSHIP_ENABLED_SELECTOR }, "latest"], timeoutMs);
  const deposit = await jsonRpc(fetchImpl, rpcEndpoint, "eth_call", [{ to: deployment.contracts.paymaster.address, data: GET_DEPOSIT_SELECTOR }, "latest"], timeoutMs);
  const blockValue = blockEvidence(block, now, maximumBlockAgeSeconds);
  const eventLogs = await jsonRpc(fetchImpl, rpcEndpoint, "eth_getLogs", [{ address: deployment.contracts.paymaster.address, fromBlock: deployment.contracts.paymaster.blockNumber ?? "latest", toBlock: blockValue.number ?? "latest", topics: [Object.keys(PAYMASTER_EVENT_TOPICS)] }], timeoutMs);
  const events = paymasterEvents(eventLogs, deployment.contracts.paymaster.address, deployment.contracts.paymaster.blockNumber, blockValue.number);
  const sponsorshipEnabled = booleanWord(enabled);
  const depositWei = uintWord(deposit);
  const checks = Object.freeze({
    deploymentVerified: deployment.ready,
    blockFresh: blockValue.fresh,
    sponsorshipEnabledMatches: sponsorshipEnabled !== null && sponsorshipEnabled === config.expectedSponsorshipEnabled,
    depositMeetsMinimum: depositWei !== null && BigInt(depositWei) >= BigInt(config.minimumDepositWei),
    paymasterEventLogQueryVerified: events !== null,
  });
  const healthy = Object.values(checks).every(Boolean);
  return Object.freeze({
    schemaVersion: 1,
    verification: "wallet-auth-public-erc4337-monitor-sample",
    environment: "public-testnet",
    observedAt: now.toISOString(),
    deployment,
    block: Object.freeze({ number: blockValue.number, timestamp: blockValue.timestamp, ageSeconds: blockValue.ageSeconds }),
    paymaster: Object.freeze({ sponsorshipEnabled, expectedSponsorshipEnabled: config.expectedSponsorshipEnabled, depositWei, minimumDepositWei: config.minimumDepositWei, events: Object.freeze(events ?? []) }),
    checks,
    healthy,
    releaseClaims: Object.freeze({ monitoringSampleHealthy: healthy, monitoringPublic: false }),
    readOnlyMethods: Object.freeze(["eth_chainId", "eth_supportedEntryPoints", "eth_getTransactionReceipt", "eth_getCode", "eth_getBlockByNumber", "eth_call", "eth_getLogs"]),
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

function contractEvidence(name, expected, receipt, code) {
  const receiptValue = receipt.ok && receipt.result && typeof receipt.result === "object" && !Array.isArray(receipt.result) ? receipt.result : null;
  const receiptMatches = receiptValue !== null && receiptValue.transactionHash === expected.transactionHash && receiptValue.status === "0x1" && receiptValue.contractAddress === expected.address && HASH.test(receiptValue.blockHash ?? "") && /^0x[1-9a-f][0-9a-f]*$/.test(receiptValue.blockNumber ?? "") && Array.isArray(receiptValue.logs);
  const requiredDeploymentEventMatches = name !== "paymaster" || paymasterOwnershipEvent(receiptValue, expected.address);
  const runtime = runtimeEvidence(code);
  return Object.freeze({ address: expected.address, transactionHash: expected.transactionHash, blockNumber: receiptMatches ? receiptValue.blockNumber : null, receiptMatches, requiredDeploymentEventMatches, runtimeBytes: runtime.bytes, observedRuntimeSha256: runtime.sha256, runtimeMatches: runtime.sha256 === expected.runtimeSha256, verified: receiptMatches && requiredDeploymentEventMatches && runtime.sha256 === expected.runtimeSha256 });
}

function runtimeEvidence(value) {
  if (!value.ok || typeof value.result !== "string" || !HEX_DATA.test(value.result) || value.result === "0x") return { bytes: null, sha256: null };
  const raw = value.result.slice(2);
  const bytes = Uint8Array.from({ length: raw.length / 2 }, (_, index) => Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16));
  return { bytes: bytes.length, sha256: bytesToHex(sha256(bytes)) };
}
function runtimeSha256(value) { const raw = value.slice(2); const bytes = Uint8Array.from({ length: raw.length / 2 }, (_, index) => Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16)); return bytesToHex(sha256(bytes)); }
function paymasterOwnershipEvent(receipt, address) { if (!receipt || !Array.isArray(receipt.logs)) return false; return receipt.logs.some(log => log && typeof log === "object" && log.address === address && Array.isArray(log.topics) && log.topics.length === 3 && log.topics[0] === OWNERSHIP_TRANSFERRED_TOPIC && log.topics[1] === `0x${"0".repeat(64)}` && /^0x0{24}[0-9a-f]{40}$/.test(log.topics[2]) && !/^0x0{64}$/.test(log.topics[2]) && log.data === "0x"); }

function returnedAddress(value) { return value.ok && typeof value.result === "string" && /^0x0{24}[0-9a-f]{40}$/.test(value.result) ? `0x${value.result.slice(-40)}` : null; }
function blockEvidence(value, now, maximumAge) { const result = value.ok && value.result && typeof value.result === "object" && !Array.isArray(value.result) ? value.result : null; const number = canonicalQuantity(result?.number); const timestampQuantity = canonicalQuantity(result?.timestamp); if (number === null || timestampQuantity === null) return { number: null, timestamp: null, ageSeconds: null, fresh: false }; const timestamp = Number(BigInt(timestampQuantity)); const nowSeconds = Math.floor(now.getTime() / 1000); if (!Number.isSafeInteger(timestamp) || timestamp > nowSeconds) return { number, timestamp: null, ageSeconds: null, fresh: false }; const ageSeconds = nowSeconds - timestamp; return { number, timestamp: new Date(timestamp * 1000).toISOString(), ageSeconds, fresh: ageSeconds <= maximumAge }; }
function canonicalQuantity(value) { return typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value) ? value : null; }
function booleanWord(value) { if (!value.ok || typeof value.result !== "string" || !/^0x[0-9a-f]{64}$/.test(value.result)) return null; if (value.result === `0x${"0".repeat(64)}`) return false; if (value.result === `0x${"0".repeat(63)}1`) return true; return null; }
function uintWord(value) { return value.ok && typeof value.result === "string" && /^0x[0-9a-f]{64}$/.test(value.result) ? BigInt(value.result).toString(10) : null; }
function paymasterEvents(value, address, fromBlock, toBlock) {
  if (!value.ok || !Array.isArray(value.result) || value.result.length > 1024 || canonicalQuantity(fromBlock) === null || canonicalQuantity(toBlock) === null) return null;
  const minimum = BigInt(fromBlock), maximum = BigInt(toBlock);
  let previousBlock = -1n, previousIndex = -1n;
  const result = [];
  for (const log of value.result) {
    if (!log || typeof log !== "object" || Array.isArray(log) || log.address !== address || log.removed !== false || !Array.isArray(log.topics) || !HEX_DATA.test(log.data ?? "") || !HASH.test(log.transactionHash ?? "")) return null;
    const blockNumber = canonicalQuantity(log.blockNumber), logIndex = canonicalQuantity(log.logIndex);
    if (blockNumber === null || logIndex === null) return null;
    const block = BigInt(blockNumber), index = BigInt(logIndex);
    if (block < minimum || block > maximum || block < previousBlock || (block === previousBlock && index <= previousIndex)) return null;
    const type = PAYMASTER_EVENT_TOPICS[log.topics[0]];
    if (!type || !validPaymasterEventShape(type, log)) return null;
    result.push(Object.freeze({ type, blockNumber, transactionHash: log.transactionHash, logIndex }));
    previousBlock = block; previousIndex = index;
  }
  return result;
}
function validPaymasterEventShape(type, log) { if (type === "GlobalSponsorshipChanged") return log.topics.length === 2 && /^0x0{24}[0-9a-f]{40}$/.test(log.topics[1]) && booleanWord({ ok: true, result: log.data }) !== null; return log.topics.length === 3 && /^0x[0-9a-f]{64}$/.test(log.topics[1]) && /^0x0{24}[0-9a-f]{40}$/.test(log.topics[2]) && log.data === "0x"; }
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
