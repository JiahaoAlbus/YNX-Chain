import {DAppConnectError} from "./errors.js";

const FORBIDDEN_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "10.0.2.2", "example.com"]);
function url(name, value) { try { const parsed = new URL(value); if (parsed.protocol !== "https:" || FORBIDDEN_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith(".local")) throw new Error("unsafe"); return parsed.toString(); } catch { throw new DAppConnectError("ENDPOINT_MANIFEST_INVALID", `${name} must be a public HTTPS URL.`); } }

export async function validateEndpointManifest(manifest, {verifySignature, now = Date.now(), expectedChainId = 6423} = {}) {
  if (!manifest || manifest.schemaVersion !== "1.0.0") throw new DAppConnectError("ENDPOINT_MANIFEST_INVALID", "Unsupported endpoint manifest schema.");
  if (Number(manifest.evmChainId) !== expectedChainId || manifest.evmChainHex?.toLowerCase() !== "0x1917") throw new DAppConnectError("ENDPOINT_MANIFEST_WRONG_CHAIN", "Endpoint manifest chain identity does not match YNX Testnet.");
  if (Date.parse(manifest.expiresAt) <= now) throw new DAppConnectError("ENDPOINT_MANIFEST_EXPIRED", "Endpoint manifest has expired.");
  if (typeof verifySignature !== "function") throw new DAppConnectError("ENDPOINT_MANIFEST_UNVERIFIED", "A manifest signature verifier is required before activation.");
  if (!(await verifySignature(manifest))) throw new DAppConnectError("ENDPOINT_MANIFEST_UNVERIFIED", "Endpoint manifest signature verification failed.");
  const required = ["rpc", "evmRpc", "rest", "walletGateway", "appGateway", "faucet", "explorer", "indexer", "monitor", "healthUrl", "versionUrl"];
  const endpoints = Object.fromEntries(required.map(key => [key, url(key, manifest[key])]));
  return Object.freeze({...manifest, ...endpoints, verification: "VERIFIED"});
}
