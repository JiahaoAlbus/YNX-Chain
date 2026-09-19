import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalJSON} from "../lib/sdk-release.mjs";
import {readCanonicalJSON, validateMainnetDraft} from "../lib/chainlist-candidate.mjs";

const CONFIG_PATH = "chain-metadata/ynx-endpoint-migration.json";
const EXPECTED = Object.freeze({
  explorer: "https://explorer-testnet.ynxweb4.com",
  faucet: "https://faucet-testnet.ynxweb4.com",
  legacyEVM: "https://evm.ynxweb4.com",
  legacyExplorer: "https://explorer.ynxweb4.com",
  legacyFaucet: "https://faucet.ynxweb4.com",
  legacyRPC: "https://rpc.ynxweb4.com",
  mainnet: "https://rpc-mainnet.ynxweb4.com",
  rpc: "https://rpc-testnet.ynxweb4.com",
});

export function loadEndpointMigration(rootDir = process.cwd()) {
  const file = path.join(rootDir, CONFIG_PATH);
  const body = fs.readFileSync(file);
  const config = JSON.parse(body);
  assert.equal(body.toString(), canonicalJSON(config), `${CONFIG_PATH} must be canonical JSON`);
  validateEndpointMigration(config);
  validateMainnetDraft(readCanonicalJSON(path.join(rootDir, "chain-metadata/ynx-mainnet-draft.json")).value);
  validateDeploymentTemplates(rootDir, config);
  return config;
}

export function validateEndpointMigration(config) {
  assert.deepEqual(Object.keys(config).sort(), ["activation", "chainEnvironment", "chainId", "chainIdHex", "mainnet", "nativeSymbol", "proofAddress", "schema", "testnet"].sort());
  assert.equal(config.schema, "ynx-endpoint-migration/v1");
  assert.equal(config.chainEnvironment, "testnet");
  assert.equal(config.chainId, 6423);
  assert.equal(config.chainIdHex, "0x1917");
  assert.equal(config.nativeSymbol, "YNXT");
  assert.match(config.proofAddress, /^0x[0-9a-f]{40}$/);
  assert.deepEqual(config.activation, {
    explorerAliasPublicVerified: false,
    faucetAliasPublicVerified: false,
    rpcAliasPublicVerified: false,
  });
  assert.deepEqual(config.mainnet, {chainId: null, enabled: false, reservedRpcUrl: EXPECTED.mainnet});
  assert.deepEqual(config.testnet.canonicalTargets, {explorer: EXPECTED.explorer, faucet: EXPECTED.faucet, rpc: EXPECTED.rpc});
  assert.deepEqual(config.testnet.legacyCompatibility, {
    evmRpc: EXPECTED.legacyEVM,
    explorer: EXPECTED.legacyExplorer,
    faucet: EXPECTED.legacyFaucet,
    rpc: EXPECTED.legacyRPC,
  });
  assert.deepEqual(config.testnet.transport, {evmJsonRpcPath: "/", nativeRestBasePath: "/", websocketUrl: null});
  for (const value of Object.values(EXPECTED)) assertCanonicalHTTPS(value);
  return config;
}

export function validateDeploymentTemplates(rootDir, config) {
  const deploy = fs.readFileSync(path.join(rootDir, "scripts/deploy/deploy-testnet.sh"), "utf8");
  for (const domain of [
    new URL(config.testnet.canonicalTargets.rpc).hostname,
    new URL(config.testnet.canonicalTargets.faucet).hostname,
    new URL(config.testnet.canonicalTargets.explorer).hostname,
  ]) {
    assert.ok(deploy.includes(domain), `deployment template is missing ${domain}`);
  }
  assert.ok(deploy.includes('YNX_MAINNET_ENABLED must remain false'), "deployment template does not reject Mainnet activation");
  assert.ok(deploy.includes('CHAIN_ID" != "6423"') && deploy.includes('NATIVE_SYMBOL" != "YNXT"'), "deployment template does not pin the Testnet identity");
  assert.ok(deploy.includes("YNX_FAUCET_ALLOWED_ORIGINS="), "deployment template does not configure Faucet alias CORS");
}

export async function verifyLiveMigration(config, {fetchImpl = fetch} = {}) {
  const legacyRPC = config.testnet.legacyCompatibility.rpc;
  const targetRPC = config.testnet.canonicalTargets.rpc;
  const [legacyIdentity, targetIdentity] = await Promise.all([
    rpcIdentity(legacyRPC, fetchImpl),
    rpcIdentity(targetRPC, fetchImpl),
  ]);
  assert.deepEqual(targetIdentity, legacyIdentity, "new and legacy RPC identity differ");
  assert.deepEqual(targetIdentity, {chainId: "0x1917", networkId: "6423"}, "RPC is not YNX Testnet 6423");

  const [legacyHeightHex, targetHeightHex] = await Promise.all([
    jsonRPC(legacyRPC, "eth_blockNumber", [], fetchImpl),
    jsonRPC(targetRPC, "eth_blockNumber", [], fetchImpl),
  ]);
  const height = Math.min(hexQuantity(legacyHeightHex), hexQuantity(targetHeightHex));
  assert.ok(height > 0, "comparison height must be positive");
  const comparisonHeight = `0x${height.toString(16)}`;
  const [legacyBlock, targetBlock] = await Promise.all([
    jsonRPC(legacyRPC, "eth_getBlockByNumber", [comparisonHeight, false], fetchImpl),
    jsonRPC(targetRPC, "eth_getBlockByNumber", [comparisonHeight, false], fetchImpl),
  ]);
  assert.ok(legacyBlock?.hash && targetBlock?.hash, "comparison block is unavailable");
  assert.equal(targetBlock.hash, legacyBlock.hash, "same-height block hash differs");
  assert.deepEqual(targetBlock.transactions, legacyBlock.transactions, "same-height transaction history differs");

  const proofMethods = [
    ["eth_getBalance", [config.proofAddress, comparisonHeight]],
    ["eth_getTransactionCount", [config.proofAddress, comparisonHeight]],
    ["eth_getCode", [config.proofAddress, comparisonHeight]],
  ];
  const stateProof = {};
  for (const [method, params] of proofMethods) {
    const [legacyValue, targetValue] = await Promise.all([
      jsonRPC(legacyRPC, method, params, fetchImpl),
      jsonRPC(targetRPC, method, params, fetchImpl),
    ]);
    assert.equal(targetValue, legacyValue, `${method} differs at the comparison height`);
    stateProof[method] = targetValue;
  }

  let transactionProof = null;
  if (legacyBlock.transactions.length > 0) {
    const transactionHash = legacyBlock.transactions[0];
    const [legacyTransaction, targetTransaction] = await Promise.all([
      jsonRPC(legacyRPC, "eth_getTransactionByHash", [transactionHash], fetchImpl),
      jsonRPC(targetRPC, "eth_getTransactionByHash", [transactionHash], fetchImpl),
    ]);
    assert.deepEqual(targetTransaction, legacyTransaction, "representative historical transaction differs");
    transactionProof = transactionHash;
  }

  const [legacyFaucet, targetFaucet] = await Promise.all([
    getJSON(`${config.testnet.legacyCompatibility.faucet}/health`, fetchImpl),
    getJSON(`${config.testnet.canonicalTargets.faucet}/health`, fetchImpl),
  ]);
  for (const health of [legacyFaucet, targetFaucet]) {
    assert.equal(health.ok, true, "Faucet is not healthy");
    assert.equal(health.upstreamOk, true, "Faucet upstream is not healthy");
    assert.equal(health.chainId, 6423, "Faucet chain ID mismatch");
    assert.equal(health.nativeSymbol, "YNXT", "Faucet native symbol mismatch");
  }
  assert.equal(targetFaucet.build?.commit, legacyFaucet.build?.commit, "Faucet aliases do not expose the same build");
  assert.equal(targetFaucet.requestPath, legacyFaucet.requestPath, "Faucet aliases expose different request paths");
  assert.equal(targetFaucet.requestStatusPath, legacyFaucet.requestStatusPath, "Faucet aliases expose different recovery paths");

  if (config.activation.explorerAliasPublicVerified) {
    const [legacyExplorer, targetExplorer] = await Promise.all([
      getJSON(`${config.testnet.legacyCompatibility.explorer}/health`, fetchImpl),
      getJSON(`${config.testnet.canonicalTargets.explorer}/health`, fetchImpl),
    ]);
    assert.equal(targetExplorer.network?.chainId, legacyExplorer.network?.chainId, "Explorer chain identity differs");
    assert.equal(targetExplorer.build?.commit, legacyExplorer.build?.commit, "Explorer aliases expose different builds");
  }

  return {
    chainId: targetIdentity.chainId,
    comparisonHeight: height,
    faucetBuild: targetFaucet.build?.commit || null,
    networkId: targetIdentity.networkId,
    publicVerified: true,
    stateProof,
    transactionProof,
  };
}

async function rpcIdentity(url, fetchImpl) {
  const [chainId, networkId] = await Promise.all([
    jsonRPC(url, "eth_chainId", [], fetchImpl),
    jsonRPC(url, "net_version", [], fetchImpl),
  ]);
  return {chainId, networkId};
}

async function jsonRPC(url, method, params, fetchImpl) {
  const id = `ynx-endpoint-migration-${method}`;
  const response = await request(url, {body: JSON.stringify({id, jsonrpc: "2.0", method, params}), headers: {"content-type": "application/json"}, method: "POST"}, fetchImpl);
  const payload = await boundedJSON(response, method);
  if (payload.jsonrpc !== "2.0" || payload.id !== id || payload.error || !("result" in payload)) throw new Error(`${method} returned an invalid JSON-RPC response`);
  return payload.result;
}

async function getJSON(url, fetchImpl) {
  return boundedJSON(await request(url, {headers: {accept: "application/json"}}, fetchImpl), url);
}

async function request(url, options, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(url, {...options, redirect: "error", signal: controller.signal});
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function boundedJSON(response, name) {
  const text = await response.text();
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error(`${name} response exceeds 2 MiB`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} returned invalid JSON`);
  }
}

function hexQuantity(value) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) throw new Error("invalid hex quantity");
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed)) throw new Error("hex quantity exceeds safe integer range");
  return parsed;
}

function assertCanonicalHTTPS(value) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(parsed.port, "");
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  assert.equal(value.endsWith("/"), false);
}

function parseArgs(argv) {
  if (argv.length === 0) return {live: false};
  if (argv.length === 1 && argv[0] === "--live") return {live: true};
  throw new Error("usage: testnet-endpoint-migration-check.mjs [--live]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {live} = parseArgs(process.argv.slice(2));
  const config = loadEndpointMigration();
  if (!live) {
    process.stdout.write("testnet-endpoint-migration-check passed: config valid; mainnet disabled; public aliases remain unverified\n");
  } else {
    const proof = await verifyLiveMigration(config);
    process.stdout.write(`testnet-endpoint-migration-check passed: public aliases verified at height=${proof.comparisonHeight} chain=${proof.chainId}/${proof.networkId} faucetBuild=${proof.faucetBuild}\n`);
  }
}
