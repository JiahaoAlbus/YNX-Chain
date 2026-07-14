import fs from "node:fs";
import path from "node:path";
import {
  readCanonicalJSON,
  validateMainnetDraft,
  validateTestnetMetadata,
  validateVerificationConfig,
} from "./chainlist-candidate.mjs";
import {canonicalJSON, sha256} from "./sdk-release.mjs";
import {normalizeYNXAddress} from "../../sdk/js/index.js";

export const EXCHANGE_CANDIDATE_SCHEMA = "ynx-exchange-candidate/v1";
export const EXCHANGE_POLICY_PATH = "exchange/ynx-testnet-policy.json";
export const EXCHANGE_VECTORS_PATH = "testdata/exchange-signed-transactions.json";

const CAPABILITIES = Object.freeze([
  ["eth_chainId", "standard-read", "supported", true],
  ["net_version", "standard-read", "supported", true],
  ["eth_blockNumber", "standard-read", "supported", true],
  ["eth_getBalance", "latest-or-pending-only", "bounded", true],
  ["eth_getTransactionCount", "latest-or-pending-only", "implemented-not-public-release", false],
  ["eth_getBlockByNumber", "exact-height-or-standard-tag", "implemented-not-public-release", false],
  ["eth_getBlockByHash", "exact-canonical-block-hash", "implemented-not-public-release", false],
  ["eth_getTransactionByHash", "standard-read-bounded-fields", "bounded", false],
  ["eth_getTransactionReceipt", "standard-read-bounded-fields", "bounded", false],
  ["eth_getLogs", "bounded-range-address-topic-filter", "bounded", true],
  ["eth_sendRawTransaction", "ynx-native-envelope-only; standard-ethereum-rlp-unsupported", "implemented-not-public-release", false],
  ["eth_call", "bounded-contract-subset", "bounded", false],
  ["eth_estimateGas", "constant-local-estimate-not-production-gas-market", "not-exchange-safe", false],
  ["eth_sendTransaction", "bounded-devtool-contract-call-only", "not-exchange-safe", false],
  ["eth_gasPrice", "not-implemented", "unsupported", false],
]);

export function loadExchangeSources(rootDir) {
  const root = path.resolve(rootDir);
  const metadata = readCanonicalJSON(path.join(root, "chain-metadata/ynx-testnet.json"));
  const mainnet = readCanonicalJSON(path.join(root, "chain-metadata/ynx-mainnet-draft.json"));
  const verification = readCanonicalJSON(path.join(root, "chain-metadata/ynx-testnet-verification.json"));
  const policy = readCanonicalJSON(path.join(root, EXCHANGE_POLICY_PATH));
  const vectors = readCanonicalJSON(path.join(root, EXCHANGE_VECTORS_PATH));
  validateTestnetMetadata(metadata.value);
  validateMainnetDraft(mainnet.value);
  validateVerificationConfig(verification.value);
  validateExchangePolicy(policy.value);
  validateExchangeVectors(vectors.value);
  return {root, metadata, mainnet, verification, policy, vectors};
}

export function validateExchangePolicy(policy) {
  assertExactKeys(policy, ["addressPolicy", "broadcastPolicy", "confirmationPolicy", "rpcCapabilities", "schema", "status"], "exchange policy");
  if (policy.schema !== "ynx-exchange-policy/v1") throw new Error("exchange policy schema mismatch");

  assertExactKeys(policy.addressPolicy, ["acceptedRepresentations", "canonicalQueryFormat", "canonicalSigningFormat", "canonicalStorageFormat", "memoTag", "oneAccountTwoRepresentations"], "exchange address policy");
  if (canonicalJSON(policy.addressPolicy.acceptedRepresentations) !== canonicalJSON(["lowercase-evm-0x", "checksummed-ynx1"]) ||
      policy.addressPolicy.canonicalQueryFormat !== "lowercase-evm-0x" || policy.addressPolicy.canonicalSigningFormat !== "lowercase-evm-0x" ||
      policy.addressPolicy.canonicalStorageFormat !== "lowercase-evm-0x" || policy.addressPolicy.memoTag !== "not-used" || policy.addressPolicy.oneAccountTwoRepresentations !== true) {
    throw new Error("exchange address policy weakens the one-account/two-representation boundary");
  }

  assertExactKeys(policy.broadcastPolicy, ["canonicalEnvelope", "publicAuthoritativeDeployed", "restContentType", "restPath", "rpcEncoding", "rpcMethod", "standardEthereumRLP"], "exchange broadcast policy");
  if (policy.broadcastPolicy.canonicalEnvelope !== "ynx-native-json-envelope-v1" || policy.broadcastPolicy.publicAuthoritativeDeployed !== false ||
      policy.broadcastPolicy.restContentType !== "application/json" || policy.broadcastPolicy.restPath !== "/transactions/broadcast" ||
      policy.broadcastPolicy.rpcEncoding !== "0x-hex-of-canonical-ynx-native-json-envelope-v1" || policy.broadcastPolicy.rpcMethod !== "eth_sendRawTransaction" ||
      policy.broadcastPolicy.standardEthereumRLP !== false) {
    throw new Error("exchange broadcast policy makes an unsupported deployment or Ethereum RLP claim");
  }

  assertExactKeys(policy.confirmationPolicy, ["duplicateTransactionHash", "finalityModel", "fixtureMinimumConfirmations", "pauseOnBlockIdentityMismatch", "pauseOnIndexerLag", "pauseOnObservedReorg", "productionCreditThreshold", "productionThresholdApproved", "reorgResistanceProven", "restartPersistenceRequired"], "exchange confirmation policy");
  if (policy.confirmationPolicy.duplicateTransactionHash !== "idempotent-exact-replay" || policy.confirmationPolicy.finalityModel !== "authoritative-producer-follower; no-public-bft-finality-proof" ||
      policy.confirmationPolicy.fixtureMinimumConfirmations !== 2 || policy.confirmationPolicy.productionCreditThreshold !== null || policy.confirmationPolicy.productionThresholdApproved !== false ||
      policy.confirmationPolicy.reorgResistanceProven !== false || policy.confirmationPolicy.restartPersistenceRequired !== true ||
      policy.confirmationPolicy.pauseOnBlockIdentityMismatch !== true || policy.confirmationPolicy.pauseOnIndexerLag !== true || policy.confirmationPolicy.pauseOnObservedReorg !== true) {
    throw new Error("exchange confirmation policy overstates finality or omits a fail-closed boundary");
  }

  if (!Array.isArray(policy.rpcCapabilities) || policy.rpcCapabilities.length !== CAPABILITIES.length) throw new Error("exchange RPC capability matrix length mismatch");
  policy.rpcCapabilities.forEach((entry, index) => {
    assertExactKeys(entry, ["compatibility", "method", "publicVerified", "status"], `exchange RPC capability ${index}`);
    const [method, compatibility, status, publicVerified] = CAPABILITIES[index];
    if (entry.method !== method || entry.compatibility !== compatibility || entry.status !== status || entry.publicVerified !== publicVerified) {
      throw new Error(`exchange RPC capability mismatch for ${method}`);
    }
  });

  assertExactKeys(policy.status, ["exchangeListed", "exchangePartnership", "exchangeSubmitted", "independentExchangeVerified", "mainnet"], "exchange status");
  if (Object.values(policy.status).some((value) => value !== false)) throw new Error("exchange policy contains an unsupported external or mainnet claim");
  return policy;
}

export function validateExchangeVectors(vectors) {
  assertExactKeys(vectors, ["accounts", "privateKeyMaterialIncluded", "schema", "testOnly", "transactions", "unsafeForProductionCustody"], "exchange vectors");
  if (vectors.schema !== "ynx-exchange-signed-vectors/v1" || vectors.testOnly !== true || vectors.unsafeForProductionCustody !== true || vectors.privateKeyMaterialIncluded !== false) {
    throw new Error("exchange vector safety boundary mismatch");
  }
  if (!Array.isArray(vectors.accounts) || vectors.accounts.length !== 3) throw new Error("exchange vector account count mismatch");
  const accounts = new Map();
  for (const account of vectors.accounts) {
    assertExactKeys(account, ["evmAddress", "role", "ynxAddress"], "exchange vector account");
    const normalized = normalizeYNXAddress(account.ynxAddress);
    if (normalized.evmAddress !== account.evmAddress || normalized.ynxAddress !== account.ynxAddress) throw new Error("exchange vector address representations differ");
    if (accounts.has(account.role)) throw new Error("duplicate exchange vector account role");
    accounts.set(account.role, account.evmAddress);
  }
  const purposes = ["deposit-recognition", "withdrawal-broadcast"];
  if (!Array.isArray(vectors.transactions) || vectors.transactions.length !== purposes.length) throw new Error("exchange signed vector count mismatch");
  vectors.transactions.forEach((record, index) => {
    assertExactKeys(record, ["canonicalPayloadHex", "envelope", "purpose", "transactionHash"], "exchange signed vector");
    if (record.purpose !== purposes[index] || !/^0x[0-9a-f]+$/.test(record.canonicalPayloadHex) || record.canonicalPayloadHex.length % 2 !== 0 || !/^0x[0-9a-f]{64}$/.test(record.transactionHash)) {
      throw new Error("exchange signed vector encoding or purpose mismatch");
    }
    const payload = Buffer.from(record.canonicalPayloadHex.slice(2), "hex");
    let decoded;
    try {
      decoded = JSON.parse(payload);
    } catch {
      throw new Error("exchange signed vector payload is not JSON");
    }
    if (canonicalJSON(decoded) !== canonicalJSON(record.envelope) || `0x${sha256(payload)}` !== record.transactionHash) throw new Error("exchange signed vector payload/hash mismatch");
    assertExactKeys(record.envelope, ["amount", "chainId", "fee", "from", "nonce", "publicKey", "signature", "to", "type", "version"], "exchange signed envelope");
    if (record.envelope.version !== 1 || record.envelope.chainId !== 6423 || record.envelope.type !== "transfer" || record.envelope.fee !== 1 || record.envelope.nonce !== 1 ||
        !Number.isSafeInteger(record.envelope.amount) || record.envelope.amount <= 0 || !/^0x[0-9a-f]{40}$/.test(record.envelope.from) || !/^0x[0-9a-f]{40}$/.test(record.envelope.to) ||
        !/^[0-9a-f]{66}$/.test(record.envelope.publicKey) || !/^30[0-9a-f]{136,142}$/.test(record.envelope.signature)) {
      throw new Error("exchange signed envelope field mismatch");
    }
  });
  if (vectors.transactions[0].envelope.from !== accounts.get("depositor") || vectors.transactions[0].envelope.to !== accounts.get("exchange-deposit-and-test-hot-wallet") || vectors.transactions[0].envelope.amount !== 1000 ||
      vectors.transactions[1].envelope.from !== accounts.get("exchange-deposit-and-test-hot-wallet") || vectors.transactions[1].envelope.to !== accounts.get("withdrawal-recipient") || vectors.transactions[1].envelope.amount !== 125) {
    throw new Error("exchange signed vector flow mismatch");
  }
  return vectors;
}

export function buildExchangeProfile(sources) {
  const metadata = sources.metadata.value;
  const policy = sources.policy.value;
  return {
    addressPolicy: policy.addressPolicy,
    asset: {decimals: metadata.nativeCurrency.decimals, name: "YNXT", symbol: "YNXT", type: "native-l1-coin"},
    broadcastPolicy: policy.broadcastPolicy,
    chain: {
      chainId: metadata.chainId,
      cometChainId: "ynx_6423-1",
      evmChainIdHex: "0x1917",
      evmRPC: metadata.rpc[0],
      explorer: metadata.explorers[0].url,
      infoURL: metadata.infoURL,
      networkId: metadata.networkId,
      restStatus: sources.verification.value.restStatusURL,
      testnet: true,
    },
    confirmationPolicy: policy.confirmationPolicy,
    rpcCapabilities: policy.rpcCapabilities,
    status: {...policy.status, truthfulStatus: "testnet-exchange-readiness-only"},
  };
}

export function buildExchangeCandidateStatus(sources) {
  return {
    candidatePublicRuntimeDeployed: sources.policy.value.broadcastPolicy.publicAuthoritativeDeployed,
    exchangeListed: false,
    exchangePartnership: false,
    exchangeSubmitted: false,
    independentExchangeVerified: false,
    mainnetIncluded: false,
    truthfulStatus: "testnet-readiness-candidate-only",
  };
}

export function exchangeExpectedBodies(sources) {
  const profile = buildExchangeProfile(sources);
  return new Map([
    ["exchange-status.json", Buffer.from(canonicalJSON(buildExchangeCandidateStatus(sources)))],
    ["rpc-capabilities.json", Buffer.from(canonicalJSON(profile.rpcCapabilities))],
    ["signed-transaction-vectors.json", sources.vectors.body],
    ["ynx-testnet-exchange-profile.json", Buffer.from(canonicalJSON(profile))],
  ]);
}

export function assertExactKeys(value, expectedKeys, name) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${name} fields mismatch`);
}

export function assertGeneratedVectorsMatch(rootDir, generatedPath) {
  const expected = fs.readFileSync(path.join(path.resolve(rootDir), EXCHANGE_VECTORS_PATH));
  const generated = fs.readFileSync(generatedPath);
  if (!generated.equals(expected)) throw new Error("generated exchange signed vectors differ from committed public fixtures");
}
