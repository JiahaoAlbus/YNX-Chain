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

export async function verifyLiveMigration(config, {fetchImpl = fetch, transactionHash = null, contractAddress = null, explorer = false} = {}) {
  validateEndpointMigration(config);
  if (transactionHash !== null) assert.match(transactionHash, /^0x[0-9a-f]{64}$/, "invalid historical transaction hash");
  if (contractAddress !== null) assert.match(contractAddress, /^0x[0-9a-f]{40}$/, "invalid contract proof address");
  assert.equal(typeof explorer, "boolean");
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
  for (const block of [legacyBlock, targetBlock]) {
    assert.ok(block && typeof block === "object", "comparison block is unavailable");
    assert.match(block.hash ?? "", /^0x[0-9a-f]{64}$/, "invalid block hash");
    assert.equal(block.number, comparisonHeight, "provider returned the wrong comparison height");
    assert.ok(Array.isArray(block.transactions), "block transaction list is missing");
    for (const hash of block.transactions) assert.match(hash, /^0x[0-9a-f]{64}$/, "invalid block transaction hash");
  }
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
    for (const value of [legacyValue, targetValue]) {
      if (method === "eth_getCode") assert.match(value ?? "", /^0x(?:[0-9a-f]{2})*$/, "invalid EVM bytecode");
      else assert.match(value ?? "", /^0x(?:0|[1-9a-f][0-9a-f]*)$/, "invalid state quantity");
    }
    assert.equal(targetValue, legacyValue, `${method} differs at the comparison height`);
    stateProof[method] = targetValue;
  }

  let transactionProof = null;
  const historyHash = transactionHash ?? legacyBlock.transactions[0] ?? null;
  if (historyHash !== null) {
    const [legacyTransaction, targetTransaction] = await Promise.all([
      jsonRPC(legacyRPC, "eth_getTransactionByHash", [historyHash], fetchImpl),
      jsonRPC(targetRPC, "eth_getTransactionByHash", [historyHash], fetchImpl),
    ]);
    for (const tx of [legacyTransaction, targetTransaction]) {
      assert.ok(tx && typeof tx === "object", "historical transaction is missing");
      assert.equal(tx.hash, historyHash, "historical transaction hash mismatch");
      assert.match(tx.blockHash ?? "", /^0x[0-9a-f]{64}$/, "historical transaction is not mined");
      const txHeight = hexQuantity(tx.blockNumber);
      assert.ok(txHeight > 0 && txHeight <= height, "historical transaction is outside the comparison range");
    }
    assert.deepEqual(targetTransaction, legacyTransaction, "representative historical transaction differs");
    const txBlock = await jsonRPC(legacyRPC, "eth_getBlockByNumber", [legacyTransaction.blockNumber, false], fetchImpl);
    const targetTxBlock = await jsonRPC(targetRPC, "eth_getBlockByNumber", [legacyTransaction.blockNumber, false], fetchImpl);
    for (const block of [txBlock, targetTxBlock]) {
      assert.equal(block?.number, legacyTransaction.blockNumber, "historical block height mismatch");
      assert.equal(block?.hash, legacyTransaction.blockHash, "historical block hash mismatch");
      assert.ok(Array.isArray(block?.transactions) && block.transactions.includes(historyHash), "historical block does not contain transaction");
    }
    transactionProof = historyHash;
  }

  let contractProof = null;
  if (contractAddress !== null) {
    const [oldCode, newCode] = await Promise.all([
      jsonRPC(legacyRPC, "eth_getCode", [contractAddress, comparisonHeight], fetchImpl),
      jsonRPC(targetRPC, "eth_getCode", [contractAddress, comparisonHeight], fetchImpl),
    ]);
    assert.match(oldCode ?? "", /^0x(?:[0-9a-f]{2})+$/, "contract proof must have nonempty code");
    assert.equal(newCode, oldCode, "contract code differs at comparison height");
    contractProof = {address: contractAddress, code: oldCode};
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
    assert.match(health.build?.commit ?? "", /^[0-9a-f]{40}$/, "Faucet build identity missing");
    assert.equal(health.fundingReady, true, "Faucet is not funding-ready");
    assert.equal(health.idempotentRequests, true, "Faucet durable admissions unavailable");
    assert.equal(health.requestPath, "/request", "Faucet request path missing");
    assert.equal(health.requestStatusPath, "/request-status", "Faucet recovery path missing");
    for (const field of ["defaultAmount", "maxAmount", "rateLimitMax", "rateLimitWindowSeconds", "ipRateLimitMax", "ipRateLimitWindowSeconds"]) {
      assert.ok(Number.isSafeInteger(health[field]) && health[field] > 0, `Faucet ${field} missing or invalid`);
    }
  }
  assert.equal(targetFaucet.build?.commit, legacyFaucet.build?.commit, "Faucet aliases do not expose the same build");
  assert.equal(targetFaucet.requestPath, legacyFaucet.requestPath, "Faucet aliases expose different request paths");
  assert.equal(targetFaucet.requestStatusPath, legacyFaucet.requestStatusPath, "Faucet aliases expose different recovery paths");
  for (const field of ["defaultAmount", "maxAmount", "rateLimitMax", "rateLimitWindowSeconds", "ipRateLimitMax", "ipRateLimitWindowSeconds"]) {
    assert.equal(targetFaucet[field], legacyFaucet[field], `Faucet ${field} differs`);
  }

  if (explorer) {
    const [legacyExplorer, targetExplorer] = await Promise.all([
      getJSON(`${config.testnet.legacyCompatibility.explorer}/health`, fetchImpl),
      getJSON(`${config.testnet.canonicalTargets.explorer}/health`, fetchImpl),
    ]);
    for (const health of [legacyExplorer, targetExplorer]) {
      assert.equal(health.ok, true, "Explorer is unhealthy");
      assert.equal(health.indexerOk, true, "Explorer indexer is unhealthy");
      assert.equal(health.network?.chainId, 6423, "Explorer chain identity differs");
      assert.equal(health.nativeSymbol, "YNXT", "Explorer asset mismatch");
      assert.match(health.build?.commit ?? "", /^[0-9a-f]{40}$/, "Explorer build missing");
      assert.ok(Number.isSafeInteger(health.indexedHeight) && health.indexedHeight > 0 && Number.isSafeInteger(health.rpcHeight) && health.rpcHeight >= health.indexedHeight, "Explorer heights invalid");
    }
    assert.equal(targetExplorer.build?.commit, legacyExplorer.build?.commit, "Explorer aliases expose different builds");
  }

  return {
    chainId: targetIdentity.chainId,
    comparisonHeight: height,
    comparisonBlockHash: legacyBlock.hash,
    contractProof,
    faucetBuild: targetFaucet.build?.commit || null,
    networkId: targetIdentity.networkId,
    readOnlyComparisonVerified: transactionProof !== null && contractProof !== null,
    explorerAliasReadVerified: explorer,
    publicVerified: false,
    remainingGates: [
      ...(transactionProof === null ? ["HISTORICAL_TRANSACTION_REQUIRED"] : []),
      ...(contractProof === null ? ["NONEMPTY_CONTRACT_CODE_REQUIRED"] : []),
      ...(!explorer ? ["EXPLORER_ALIAS_NOT_CHECKED"] : []),
      "BLOCK_GROWTH_AND_NATIVE_REST", "CORS_AND_TRANSPORTS", "SHARED_FAUCET_STATE", "WALLET_AND_ECOSYSTEM_REGRESSION",
    ],
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
  const payload = await requestJSON(url, {body: JSON.stringify({id, jsonrpc: "2.0", method, params}), headers: {"content-type": "application/json"}, method: "POST"}, fetchImpl);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.jsonrpc !== "2.0" || payload.id !== id || "error" in payload || !("result" in payload)) throw new Error(`${method} returned an invalid JSON-RPC response`);
  return payload.result;
}

async function getJSON(url, fetchImpl) {
  return requestJSON(url, {headers: {accept: "application/json"}}, fetchImpl);
}

export async function requestJSON(url, options, fetchImpl, {timeoutMs = 10_000, maxBytes = 2 * 1024 * 1024} = {}) {
  const controller = new AbortController();
  let reader;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      reject(new Error(`${url} request/body timed out`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetchImpl(url, {...options, redirect: "error", signal: controller.signal});
      controller.signal.throwIfAborted();
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      if (response.redirected) throw new Error(`${url} redirected`);
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error(`${url} returned non-JSON content type`);
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error(`${url} response exceeds size limit`);
      if (!response.body) throw new Error(`${url} response body missing`);
      reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const {done, value} = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error(`${url} response exceeds size limit`);
        chunks.push(Buffer.from(value));
      }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new Error(`${url} returned invalid JSON`); }
    })()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
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
  const result = {live: false, explorer: false};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--live" && !result.live) result.live = true;
    else if (arg === "--explorer" && !result.explorer) result.explorer = true;
    else if (arg === "--transaction" && !result.transactionHash) result.transactionHash = argv[++i];
    else if (arg === "--contract" && !result.contractAddress) result.contractAddress = argv[++i];
    else throw new Error("usage: testnet-endpoint-migration-check.mjs [--live [--explorer] [--transaction <hash>] [--contract <address>]]");
    if ((arg === "--transaction" && !result.transactionHash) || (arg === "--contract" && !result.contractAddress)) throw new Error("proof argument is missing");
  }
  if (!result.live && (result.explorer || result.transactionHash || result.contractAddress)) throw new Error("proof options require --live");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {live, ...options} = parseArgs(process.argv.slice(2));
  const config = loadEndpointMigration();
  if (!live) {
    process.stdout.write("testnet-endpoint-migration-check passed: config valid; mainnet disabled; public aliases remain unverified\n");
  } else {
    const proof = await verifyLiveMigration(config, options);
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    if (!proof.readOnlyComparisonVerified) process.exitCode = 2;
  }
}
