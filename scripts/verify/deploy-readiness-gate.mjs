#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const verifyDir = process.env.YNX_VERIFY_TESTNET_OUT || "tmp/verify-testnet";
const blockerJsonPath = process.env.YNX_REMOTE_BLOCKER_JSON || path.join(verifyDir, "remote-blockers.json");
const upgradeSourceEvidencePath = process.env.YNX_UPGRADE_SOURCE_RELEASE_EVIDENCE_PATH || path.join(verifyDir, "upgrade-source-release-evidence.json");
const maxAgeMinutes = Number(process.env.YNX_DEPLOY_GATE_MAX_AGE_MINUTES || 120);
const expectedCosmosChainId = process.env.YNX_COSMOS_CHAIN_ID || "ynx_6423-1";
const expectedEvmChainId = Number(process.env.YNX_EVM_CHAIN_ID || 6423);
const expectedEvmChainIdHex = String(process.env.YNX_EVM_CHAIN_ID_HEX || "0x1917").toLowerCase();
const expectedNativeSymbol = process.env.YNX_NATIVE_COIN_SYMBOL || "YNXT";
const bootstrapDeploy = process.env.YNX_BOOTSTRAP_DEPLOY === "1";
const upgradeDeploy = process.env.YNX_UPGRADE_DEPLOY === "1";

const allowedUpgradeFailures = new Set([
  "release.manifest.evidence.present", "release.manifest.commit", "release.manifest.release", "release.manifest.chaindChecksum",
  "rpc.status.buildCommit", "rpc.status.buildRelease",
  "rpc.nodeIdentity.buildCommit", "rpc.nodeIdentity.buildRelease",
  "ai.health.buildCommit", "ai.health.buildRelease",
  "pay.health.buildCommit", "pay.health.buildRelease",
  "trust.health.buildCommit", "trust.health.buildRelease",
  "resource.health.buildCommit", "resource.health.buildRelease",
  "web4.health.truthful", "web4.health.chain",
  "mutable.remote.actions",
]);

function fail(message, details = []) {
  console.error(`deploy-readiness-gate failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  console.error("Run: make host-key-audit");
  console.error("Run: make host-key-repair-plan");
  console.error("Run for external fingerprint verification: make host-key-approval-request");
  console.error("Run for external reviewer packet: make host-key-approval-packet");
  console.error("Run to inspect current approval blocker state: make host-key-approval-status");
  console.error("Run after trusted fingerprint approval exists: make host-key-approval-check");
  console.error("Run after approval check passes: make host-key-approved-repair-dry-run");
  console.error("Run after dry-run review: make host-key-approved-repair");
  console.error("Run: YNX_REMOTE_TIMEOUT_MS=5000 YNX_REMOTE_BLOCK_GROWTH_DELAY_MS=1000 YNX_REMOTE_EVIDENCE_PATH=tmp/verify-testnet/remote-evidence.json make remote-smoke-test");
  console.error("Run: make remote-blocker-report");
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail(`missing or unreadable blocker JSON at ${file}`, [err.message]);
  }
}

function currentGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function validateUpgradeSourceEvidence(headCommit) {
  const problems = [];
  let evidence = null;
  try {
    evidence = JSON.parse(fs.readFileSync(upgradeSourceEvidencePath, "utf8"));
  } catch (err) {
    return [`upgrade source release evidence: missing or unreadable (${upgradeSourceEvidencePath}): ${err.message}`];
  }
  if (evidence?.schema !== "ynx-upgrade-source-release-evidence/v1") {
    problems.push(`upgrade source release evidence: invalid schema (${upgradeSourceEvidencePath})`);
  }
  if (evidence?.status !== "passed") {
    problems.push(`upgrade source release evidence: status must be passed, got ${evidence?.status || "missing"} (${upgradeSourceEvidencePath})`);
  }
  const generatedAt = Date.parse(evidence?.generatedAt || "");
  if (!Number.isFinite(generatedAt)) {
    problems.push(`upgrade source release evidence: missing valid generatedAt (${upgradeSourceEvidencePath})`);
  } else {
    const ageMinutes = (Date.now() - generatedAt) / 60000;
    if (ageMinutes > maxAgeMinutes) {
      problems.push(`upgrade source release evidence: stale ${ageMinutes.toFixed(1)} minutes old, max ${maxAgeMinutes} (${upgradeSourceEvidencePath})`);
    }
  }
  const targetCommit = String(evidence?.target?.commit || "");
  const sourceCommit = String(evidence?.source?.commit || "");
  if (!/^[0-9a-f]{12}$/.test(targetCommit) || headCommit === "unknown" || targetCommit !== headCommit.slice(0, 12)) {
    problems.push(`upgrade source release evidence: target commit ${targetCommit || "missing"} does not match current HEAD ${headCommit.slice(0, 12)} (${upgradeSourceEvidencePath})`);
  }
  if (evidence?.target?.release !== `ynx-chain-${targetCommit}`) {
    problems.push(`upgrade source release evidence: target release does not match target commit (${upgradeSourceEvidencePath})`);
  }
  if (!/^[0-9a-f]{12}$/.test(sourceCommit) || evidence?.source?.release !== `ynx-chain-${sourceCommit}`) {
    problems.push(`upgrade source release evidence: source release identity is invalid (${upgradeSourceEvidencePath})`);
  }
  if (sourceCommit && sourceCommit === targetCommit) {
    problems.push(`upgrade source release evidence: source and target commits must differ (${upgradeSourceEvidencePath})`);
  }
  const nodes = Array.isArray(evidence?.nodes) ? evidence.nodes : [];
  const requiredRoles = ["primary", "singapore", "silicon-valley", "seoul"];
  if (nodes.length !== requiredRoles.length) {
    problems.push(`upgrade source release evidence: exactly four node records are required (${upgradeSourceEvidencePath})`);
  }
  for (const role of requiredRoles) {
    const node = nodes.find((item) => item?.role === role);
    if (!node || node.ok !== true) {
      problems.push(`upgrade source release evidence: ${role} did not prove the current manifest and installed ynx-chaind checksum (${upgradeSourceEvidencePath})`);
    }
    if (node?.observed?.sourceCommit !== sourceCommit || node?.observed?.sourceRelease !== evidence?.source?.release) {
      problems.push(`upgrade source release evidence: ${role} source identity is inconsistent (${upgradeSourceEvidencePath})`);
    }
  }
  return problems;
}

if (process.env.DEPLOY_DRY_RUN === "1") {
  console.log("deploy-readiness-gate skipped for DEPLOY_DRY_RUN=1");
  process.exit(0);
}

const blocker = readJson(blockerJsonPath);
const generatedAt = Date.parse(blocker.generatedAt || "");
if (!Number.isFinite(generatedAt)) {
  fail("blocker JSON has no valid generatedAt timestamp", [`file: ${blockerJsonPath}`]);
}

const ageMinutes = (Date.now() - generatedAt) / 60000;
if (ageMinutes > maxAgeMinutes) {
  fail("blocker JSON is stale", [
    `file: ${blockerJsonPath}`,
    `ageMinutes: ${ageMinutes.toFixed(1)}`,
    `maxAgeMinutes: ${maxAgeMinutes}`,
  ]);
}

const sourceEvidence = blocker.sourceEvidence || null;
if (!sourceEvidence || typeof sourceEvidence !== "object") {
  fail("required source evidence metadata is missing", [
    `file: ${blockerJsonPath}`,
    "rerun make host-key-audit, make remote-smoke-test, and make remote-blocker-report",
  ]);
}

const requiredSources = new Map([
  ["remoteEvidence", "remote smoke evidence"],
  ["hostKeyAudit", "host-key audit"],
]);
if (bootstrapDeploy) {
  requiredSources.set("legacyInventory", "legacy deployment inventory");
}
for (const [key, source] of Object.entries(sourceEvidence)) {
  if (source?.required) {
    requiredSources.set(key, key);
  }
}
const sourceProblems = [];
const headCommit = currentGitCommit();
if (upgradeDeploy) {
  sourceProblems.push(...validateUpgradeSourceEvidence(headCommit));
}
for (const [key, label] of requiredSources.entries()) {
  const source = sourceEvidence[key];
  if (!source || !source.exists) {
    sourceProblems.push(`${label}: missing (${source?.path || "unknown path"})`);
    continue;
  }
  if (!source.path) {
    sourceProblems.push(`${label}: missing source path`);
    continue;
  }
  if (!fs.existsSync(source.path)) {
    sourceProblems.push(`${label}: source path no longer exists (${source.path})`);
    continue;
  }
  const sourceTimestamp = Date.parse(source.timestamp || "");
  if (!Number.isFinite(sourceTimestamp)) {
    sourceProblems.push(`${label}: missing valid timestamp (${source.path || "unknown path"})`);
    continue;
  }
  const sourceAgeMinutes = (Date.now() - sourceTimestamp) / 60000;
  if (sourceAgeMinutes > maxAgeMinutes) {
    sourceProblems.push(`${label}: stale ${sourceAgeMinutes.toFixed(1)} minutes old, max ${maxAgeMinutes} (${source.path || "unknown path"})`);
  }
  if (key === "remoteEvidence") {
    let remoteEvidence = null;
    try {
      remoteEvidence = JSON.parse(fs.readFileSync(source.path, "utf8"));
    } catch (err) {
      sourceProblems.push(`${label}: unreadable JSON (${source.path}): ${err.message}`);
      continue;
    }
    if (remoteEvidence?.proofType !== "remote-public-testnet-smoke") {
      sourceProblems.push(`${label}: proofType must be remote-public-testnet-smoke (${source.path})`);
    }
    if (!bootstrapDeploy && !upgradeDeploy && remoteEvidence?.status !== "passed") {
      sourceProblems.push(`${label}: status must be passed, got ${remoteEvidence?.status || "missing"} (${source.path})`);
    }
    if (upgradeDeploy) {
      const failedChecks = Array.isArray(remoteEvidence?.checks) ? remoteEvidence.checks.filter((check) => check?.ok !== true) : [];
      const unsafeFailures = failedChecks.filter((check) => !allowedUpgradeFailures.has(String(check?.name || "")));
      if (!failedChecks.length || unsafeFailures.length) {
        sourceProblems.push(`${label}: upgrade evidence has unsafe failures: ${unsafeFailures.map((check) => check?.name || "unknown").join(", ") || "missing expected source/target release differences"} (${source.path})`);
      }
    }
    const evidenceCommit = String(remoteEvidence?.gitCommit || "");
    if (!/^[0-9a-f]{40}$/i.test(evidenceCommit)) {
      sourceProblems.push(`${label}: gitCommit must be a full 40-character SHA (${source.path})`);
    } else if (headCommit !== "unknown" && evidenceCommit !== headCommit) {
      sourceProblems.push(`${label}: gitCommit ${evidenceCommit.slice(0, 12)} does not match current HEAD ${headCommit.slice(0, 12)} (${source.path})`);
    }
    const expected = remoteEvidence?.expected || {};
    const releaseCommit = String(expected.releaseCommit || "");
    const releaseName = String(expected.releaseName || "");
    if (expected.cosmosChainId !== expectedCosmosChainId) {
      sourceProblems.push(`${label}: expected.cosmosChainId must be ${expectedCosmosChainId} (${source.path})`);
    }
    if (Number(expected.evmChainId) !== expectedEvmChainId) {
      sourceProblems.push(`${label}: expected.evmChainId must be ${expectedEvmChainId} (${source.path})`);
    }
    if (String(expected.evmChainIdHex || "").toLowerCase() !== expectedEvmChainIdHex) {
      sourceProblems.push(`${label}: expected.evmChainIdHex must be ${expectedEvmChainIdHex} (${source.path})`);
    }
    if (expected.nativeSymbol !== expectedNativeSymbol) {
      sourceProblems.push(`${label}: expected.nativeSymbol must be ${expectedNativeSymbol} (${source.path})`);
    }
    if (!/^[0-9a-f]{7,40}$/i.test(releaseCommit) || releaseCommit === "unknown") {
      sourceProblems.push(`${label}: expected.releaseCommit must be a concrete git SHA prefix (${source.path})`);
    } else if (headCommit !== "unknown" && !headCommit.startsWith(releaseCommit)) {
      sourceProblems.push(`${label}: expected.releaseCommit ${releaseCommit} does not match current HEAD ${headCommit.slice(0, 12)} (${source.path})`);
    }
    if (releaseName !== `ynx-chain-${releaseCommit}`) {
      sourceProblems.push(`${label}: expected.releaseName must match ynx-chain-<releaseCommit> (${source.path})`);
    }
  }
}
if (sourceProblems.length) {
  fail("required source evidence is missing or stale", sourceProblems);
}

const sourceBlockers = blocker.deployBlockers?.sources || [];
const nodeBlockers = blocker.deployBlockers?.nodes || [];
const endpointBlockers = blocker.deployBlockers?.endpoints || [];
if (bootstrapDeploy) {
  if (sourceBlockers.length || nodeBlockers.length) {
    const details = [
      ...sourceBlockers.map((item) => `${item.name || "source"} ${item.path || ""}: ${item.classification} (${item.detail || "no detail"})`),
      ...nodeBlockers.map((item) => `${item.role || "node"} ${item.login || ""} ${item.host || ""}: ${item.classification} (${item.detail || "no detail"})`),
    ];
    fail("bootstrap deployment still has unsafe source or SSH evidence", details.slice(0, 24));
  }
  console.log(`deploy-readiness-gate passed in explicit bootstrap mode: ${blockerJsonPath}`);
  console.log(`pre-deployment public endpoint blockers recorded: ${endpointBlockers.length}`);
  process.exit(0);
}
if (upgradeDeploy) {
  const unsafeEndpointBlockers = endpointBlockers.filter((item) => !allowedUpgradeFailures.has(String(item?.name || "")));
  if (sourceBlockers.length || nodeBlockers.length || unsafeEndpointBlockers.length) {
    const details = [
      ...sourceBlockers.map((item) => `${item.name || "source"} ${item.path || ""}: ${item.classification} (${item.detail || "no detail"})`),
      ...nodeBlockers.map((item) => `${item.role || "node"} ${item.login || ""} ${item.host || ""}: ${item.classification} (${item.detail || "no detail"})`),
      ...unsafeEndpointBlockers.map((item) => `${item.name || "endpoint"} ${item.endpoint || ""}: ${item.classification} (${item.detail || "no detail"})`),
    ];
    fail("upgrade deployment has unsafe SSH, source, or endpoint evidence", details.slice(0, 24));
  }
  console.log(`deploy-readiness-gate passed in restricted upgrade mode: ${blockerJsonPath}`);
  console.log(`allowed source-to-target release/Web4 blockers recorded: ${endpointBlockers.length}`);
  process.exit(0);
}
if (!blocker.deployReady || sourceBlockers.length || nodeBlockers.length || endpointBlockers.length) {
  const details = [
    ...sourceBlockers.map((item) => `${item.name || "source"} ${item.path || ""}: ${item.classification} (${item.detail || "no detail"})`),
    ...nodeBlockers.map((item) => `${item.role || "node"} ${item.login || ""} ${item.host || ""}: ${item.classification} (${item.detail || "no detail"})`),
    ...endpointBlockers.map((item) => `${item.name || "endpoint"} ${item.endpoint || ""}: ${item.classification} (${item.detail || "no detail"})`),
  ];
  fail("remote SSH or public ingress evidence is not safe for mutation", details.slice(0, 24));
}

console.log(`deploy-readiness-gate passed: ${blockerJsonPath}`);
