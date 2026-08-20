import {DAppConnectError} from "./errors.js";
import {createHash} from "node:crypto";

const FORBIDDEN_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "10.0.2.2", "example.com"]);
function url(name, value) { try { const parsed = new URL(value); if (parsed.protocol !== "https:" || FORBIDDEN_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith(".local")) throw new Error("unsafe"); return parsed.toString(); } catch { throw new DAppConnectError("ENDPOINT_MANIFEST_INVALID", `${name} must be a public HTTPS URL.`); } }

export function validateSchema(manifest) { if (!manifest || manifest.schemaVersion !== "1.0.0") throw new DAppConnectError("ENDPOINT_MANIFEST_INVALID", "Unsupported endpoint manifest schema."); return manifest; }
export function validateExpiry(manifest, now = Date.now()) { if (!manifest.expiresAt || Date.parse(manifest.expiresAt) <= now) throw new DAppConnectError("ENDPOINT_MANIFEST_EXPIRED", "Endpoint manifest is missing an accepted future expiry."); return manifest; }
export function verifyChainIdentity(manifest, expectedChainId = 6423) { const id = manifest.evmChainId ?? manifest.network?.evmChainId; const hex = manifest.evmChainHex; if (Number(id) !== expectedChainId || (hex && hex.toLowerCase() !== "0x1917")) throw new DAppConnectError("ENDPOINT_MANIFEST_WRONG_CHAIN", "Endpoint manifest chain identity does not match YNX Testnet."); return manifest; }
export async function verifyManifestSignature(manifest, verifySignature) { if (typeof verifySignature !== "function" || !(await verifySignature(manifest))) throw new DAppConnectError("ENDPOINT_MANIFEST_UNVERIFIED", "Endpoint manifest signature verification failed."); return manifest; }
export function manifestPayloadSha256(manifest) { const {integrity, ...payload} = manifest || {}; return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex"); }
function validateDeclaredEndpoints(manifest) { for (const key of ["rpc", "evmRpc", "rest", "walletGateway", "appGateway", "faucet", "explorer", "indexer", "monitor", "healthUrl", "versionUrl"]) url(key, manifest[key]); return manifest; }
export async function fetchRemoteManifest(urlValue, {fetchImpl = globalThis.fetch} = {}) { if (typeof fetchImpl !== "function") throw new DAppConnectError("ENDPOINT_FETCH_UNAVAILABLE", "A fetch implementation is required."); const response = await fetchImpl(url("manifest", urlValue)); if (!response?.ok) throw new DAppConnectError("ENDPOINT_FETCH_FAILED", `Endpoint manifest request failed with ${response?.status ?? "unknown"}.`); return response.json(); }
export function getProductEndpoint(manifest, productId) { const endpoint = manifest?.endpoints?.products?.[productId]; if (!endpoint) throw new DAppConnectError("PRODUCT_ENDPOINT_NOT_FOUND", `No accepted endpoint exists for ${productId}.`); return url(`products.${productId}`, typeof endpoint === "string" ? endpoint : endpoint.url); }
export async function selectHealthyEndpoint(candidates, {healthCheck} = {}) { if (!Array.isArray(candidates) || !candidates.length) throw new DAppConnectError("ENDPOINT_UNAVAILABLE", "No verified endpoint candidates were supplied."); for (const candidate of candidates) { const value = url("endpoint", typeof candidate === "string" ? candidate : candidate.url); if (!healthCheck || await healthCheck(value)) return value; } throw new DAppConnectError("ENDPOINT_UNHEALTHY", "No verified endpoint passed its health check."); }
export async function safeRetry(operation, {attempts = 2} = {}) { let failure; for (let index = 0; index <= attempts; index += 1) { try { return await operation(index); } catch (error) { failure = error; } } throw failure; }
export async function loadBundledManifest(manifest, options = {}) {
  if (manifest?.status === "CANDIDATE_NOT_ACCEPTED" || manifest?.integrity?.status === "UNSIGNED_CANDIDATE") throw new DAppConnectError("ENDPOINT_MANIFEST_NOT_ACCEPTED", "The bundled Endpoint Manifest is a candidate and cannot activate endpoints.");
  if (manifest?.status === "ACCEPTED_BUNDLED_CONSUMER_CONTRACT") {
    validateSchema(manifest); validateExpiry(manifest, options.now); verifyChainIdentity(manifest, options.expectedChainId); validateDeclaredEndpoints(manifest);
    const expected = options.expectedSha256 || manifest.integrity?.payloadSha256;
    if (manifest.integrity?.status !== "BUNDLED_SHA256_ACCEPTED" || !/^[a-f0-9]{64}$/i.test(expected || "") || manifestPayloadSha256(manifest) !== expected) throw new DAppConnectError("ENDPOINT_MANIFEST_INTEGRITY_FAILED", "Accepted bundled manifest SHA-256 verification failed.");
    return Object.freeze({...manifest, verification: "BUNDLED_SHA256_ACCEPTED"});
  }
  return validateEndpointManifest(manifest, options);
}
export function diagnostics(manifest, {connection} = {}) { const acceptedBundle = manifest?.status === "ACCEPTED_BUNDLED_CONSUMER_CONTRACT" && manifest?.integrity?.status === "BUNDLED_SHA256_ACCEPTED"; return Object.freeze({manifestStatus: manifest?.status ?? "NOT_LOADED", activation: acceptedBundle ? "BUNDLED_CONTRACT_ELIGIBLE_AFTER_HASH_CHECK" : manifest?.status === "ACCEPTED" && manifest?.integrity?.status === "SIGNED" ? "ELIGIBLE_AFTER_VERIFICATION" : "BLOCKED_PENDING_ACCEPTANCE", standardConnection: connection?.account ? "CONNECTED" : "NOT_CONNECTED", endpointCount: Object.keys(manifest?.endpoints ?? {}).length}); }
export function compatibilityCheck(manifest, options) { try { validateSchema(manifest); validateExpiry(manifest, options?.now); verifyChainIdentity(manifest, options?.expectedChainId); return {compatible: true}; } catch (error) { return {compatible: false, code: error.code}; } }

export async function validateEndpointManifest(manifest, {verifySignature, now = Date.now(), expectedChainId = 6423} = {}) {
  validateSchema(manifest); verifyChainIdentity(manifest, expectedChainId); validateExpiry(manifest, now); await verifyManifestSignature(manifest, verifySignature);
  const required = ["rpc", "evmRpc", "rest", "walletGateway", "appGateway", "faucet", "explorer", "indexer", "monitor", "healthUrl", "versionUrl"];
  const endpoints = Object.fromEntries(required.map(key => [key, url(key, manifest[key])]));
  return Object.freeze({...manifest, ...endpoints, verification: "VERIFIED"});
}
