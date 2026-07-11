#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const requiredChecks = [
  "rpc.status.chain",
  "rpc.status.buildCommit",
  "rpc.status.buildRelease",
  "rpc.status.buildTime",
  "release.manifest.evidence.present",
  "release.manifest.schema",
  "release.manifest.commit",
  "release.manifest.release",
  "release.manifest.chaindChecksum",
  "rpc.status.height.growth",
  "rpc.validators.count",
  "rpc.validators.addresses",
  "rpc.validators.monikers",
  "rpc.validators.peerReadiness",
  "rpc.nodeIdentity.configured",
  "rpc.nodeIdentity.expectedValidatorCount",
  "rpc.nodeIdentity.peerSyncTargetCount",
  "rpc.nodeIdentity.peerSyncFreshness",
  "rpc.nodeIdentity.buildCommit",
  "rpc.nodeIdentity.buildRelease",
  "rpc.nodeIdentity.buildTime",
  "rpc.validators.peers.expected",
  "rpc.validators.peers.observed",
  "rpc.validators.peerSync",
  "evm.eth_chainId.result",
  "evm.eth_blockNumber.result",
  "rest.status.chain",
  "grpc.endpoint",
  "governance.requestValidityRules.required",
  "governance.transparency.initial.report",
  "faucet.health.chain",
  "faucet.health.native",
  "faucet.request.tx",
  "indexer.overview.chain",
  "indexer.overview.native",
  "explorer.health.truthful",
  "explorer.summary.chain",
  "explorer.summary.native",
  "explorer.summary.validators",
  "explorer.faucetTx.hash",
  "ai.health.truthful",
  "ai.health.chain",
  "ai.health.gateway",
  "ai.health.buildCommit",
  "ai.health.buildRelease",
  "ai.health.buildTime",
  "ai.stream.authenticatedSSE",
  "ai.action.proposal.audit",
  "ai.permission.active",
  "ai.action.approve.permissionGate",
  "ai.action.lookup.audit",
  "ai.action.list.session",
  "pay.health.truthful",
  "pay.health.chain",
  "pay.health.gateway",
  "pay.health.buildCommit",
  "pay.health.buildRelease",
  "pay.health.buildTime",
  "pay.auth.configured",
  "trust.health.truthful",
  "trust.health.chain",
  "trust.health.gateway",
  "trust.health.buildCommit",
  "trust.health.buildRelease",
  "trust.health.buildTime",
  "trust.auth.configured",
  "resource.health.truthful",
  "resource.health.chain",
  "resource.health.gateway",
  "resource.health.buildCommit",
  "resource.health.buildRelease",
  "resource.health.buildTime",
  "resource.auth.configured",
  "web4.health.truthful",
  "pay.intent.created",
  "pay.intent.idempotency",
  "pay.invoice.idempotency",
  "pay.webhook.auditFields",
  "pay.webhook.idempotency",
  "pay.webhook.lookup.id",
  "pay.events.auditHash",
  "trust.trace.address",
  "governance.request.illegal.classification",
  "governance.request.illegal.nativeYnxtProtected",
  "governance.request.review.classification",
  "governance.request.review.lookup.id",
  "governance.request.review.markReviewed.status",
  "governance.request.manualReject.status",
  "governance.request.notice.classification",
  "trust.appeal.open.status",
  "trust.appeal.lookup.id",
  "trust.appeal.resolve.status",
  "trust.appeal.correctionEvidence.summary",
  "trust.trackingReview.valid.classification",
  "trust.trackingReview.overbroad.classification",
  "governance.transparency.final.report",
  "resource.policy.inspectable",
  "resource.quote.policyEvidence",
  "resource.delegation.active",
  "resource.rental.settled",
  "resource.income.recorded",
  "resource.analytics.updated",
  "ide.compile.ok",
];

const requiredEndpointKeys = ["rpc", "evm", "rest", "faucet", "indexer", "explorer", "ai", "pay", "trust", "resource", "web4"];
const localHostPattern = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i;

function parseArgs(argv) {
  const args = { evidencePath: "", outPath: "", selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--out") {
      args.outPath = argv[i + 1] || "";
      i += 1;
    } else if (!args.evidencePath) {
      args.evidencePath = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function currentGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function validHttpsEndpoint(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !localHostPattern.test(url.hostname);
  } catch {
    return false;
  }
}

function validGrpcHost(value) {
  const host = String(value || "").trim();
  if (!host || localHostPattern.test(host)) return false;
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(host) ? host : `grpcs://${host}`);
    return Boolean(parsed.hostname) && !localHostPattern.test(parsed.hostname);
  } catch {
    return false;
  }
}

function validateMetadata(evidence) {
  const problems = [];
  if (evidence?.proofType !== "remote-public-testnet-smoke") {
    problems.push("proofType must be remote-public-testnet-smoke");
  }
  if (!Number.isFinite(Date.parse(evidence?.generatedAt || ""))) {
    problems.push("generatedAt must be a valid timestamp");
  }
  const gitCommit = String(evidence?.gitCommit || "");
  if (!/^[0-9a-f]{40}$/i.test(gitCommit)) {
    problems.push("gitCommit must be a full 40-character git SHA");
  }
  const headCommit = currentGitCommit();
  if (/^[0-9a-f]{40}$/i.test(gitCommit) && headCommit !== "unknown" && gitCommit !== headCommit) {
    problems.push(`gitCommit must match current HEAD ${headCommit.slice(0, 12)}`);
  }
  const expected = evidence?.expected || {};
  if (expected.cosmosChainId !== "ynx_6423-1") {
    problems.push("expected.cosmosChainId must be ynx_6423-1");
  }
  if (Number(expected.evmChainId) !== 6423) {
    problems.push("expected.evmChainId must be 6423");
  }
  if (String(expected.evmChainIdHex || "").toLowerCase() !== "0x1917") {
    problems.push("expected.evmChainIdHex must be 0x1917");
  }
  if (expected.nativeSymbol !== "YNXT") {
    problems.push("expected.nativeSymbol must be YNXT");
  }
  if (Number(expected.minValidators) < 3) {
    problems.push("expected.minValidators must be at least 3");
  }
  const releaseCommit = String(expected.releaseCommit || "");
  const releaseName = String(expected.releaseName || "");
  if (!/^[0-9a-f]{7,40}$/i.test(releaseCommit) || releaseCommit === "unknown") {
    problems.push("expected.releaseCommit must be a concrete git SHA prefix");
  }
  if (/^[0-9a-f]{7,40}$/i.test(releaseCommit) && headCommit !== "unknown" && !headCommit.startsWith(releaseCommit)) {
    problems.push(`expected.releaseCommit must match current HEAD ${headCommit.slice(0, 12)}`);
  }
  if (!releaseName || releaseName !== `ynx-chain-${releaseCommit}`) {
    problems.push("expected.releaseName must match ynx-chain-<releaseCommit>");
  }
  if (/^[0-9a-f]{40}$/i.test(gitCommit) && /^[0-9a-f]{7,40}$/i.test(releaseCommit) && !gitCommit.startsWith(releaseCommit)) {
    problems.push("gitCommit must start with expected.releaseCommit");
  }
  const endpoints = evidence?.endpoints || {};
  for (const key of requiredEndpointKeys) {
    if (!validHttpsEndpoint(endpoints[key])) {
      problems.push(`endpoints.${key} must be a non-local https URL`);
    }
  }
  if (!validGrpcHost(endpoints.grpcHost)) {
    problems.push("endpoints.grpcHost must be a non-local gRPC host");
  }
  if (typeof evidence?.releaseManifestEvidencePath !== "string" || !evidence.releaseManifestEvidencePath.includes("release-manifest-evidence.json")) {
    problems.push("releaseManifestEvidencePath must point at release-manifest-evidence.json");
  }
  return problems;
}

function validateEvidence(evidence) {
  const checks = Array.isArray(evidence?.checks) ? evidence.checks : [];
  const byName = new Map();
  for (const check of checks) {
    if (typeof check?.name === "string") byName.set(check.name, check);
  }
  const metadataProblems = validateMetadata(evidence);
  const missingRequiredChecks = requiredChecks.filter((name) => !byName.has(name));
  const failedChecks = checks.filter((check) => !check?.ok).map((check) => check?.name || "unnamed-check");
  const failedRequiredChecks = requiredChecks.filter((name) => byName.has(name) && !byName.get(name)?.ok);
  const skippedMutableActions = byName.has("mutable.remote.actions");
  const validPublicProof = evidence?.status === "passed" &&
    metadataProblems.length === 0 &&
    missingRequiredChecks.length === 0 &&
    failedChecks.length === 0 &&
    failedRequiredChecks.length === 0 &&
    !skippedMutableActions;
  return {
    validPublicProof,
    evidenceStatus: evidence?.status || "missing",
    metadataValid: metadataProblems.length === 0,
    metadataProblems,
    requiredCheckCount: requiredChecks.length,
    observedCheckCount: checks.length,
    missingRequiredChecks,
    failedRequiredChecks,
    failedChecks,
    skippedMutableActions,
    requiredChecks,
  };
}

function writeReport(file, report) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

function buildFixture({ status = "passed", omit = [], fail = [], includeSkipped = false } = {}) {
  const headCommit = currentGitCommit();
  const fixtureCommit = /^[0-9a-f]{40}$/i.test(headCommit) ? headCommit : "abc1234abc1234abc1234abc1234abc1234abc12";
  const releaseCommit = fixtureCommit.slice(0, 12);
  const omitSet = new Set(omit);
  const failSet = new Set(fail);
  const checks = requiredChecks
    .filter((name) => !omitSet.has(name))
    .map((name) => ({ name, ok: !failSet.has(name), detail: failSet.has(name) ? "fixture failure" : "fixture ok" }));
  if (includeSkipped) checks.push({ name: "mutable.remote.actions", ok: false, detail: "fixture skipped" });
  return {
    proofType: "remote-public-testnet-smoke",
    generatedAt: "2026-07-10T00:00:00.000Z",
    gitCommit: fixtureCommit,
    expected: {
      cosmosChainId: "ynx_6423-1",
      evmChainId: 6423,
      evmChainIdHex: "0x1917",
      nativeSymbol: "YNXT",
      minValidators: 3,
      releaseCommit,
      releaseName: `ynx-chain-${releaseCommit}`,
    },
    endpoints: {
      rpc: "https://rpc.ynxweb4.com",
      evm: "https://evm.ynxweb4.com",
      rest: "https://rest.ynxweb4.com",
      grpcHost: "grpc.ynxweb4.com",
      faucet: "https://faucet.ynxweb4.com",
      indexer: "https://indexer.ynxweb4.com",
      explorer: "https://explorer.ynxweb4.com",
      ai: "https://ai.ynxweb4.com",
      pay: "https://pay.ynxweb4.com",
      trust: "https://trust.ynxweb4.com",
      resource: "https://resource.ynxweb4.com",
      web4: "https://web4.ynxweb4.com",
    },
    releaseManifestEvidencePath: "tmp/verify-testnet/release-manifest-evidence.json",
    status,
    checks,
  };
}

function selfTest() {
  const valid = validateEvidence(buildFixture());
  assert.equal(valid.validPublicProof, true, "complete passed fixture should be valid");
  const missing = validateEvidence(buildFixture({ omit: ["trust.appeal.resolve.status"] }));
  assert.equal(missing.validPublicProof, false, "missing appeal resolution proof must be invalid");
  assert(missing.missingRequiredChecks.includes("trust.appeal.resolve.status"));
  const missingCorrectionEvidence = validateEvidence(buildFixture({ omit: ["trust.appeal.correctionEvidence.summary"] }));
  assert.equal(missingCorrectionEvidence.validPublicProof, false, "missing appeal correction evidence proof must be invalid");
  assert(missingCorrectionEvidence.missingRequiredChecks.includes("trust.appeal.correctionEvidence.summary"));
  const missingPayIdempotency = validateEvidence(buildFixture({ omit: ["pay.intent.idempotency"] }));
  assert.equal(missingPayIdempotency.validPublicProof, false, "missing Pay idempotency proof must be invalid");
  assert(missingPayIdempotency.missingRequiredChecks.includes("pay.intent.idempotency"));
  const missingWebhookAudit = validateEvidence(buildFixture({ omit: ["pay.webhook.auditFields"] }));
  assert.equal(missingWebhookAudit.validPublicProof, false, "missing Pay webhook audit proof must be invalid");
  assert(missingWebhookAudit.missingRequiredChecks.includes("pay.webhook.auditFields"));
  const missingAIProposal = validateEvidence(buildFixture({ omit: ["ai.action.proposal.audit"] }));
  assert.equal(missingAIProposal.validPublicProof, false, "missing AI sensitive action proposal proof must be invalid");
  assert(missingAIProposal.missingRequiredChecks.includes("ai.action.proposal.audit"));
  const missingAIStream = validateEvidence(buildFixture({ omit: ["ai.stream.authenticatedSSE"] }));
  assert.equal(missingAIStream.validPublicProof, false, "missing authenticated AI streaming proof must be invalid");
  assert(missingAIStream.missingRequiredChecks.includes("ai.stream.authenticatedSSE"));
  const missingAIPermission = validateEvidence(buildFixture({ omit: ["ai.permission.active"] }));
  assert.equal(missingAIPermission.validPublicProof, false, "missing AI permission proof must be invalid");
  assert(missingAIPermission.missingRequiredChecks.includes("ai.permission.active"));
  const failedAIApproval = validateEvidence(buildFixture({ fail: ["ai.action.approve.permissionGate"] }));
  assert.equal(failedAIApproval.validPublicProof, false, "failed AI permission-gated approval proof must be invalid");
  assert(failedAIApproval.failedRequiredChecks.includes("ai.action.approve.permissionGate"));
  const failed = validateEvidence(buildFixture({ fail: ["governance.request.illegal.nativeYnxtProtected"] }));
  assert.equal(failed.validPublicProof, false, "failed native YNXT protection proof must be invalid");
  assert(failed.failedRequiredChecks.includes("governance.request.illegal.nativeYnxtProtected"));
  const missingManifest = validateEvidence(buildFixture({ omit: ["release.manifest.chaindChecksum"] }));
  assert.equal(missingManifest.validPublicProof, false, "missing release manifest checksum proof must be invalid");
  assert(missingManifest.missingRequiredChecks.includes("release.manifest.chaindChecksum"));
  const skipped = validateEvidence(buildFixture({ includeSkipped: true }));
  assert.equal(skipped.validPublicProof, false, "skipped mutable remote actions must be invalid");
  assert.equal(skipped.skippedMutableActions, true);
  const staleCommit = buildFixture();
  staleCommit.gitCommit = "1111111111111111111111111111111111111111";
  staleCommit.expected.releaseCommit = "111111111111";
  staleCommit.expected.releaseName = "ynx-chain-111111111111";
  const staleCommitReport = validateEvidence(staleCommit);
  assert.equal(staleCommitReport.validPublicProof, false, "old commit evidence must not be valid public proof");
  assert(staleCommitReport.metadataProblems.some((problem) => problem.includes("current HEAD")));
  const localEndpoint = buildFixture();
  localEndpoint.endpoints.rpc = "http://127.0.0.1:6420";
  const localEndpointReport = validateEvidence(localEndpoint);
  assert.equal(localEndpointReport.validPublicProof, false, "localhost endpoints must not be valid public proof");
  assert(localEndpointReport.metadataProblems.some((problem) => problem.includes("endpoints.rpc")));
  const wrongIdentity = buildFixture();
  wrongIdentity.expected.cosmosChainId = "ynx_9102-1";
  const wrongIdentityReport = validateEvidence(wrongIdentity);
  assert.equal(wrongIdentityReport.validPublicProof, false, "old-chain identity must not be valid public proof");
  assert(wrongIdentityReport.metadataProblems.some((problem) => problem.includes("cosmosChainId")));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-public-proof-check-"));
  const out = path.join(tmp, "report.json");
  writeReport(out, valid);
  assert.equal(readJson(out).validPublicProof, true, "report should be written");
  console.log("public-proof-evidence-check self-test passed");
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  selfTest();
  process.exit(0);
}

const evidencePath = args.evidencePath || process.env.YNX_REMOTE_EVIDENCE_PATH || "tmp/verify-testnet/remote-evidence.json";
const report = validateEvidence(readJson(evidencePath));
writeReport(args.outPath, report);
if (!report.validPublicProof) {
  console.error(`public-proof evidence invalid: ${evidencePath}`);
  if (report.metadataProblems.length) console.error(`metadata problems: ${report.metadataProblems.join(", ")}`);
  if (report.missingRequiredChecks.length) console.error(`missing required checks: ${report.missingRequiredChecks.join(", ")}`);
  if (report.failedRequiredChecks.length) console.error(`failed required checks: ${report.failedRequiredChecks.join(", ")}`);
  if (report.failedChecks.length) console.error(`failed checks: ${report.failedChecks.join(", ")}`);
  if (report.skippedMutableActions) console.error("mutable remote actions were skipped");
  process.exit(1);
}
console.log(`public-proof evidence valid: ${evidencePath}`);
