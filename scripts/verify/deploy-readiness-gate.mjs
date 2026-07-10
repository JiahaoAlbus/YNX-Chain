#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const verifyDir = process.env.YNX_VERIFY_TESTNET_OUT || "tmp/verify-testnet";
const blockerJsonPath = process.env.YNX_REMOTE_BLOCKER_JSON || path.join(verifyDir, "remote-blockers.json");
const maxAgeMinutes = Number(process.env.YNX_DEPLOY_GATE_MAX_AGE_MINUTES || 120);
const expectedCosmosChainId = process.env.YNX_COSMOS_CHAIN_ID || "ynx_6423-1";
const expectedEvmChainId = Number(process.env.YNX_EVM_CHAIN_ID || 6423);
const expectedEvmChainIdHex = String(process.env.YNX_EVM_CHAIN_ID_HEX || "0x1917").toLowerCase();
const expectedNativeSymbol = process.env.YNX_NATIVE_COIN_SYMBOL || "YNXT";

function fail(message, details = []) {
  console.error(`deploy-readiness-gate failed: ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  console.error("Run: make host-key-audit");
  console.error("Run: make host-key-repair-plan");
  console.error("Run for external fingerprint verification: make host-key-approval-request");
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
for (const [key, source] of Object.entries(sourceEvidence)) {
  if (source?.required) {
    requiredSources.set(key, key);
  }
}
const sourceProblems = [];
const headCommit = currentGitCommit();
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
if (!blocker.deployReady || sourceBlockers.length || nodeBlockers.length || endpointBlockers.length) {
  const details = [
    ...sourceBlockers.map((item) => `${item.name || "source"} ${item.path || ""}: ${item.classification} (${item.detail || "no detail"})`),
    ...nodeBlockers.map((item) => `${item.role || "node"} ${item.login || ""} ${item.host || ""}: ${item.classification} (${item.detail || "no detail"})`),
    ...endpointBlockers.map((item) => `${item.name || "endpoint"} ${item.endpoint || ""}: ${item.classification} (${item.detail || "no detail"})`),
  ];
  fail("remote SSH or public ingress evidence is not safe for mutation", details.slice(0, 24));
}

console.log(`deploy-readiness-gate passed: ${blockerJsonPath}`);
