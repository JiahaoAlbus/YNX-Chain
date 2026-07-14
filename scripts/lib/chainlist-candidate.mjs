import fs from "node:fs";
import path from "node:path";
import {canonicalJSON, sha256} from "./sdk-release.mjs";

export const CHAINLIST_CANDIDATE_SCHEMA = "ynx-chainlist-candidate/v1";
export const TESTNET_CHAIN_ID = 6423;
export const TESTNET_CHAIN_ID_HEX = "0x1917";
export const TESTNET_NATIVE_SYMBOL = "YNXT";
export const TESTNET_METADATA_PATH = "chain-metadata/ynx-testnet.json";
export const MAINNET_DRAFT_PATH = "chain-metadata/ynx-mainnet-draft.json";
export const COLLISION_EVIDENCE_PATH = "chain-metadata/chainid-collision-evidence.json";
export const VERIFICATION_CONFIG_PATH = "chain-metadata/ynx-testnet-verification.json";

const TESTNET_KEYS = ["chain", "chainId", "explorers", "faucets", "infoURL", "name", "nativeCurrency", "networkId", "rpc", "shortName", "status"];
const EXPECTED_ENDPOINTS = Object.freeze({
  explorer: "https://explorer.ynxweb4.com",
  faucet: "https://faucet.ynxweb4.com",
  info: "https://www.ynxweb4.com",
  rpc: "https://evm.ynxweb4.com",
});

export function readCanonicalJSON(filePath) {
  const body = fs.readFileSync(filePath);
  let value;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error.message}`);
  }
  if (!body.equals(Buffer.from(canonicalJSON(value)))) throw new Error(`${filePath} is not canonical JSON`);
  return {body, value};
}

export function loadCandidateSources(rootDir) {
  const root = path.resolve(rootDir);
  const metadata = readCanonicalJSON(path.join(root, TESTNET_METADATA_PATH));
  const mainnet = readCanonicalJSON(path.join(root, MAINNET_DRAFT_PATH));
  const collision = readCanonicalJSON(path.join(root, COLLISION_EVIDENCE_PATH));
  const verification = readCanonicalJSON(path.join(root, VERIFICATION_CONFIG_PATH));
  validateTestnetMetadata(metadata.value);
  validateMainnetDraft(mainnet.value);
  validateCollisionEvidence(collision.value, metadata.value);
  validateVerificationConfig(verification.value);
  return {root, metadata, mainnet, collision, verification};
}

export function validateTestnetMetadata(metadata) {
  assertExactKeys(metadata, TESTNET_KEYS, "testnet metadata");
  if (metadata.name !== "YNX Testnet" || metadata.chain !== "YNX" || metadata.shortName !== "ynxt" || metadata.status !== "active") {
    throw new Error("YNX Testnet name, chain, shortName, or status mismatch");
  }
  if (metadata.chainId !== TESTNET_CHAIN_ID || metadata.networkId !== TESTNET_CHAIN_ID) throw new Error("YNX Testnet chain/network ID mismatch");
  assertExactKeys(metadata.nativeCurrency, ["decimals", "name", "symbol"], "native currency");
  if (metadata.nativeCurrency.name !== TESTNET_NATIVE_SYMBOL || metadata.nativeCurrency.symbol !== TESTNET_NATIVE_SYMBOL || metadata.nativeCurrency.decimals !== 18) {
    throw new Error("YNX Testnet native currency mismatch");
  }
  validateExactURLArray(metadata.rpc, [EXPECTED_ENDPOINTS.rpc], "RPC URLs");
  validateExactURLArray(metadata.faucets, [EXPECTED_ENDPOINTS.faucet], "Faucet URLs");
  validateHTTPSURL(metadata.infoURL, "info URL");
  if (metadata.infoURL !== EXPECTED_ENDPOINTS.info) throw new Error("YNX Testnet info URL mismatch");
  if (!Array.isArray(metadata.explorers) || metadata.explorers.length !== 1) throw new Error("YNX Testnet must have exactly one Explorer");
  const explorer = metadata.explorers[0];
  assertExactKeys(explorer, ["name", "standard", "url"], "Explorer");
  if (explorer.name !== "YNX Explorer" || explorer.standard !== "EIP3091" || explorer.url !== EXPECTED_ENDPOINTS.explorer) {
    throw new Error("YNX Testnet Explorer metadata mismatch");
  }
  validateHTTPSURL(explorer.url, "Explorer URL");
  return metadata;
}

export function validateMainnetDraft(metadata) {
  assertExactKeys(metadata, ["chain", "chainId", "explorers", "faucets", "name", "nativeCurrency", "networkId", "rpc", "status"], "mainnet draft");
  if (metadata.name !== "YNX Mainnet" || metadata.chain !== "YNX" || metadata.chainId !== 6420 || metadata.networkId !== 6420) throw new Error("YNX Mainnet draft identity mismatch");
  if (metadata.status !== "draft-only; mainnet not launched") throw new Error("YNX Mainnet must remain explicitly draft-only");
  if (metadata.rpc.length !== 0 || metadata.faucets.length !== 0 || metadata.explorers.length !== 0) throw new Error("YNX Mainnet draft must not publish endpoints");
  assertExactKeys(metadata.nativeCurrency, ["decimals", "name", "symbol"], "mainnet native currency");
  if (metadata.nativeCurrency.name !== TESTNET_NATIVE_SYMBOL || metadata.nativeCurrency.symbol !== TESTNET_NATIVE_SYMBOL || metadata.nativeCurrency.decimals !== 18) {
    throw new Error("YNX Mainnet draft native currency mismatch");
  }
  return metadata;
}

export function validateCollisionEvidence(evidence, metadata, {now = new Date(), maximumAgeMs = 30 * 24 * 60 * 60 * 1000} = {}) {
  assertExactKeys(evidence, ["aggregate", "candidate", "matches", "registry", "status"], "collision evidence");
  assertExactKeys(evidence.aggregate, ["bytes", "chainCount", "fetchedAt", "sha256", "url"], "collision aggregate");
  assertExactKeys(evidence.candidate, ["chainId", "name", "shortName"], "collision candidate");
  assertExactKeys(evidence.matches, ["chainId", "name", "shortName"], "collision matches");
  assertExactKeys(evidence.registry, ["commit", "repository", "targetFile", "targetFilePresent"], "collision registry");
  if (evidence.aggregate.url !== "https://chainid.network/chains.json" || !Number.isSafeInteger(evidence.aggregate.bytes) || evidence.aggregate.bytes <= 0 || evidence.aggregate.bytes > 16 * 1024 * 1024) {
    throw new Error("collision aggregate source or byte count is invalid");
  }
  if (!Number.isSafeInteger(evidence.aggregate.chainCount) || evidence.aggregate.chainCount < 1 || !/^[0-9a-f]{64}$/.test(evidence.aggregate.sha256)) {
    throw new Error("collision aggregate count or digest is invalid");
  }
  const fetchedAt = new Date(evidence.aggregate.fetchedAt);
  if (!Number.isFinite(fetchedAt.getTime()) || fetchedAt.toISOString().replace(".000Z", "Z") !== evidence.aggregate.fetchedAt) throw new Error("collision evidence timestamp is invalid");
  const age = now.getTime() - fetchedAt.getTime();
  if (age < -5 * 60 * 1000 || age > maximumAgeMs) throw new Error("collision evidence is stale or from the future");
  if (evidence.candidate.chainId !== metadata.chainId || evidence.candidate.name !== metadata.name || evidence.candidate.shortName !== metadata.shortName) {
    throw new Error("collision candidate does not match testnet metadata");
  }
  for (const field of ["chainId", "name", "shortName"]) {
    if (!Array.isArray(evidence.matches[field]) || evidence.matches[field].length !== 0) throw new Error(`collision evidence reports a ${field} conflict`);
  }
  if (evidence.registry.repository !== "https://github.com/ethereum-lists/chains.git" || !/^[0-9a-f]{40}$/.test(evidence.registry.commit)) {
    throw new Error("collision registry source or commit is invalid");
  }
  if (evidence.registry.targetFile !== "_data/chains/eip155-6423.json" || evidence.registry.targetFilePresent !== false) {
    throw new Error("collision registry target file is present or mismatched");
  }
  if (evidence.status !== "unassigned-at-observation; refresh-before-submission") throw new Error("collision evidence status is not fail-closed");
  return evidence;
}

export function validateVerificationConfig(config) {
  assertExactKeys(config, ["blockGrowthPollIntervalMs", "blockGrowthTimeoutMs", "explorerAccountQuery", "explorerHealthPath", "explorerSearchPath", "faucetHealthPath", "requestAttempts", "requestTimeoutMs", "restStatusURL"], "testnet verification config");
  if (config.restStatusURL !== "https://rpc.ynxweb4.com/status") throw new Error("REST status URL mismatch");
  validateHTTPSURL(config.restStatusURL, "REST status URL");
  if (config.faucetHealthPath !== "/health" || config.explorerHealthPath !== "/health" || config.explorerSearchPath !== "/api/search") throw new Error("health/search paths mismatch");
  if (!/^0x[0-9a-f]{40}$/.test(config.explorerAccountQuery)) throw new Error("Explorer proof account is invalid");
  for (const field of ["blockGrowthPollIntervalMs", "blockGrowthTimeoutMs", "requestAttempts", "requestTimeoutMs"]) {
    if (!Number.isSafeInteger(config[field]) || config[field] <= 0) throw new Error(`${field} must be a positive integer`);
  }
  if (config.requestAttempts > 5 || config.requestTimeoutMs > 15000 || config.blockGrowthTimeoutMs > 30000) throw new Error("verification retry/timeout bounds are too large");
  return config;
}

export function buildWalletAddEthereumChain(metadata) {
  validateTestnetMetadata(metadata);
  return {
    blockExplorerUrls: metadata.explorers.map((entry) => entry.url),
    chainId: TESTNET_CHAIN_ID_HEX,
    chainName: metadata.name,
    nativeCurrency: {...metadata.nativeCurrency},
    rpcUrls: [...metadata.rpc],
  };
}

export function buildSDKNetworkModule(metadata) {
  const payload = buildWalletAddEthereumChain(metadata);
  return `// Generated from chain-metadata/ynx-testnet.json; verify with make chainlist-candidate-check.\nexport const ynxTestnet = Object.freeze({\n  chainId: ${JSON.stringify(payload.chainId)},\n  chainIdDecimal: ${metadata.chainId},\n  chainName: ${JSON.stringify(payload.chainName)},\n  nativeCurrency: Object.freeze(${JSON.stringify(payload.nativeCurrency)}),\n  rpcUrls: Object.freeze(${JSON.stringify(payload.rpcUrls)}),\n  restUrls: Object.freeze([\"https://rpc.ynxweb4.com\"]),\n  blockExplorerUrls: Object.freeze(${JSON.stringify(payload.blockExplorerUrls)}),\n  faucetUrls: Object.freeze(${JSON.stringify(metadata.faucets)}),\n  infoUrl: ${JSON.stringify(metadata.infoURL)},\n});\n`;
}

export function buildCandidateStatus() {
  return {
    chainlistAccepted: false,
    chainlistSubmitted: false,
    endpointProof: "operator-controlled-live-read-only-check-required-before-submission",
    mainnetIncluded: false,
    truthfulStatus: "testnet-candidate-only",
    walletDefaultSupported: false,
  };
}

export function digestRecord(file, body) {
  return {bytes: body.length, file, sha256: sha256(body)};
}

export function assertExactKeys(value, expectedKeys, name) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${name} fields mismatch: expected ${expected.join(",")}`);
  }
}

function validateExactURLArray(actual, expected, name) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new Error(`${name} mismatch`);
  for (const value of actual) validateHTTPSURL(value, name);
}

function validateHTTPSURL(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port || value.endsWith("/")) {
    throw new Error(`${name} must be a canonical HTTPS URL without credentials, port, query, hash, or trailing slash`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local")) throw new Error(`${name} must not use a local host`);
}
