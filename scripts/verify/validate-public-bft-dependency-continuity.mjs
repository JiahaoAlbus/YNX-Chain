#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function fail(message) {
  throw new Error(`public BFT dependency continuity rejected: ${message}`);
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${path.basename(file)} is not valid JSON: ${error.message}`);
  }
}

function validate(root, commit, release, migrationHeight, migrationHash, maxLag) {
  if (!/^[0-9a-f]{12}$/.test(commit) || release !== `ynx-bft-gateway-${commit}`) fail("expected release identity is invalid");
  if (!Number.isSafeInteger(migrationHeight) || migrationHeight < 1) fail("migration height is invalid");
  if (!/^[0-9a-f]{64}$/.test(migrationHash)) fail("migration hash is invalid");
  if (!Number.isSafeInteger(maxLag) || maxLag < 0 || maxLag > 20) fail("maximum index lag is invalid");
  const serviceRelease = `ynx-chain-${commit}`;

  const gatewayBefore = readJSON(path.join(root, "gateway-before-health.json"));
  const gatewayAfter = readJSON(path.join(root, "gateway-after-health.json"));
  const status = readJSON(path.join(root, "gateway-after-status.json"));
  for (const value of [gatewayBefore, gatewayAfter]) {
    if (value.ok !== true || value.service !== "ynx-bft-gatewayd" || value.mode !== "cometbft-backed" || value.chainId !== 6423 || value.nativeSymbol !== "YNXT" || value.cometChainId !== "ynx_6423-1" || value.validatorCount !== 4 || value.publicCutoverReady !== false) fail("gateway health identity mismatch");
    if (value.migrationHeight !== migrationHeight || value.migrationBlockHash !== migrationHash) fail("gateway migration anchor mismatch");
    if (value.build?.commit !== commit || value.build?.release !== release) fail("gateway build identity mismatch");
  }
  if (!Number.isSafeInteger(gatewayBefore.height) || !Number.isSafeInteger(gatewayAfter.height) || gatewayAfter.height <= gatewayBefore.height) fail("candidate height did not grow during continuity observation");
  if (status.chainId !== 6423 || status.nativeCurrencySymbol !== "YNXT" || status.consensusEngine !== "cometbft" || status.cometChainId !== "ynx_6423-1" || status.validatorCount !== 4 || status.publicCutoverReady !== false) fail("gateway status identity mismatch");
  if (status.migrationHeight !== migrationHeight || status.migrationBlockHash !== migrationHash || status.earliestBlockHeight !== migrationHeight + 1) fail("gateway retained-history boundary mismatch");

  const indexer = readJSON(path.join(root, "indexer-after-health.json"));
  if (indexer.ok !== true || indexer.service !== "ynx-indexerd" || indexer.chainId !== 6423 || indexer.nativeSymbol !== "YNXT" || indexer.lastError !== "") fail("candidate indexer health mismatch");
  if (indexer.build?.commit !== commit || indexer.build?.release !== serviceRelease) fail("candidate indexer build identity mismatch");
  if (!Number.isSafeInteger(indexer.lastIndexedHeight) || !Number.isSafeInteger(indexer.lastSourceHeight) || indexer.lastIndexedHeight < migrationHeight + 1 || indexer.lastSourceHeight < indexer.lastIndexedHeight || indexer.lastSourceHeight - indexer.lastIndexedHeight > maxLag) fail("candidate indexer continuity or lag mismatch");

  const explorer = readJSON(path.join(root, "explorer-health.json"));
  if (explorer.ok !== true || explorer.service !== "ynx-explorerd" || explorer.network?.chainId !== 6423 || explorer.nativeSymbol !== "YNXT" || explorer.validatorCount !== 4 || explorer.indexerOk !== true || explorer.truthfulStatus !== "rpc-and-indexer-backed") fail("candidate Explorer continuity mismatch");
  if (explorer.build?.commit !== commit || explorer.build?.release !== serviceRelease) fail("candidate Explorer build identity mismatch");
  if (!Number.isSafeInteger(explorer.rpcHeight) || !Number.isSafeInteger(explorer.indexedHeight) || explorer.rpcHeight < gatewayAfter.height || explorer.syncLagBlocks > maxLag) fail("candidate Explorer height or lag mismatch");

  const serviceFiles = {
    faucet: "faucet-health.json",
    ai: "ai-health.json",
    pay: "pay-health.json",
    trust: "trust-health.json",
    resource: "resource-health.json",
  };
  const services = {};
  for (const [name, file] of Object.entries(serviceFiles)) {
    const value = readJSON(path.join(root, file));
    if (value.ok !== true || value.upstreamMode !== "bft" || !/^0x[0-9a-f]{40}$/.test(value.signerAddress || value.faucetAddress || "")) fail(`${name} is not a healthy signer-bound BFT dependency`);
    if (value.build?.commit !== commit || value.build?.release !== serviceRelease) fail(`${name} build identity mismatch`);
    services[name] = { upstreamMode: value.upstreamMode, signerAddress: value.signerAddress || value.faucetAddress };
  }
  return {
    schemaVersion: 1,
    status: "passed",
    commit,
    release,
    migrationHeight,
    migrationBlockHash: migrationHash,
    heightBefore: gatewayBefore.height,
    heightAfter: gatewayAfter.height,
    indexedHeight: indexer.lastIndexedHeight,
    indexLag: indexer.lastSourceHeight - indexer.lastIndexedHeight,
    explorerLag: explorer.syncLagBlocks,
    parallelCandidateOnly: true,
    publicIngressChanged: false,
    publicCutoverAuthorized: false,
    services,
  };
}

function writeFixture(root, commit, release, migrationHeight, migrationHash) {
  const build = { commit, release, buildTime: "2026-07-13T00:00:00Z" };
  const serviceBuild = { ...build, release: `ynx-chain-${commit}` };
  const health = (height) => ({ ok: true, service: "ynx-bft-gatewayd", mode: "cometbft-backed", chainId: 6423, nativeSymbol: "YNXT", cometChainId: "ynx_6423-1", height, validatorCount: 4, publicCutoverReady: false, migrationHeight, migrationBlockHash: migrationHash, build });
  const files = {
    "gateway-before-health.json": health(migrationHeight + 5),
    "gateway-after-health.json": health(migrationHeight + 7),
    "gateway-after-status.json": { chainId: 6423, nativeCurrencySymbol: "YNXT", consensusEngine: "cometbft", cometChainId: "ynx_6423-1", validatorCount: 4, publicCutoverReady: false, migrationHeight, migrationBlockHash: migrationHash, earliestBlockHeight: migrationHeight + 1 },
    "indexer-after-health.json": { ok: true, service: "ynx-indexerd", chainId: 6423, nativeSymbol: "YNXT", lastIndexedHeight: migrationHeight + 6, lastSourceHeight: migrationHeight + 7, lastError: "", build: serviceBuild },
    "explorer-health.json": { ok: true, service: "ynx-explorerd", network: { chainId: 6423 }, nativeSymbol: "YNXT", validatorCount: 4, indexerOk: true, truthfulStatus: "rpc-and-indexer-backed", rpcHeight: migrationHeight + 7, indexedHeight: migrationHeight + 6, syncLagBlocks: 1, build: serviceBuild },
    "faucet-health.json": { ok: true, upstreamMode: "bft", faucetAddress: `0x${"1".repeat(40)}`, build: serviceBuild },
    "ai-health.json": { ok: true, upstreamMode: "bft", signerAddress: `0x${"2".repeat(40)}`, build: serviceBuild },
    "pay-health.json": { ok: true, upstreamMode: "bft", signerAddress: `0x${"3".repeat(40)}`, build: serviceBuild },
    "trust-health.json": { ok: true, upstreamMode: "bft", signerAddress: `0x${"4".repeat(40)}`, build: serviceBuild },
    "resource-health.json": { ok: true, upstreamMode: "bft", signerAddress: `0x${"5".repeat(40)}`, build: serviceBuild },
  };
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(root, name), `${JSON.stringify(value)}\n`);
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-bft-dependency-continuity-"));
  const commit = "abcdef123456", release = `ynx-bft-gateway-${commit}`, height = 100, hash = "a".repeat(64);
  try {
    writeFixture(root, commit, release, height, hash);
    const result = validate(root, commit, release, height, hash, 3);
    if (result.status !== "passed" || result.publicIngressChanged !== false || result.heightAfter <= result.heightBefore) fail("valid continuity fixture failed");
    const indexerPath = path.join(root, "indexer-after-health.json");
    const indexer = readJSON(indexerPath);
    indexer.lastIndexedHeight = height;
    fs.writeFileSync(indexerPath, `${JSON.stringify(indexer)}\n`);
    let rejected = false;
    try { validate(root, commit, release, height, hash, 3); } catch { rejected = true; }
    if (!rejected) fail("continuity fixture accepted an Indexer below the migration boundary");
    writeFixture(root, commit, release, height, hash);
    const explorerPath = path.join(root, "explorer-health.json");
    const explorer = readJSON(explorerPath);
    explorer.syncLagBlocks = 4;
    fs.writeFileSync(explorerPath, `${JSON.stringify(explorer)}\n`);
    rejected = false;
    try { validate(root, commit, release, height, hash, 3); } catch { rejected = true; }
    if (!rejected) fail("continuity fixture accepted an Explorer beyond the lag boundary");
    writeFixture(root, commit, release, height, hash);
    const gatewayPath = path.join(root, "gateway-after-health.json");
    const gateway = readJSON(gatewayPath);
    gateway.migrationBlockHash = "b".repeat(64);
    fs.writeFileSync(gatewayPath, `${JSON.stringify(gateway)}\n`);
    rejected = false;
    try { validate(root, commit, release, height, hash, 3); } catch { rejected = true; }
    if (!rejected) fail("continuity fixture accepted a mismatched migration anchor");
    console.log("public BFT dependency continuity self-test passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
} else {
  const [root, commit, release, heightValue, hash, maxLagValue, output] = args;
  if (!root || !commit || !release || !heightValue || !hash || !maxLagValue || !output) fail("evidence root, identity, migration anchor, max lag, and output are required");
  const result = validate(path.resolve(root), commit, release, Number(heightValue), hash.toLowerCase().replace(/^0x/, ""), Number(maxLagValue));
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(`public BFT dependency continuity passed: height=${result.heightAfter} indexed=${result.indexedHeight} lag=${result.indexLag}`);
}
