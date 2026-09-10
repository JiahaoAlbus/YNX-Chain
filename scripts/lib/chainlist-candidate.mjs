import fs from "node:fs";
import {createHash} from "node:crypto";
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

export const UNASSIGNED_REGISTRY_STATUS = "unassigned-at-observation; refresh-before-submission";
export const REGISTERED_REGISTRY_STATUS = "registered-same-network-observed; candidate-not-submitted";
export const REGISTERED_ENTRY_MAX_BYTES = 64 * 1024;

export function validateCollisionEvidence(evidence, metadata, {now = new Date(), maximumAgeMs = 30 * 24 * 60 * 60 * 1000} = {}) {
  validateTestnetMetadata(metadata);
  const registered = evidence?.status === REGISTERED_REGISTRY_STATUS;
  assertExactKeys(evidence, ["aggregate", "candidate", "matches", "registry", "status", ...(registered ? ["registeredEntry"] : [])], "collision evidence");
  assertExactKeys(evidence.aggregate, ["bytes", "chainCount", "fetchedAt", "sha256", "url"], "collision aggregate");
  assertExactKeys(evidence.candidate, ["chainId", "name", "shortName"], "collision candidate");
  assertExactKeys(evidence.matches, ["chainId", "name", "shortName"], "collision matches");
  assertExactKeys(evidence.registry, ["commit", "repository", "targetFile", "targetFilePresent"], "collision registry");
  if (evidence.aggregate.url !== "https://chainid.network/chains.json" || !Number.isSafeInteger(evidence.aggregate.bytes) || evidence.aggregate.bytes <= 0 || evidence.aggregate.bytes > 16 * 1024 * 1024) throw new Error("collision aggregate source or byte count is invalid");
  if (!Number.isSafeInteger(evidence.aggregate.chainCount) || evidence.aggregate.chainCount < 1 || !/^[0-9a-f]{64}$/.test(evidence.aggregate.sha256)) throw new Error("collision aggregate count or digest is invalid");
  const aggregateTime = validateRegistryObservationTime(evidence.aggregate.fetchedAt, {now, maximumAgeMs});
  if (evidence.candidate.chainId !== metadata.chainId || evidence.candidate.name !== metadata.name || evidence.candidate.shortName !== metadata.shortName) throw new Error("collision candidate does not match testnet metadata");
  if (evidence.registry.repository !== "https://github.com/ethereum-lists/chains.git" || !/^[0-9a-f]{40}$/.test(evidence.registry.commit)) throw new Error("collision registry source or commit is invalid");
  if (evidence.registry.targetFile !== "_data/chains/eip155-6423.json" || evidence.registry.targetFilePresent !== registered) throw new Error("collision registry target file is present or mismatched");
  if (!registered) {
    for (const field of ["chainId", "name", "shortName"]) if (!Array.isArray(evidence.matches[field]) || evidence.matches[field].length !== 0) throw new Error(`collision evidence reports a ${field} conflict`);
    if (evidence.status !== UNASSIGNED_REGISTRY_STATUS) throw new Error("collision evidence status is not fail-closed");
    return evidence;
  }
  const record = evidence.registeredEntry;
  assertExactKeys(record, ["url", "body", "bytes", "sha256", "gitBlobSha1", "observedAt", "candidateExactMatch", "metadataDifferences", "registeredShortNameMatches"], "registered entry");
  if (record.url !== registeredEntryURL(evidence.registry.commit)) throw new Error("registered entry URL/ref/path mismatch");
  const body = registryEntryBytes(record.body);
  if (record.bytes !== body.length || !/^[0-9a-f]{64}$/.test(record.sha256) || record.sha256 !== sha256(body) || record.gitBlobSha1 !== registryEntryGitBlob(body)) throw new Error("registered entry raw bytes or digest mismatch");
  const entryTime = validateRegistryObservationTime(record.observedAt, {now, maximumAgeMs});
  if (entryTime < aggregateTime || entryTime - aggregateTime > 120000) throw new Error("registered entry observation window mismatch");
  const entry = parseRegisteredNetworkEntry(record.body, metadata);
  const own = projectRegistryMatch(entry);
  for (const field of ["chainId", "name", "shortName"]) {
    const expected = field === "shortName" && entry.shortName.toLowerCase() !== metadata.shortName.toLowerCase() ? [] : [own];
    if (canonicalJSON(evidence.matches[field]) !== canonicalJSON(expected)) throw new Error(`collision evidence reports a ${field} conflict or duplicate`);
  }
  if (canonicalJSON(record.registeredShortNameMatches) !== canonicalJSON([own])) throw new Error("registered shortName conflict or duplicate");
  const differences = registeredMetadataDifferences(entry, metadata);
  if (record.candidateExactMatch !== (differences.length === 0) || canonicalJSON(record.metadataDifferences) !== canonicalJSON(differences)) throw new Error("registered entry candidate comparison mismatch");
  return evidence;
}

export function registeredEntryURL(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("registered entry commit is invalid");
  return `https://raw.githubusercontent.com/ethereum-lists/chains/${commit}/_data/chains/eip155-6423.json`;
}

export function registryEntryGitBlob(body) {
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

function registryEntryBytes(raw) {
  if (typeof raw !== "string") throw new Error("registered entry body must be UTF-8 text");
  const body = Buffer.from(raw, "utf8");
  if (!body.length || body.length > REGISTERED_ENTRY_MAX_BYTES || body.toString("utf8") !== raw) throw new Error("registered entry body size or UTF-8 is invalid");
  return body;
}

export function parseRegisteredNetworkEntry(raw, metadata) {
  validateTestnetMetadata(metadata);
  registryEntryBytes(raw);
  const entry = parseRegistryJSON(raw);
  const required = ["chain", "chainId", "explorers", "faucets", "infoURL", "name", "nativeCurrency", "networkId", "rpc", "shortName"];
  const optional = ["icon", "slip44", "features", "status"];
  if (!entry || Array.isArray(entry) || typeof entry !== "object" || required.some((key) => !Object.hasOwn(entry, key)) || Object.keys(entry).some((key) => !required.includes(key) && !optional.includes(key))) throw new Error("registered entry fields mismatch");
  for (const field of ["chain", "chainId", "networkId", "name", "nativeCurrency", "rpc", "explorers"]) if (canonicalJSON(entry[field]) !== canonicalJSON(metadata[field])) throw new Error(`registered network identity ${field} mismatch`);
  const allowedMetadata = {shortName: [metadata.shortName, "ynxtest"], faucets: [metadata.faucets, ["https://www.ynxweb4.com/dapp/faucet"]], infoURL: [metadata.infoURL, "https://ynxweb4.com"]};
  for (const [field, allowed] of Object.entries(allowedMetadata)) if (!allowed.some((value) => canonicalJSON(value) === canonicalJSON(entry[field]))) throw new Error(`unreviewed registered metadata ${field}`);
  const exact = canonicalJSON(entry) === canonicalJSON(metadata);
  // The update branch permits only the observed presence pattern. Removing a
  // registered capability is not a display-only change. A wholly identical
  // entry is an explicit observation mode, not permission to mix patterns.
  if (!exact) for (const field of optional) if (Object.hasOwn(entry, field) !== (field !== "status")) throw new Error(`unreviewed registered metadata presence ${field}`);
  const allowedOptional = {icon: "ynx", slip44: 60, features: [{name: "EIP155"}], status: metadata.status};
  for (const field of optional) if (Object.hasOwn(entry, field) && canonicalJSON(entry[field]) !== canonicalJSON(allowedOptional[field])) throw new Error(`unreviewed registered metadata ${field}`);
  return entry;
}

// Keep one token of lookahead instead of retaining a token array for the full
// aggregate. JSON.parse validates syntax; this second pass rejects ambiguous
// duplicate keys (including escaped equivalents) at every object depth.
export function parseRegistryJSON(raw) {
  const parsed = JSON.parse(raw);
  const pattern = /\s*("(?:\\.|[^"\\])*"|[{}\[\],:]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/y;
  const next = () => pattern.exec(raw)?.[1];
  let token = next();
  function take() { const previous = token; token = next(); return previous; }
  function value(depth) {
    if (depth > 32) throw new Error("registry JSON nesting is too deep");
    const current = take();
    if (current === "{") {
      const keys = new Set();
      if (token !== "}") while (true) {
        const key = JSON.parse(take());
        if (keys.has(key)) throw new Error("registry duplicate JSON key");
        keys.add(key); take(); value(depth + 1);
        if (token !== ",") break;
        take();
      }
      take();
    } else if (current === "[") {
      if (token !== "]") while (true) { value(depth + 1); if (token !== ",") break; take(); }
      take();
    }
  }
  value(0);
  if (token !== undefined) throw new Error("registry JSON token mismatch");
  return parsed;
}

export function projectRegistryMatch(entry) {
  return {chainId: entry.chainId, name: entry.name, shortName: entry.shortName};
}

export function registeredMetadataDifferences(entry, metadata) {
  return [...new Set([...Object.keys(entry), ...Object.keys(metadata)])].sort().filter((field) => !Object.hasOwn(entry, field) || !Object.hasOwn(metadata, field) || canonicalJSON(entry[field]) !== canonicalJSON(metadata[field])).map((field) => ({field, candidatePresent: Object.hasOwn(metadata, field), candidateValue: metadata[field] ?? null, registeredPresent: Object.hasOwn(entry, field), registeredValue: entry[field] ?? null}));
}

function validateRegistryObservationTime(value, {now, maximumAgeMs}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isSafeInteger(maximumAgeMs) || maximumAgeMs <= 0 || maximumAgeMs > 30 * 24 * 60 * 60 * 1000) throw new Error("registry freshness context is invalid");
  const time = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(time.getTime()) || time.toISOString().replace(".000Z", "Z") !== value) throw new Error("collision evidence timestamp is invalid");
  const age = now.getTime() - time.getTime();
  if (age < -5 * 60 * 1000 || age > maximumAgeMs) throw new Error("collision evidence is stale or from the future");
  return time.getTime();
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

export function buildCandidateStatus(evidence, metadata) {
  if (evidence) validateCollisionEvidence(evidence, metadata);
  const registered = evidence?.status === REGISTERED_REGISTRY_STATUS;
  const exact = registered ? evidence.registeredEntry.candidateExactMatch : null;
  return {
    chainlistAccepted: false,
    chainlistSubmitted: false,
    candidateKind: !registered ? "new-entry" : exact ? "registered-exact-observation" : "registered-metadata-update",
    candidateExactMatch: exact,
    registeredEntryObserved: registered,
    endpointProof: "operator-controlled-live-read-only-check-required-before-submission",
    mainnetIncluded: false,
    truthfulStatus: registered ? "registered-network-candidate-not-submitted-or-accepted" : "testnet-candidate-only",
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
