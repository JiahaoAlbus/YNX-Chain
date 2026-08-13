import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { WalletAuthError } from "./canonical.js";

const CHAIN_ID = "0x1917";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/;

export async function probePublicERC4337Readiness(config) {
  const rpcEndpoint = endpoint(config?.rpcEndpoint, "RPC endpoint");
  const bundlerEndpoint = endpoint(config?.bundlerEndpoint, "Bundler endpoint");
  const entryPoint = optionalPattern(config?.entryPoint, ADDRESS, "EntryPoint");
  const expectedRuntimeSha256 = optionalPattern(config?.expectedRuntimeSha256, SHA256, "EntryPoint runtime SHA-256");
  if ((entryPoint === null) !== (expectedRuntimeSha256 === null)) fail("INVALID_CONFIG", "EntryPoint and expected runtime SHA-256 must be configured together");
  const timeoutMs = integer(config?.timeoutMs ?? 10_000, 250, 30_000, "probe timeout");
  const fetchImpl = config?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") fail("INVALID_CONFIG", "probe fetch implementation is invalid");

  const rpcChain = await jsonRpc(fetchImpl, rpcEndpoint, "eth_chainId", [], timeoutMs);
  const bundlerChain = await jsonRpc(fetchImpl, bundlerEndpoint, "eth_chainId", [], timeoutMs);
  const supported = await jsonRpc(fetchImpl, bundlerEndpoint, "eth_supportedEntryPoints", [], timeoutMs);
  const code = entryPoint === null ? null : await jsonRpc(fetchImpl, rpcEndpoint, "eth_getCode", [entryPoint, "latest"], timeoutMs);

  const rpcChainMatches = rpcChain.ok && rpcChain.result === CHAIN_ID;
  const bundlerChainMatches = bundlerChain.ok && bundlerChain.result === CHAIN_ID;
  const supportedEntryPoints = supported.ok && Array.isArray(supported.result) && supported.result.every((value) => typeof value === "string" && ADDRESS.test(value))
    ? [...new Set(supported.result)]
    : [];
  const entryPointSupported = entryPoint !== null && supported.ok && supportedEntryPoints.length === supported.result.length && supportedEntryPoints.includes(entryPoint);
  const runtime = runtimeEvidence(code, expectedRuntimeSha256);
  const checks = Object.freeze({
    rpcChainMatches,
    bundlerChainMatches,
    entryPointConfigured: entryPoint !== null,
    entryPointRuntimeHashMatches: runtime.hashMatches,
    entryPointSupported,
  });
  return Object.freeze({
    schemaVersion: 1,
    verification: "wallet-auth-public-erc4337-readiness",
    environment: "public-testnet",
    observedAt: new Date().toISOString(),
    endpoints: Object.freeze({ rpc: publicEndpoint(rpcEndpoint), bundler: publicEndpoint(bundlerEndpoint) }),
    entryPoint,
    expectedRuntimeSha256,
    observedRuntimeSha256: runtime.sha256,
    observedRuntimeBytes: runtime.bytes,
    supportedEntryPoints: Object.freeze(supportedEntryPoints),
    checks,
    observations: Object.freeze({
      rpcChain: publicObservation(rpcChain),
      bundlerChain: publicObservation(bundlerChain),
      bundlerSupportedEntryPoints: publicObservation(supported),
      entryPointCode: code === null ? Object.freeze({ status: "not-configured" }) : publicObservation(code),
    }),
    ready: Object.values(checks).every(Boolean),
    releaseClaims: Object.freeze({
      entryPointDeployedPublic: rpcChainMatches && runtime.hashMatches,
      bundlerDeployedPublic: rpcChainMatches && bundlerChainMatches && entryPointSupported && runtime.hashMatches,
      paymasterDeployedPublic: false,
      sponsoredReceiptPublic: false,
    }),
    secretMaterialRecorded: false,
  });
}

async function jsonRpc(fetchImpl, url, method, params, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url.href, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return Object.freeze({ ok: false, status: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "unavailable" });
  }
  if (!response || typeof response.status !== "number") return Object.freeze({ ok: false, status: "invalid-http-response" });
  const deploymentError = boundedHeader(response.headers?.get?.("x-vercel-error"));
  if (!response.ok) return Object.freeze({ ok: false, status: "http-error", httpStatus: response.status, ...(deploymentError ? { deploymentError } : {}) });
  let text;
  try { text = await response.text(); } catch { return Object.freeze({ ok: false, status: "unreadable-response" }); }
  if (new TextEncoder().encode(text).byteLength > 1_048_576) return Object.freeze({ ok: false, status: "response-too-large" });
  let body;
  try { body = JSON.parse(text); } catch { return Object.freeze({ ok: false, status: "invalid-json" }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || body.id !== 1) return Object.freeze({ ok: false, status: "invalid-json-rpc" });
  const keys = Object.keys(body).sort().join("\n");
  if (keys === "error\nid\njsonrpc" && Number.isSafeInteger(body.error?.code) && typeof body.error?.message === "string") {
    return Object.freeze({ ok: false, status: "rpc-error", rpcCode: body.error.code, rpcMessage: boundedMessage(body.error.message) });
  }
  if (keys !== "id\njsonrpc\nresult") return Object.freeze({ ok: false, status: "invalid-json-rpc" });
  return Object.freeze({ ok: true, status: "success", result: body.result });
}

function runtimeEvidence(observation, expected) {
  if (observation === null || !observation.ok || typeof observation.result !== "string" || !HEX_DATA.test(observation.result) || observation.result === "0x") return Object.freeze({ bytes: null, sha256: null, hashMatches: false });
  const raw = observation.result.slice(2);
  const bytes = Uint8Array.from({ length: raw.length / 2 }, (_, index) => Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16));
  const digest = bytesToHex(sha256(bytes));
  return Object.freeze({ bytes: bytes.length, sha256: digest, hashMatches: expected !== null && digest === expected });
}

function publicObservation(value) {
  const result = { status: value.status };
  for (const key of ["httpStatus", "deploymentError", "rpcCode", "rpcMessage"]) if (key in value) result[key] = value[key];
  if (value.ok && typeof value.result === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value.result)) result.result = value.result;
  return Object.freeze(result);
}

function endpoint(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { fail("INVALID_CONFIG", `${label} is invalid`); }
  const loopback = parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash || !["/", "/rpc"].includes(parsed.pathname)) fail("INVALID_CONFIG", `${label} must use canonical / or /rpc without credentials, query or fragment`);
  return parsed;
}
function publicEndpoint(value) { return `${value.protocol}//${value.host}${value.pathname}`; }
function optionalPattern(value, pattern, label) { if (value === undefined || value === null || value === "") return null; if (typeof value !== "string" || !pattern.test(value)) fail("INVALID_CONFIG", `${label} is invalid`); return value; }
function integer(value, minimum, maximum, label) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("INVALID_CONFIG", `${label} is invalid`); return value; }
function boundedHeader(value) { return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value) ? value : null; }
function boundedMessage(value) { return value.replace(/[\r\n\t]/g, " ").slice(0, 256); }
function fail(code, message) { throw new WalletAuthError(code, message); }
