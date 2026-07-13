#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRemoteSmokeDispatcher, parseRemoteSmokeTransport, remoteSocketTarget } from "./lib/remote-smoke-transport.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidencePath = process.env.YNX_REMOTE_EVIDENCE_PATH || path.join(repoRoot, "tmp/remote-smoke-test/evidence.json");
const releaseManifestEvidencePath = process.env.YNX_RELEASE_MANIFEST_EVIDENCE_PATH || path.join(repoRoot, "tmp/verify-testnet/release-manifest-evidence.json");
const timeoutMs = Number(process.env.YNX_REMOTE_TIMEOUT_MS || 12000);
const growthDelayMs = Number(process.env.YNX_REMOTE_BLOCK_GROWTH_DELAY_MS || 2500);
const remoteTransport = parseRemoteSmokeTransport();
const remoteDispatcher = createRemoteSmokeDispatcher(remoteTransport, timeoutMs);
const currentGitCommit = readGitCommit();
const defaultShortCommit = currentGitCommit === "unknown" ? "unknown" : currentGitCommit.slice(0, 12);
const expectedReleaseCommit = process.env.YNX_EXPECTED_RELEASE_COMMIT || defaultShortCommit;
const expected = {
  cosmosChainId: process.env.YNX_COSMOS_CHAIN_ID || "ynx_6423-1",
  evmChainId: Number(process.env.YNX_EVM_CHAIN_ID || 6423),
  evmChainIdHex: String(process.env.YNX_EVM_CHAIN_ID_HEX || "0x1917").toLowerCase(),
  nativeSymbol: process.env.YNX_NATIVE_COIN_SYMBOL || "YNXT",
  minValidators: Number(process.env.YNX_EXPECTED_VALIDATOR_COUNT || 3),
  releaseCommit: expectedReleaseCommit,
  releaseName: process.env.YNX_EXPECTED_RELEASE_NAME || `ynx-chain-${expectedReleaseCommit}`,
};
const endpoints = {
  rpc: trimSlash(process.env.PUBLIC_RPC_URL || "https://rpc.ynxweb4.com"),
  evm: trimSlash(process.env.PUBLIC_EVM_RPC_URL || "https://evm.ynxweb4.com"),
  rest: trimSlash(process.env.PUBLIC_REST_URL || "https://rest.ynxweb4.com"),
  grpcHost: String(process.env.PUBLIC_GRPC_HOST || "grpc.ynxweb4.com"),
  faucet: trimSlash(process.env.PUBLIC_FAUCET_URL || "https://faucet.ynxweb4.com"),
  indexer: trimSlash(process.env.PUBLIC_INDEXER_URL || "https://indexer.ynxweb4.com"),
  explorer: trimSlash(process.env.PUBLIC_EXPLORER_URL || "https://explorer.ynxweb4.com"),
  ai: trimSlash(process.env.PUBLIC_AI_URL || "https://ai.ynxweb4.com"),
  pay: trimSlash(process.env.PUBLIC_PAY_URL || "https://pay.ynxweb4.com"),
  trust: trimSlash(process.env.PUBLIC_TRUST_URL || "https://trust.ynxweb4.com"),
  resource: trimSlash(process.env.PUBLIC_RESOURCE_URL || "https://resource.ynxweb4.com"),
  web4: trimSlash(process.env.PUBLIC_WEB4_URL || "https://web4.ynxweb4.com"),
};
const sampleAddress = process.env.YNX_REMOTE_SMOKE_ADDRESS || `ynx_remote_smoke_${Date.now()}`;
const aiGatewayAPIKey = String(process.env.YNX_AI_GATEWAY_API_KEY || "");
const payGatewayAPIKey = String(process.env.YNX_PAY_API_KEY || "");
const trustGatewayAPIKey = String(process.env.YNX_TRUST_API_KEY || "");
const trustHeaders = trustGatewayAPIKey ? { "x-ynx-trust-key": trustGatewayAPIKey } : {};
const resourceGatewayAPIKey = String(process.env.YNX_RESOURCE_API_KEY || "");
const resourceHeaders = resourceGatewayAPIKey ? { "x-ynx-resource-key": resourceGatewayAPIKey } : {};

const checks = [];
const evidence = {
  proofType: "remote-public-testnet-smoke",
  generatedAt: new Date().toISOString(),
  gitCommit: currentGitCommit,
  expected,
  endpoints,
  releaseManifestEvidencePath,
  sampleAddress,
  transport: remoteTransport ? {
    mode: "explicit-connect-override",
    route: remoteTransport.route,
    logicalTlsNamesPreserved: true,
    operatorControlled: true,
    independentThirdPartyProof: false,
  } : {
    mode: "direct",
    operatorControlled: true,
    independentThirdPartyProof: false,
  },
  observed: {},
  checks,
};

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function readGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function clip(value, max = 1600) {
  const out = typeof value === "string" ? value : JSON.stringify(value);
  return out.length > max ? `${out.slice(0, max)}...` : out;
}

function record(name, ok, detail, observed) {
  checks.push({ name, ok, detail, observed });
  const status = ok ? "ok" : "FAIL";
  console.log(`${status} ${name}: ${detail}`);
}

async function request(name, url, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body !== "string") {
    body = JSON.stringify(body);
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
      ...(remoteDispatcher ? { dispatcher: remoteDispatcher } : {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Keep the raw body for diagnostics.
    }
    const requestId = res.headers.get("x-request-id") || "";
    evidence.observed[name] = { url, status: res.status, ok: res.ok, requestId, body: json ?? clip(text) };
    if (!res.ok) {
      return { ok: false, status: res.status, text, json, requestId, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, text, json, requestId };
  } catch (err) {
    evidence.observed[name] = { url, ok: false, error: err.message };
    return { ok: false, status: 0, text: "", json: null, error: err.message };
  }
}

async function getJson(name, url, headers = {}) {
  let res = await request(name, url, { headers });
  if (!res.ok && res.status === 0) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    res = await request(name, url, { headers });
  }
  if (!res.ok) {
    record(name, false, res.error || "request failed", evidence.observed[name]);
    return null;
  }
  if (!res.json) {
    record(name, false, "response is not JSON", evidence.observed[name]);
    return null;
  }
  record(name, true, `HTTP ${res.status}`, evidence.observed[name]);
  return res.json;
}

async function getJsonEventually(name, url, headers = {}, attempts = 8, delayMs = 1000) {
  let res = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    res = await request(name, url, { headers });
    if (res.ok && res.json) {
      record(name, true, `HTTP ${res.status} after ${attempt} attempt(s)`, evidence.observed[name]);
      return res.json;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  record(name, false, res?.error || (res?.ok ? "response is not JSON" : "request failed"), evidence.observed[name]);
  return null;
}

async function postJson(name, url, body, headers = {}) {
  const res = await request(name, url, { method: "POST", body, headers });
  if (!res.ok) {
    record(name, false, res.error || "request failed", evidence.observed[name]);
    return null;
  }
  if (!res.json) {
    record(name, false, "response is not JSON", evidence.observed[name]);
    return null;
  }
  record(name, true, `HTTP ${res.status}`, evidence.observed[name]);
  return res.json;
}

async function postJsonExpectError(name, url, body, expectedStatus, messagePattern, headers = {}) {
  const res = await request(name, url, { method: "POST", body, headers });
  const message = String(res.json?.error || res.json?.message || res.text || "");
  const ok = res.status === expectedStatus && messagePattern.test(message);
  record(
    name,
    ok,
    ok ? `HTTP ${res.status} rejected conflicting input` : `expected HTTP ${expectedStatus} matching ${messagePattern}, got HTTP ${res.status}: ${clip(message)}`,
    evidence.observed[name],
  );
  return ok;
}

function chainIdOf(json) {
  return json?.chainId ?? json?.chain_id ?? json?.network?.chainId ?? json?.network?.chain_id ??
    json?.status?.chainId ?? json?.result?.node_info?.network ?? null;
}

function nativeSymbolOf(json) {
  return json?.nativeSymbol ?? json?.native_symbol ?? json?.network?.nativeCurrencySymbol ??
    json?.network?.nativeSymbol ?? json?.denom ?? json?.native?.symbol ?? null;
}

function heightOf(json) {
  const raw = json?.height ?? json?.latestBlockHeight ?? json?.latest_block_height ??
    json?.latestBlock?.height ?? json?.result?.sync_info?.latest_block_height ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function txHashOf(json) {
  return json?.transaction?.hash ?? json?.txHash ?? json?.tx_hash ?? json?.hash ?? null;
}

function chainMatches(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).toLowerCase();
  if (text === expected.cosmosChainId.toLowerCase()) return true;
  if (text === expected.evmChainIdHex) return true;
  if (Number(text) === expected.evmChainId) return true;
  return false;
}

function checkChain(name, json) {
  const chainId = chainIdOf(json);
  const ok = chainMatches(chainId);
  record(name, ok, ok ? `chain id ${chainId}` : `expected ${expected.cosmosChainId} or ${expected.evmChainId}, got ${chainId}`, { chainId });
  return ok;
}

function checkNative(name, json) {
  const native = nativeSymbolOf(json);
  const ok = native === null || native === expected.nativeSymbol;
  record(name, ok, ok ? `native ${native ?? "not reported"}` : `expected ${expected.nativeSymbol}, got ${native}`, { native });
  return ok;
}

function checkTxHash(name, json) {
  const hash = txHashOf(json);
  const ok = typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash);
  record(name, ok, ok ? `tx ${hash}` : `missing valid tx hash: ${hash}`, { hash });
  return ok;
}

function checkRequestValidityRules(json) {
  const rules = Array.isArray(json?.rules) ? json.rules : [];
  const ids = new Set(rules.map((rule) => rule?.id).filter(Boolean));
  const required = [
    "protect-private-secrets",
    "no-signature-bypass",
    "preserve-audit-transparency",
    "no-evidence-free-risk",
    "no-ai-punishment",
    "targeted-scope-required",
    "native-ynxt-no-direct-freeze",
    "asset-type-boundary",
    "evidence-required",
    "governance-review-user-rights",
    "user-notice-required",
  ];
  const missing = required.filter((id) => !ids.has(id));
  const ok = missing.length === 0;
  record(
    "governance.requestValidityRules.required",
    ok,
    ok ? `${required.length} required rule IDs present` : `missing rule IDs: ${missing.join(", ")}`,
    { ruleCount: rules.length, missing }
  );
  return ok;
}

function checkGovernanceRequest(name, json, classification, status, ruleId) {
  const observedClassification = json?.classification ?? "";
  const observedStatus = json?.status ?? "";
  const ruleIds = Array.isArray(json?.ruleIds) ? json.ruleIds : [];
  const ok = observedClassification === classification && observedStatus === status && (!ruleId || ruleIds.includes(ruleId));
  record(
    name,
    ok,
    ok ? `${classification}/${status}` : `expected ${classification}/${status}/${ruleId || "any-rule"}, got ${observedClassification}/${observedStatus}/${ruleIds.join("|")}`,
    { id: json?.id, classification: observedClassification, status: observedStatus, ruleIds }
  );
  return ok;
}

function checkReadableID(name, json, expectedID) {
  const ok = typeof expectedID === "string" && expectedID.length > 0 && json?.id === expectedID;
  record(name, ok, ok ? `id ${expectedID}` : `expected id ${expectedID}, got ${json?.id}`, { expectedID, id: json?.id });
  return ok;
}

function checkAppeal(name, json, status) {
  const ok = json?.status === status && typeof json?.id === "string" && json.id.length > 0 && typeof json?.transparencyEntryId === "string" && json.transparencyEntryId.length > 0;
  record(
    name,
    ok,
    ok ? `${status} appeal ${json.id}` : `expected ${status} appeal with transparency entry, got ${clip(json)}`,
    { id: json?.id, status: json?.status, transparencyEntryId: json?.transparencyEntryId }
  );
  return ok;
}

function checkTrackingReview(name, json, classification, status, ruleId) {
  const ruleIds = Array.isArray(json?.ruleIds) ? json.ruleIds : [];
  const ok = json?.classification === classification && json?.status === status && (!ruleId || ruleIds.includes(ruleId));
  record(
    name,
    ok,
    ok ? `${classification}/${status}` : `expected ${classification}/${status}/${ruleId || "any-rule"}, got ${json?.classification}/${json?.status}/${ruleIds.join("|")}`,
    { id: json?.id, classification: json?.classification, status: json?.status, ruleIds, appealPath: json?.appealPath }
  );
  return ok;
}

function checkTransparencyReport(name, json, minimums = {}) {
  const entryCount = Number(json?.entryCount);
  const rejectedCount = Number(json?.rejectedCount);
  const appealCount = Number(json?.appealCount);
  const reviewCount = Number(json?.reviewCount);
  const ok = Number.isFinite(entryCount) &&
    entryCount >= Number(minimums.entryCount ?? 0) &&
    (!("rejectedCount" in minimums) || (Number.isFinite(rejectedCount) && rejectedCount >= minimums.rejectedCount)) &&
    (!("appealCount" in minimums) || (Number.isFinite(appealCount) && appealCount >= minimums.appealCount)) &&
    (!("reviewCount" in minimums) || (Number.isFinite(reviewCount) && reviewCount >= minimums.reviewCount)) &&
    Array.isArray(json?.entries);
  record(
    name,
    ok,
    ok ? `entries=${entryCount} rejected=${rejectedCount} appeals=${appealCount} reviews=${reviewCount}` : `unexpected transparency report ${clip(json)}`,
    { entryCount, rejectedCount, appealCount, reviewCount }
  );
  return ok;
}

function checkValidators(json) {
  const validators = Array.isArray(json?.validators) ? json.validators : [];
  const active = validators.filter((validator) => validator?.active !== false);
  const ok = active.length >= expected.minValidators;
  record(
    "rpc.validators.count",
    ok,
    ok ? `${active.length} active validators` : `expected at least ${expected.minValidators} active validators, got ${active.length}`,
    { count: active.length, validators }
  );
  const hasAddresses = active.every((validator) => typeof validator.address === "string" && validator.address.length > 0);
  record("rpc.validators.addresses", hasAddresses, hasAddresses ? "all validators have addresses" : "one or more validators lack address", { validators });
  const hasMonikers = active.length > 0 && active.every((validator) => typeof validator.moniker === "string" && validator.moniker.length > 0);
  record("rpc.validators.monikers", hasMonikers, hasMonikers ? "all validators have monikers" : "one or more validators lack moniker", { validators });
  const readyPeers = active.filter((validator) => validator.peerReady === true && typeof validator.peerStatus === "string" && validator.peerStatus.length > 0);
  const peerReadinessOk = readyPeers.length >= expected.minValidators;
  record(
    "rpc.validators.peerReadiness",
    peerReadinessOk,
    peerReadinessOk ? `${readyPeers.length} validators have peer readiness evidence` : `expected at least ${expected.minValidators} validators with peer readiness evidence, got ${readyPeers.length}`,
    { readyPeerCount: readyPeers.length, validators }
  );
  return ok && hasAddresses && hasMonikers && peerReadinessOk;
}

function checkValidatorPeers(json) {
  const peers = Array.isArray(json?.peers) ? json.peers : [];
  const expectedPeers = peers.filter((peer) => peer?.expected === true);
  const observedPeers = peers.filter((peer) => peer?.observed === true);
  const expectedOk = expectedPeers.length >= expected.minValidators;
  const observedOk = observedPeers.length >= expected.minValidators;
  record(
    "rpc.validators.peers.expected",
    expectedOk,
    expectedOk ? `${expectedPeers.length} expected peers` : `expected at least ${expected.minValidators} bootstrap peers, got ${expectedPeers.length}`,
    { expectedPeerCount: expectedPeers.length, peers }
  );
  record(
    "rpc.validators.peers.observed",
    observedOk,
    observedOk ? `${observedPeers.length} observed peers` : `expected at least ${expected.minValidators} observed peers, got ${observedPeers.length}`,
    { observedPeerCount: observedPeers.length, peers }
  );
  return expectedOk && observedOk;
}

function checkValidatorPeerSync(json) {
  const syncs = Array.isArray(json?.syncs) ? json.syncs : [];
  const healthy = syncs.filter((sync) => ["synced", "lagging"].includes(sync?.status) && typeof sync?.source === "string" && typeof sync?.target === "string" && sync.source !== sync.target && typeof sync?.updatedAt === "string");
  const ok = healthy.length >= Math.max(1, expected.minValidators - 1);
  record(
    "rpc.validators.peerSync",
    ok,
    ok ? `${healthy.length} validator peer height observations` : `expected validator peer height observations, got ${healthy.length}`,
    { syncCount: healthy.length, syncs }
  );
  return ok;
}

function checkNodeIdentity(json) {
  const freshness = json?.peerSyncFreshness ?? {};
  const targetCount = Number(json?.peerSyncTargetCount ?? 0);
  const expectedCount = Number(json?.expectedValidatorCount ?? 0);
  const configured = json?.configured === true && typeof json?.validatorAddress === "string" && json.validatorAddress.length > 0;
  const authoritativeProducer = json?.blockProductionEnabled === true && json?.replicationMode === "authoritative_producer" && !json?.replicationSource;
  const targetCountOk = targetCount >= Math.max(1, expected.minValidators - 1);
  const expectedCountOk = expectedCount >= expected.minValidators;
  const freshnessOk = ["synced", "fresh_with_lag"].includes(freshness?.status) &&
    Number(freshness?.missing ?? 0) === 0 &&
    Number(freshness?.stale ?? 0) === 0 &&
    Number(freshness?.fresh ?? 0) >= Math.max(1, expected.minValidators - 1);
  record(
    "rpc.nodeIdentity.configured",
    configured,
    configured ? `validator ${json.validatorAddress}` : `missing configured validator identity: ${clip(json)}`,
    { validatorAddress: json?.validatorAddress, configured: json?.configured }
  );
  record(
    "rpc.nodeIdentity.authoritativeProducer",
    authoritativeProducer,
    authoritativeProducer ? "public RPC is served by the configured authoritative producer" : `authoritative producer identity missing: ${clip(json)}`,
    { blockProductionEnabled: json?.blockProductionEnabled, replicationMode: json?.replicationMode, replicationSource: json?.replicationSource }
  );
  record(
    "rpc.nodeIdentity.expectedValidatorCount",
    expectedCountOk,
    expectedCountOk ? `expected validators ${expectedCount}` : `expected at least ${expected.minValidators} validators, got ${expectedCount}`,
    { expectedValidatorCount: expectedCount }
  );
  record(
    "rpc.nodeIdentity.peerSyncTargetCount",
    targetCountOk,
    targetCountOk ? `peer sync targets ${targetCount}` : `expected peer sync targets, got ${targetCount}`,
    { peerSyncTargetCount: targetCount, peerSyncTargetAddresses: json?.peerSyncTargetAddresses }
  );
  record(
    "rpc.nodeIdentity.peerSyncFreshness",
    freshnessOk,
    freshnessOk ? `fresh peer height observations (${freshness.status})` : `expected fresh peer height observations, got ${clip(freshness)}`,
    freshness
  );
  return configured && authoritativeProducer && expectedCountOk && targetCountOk && freshnessOk;
}

function checkBuildIdentity(name, json) {
  const build = json?.build ?? {};
  const commit = String(build?.commit ?? "");
  const release = String(build?.release ?? "");
  const buildTime = String(build?.buildTime ?? "");
  const commitOk = commit === expected.releaseCommit;
  const releaseOk = release === expected.releaseName;
  const buildTimeOk = buildTime.length > 0 && buildTime !== "unknown";
  record(
    `${name}.buildCommit`,
    commitOk,
    commitOk ? `commit ${commit}` : `expected ${expected.releaseCommit}, got ${commit || "missing"}`,
    { commit, expected: expected.releaseCommit }
  );
  record(
    `${name}.buildRelease`,
    releaseOk,
    releaseOk ? `release ${release}` : `expected ${expected.releaseName}, got ${release || "missing"}`,
    { release, expected: expected.releaseName }
  );
  record(
    `${name}.buildTime`,
    buildTimeOk,
    buildTimeOk ? `buildTime ${buildTime}` : `missing injected build time, got ${buildTime || "missing"}`,
    { buildTime }
  );
  return commitOk && releaseOk && buildTimeOk;
}

function checkReleaseManifestEvidence() {
  let manifestEvidence = null;
  try {
    manifestEvidence = JSON.parse(fs.readFileSync(releaseManifestEvidencePath, "utf8"));
  } catch (err) {
    evidence.observed["release.manifest.evidence"] = { path: releaseManifestEvidencePath, error: err.message };
    record("release.manifest.evidence.present", false, `missing release manifest evidence: ${releaseManifestEvidencePath}`, evidence.observed["release.manifest.evidence"]);
    record("release.manifest.schema", false, "missing release manifest evidence schema", {});
    record("release.manifest.commit", false, "missing release manifest evidence commit", {});
    record("release.manifest.release", false, "missing release manifest evidence release", {});
    record("release.manifest.chaindChecksum", false, "missing release manifest checksum evidence", {});
    return false;
  }
  evidence.observed["release.manifest.evidence"] = { path: releaseManifestEvidencePath, body: manifestEvidence };
  const schemaOk = manifestEvidence?.schema === "ynx-release-manifest-evidence/v1";
  const statusOk = manifestEvidence?.status === "passed";
  const commitOk = manifestEvidence?.expected?.commit === expected.releaseCommit;
  const releaseOk = manifestEvidence?.expected?.release === expected.releaseName;
  const nodes = Array.isArray(manifestEvidence?.nodes) ? manifestEvidence.nodes : [];
  const sha256Pattern = /^[0-9a-f]{64}$/;
  const checksumOk = nodes.length >= expected.minValidators && nodes.every((node) =>
    node?.checks?.["releaseManifest.chaindChecksum"] === true &&
    sha256Pattern.test(String(node?.observed?.chaindSha256 || "")) &&
    sha256Pattern.test(String(node?.observed?.manifestSha256 || ""))
  );
  record("release.manifest.evidence.present", statusOk, statusOk ? "release manifest evidence passed" : `release manifest evidence status ${manifestEvidence?.status || "missing"}`, { path: releaseManifestEvidencePath, status: manifestEvidence?.status });
  record("release.manifest.schema", schemaOk, schemaOk ? "release manifest evidence schema ok" : `unexpected schema ${manifestEvidence?.schema || "missing"}`, { schema: manifestEvidence?.schema });
  record("release.manifest.commit", commitOk, commitOk ? `manifest commit ${expected.releaseCommit}` : `expected ${expected.releaseCommit}, got ${manifestEvidence?.expected?.commit || "missing"}`, manifestEvidence?.expected || {});
  record("release.manifest.release", releaseOk, releaseOk ? `manifest release ${expected.releaseName}` : `expected ${expected.releaseName}, got ${manifestEvidence?.expected?.release || "missing"}`, manifestEvidence?.expected || {});
  record("release.manifest.chaindChecksum", checksumOk, checksumOk ? `${nodes.length} node checksum proofs with manifest and binary hashes` : "missing per-node ynx-chaind checksum or hash proof", { nodeCount: nodes.length, failedRoles: manifestEvidence?.failedRoles, missingRoles: manifestEvidence?.missingRoles });
  return schemaOk && statusOk && commitOk && releaseOk && checksumOk;
}

function checkEvmResult(name, json, expectedValue) {
  const result = String(json?.result ?? "").toLowerCase();
  const ok = result === expectedValue.toLowerCase();
  record(name, ok, ok ? `result ${result}` : `expected ${expectedValue}, got ${result}`, { result });
  return ok;
}

function checkHexQuantity(name, json) {
  const result = String(json?.result ?? "");
  const ok = /^0x[0-9a-fA-F]+$/.test(result) && Number.parseInt(result, 16) > 0;
  record(name, ok, ok ? `result ${result}` : `invalid block quantity ${result}`, { result });
  return ok;
}

function checkTruthfulServiceHealth(name, json) {
  const okField = json?.ok;
  const oldChain = String(chainIdOf(json) ?? "").toLowerCase() === "ynx_9102-1";
  const ok = okField !== false && !oldChain;
  record(name, ok, ok ? "service health is not old-chain proof" : `old-chain or unhealthy response (${clip(json)})`, json);
  return ok;
}

function checkWeb4ChainBinding(json) {
  const binding = json?.chain_binding;
  const observed = binding?.observed;
  const ok = binding?.required === true &&
    binding?.verified === true &&
    binding?.status === "verified" &&
    binding?.expected_chain_id === "ynx_6423-1" &&
    binding?.expected_numeric_chain_id === 6423 &&
    observed?.chain_id === 6423 &&
    observed?.native_symbol === "YNXT" &&
    Number.isSafeInteger(observed?.height) && observed.height > 0 &&
    observed?.public_network === true &&
    /^[0-9a-f]{12}$/.test(String(observed?.build_commit || "")) &&
    observed?.build_release === `ynx-chain-${observed?.build_commit}` &&
    json?.truthful_status === "current-chain-rpc-bound";
  record(
    "web4.health.chainBinding",
    ok,
    ok ? `Web4 Hub is bound to live chain height ${observed.height} release ${observed.build_release}` : `Web4 Hub lacks verified current-chain binding: ${clip(binding)}`,
    binding || {},
  );
  return ok;
}

function checkAIActionProposal(json) {
  const ok = typeof json?.id === "string" && json.id.length > 0 &&
    json?.status === "pending_approval" &&
    json?.sensitive === true &&
    json?.requiresApproval === true &&
    json?.executable === false &&
    typeof json?.auditHash === "string" && json.auditHash.length > 0 &&
    typeof json?.transparencyEntryId === "string" && json.transparencyEntryId.length > 0;
  record(
    "ai.action.proposal.audit",
    ok,
    ok ? `sensitive action ${json.id} pending approval` : `AI action proposal did not expose required pending/audit state: ${clip(json)}`,
    {
      id: json?.id,
      status: json?.status,
      sensitive: json?.sensitive,
      requiresApproval: json?.requiresApproval,
      executable: json?.executable,
      auditHash: json?.auditHash,
      transparencyEntryId: json?.transparencyEntryId,
    }
  );
  return ok;
}

function checkAIPermission(json) {
  const ok = typeof json?.id === "string" && json.id.length > 0 &&
    json?.status === "active" &&
    typeof json?.auditHash === "string" && json.auditHash.length > 0 &&
    typeof json?.expiresAt === "string" && json.expiresAt.length > 0;
  record(
    "ai.permission.active",
    ok,
    ok ? `active permission ${json.id}` : `AI permission did not expose required active/audit state: ${clip(json)}`,
    { id: json?.id, status: json?.status, auditHash: json?.auditHash, expiresAt: json?.expiresAt }
  );
  return ok;
}

function checkAIActionApproval(json, expectedPermissionID) {
  const ok = json?.status === "approved" &&
    json?.executable === true &&
    json?.permissionId === expectedPermissionID &&
    typeof json?.approvedAt === "string" && json.approvedAt.length > 0 &&
    typeof json?.approvedBy === "string" && json.approvedBy.length > 0 &&
    typeof json?.auditHash === "string" && json.auditHash.length > 0 &&
    typeof json?.transparencyEntryId === "string" && json.transparencyEntryId.length > 0;
  record(
    "ai.action.approve.permissionGate",
    ok,
    ok ? "sensitive action became executable only after matching permission approval" : `AI approval did not expose required permission-gated state: ${clip(json)}`,
    {
      id: json?.id,
      status: json?.status,
      executable: json?.executable,
      permissionId: json?.permissionId,
      expectedPermissionID,
      approvedAt: json?.approvedAt,
      approvedBy: json?.approvedBy,
      auditHash: json?.auditHash,
      transparencyEntryId: json?.transparencyEntryId,
    }
  );
  return ok;
}

function checkAIActionLookup(json, expectedID, expectedPermissionID) {
  const ok = json?.id === expectedID &&
    json?.status === "approved" &&
    json?.executable === true &&
    json?.permissionId === expectedPermissionID &&
    typeof json?.auditHash === "string" && json.auditHash.length > 0;
  record(
    "ai.action.lookup.audit",
    ok,
    ok ? `AI action lookup matched ${expectedID}` : `AI action lookup missing approved/audit state: ${clip(json)}`,
    { expectedID, id: json?.id, status: json?.status, executable: json?.executable, permissionId: json?.permissionId, auditHash: json?.auditHash }
  );
  return ok;
}

function checkAIActionList(json, expectedID) {
  const actions = Array.isArray(json?.actions) ? json.actions : [];
  const match = actions.find((action) => action?.id === expectedID);
  const ok = Boolean(match) && typeof match?.auditHash === "string" && match.auditHash.length > 0;
  record(
    "ai.action.list.session",
    ok,
    ok ? `AI action list includes ${expectedID}` : `AI action list missing expected audited action ${expectedID}`,
    { expectedID, actionCount: actions.length, match }
  );
  return ok;
}

function parseGrpcTarget(value) {
  const raw = String(value || "").trim();
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `grpcs://${raw}`;
  const parsed = new URL(withScheme);
  const port = Number(parsed.port || (parsed.protocol === "grpc:" ? 80 : 443));
  return {
    host: parsed.hostname,
    port,
    tls: parsed.protocol !== "grpc:",
    raw,
  };
}

async function checkGrpcEndpoint() {
  let target;
  try {
    target = parseGrpcTarget(endpoints.grpcHost);
  } catch (err) {
    evidence.observed["grpc.endpoint"] = { target: endpoints.grpcHost, error: err.message };
    record("grpc.endpoint", false, `invalid gRPC target: ${err.message}`, evidence.observed["grpc.endpoint"]);
    return false;
  }
  const observed = {
    target: target.raw,
    host: target.host,
    port: target.port,
    tls: target.tls,
  };

  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    const done = (ok, detail, extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket && !socket.destroyed) socket.destroy();
      evidence.observed["grpc.endpoint"] = { ...observed, ...extra };
      record("grpc.endpoint", ok, detail, evidence.observed["grpc.endpoint"]);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false, `timeout after ${timeoutMs}ms`), timeoutMs);
    const onError = (err) => done(false, err.message);

    if (target.tls) {
      const connectTarget = remoteSocketTarget(target.host, target.port, remoteTransport);
      socket = tls.connect({
        host: connectTarget.host,
        port: connectTarget.port,
        servername: target.host,
        ALPNProtocols: ["h2", "http/1.1"],
      }, () => {
        const alpn = socket.alpnProtocol || "";
        const ok = socket.authorized && alpn === "h2";
        const detail = ok
          ? `TLS gRPC reachable with ALPN ${alpn}`
          : `expected valid TLS with ALPN h2, got authorized=${socket.authorized} alpn=${alpn || "none"}`;
        socket.end();
        done(ok, detail, { authorized: socket.authorized, authorizationError: socket.authorizationError || "", alpn });
      });
      socket.setTimeout(timeoutMs, () => done(false, `timeout after ${timeoutMs}ms`));
      socket.once("error", onError);
    } else {
      const connectTarget = remoteSocketTarget(target.host, target.port, remoteTransport);
      socket = net.connect({ host: connectTarget.host, port: connectTarget.port }, () => {
        socket.end();
        done(true, "plaintext gRPC TCP port reachable");
      });
      socket.setTimeout(timeoutMs, () => done(false, `timeout after ${timeoutMs}ms`));
      socket.once("error", onError);
    }
  });
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });

  const rpcStatus1 = await getJson("rpc.status.initial", `${endpoints.rpc}/status`);
  const releaseManifestOk = checkReleaseManifestEvidence();
  const rpcChainOk = rpcStatus1 ? checkChain("rpc.status.chain", rpcStatus1) : false;
  const rpcBuildOk = rpcStatus1 ? checkBuildIdentity("rpc.status", rpcStatus1) : false;
  const height1 = rpcStatus1 ? heightOf(rpcStatus1) : null;
  record("rpc.status.height.initial", height1 !== null, height1 !== null ? `height ${height1}` : "missing latest height", { height: height1 });

  await new Promise((resolve) => setTimeout(resolve, growthDelayMs));
  const rpcStatus2 = await getJson("rpc.status.second", `${endpoints.rpc}/status`);
  const height2 = rpcStatus2 ? heightOf(rpcStatus2) : null;
  const grew = height1 !== null && height2 !== null && height2 > height1;
  record("rpc.status.height.growth", grew, grew ? `${height1} -> ${height2}` : `height did not grow (${height1} -> ${height2})`, { height1, height2 });

  const validators = await getJson("rpc.validators", `${endpoints.rpc}/validators`);
  const validatorsOk = validators ? checkValidators(validators) : false;
  const nodeIdentity = await getJson("rpc.nodeIdentity", `${endpoints.rpc}/node/identity`);
  const nodeIdentityOk = nodeIdentity ? checkNodeIdentity(nodeIdentity) : false;
  const nodeIdentityBuildOk = nodeIdentity ? checkBuildIdentity("rpc.nodeIdentity", nodeIdentity) : false;
  const validatorPeers = await getJson("rpc.validators.peers", `${endpoints.rpc}/validators/peers`);
  const validatorPeersOk = validatorPeers ? checkValidatorPeers(validatorPeers) : false;
  const validatorPeerSync = await getJson("rpc.validators.peerSync", `${endpoints.rpc}/validators/peer-sync`);
  const validatorPeerSyncOk = validatorPeerSync ? checkValidatorPeerSync(validatorPeerSync) : false;

  const evmChain = await postJson("evm.eth_chainId", endpoints.evm, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
  const evmChainOk = evmChain ? checkEvmResult("evm.eth_chainId.result", evmChain, expected.evmChainIdHex) : false;
  const evmBlock = await postJson("evm.eth_blockNumber", endpoints.evm, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
  const evmBlockOk = evmBlock ? checkHexQuantity("evm.eth_blockNumber.result", evmBlock) : false;

  const restStatus = await getJson("rest.status", `${endpoints.rest}/status`);
  const restChainOk = restStatus ? checkChain("rest.status.chain", restStatus) : false;
  const grpcOk = await checkGrpcEndpoint();

  const requestValidityRules = await getJson("governance.requestValidityRules", `${endpoints.trust}/governance/request-validity-rules`, trustHeaders);
  const requestValidityRulesOk = requestValidityRules ? checkRequestValidityRules(requestValidityRules) : false;
  const transparencyInitial = await getJson("governance.transparency.initial", `${endpoints.trust}/governance/transparency`, trustHeaders);
  const transparencyInitialOk = transparencyInitial ? checkTransparencyReport("governance.transparency.initial.report", transparencyInitial) : false;

  const faucetHealth = await getJson("faucet.health", `${endpoints.faucet}/health`);
  const faucetChainOk = faucetHealth ? checkChain("faucet.health.chain", faucetHealth) : false;
  const faucetNativeOk = faucetHealth ? checkNative("faucet.health.native", faucetHealth) : false;

  const indexerOverview = await getJson("indexer.overview", `${endpoints.indexer}/ynx/overview`);
  if (indexerOverview) {
    checkChain("indexer.overview.chain", indexerOverview);
    checkNative("indexer.overview.native", indexerOverview);
  }

  const explorerHealth = await getJson("explorer.health", `${endpoints.explorer}/health`);
  if (explorerHealth) checkTruthfulServiceHealth("explorer.health.truthful", explorerHealth);
  const explorerSummary = await getJson("explorer.summary", `${endpoints.explorer}/api/summary`);
  if (explorerSummary) {
    checkChain("explorer.summary.chain", explorerSummary);
    checkNative("explorer.summary.native", explorerSummary);
    const count = Number(explorerSummary.validatorCount ?? 0);
    record("explorer.summary.validators", count >= expected.minValidators, `validatorCount ${count}`, { validatorCount: count });
  }

  let aiHealthOk = false;
  const aiHealth = await getJson("ai.health", `${endpoints.ai}/health`);
  if (aiHealth) {
    const truthful = checkTruthfulServiceHealth("ai.health.truthful", aiHealth);
    const chain = checkChain("ai.health.chain", aiHealth);
    const serviceOk = aiHealth?.service === "ynx-ai-gatewayd" && aiHealth?.providerConfigured === true && aiHealth?.upstreamOk === true;
    record("ai.health.gateway", serviceOk, serviceOk ? "independent provider-backed AI Gateway is healthy" : `AI Gateway service/provider/upstream evidence missing: ${clip(aiHealth)}`, {
      service: aiHealth?.service,
      providerConfigured: aiHealth?.providerConfigured,
      upstreamOk: aiHealth?.upstreamOk,
      model: aiHealth?.model,
    });
    const build = checkBuildIdentity("ai.health", aiHealth);
    aiHealthOk = truthful && chain && serviceOk && build;
  }
  let payHealthOk = false;
  const payHealth = await getJson("pay.health", `${endpoints.pay}/health`);
  if (payHealth) {
    const truthful = checkTruthfulServiceHealth("pay.health.truthful", payHealth);
    const chain = checkChain("pay.health.chain", payHealth);
    const serviceOk = payHealth?.service === "ynx-payd" && payHealth?.merchantConfigured === true && payHealth?.signingConfigured === true && payHealth?.upstreamOk === true;
    record("pay.health.gateway", serviceOk, serviceOk ? "independent authenticated Pay Gateway is healthy" : `Pay Gateway service/signing/upstream evidence missing: ${clip(payHealth)}`, {
      service: payHealth?.service,
      signingConfigured: payHealth?.signingConfigured,
      upstreamOk: payHealth?.upstreamOk,
      merchantConfigured: payHealth?.merchantConfigured,
    });
    const build = checkBuildIdentity("pay.health", payHealth);
    payHealthOk = truthful && chain && serviceOk && build;
  }
  record("pay.auth.configured", Boolean(payGatewayAPIKey), payGatewayAPIKey ? "secure Pay API key is available to remote proof" : "YNX_PAY_API_KEY is missing from the secure remote proof environment", {});
  let trustHealthOk = false;
  const trustHealth = await getJson("trust.health", `${endpoints.trust}/health`);
  if (trustHealth) {
    const truthful = checkTruthfulServiceHealth("trust.health.truthful", trustHealth);
    const chain = checkChain("trust.health.chain", trustHealth);
    const serviceOk = trustHealth?.service === "ynx-trustd" && trustHealth?.upstreamOk === true && trustHealth?.bodyLimitBytes === 1048576 && trustHealth?.exportLimitBytes === 2097152;
    record("trust.health.gateway", serviceOk, serviceOk ? "independent authenticated Trust and Chain Law Gateway is healthy" : `Trust Gateway service/upstream/limit evidence missing: ${clip(trustHealth)}`, {
      service: trustHealth?.service,
      upstreamOk: trustHealth?.upstreamOk,
      bodyLimitBytes: trustHealth?.bodyLimitBytes,
      exportLimitBytes: trustHealth?.exportLimitBytes,
    });
    const build = checkBuildIdentity("trust.health", trustHealth);
    trustHealthOk = truthful && chain && serviceOk && build;
  }
  record("trust.auth.configured", Boolean(trustGatewayAPIKey), trustGatewayAPIKey ? "secure Trust API key is available to remote proof" : "YNX_TRUST_API_KEY is missing from the secure remote proof environment", {});
  let resourceHealthOk = false;
  const resourceHealth = await getJson("resource.health", `${endpoints.resource}/health`);
  if (resourceHealth) {
    const truthful = checkTruthfulServiceHealth("resource.health.truthful", resourceHealth);
    const chain = checkChain("resource.health.chain", resourceHealth);
    const serviceOk = resourceHealth?.service === "ynx-resourced" && resourceHealth?.upstreamOk === true && resourceHealth?.bodyLimitBytes === 1048576 && resourceHealth?.responseLimitBytes === 2097152;
    record("resource.health.gateway", serviceOk, serviceOk ? "independent authenticated Resource Market Gateway is healthy" : `Resource Gateway service/upstream/limit evidence missing: ${clip(resourceHealth)}`, {
      service: resourceHealth?.service,
      upstreamOk: resourceHealth?.upstreamOk,
      bodyLimitBytes: resourceHealth?.bodyLimitBytes,
      responseLimitBytes: resourceHealth?.responseLimitBytes,
    });
    const build = checkBuildIdentity("resource.health", resourceHealth);
    resourceHealthOk = truthful && chain && serviceOk && build;
  }
  record("resource.auth.configured", Boolean(resourceGatewayAPIKey), resourceGatewayAPIKey ? "secure Resource API key is available to remote proof" : "YNX_RESOURCE_API_KEY is missing from the secure remote proof environment", {});
  const web4Health = await getJson("web4.health", `${endpoints.web4}/health`);
  if (web4Health) {
    checkTruthfulServiceHealth("web4.health.truthful", web4Health);
    if (chainIdOf(web4Health) !== null) checkChain("web4.health.chain", web4Health);
    checkWeb4ChainBinding(web4Health);
  }

  const publicChainReady = releaseManifestOk && rpcChainOk && rpcBuildOk && grew && validatorsOk && nodeIdentityOk && nodeIdentityBuildOk && validatorPeersOk && validatorPeerSyncOk && evmChainOk && evmBlockOk && restChainOk && grpcOk && faucetChainOk && faucetNativeOk && aiHealthOk && payHealthOk && Boolean(payGatewayAPIKey) && trustHealthOk && Boolean(trustGatewayAPIKey) && resourceHealthOk && Boolean(resourceGatewayAPIKey) && requestValidityRulesOk && transparencyInitialOk;
  if (!publicChainReady) {
    record("mutable.remote.actions", false, "skipped faucet/pay/trust/resource/IDE/governance mutations because public endpoints are not verified as the new YNX Testnet with Chain Law APIs", {});
  } else {
    const faucetTx = await postJson("faucet.request", `${endpoints.faucet}/request`, { address: sampleAddress, amount: 100 });
    if (faucetTx) checkTxHash("faucet.request.tx", faucetTx);

    const txHash = txHashOf(faucetTx);
    if (txHash) {
      const explorerTx = await getJsonEventually("explorer.faucetTx", `${endpoints.explorer}/api/txs/${txHash}`);
      if (explorerTx) checkTxHash("explorer.faucetTx.hash", explorerTx?.transaction ?? explorerTx);
    }

    const payIntentKey = `remote-smoke-intent-${sampleAddress}`;
    const payHeaders = { "x-ynx-pay-key": payGatewayAPIKey };
    const pay = await postJson("pay.intent", `${endpoints.pay}/pay/intents`, { amount: 1, idempotencyKey: payIntentKey }, payHeaders);
    record("pay.intent.created", Boolean(pay?.id), pay?.id ? `intent ${pay.id}` : "missing pay intent id", pay);
    const payReplay = await postJson("pay.intent.replay", `${endpoints.pay}/pay/intents`, { amount: 1, idempotencyKey: payIntentKey }, payHeaders);
    record(
      "pay.intent.idempotency",
      Boolean(pay?.id) && payReplay?.id === pay.id && payReplay?.amount === pay.amount && payReplay?.idempotencyKey === payIntentKey,
      payReplay?.id === pay?.id ? "intent replay returned original object" : "intent replay created a conflicting object",
      { original: pay, replay: payReplay },
    );
    await postJsonExpectError(
      "pay.intent.idempotencyConflict",
      `${endpoints.pay}/pay/intents`,
      { amount: 99, idempotencyKey: payIntentKey },
      400,
      /idempotency.*different|already used.*different/i,
      payHeaders,
    );
    if (pay?.id) {
      const invoiceKey = `remote-smoke-invoice-${sampleAddress}`;
      const invoice = await postJson("pay.invoice", `${endpoints.pay}/pay/invoices`, { intentId: pay.id, dueInHours: 12, idempotencyKey: invoiceKey }, payHeaders);
      const invoiceReplay = await postJson("pay.invoice.replay", `${endpoints.pay}/pay/invoices`, { intentId: pay.id, dueInHours: 12, idempotencyKey: invoiceKey }, payHeaders);
      record(
        "pay.invoice.idempotency",
        Boolean(invoice?.id) && invoiceReplay?.id === invoice.id && invoiceReplay?.intentId === pay.id && invoiceReplay?.idempotencyKey === invoiceKey,
        invoiceReplay?.id === invoice?.id ? "invoice replay returned original object" : "invoice replay created a conflicting object",
        { original: invoice, replay: invoiceReplay },
      );
      await postJsonExpectError(
        "pay.invoice.idempotencyConflict",
        `${endpoints.pay}/pay/invoices`,
        { intentId: pay.id, dueInHours: 36, idempotencyKey: invoiceKey },
        400,
        /idempotency.*different|already used.*different/i,
        payHeaders,
      );

      const webhookKey = `remote-smoke-webhook-${sampleAddress}`;
      const webhook = await postJson("pay.webhook", `${endpoints.pay}/pay/webhook-signatures`, {
        intentId: pay.id,
        eventType: "payment_intent.created",
        idempotencyKey: webhookKey,
      }, payHeaders);
      const webhookAuditOk = typeof webhook?.eventId === "string" && webhook.eventId.length > 0 &&
        webhook?.algorithm === "hmac-sha256" &&
        typeof webhook?.payloadHash === "string" && webhook.payloadHash.length > 0 &&
        typeof webhook?.signature === "string" && webhook.signature.length > 0 &&
        webhook?.replaySafe === true &&
        webhook?.idempotencyKey === webhookKey;
      record(
        "pay.webhook.auditFields",
        webhookAuditOk,
        webhookAuditOk ? "webhook signature exposes replay-safe audit metadata" : "webhook signature missing replay-safe audit metadata",
        webhook,
      );
      const webhookReplay = await postJson("pay.webhook.replay", `${endpoints.pay}/pay/webhook-signatures`, {
        intentId: pay.id,
        eventType: "payment_intent.created",
        idempotencyKey: webhookKey,
      }, payHeaders);
      record(
        "pay.webhook.idempotency",
        Boolean(webhook?.eventId) && webhookReplay?.eventId === webhook.eventId && webhookReplay?.signature === webhook.signature,
        webhookReplay?.eventId === webhook?.eventId ? "webhook replay returned original signature" : "webhook replay created a conflicting signature",
        { original: webhook, replay: webhookReplay },
      );
      if (webhook?.eventId) {
        const webhookLookup = await getJson("pay.webhook.lookup", `${endpoints.pay}/pay/webhook-signatures/${encodeURIComponent(webhook.eventId)}`, payHeaders);
        record(
          "pay.webhook.lookup.id",
          webhookLookup?.eventId === webhook.eventId && webhookLookup?.payloadHash === webhook.payloadHash,
          webhookLookup?.eventId === webhook.eventId ? "webhook signature lookup matched event id" : "webhook signature lookup mismatch",
          webhookLookup,
        );
      }

      const payEvents = await getJson("pay.events", `${endpoints.pay}/pay/events?intentId=${encodeURIComponent(pay.id)}`, payHeaders);
      const eventList = Array.isArray(payEvents?.events) ? payEvents.events : [];
      const payEventsOk = eventList.length >= 2 &&
        eventList.every((event) => typeof event?.auditHash === "string" && event.auditHash.length > 0) &&
        eventList.some((event) => event?.type === "payment_intent.created" && event?.idempotencyKey === payIntentKey) &&
        eventList.some((event) => event?.type === "webhook.signed" && event?.idempotencyKey === webhookKey);
      record(
        "pay.events.auditHash",
        payEventsOk,
        payEventsOk ? "pay events expose audit hashes and idempotency metadata" : "pay events missing audit hashes or idempotency metadata",
        payEvents,
      );
    }

    const aiSession = `remote-smoke-ai-${sampleAddress}`;
    const aiRequester = "remote_smoke_merchant";
    const aiHeaders = aiGatewayAPIKey ? { "x-ynx-ai-key": aiGatewayAPIKey } : {};
    if (!aiGatewayAPIKey) {
      record("ai.stream.authenticatedSSE", false, "YNX_AI_GATEWAY_API_KEY is missing from the secure remote proof environment", {});
    } else {
      const aiStream = await request("ai.stream", `${endpoints.ai}/ai/stream?session=${encodeURIComponent(aiSession)}&q=${encodeURIComponent("Explain current YNX Testnet status without executing actions")}`, { headers: aiHeaders });
      const streamOK = aiStream.ok && aiStream.requestId && aiStream.text.includes("event: metadata") && aiStream.text.includes("event: token") && aiStream.text.includes("event: done") && aiStream.text.includes(aiSession);
      record("ai.stream.authenticatedSSE", Boolean(streamOK), streamOK ? `authenticated session stream ${aiSession} request ${aiStream.requestId}` : `authenticated AI Gateway SSE failed: ${aiStream.error || clip(aiStream.text)}`, {
        requestId: aiStream.requestId,
        sessionId: aiSession,
        status: aiStream.status,
      });
    }
    const aiAction = await postJson("ai.action.proposal", `${endpoints.ai}/ai/actions`, {
      sessionId: aiSession,
      requester: aiRequester,
      scope: "value_movement",
      actionType: "transfer",
      description: "Remote smoke sensitive merchant settlement action",
    }, aiHeaders);
    if (aiAction) {
      checkAIActionProposal(aiAction);
    } else {
      record("ai.action.proposal.audit", false, "missing AI action proposal response", {});
    }
    const aiPermission = await postJson("ai.permission", `${endpoints.ai}/ai/permissions`, {
      sessionId: aiSession,
      requester: aiRequester,
      scope: "value_movement",
      purpose: "approve remote smoke scoped merchant settlement action",
      expiryHours: 2,
    }, aiHeaders);
    if (aiPermission) {
      checkAIPermission(aiPermission);
    } else {
      record("ai.permission.active", false, "missing AI permission response", {});
    }
    if (aiAction?.id && aiPermission?.id) {
      const aiApproved = await postJson("ai.action.approve", `${endpoints.ai}/ai/actions/${encodeURIComponent(aiAction.id)}/approve`, {
        approver: "remote_smoke_reviewer",
        permissionId: aiPermission.id,
      }, aiHeaders);
      if (aiApproved) checkAIActionApproval(aiApproved, aiPermission.id);
      const aiLookup = await getJson("ai.action.lookup", `${endpoints.ai}/ai/actions/${encodeURIComponent(aiAction.id)}`, aiHeaders);
      if (aiLookup) checkAIActionLookup(aiLookup, aiAction.id, aiPermission.id);
      const aiList = await getJson("ai.action.list", `${endpoints.ai}/ai/actions?sessionId=${encodeURIComponent(aiSession)}`, aiHeaders);
      if (aiList) checkAIActionList(aiList, aiAction.id);
    } else {
      record("ai.action.approve.permissionGate", false, "skipped AI approval because proposal or permission id is missing", { actionId: aiAction?.id, permissionId: aiPermission?.id });
      record("ai.action.lookup.audit", false, "skipped AI lookup because proposal or permission id is missing", { actionId: aiAction?.id, permissionId: aiPermission?.id });
      record("ai.action.list.session", false, "skipped AI session list because proposal id is missing", { actionId: aiAction?.id });
    }

    const trust = await getJson("trust.trace", `${endpoints.trust}/trust/trace/${sampleAddress}`, trustHeaders);
    record("trust.trace.address", trust?.address === sampleAddress, trust?.address ? `trace ${trust.address}` : "missing trust trace", trust);

    const illegalRequest = await postJson("governance.request.illegal", `${endpoints.trust}/governance/requests`, {
      requester: "remote_smoke_agency",
      subject: sampleAddress,
      action: "freeze native YNXT",
      assetType: "YNXT",
      scope: sampleAddress,
      description: "directly freeze user native YNXT by protocol request",
      evidence: ["case:remote-smoke"],
    }, trustHeaders);
    if (illegalRequest) {
      checkGovernanceRequest("governance.request.illegal.classification", illegalRequest, "ILLEGAL_OR_ABUSIVE", "rejected", "native-ynxt-no-direct-freeze");
      record("governance.request.illegal.nativeYnxtProtected", illegalRequest.nativeYnxtProtected === true, illegalRequest.nativeYnxtProtected === true ? "native YNXT protected" : "nativeYnxtProtected is not true", illegalRequest);
    }

    const reviewRequest = await postJson("governance.request.review", `${endpoints.trust}/governance/requests`, {
      requester: "remote_smoke_merchant",
      subject: sampleAddress,
      action: "risk label review",
      assetType: "stablecoin",
      scope: "single transfer",
      description: "review scoped transfer evidence for remote public proof",
      evidence: ["case:remote-smoke", "tx:0xremote"],
    }, trustHeaders);
    if (reviewRequest) {
      checkGovernanceRequest("governance.request.review.classification", reviewRequest, "REQUIRES_GOVERNANCE_REVIEW", "pending_review", "governance-review-user-rights");
      if (reviewRequest.id) {
        const readReview = await getJson("governance.request.review.lookup", `${endpoints.trust}/governance/requests/${encodeURIComponent(reviewRequest.id)}`, trustHeaders);
        if (readReview) checkReadableID("governance.request.review.lookup.id", readReview, reviewRequest.id);
        const reviewed = await postJson("governance.request.review.markReviewed", `${endpoints.trust}/governance/requests/${encodeURIComponent(reviewRequest.id)}/review`, {}, trustHeaders);
        record("governance.request.review.markReviewed.status", reviewed?.status === "reviewed" && Boolean(reviewed?.reviewedAt), reviewed?.status === "reviewed" ? "reviewed" : "review failed", reviewed);
      }
    }

    const manualRequest = await postJson("governance.request.manualRejectSource", `${endpoints.trust}/governance/requests`, {
      requester: "remote_smoke_reviewer",
      subject: sampleAddress,
      action: "metadata correction",
      assetType: "evidence",
      scope: "single evidence packet",
      description: "correct one evidence packet with reviewer evidence",
      evidence: ["case:remote-smoke"],
    }, trustHeaders);
    if (manualRequest?.id) {
      const rejected = await postJson("governance.request.manualReject", `${endpoints.trust}/governance/requests/${encodeURIComponent(manualRequest.id)}/reject`, { reason: "remote smoke manual rejection proof" }, trustHeaders);
      record("governance.request.manualReject.status", rejected?.classification === "REJECTED" && rejected?.status === "rejected" && Boolean(rejected?.rejectedAt), rejected?.status === "rejected" ? "manual rejection recorded" : "manual rejection failed", rejected);
    }

    const noticeRequest = await postJson("governance.request.notice", `${endpoints.trust}/governance/requests`, {
      requester: "remote_smoke_reviewer",
      subject: sampleAddress,
      action: "notify user about appeal notice",
      assetType: "trust_label",
      scope: "single address",
      description: "create user notice and transparency notice",
      evidence: ["case:remote-smoke-notice"],
    }, trustHeaders);
    if (noticeRequest) {
      checkGovernanceRequest("governance.request.notice.classification", noticeRequest, "REQUIRES_USER_NOTICE", "notice_required", "user-notice-required");
    }

    if (reviewRequest?.id) {
      const appeal = await postJson("trust.appeal.open", `${endpoints.trust}/trust/appeals`, {
        requestId: reviewRequest.id,
        subject: sampleAddress,
        appellant: sampleAddress,
        reason: "remote public false positive correction proof",
        evidence: ["owner proof"],
      }, trustHeaders);
      if (appeal) {
        checkAppeal("trust.appeal.open.status", appeal, "SUBMITTED");
        if (appeal.id) {
          const appealRead = await getJson("trust.appeal.lookup", `${endpoints.trust}/trust/appeals/${encodeURIComponent(appeal.id)}`, trustHeaders);
          if (appealRead) checkReadableID("trust.appeal.lookup.id", appealRead, appeal.id);
          const appealResolved = await postJson("trust.appeal.resolve", `${endpoints.trust}/trust/appeals/${encodeURIComponent(appeal.id)}/resolve`, {
            reviewer: "remote_smoke_reviewer",
            decision: "LABEL_REDUCED",
            resolutionReason: "remote smoke evidence reduced label confidence",
          }, trustHeaders);
          record("trust.appeal.resolve.status", appealResolved?.status === "LABEL_REDUCED" && appealResolved?.reviewer === "remote_smoke_reviewer", appealResolved?.status === "LABEL_REDUCED" ? "appeal resolved" : "appeal resolution failed", appealResolved);
          const correctedEvidence = await postJson("trust.appeal.correctionEvidence", `${endpoints.trust}/trust/evidence`, {
            subject: sampleAddress,
          }, trustHeaders);
          const correctionSummary = correctedEvidence?.riskSummary;
          const correctionOk = Number(correctionSummary?.correctionLabelCount ?? 0) >= 1 &&
            correctionSummary?.assetEffect === "none_advisory_only" &&
            correctionSummary?.appealPath === "/trust/appeals" &&
            Array.isArray(correctionSummary?.reviewerNotes) &&
            correctionSummary.reviewerNotes.some((note) => String(note).includes("Appeal correction"));
          record(
            "trust.appeal.correctionEvidence.summary",
            correctionOk,
            correctionOk ? "appeal correction appears in Trust evidence risk summary" : "appeal correction missing from Trust evidence risk summary",
            correctedEvidence,
          );
        }
      }
    }

    const trackingValid = await postJson("trust.trackingReview.valid", `${endpoints.trust}/trust/tracking-reviews`, {
      requester: "remote_smoke_merchant",
      subject: sampleAddress,
      purpose: "single transaction screening",
      queryType: "trace",
      scope: "single transfer",
      description: "purpose limited remote tracking proof",
      evidence: ["case:remote-smoke"],
      minimumNecessary: true,
      confidenceBps: 7600,
      expiryHours: 24,
    }, trustHeaders);
    if (trackingValid) checkTrackingReview("trust.trackingReview.valid.classification", trackingValid, "VALID_UNDER_YNX_CHAIN_LAW", "logged", "tracking-purpose-limited-valid");

    const trackingBlocked = await postJson("trust.trackingReview.overbroad", `${endpoints.trust}/trust/tracking-reviews`, {
      requester: "remote_smoke_merchant",
      subject: sampleAddress,
      purpose: "bulk profile all wallets",
      queryType: "batch",
      scope: "all wallets",
      description: "mass tracking everyone",
      evidence: ["case:remote-smoke"],
      minimumNecessary: false,
    }, trustHeaders);
    if (trackingBlocked) checkTrackingReview("trust.trackingReview.overbroad.classification", trackingBlocked, "OVERBROAD", "rejected", "tracking-minimum-necessary");

    const transparencyFinal = await getJson("governance.transparency.final", `${endpoints.trust}/governance/transparency`, trustHeaders);
    if (transparencyFinal) {
      checkTransparencyReport("governance.transparency.final.report", transparencyFinal, { entryCount: 8, rejectedCount: 3, appealCount: 1, reviewCount: 1 });
    }

    const resourcePolicy = await getJson("resource.policy", `${endpoints.resource}/resource-market/policy`, resourceHeaders);
    const resourcePolicyOk = resourcePolicy?.currency === expected.nativeSymbol &&
      typeof resourcePolicy?.policyHash === "string" && resourcePolicy.policyHash.length > 0 &&
      Number(resourcePolicy?.providerShareBps ?? -1) + Number(resourcePolicy?.protocolFeeBps ?? -1) === 10000;
    record("resource.policy.inspectable", resourcePolicyOk, resourcePolicyOk ? "resource policy is inspectable" : "resource policy missing or invalid", resourcePolicy);

    const quote = await getJson("resource.quote", `${endpoints.resource}/resource-market/quote?address=${encodeURIComponent(sampleAddress)}&bandwidth=1&compute=1&aiCredits=1&trustCredits=1`, resourceHeaders);
    const quotePolicyOk = Boolean(quote) && quote.policyHash === resourcePolicy?.policyHash && Array.isArray(quote.pricingBreakdown) && quote.pricingBreakdown.length === 4;
    record("resource.quote.policyEvidence", quotePolicyOk, quotePolicyOk ? "resource quote returned with policy evidence" : "resource quote missing policy evidence", quote);

    const delegation = await postJson("resource.delegation", `${endpoints.resource}/resource-market/delegations`, { provider: sampleAddress, beneficiary: sampleAddress, amount: 10 }, resourceHeaders);
    record("resource.delegation.active", delegation?.delegation?.status === "active" && delegation?.delegation?.policyHash === resourcePolicy?.policyHash, delegation?.delegation?.status === "active" ? "resource delegation is active and policy-bound" : "resource delegation missing or invalid", delegation);
    const rental = await postJson("resource.rental", `${endpoints.resource}/resource-market/rent`, { address: sampleAddress, provider: sampleAddress, bandwidth: 1, compute: 1, aiCredits: 1, trustCredits: 1 }, resourceHeaders);
    record("resource.rental.settled", Boolean(rental?.rental?.id) && rental?.rental?.policyHash === resourcePolicy?.policyHash && Number(rental?.rental?.priceYnxt ?? 0) > 0, rental?.rental?.id ? "resource rental is settled and policy-bound" : "resource rental missing or invalid", rental);
    const income = await getJson("resource.income", `${endpoints.resource}/resource-market/income/${encodeURIComponent(sampleAddress)}`, resourceHeaders);
    record("resource.income.recorded", Array.isArray(income?.income) && income.income.length > 0 && income.income.every((entry) => entry.currency === expected.nativeSymbol), Array.isArray(income?.income) ? `resource income records ${income.income.length}` : "resource income missing", income);
    const resourceAnalytics = await getJson("resource.analytics", `${endpoints.resource}/resource-market/analytics`, resourceHeaders);
    record("resource.analytics.updated", Number(resourceAnalytics?.activeDelegationCount ?? 0) > 0 && Number(resourceAnalytics?.resourceRentalCount ?? 0) > 0 && resourceAnalytics?.policyHash === resourcePolicy?.policyHash, resourceAnalytics?.policyHash === resourcePolicy?.policyHash ? "resource analytics include delegation and rental" : "resource analytics missing or invalid", resourceAnalytics);

    const source = "pragma solidity ^0.8.24; contract RemoteSmoke { function ping() public pure returns (uint256) { return 1; } }";
    const compile = await postJson("ide.compile", `${endpoints.rest}/ide/compile`, { name: "RemoteSmoke", source });
    record("ide.compile.ok", compile?.ok === true, compile?.ok === true ? "compile preflight ok" : "compile preflight failed", compile);
  }

  const ok = checks.every((check) => check.ok);
  evidence.status = ok ? "passed" : "failed";
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`remote evidence written: ${evidencePath}`);
  if (!ok) {
    const failed = checks.filter((check) => !check.ok).map((check) => check.name).join(", ");
    console.error(`remote-smoke-test failed checks: ${failed}`);
    process.exit(1);
  }
}

main().catch((err) => {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  evidence.status = "error";
  evidence.error = err.stack || err.message;
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(err.stack || err.message);
  process.exit(1);
});
