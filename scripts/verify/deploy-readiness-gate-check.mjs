#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-deploy-gate-check-"));
const gateScript = path.join(repoRoot, "scripts/verify/deploy-readiness-gate.mjs");
const reportScript = path.join(repoRoot, "scripts/verify/remote-blocker-report.mjs");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fileSha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runNode(script, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function currentGitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, `git rev-parse HEAD should work: ${result.stderr}`);
  return result.stdout.trim();
}

function runGate(name, blocker, env = {}) {
  const blockerPath = path.join(workDir, `${name}.json`);
  writeJson(blockerPath, blocker);
  return runNode(gateScript, {
    YNX_REMOTE_BLOCKER_JSON: blockerPath,
    YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
    ...env,
  });
}

function assertGateFails(name, blocker, expected, env = {}) {
  const result = runGate(name, blocker, env);
  assert.notEqual(result.status, 0, `${name} should fail`);
  assert.match(`${result.stdout}\n${result.stderr}`, expected, `${name} should mention ${expected}`);
}

const remoteEvidencePath = path.join(workDir, "remote-evidence.json");
const hostKeyAuditPath = path.join(workDir, "host-key-audit.txt");
const legacyInventoryPath = path.join(workDir, "legacy-inventory.txt");
const headCommit = currentGitCommit();
const releaseCommit = headCommit.slice(0, 12);
const upgradeSourceEvidencePath = path.join(workDir, "upgrade-source-release-evidence.json");
const sourceCommit = "111111111111";
writeJson(upgradeSourceEvidencePath, {
  schema: "ynx-upgrade-source-release-evidence/v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  target: { commit: releaseCommit, release: `ynx-chain-${releaseCommit}` },
  source: { commit: sourceCommit, release: `ynx-chain-${sourceCommit}` },
  nodes: ["primary", "singapore", "silicon-valley", "seoul"].map((role) => ({
    role,
    ok: true,
    observed: { sourceCommit, sourceRelease: `ynx-chain-${sourceCommit}` },
  })),
});
writeJson(remoteEvidencePath, {
  proofType: "remote-public-testnet-smoke",
  generatedAt: new Date().toISOString(),
  gitCommit: headCommit,
  status: "passed",
  expected: {
    cosmosChainId: "ynx_6423-1",
    evmChainId: 6423,
    evmChainIdHex: "0x1917",
    nativeSymbol: "YNXT",
    releaseCommit,
    releaseName: `ynx-chain-${releaseCommit}`,
  },
});
fs.writeFileSync(hostKeyAuditPath, "host-key audit fresh\n");
fs.writeFileSync(legacyInventoryPath, "legacy deployment inventory fresh\n");

const now = new Date().toISOString();
const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const baseReady = {
  generatedAt: now,
  evidenceStatus: "passed",
  deployReady: true,
  deployBlockers: { sources: [], nodes: [], endpoints: [] },
  sourceEvidence: {
    remoteEvidence: { path: remoteEvidencePath, required: true, exists: true, timestamp: now, classification: "fresh" },
    hostKeyAudit: { path: hostKeyAuditPath, required: true, exists: true, timestamp: now, classification: "fresh" },
  },
};

const ok = runGate("fresh-ready", baseReady);
assert.equal(ok.status, 0, `fresh-ready should pass: ${ok.stderr}`);

assertGateFails("old-format", {
  generatedAt: now,
  deployReady: true,
  deployBlockers: { nodes: [], endpoints: [] },
}, /required source evidence metadata is missing/);

assertGateFails("stale-source", {
  ...baseReady,
  sourceEvidence: {
    ...baseReady.sourceEvidence,
    remoteEvidence: { ...baseReady.sourceEvidence.remoteEvidence, timestamp: stale, classification: "stale-required-evidence" },
  },
}, /required source evidence is missing or stale/);

assertGateFails("missing-source-file", {
  ...baseReady,
  sourceEvidence: {
    ...baseReady.sourceEvidence,
    hostKeyAudit: { ...baseReady.sourceEvidence.hostKeyAudit, path: path.join(workDir, "deleted-host-key-audit.txt") },
  },
}, /source path no longer exists/);

const staleCommitRemoteEvidencePath = path.join(workDir, "remote-evidence-stale-commit.json");
writeJson(staleCommitRemoteEvidencePath, {
  proofType: "remote-public-testnet-smoke",
  generatedAt: now,
  gitCommit: "1111111111111111111111111111111111111111",
  expected: {
    cosmosChainId: "ynx_6423-1",
    evmChainId: 6423,
    evmChainIdHex: "0x1917",
    nativeSymbol: "YNXT",
    releaseCommit: "111111111111",
    releaseName: "ynx-chain-111111111111",
  },
});
assertGateFails("stale-commit-remote-evidence", {
  ...baseReady,
  sourceEvidence: {
    ...baseReady.sourceEvidence,
    remoteEvidence: { ...baseReady.sourceEvidence.remoteEvidence, path: staleCommitRemoteEvidencePath },
  },
}, /does not match current HEAD/);

const failedStatusRemoteEvidencePath = path.join(workDir, "remote-evidence-failed-status.json");
writeJson(failedStatusRemoteEvidencePath, {
  proofType: "remote-public-testnet-smoke",
  generatedAt: now,
  gitCommit: headCommit,
  status: "failed",
  expected: {
    cosmosChainId: "ynx_6423-1",
    evmChainId: 6423,
    evmChainIdHex: "0x1917",
    nativeSymbol: "YNXT",
    releaseCommit,
    releaseName: `ynx-chain-${releaseCommit}`,
  },
});
assertGateFails("failed-status-remote-evidence", {
  ...baseReady,
  sourceEvidence: {
    ...baseReady.sourceEvidence,
    remoteEvidence: { ...baseReady.sourceEvidence.remoteEvidence, path: failedStatusRemoteEvidencePath },
  },
}, /status must be passed/);

const upgradeRemoteEvidencePath = path.join(workDir, "remote-evidence-upgrade.json");
writeJson(upgradeRemoteEvidencePath, {
  proofType: "remote-public-testnet-smoke",
  generatedAt: now,
  gitCommit: headCommit,
  status: "failed",
  expected: {
    cosmosChainId: "ynx_6423-1", evmChainId: 6423, evmChainIdHex: "0x1917", nativeSymbol: "YNXT",
    releaseCommit, releaseName: `ynx-chain-${releaseCommit}`,
  },
  checks: [
    { name: "rpc.status.chain", ok: true },
    { name: "rpc.status.height.growth", ok: true },
    { name: "rpc.status.buildCommit", ok: false },
    { name: "release.manifest.evidence.present", ok: false },
    { name: "release.manifest.chaindChecksum", ok: false },
    { name: "web4.health.chain", ok: false },
    { name: "mutable.remote.actions", ok: false },
  ],
});
const upgradeReady = {
  ...baseReady,
  deployReady: false,
  sourceEvidence: {
    ...baseReady.sourceEvidence,
    remoteEvidence: { ...baseReady.sourceEvidence.remoteEvidence, path: upgradeRemoteEvidencePath },
  },
  deployBlockers: {
    sources: [], nodes: [],
    endpoints: [
      { name: "rpc.status.buildCommit", classification: "release-identity-missing" },
      { name: "release.manifest.evidence.present", classification: "target-release-not-installed" },
      { name: "release.manifest.chaindChecksum", classification: "target-release-not-installed" },
      { name: "web4.health.chain", classification: "legacy-chain" },
      { name: "mutable.remote.actions", classification: "gated-mutation-skipped" },
    ],
  },
};
const upgradeEnv = { YNX_UPGRADE_DEPLOY: "1", YNX_UPGRADE_SOURCE_RELEASE_EVIDENCE_PATH: upgradeSourceEvidencePath };
const upgradeOk = runGate("restricted-upgrade", upgradeReady, upgradeEnv);
assert.equal(upgradeOk.status, 0, `restricted upgrade should pass known source/target differences: ${upgradeOk.stderr}`);
assert.match(upgradeOk.stdout, /restricted upgrade mode/);

const unsafeUpgradeEvidencePath = path.join(workDir, "remote-evidence-unsafe-upgrade.json");
writeJson(unsafeUpgradeEvidencePath, {
  ...JSON.parse(fs.readFileSync(upgradeRemoteEvidencePath, "utf8")),
  checks: [{ name: "rpc.status.height.growth", ok: false }],
});
const unsafeUpgrade = runGate("unsafe-upgrade", {
  ...upgradeReady,
  sourceEvidence: {
    ...upgradeReady.sourceEvidence,
    remoteEvidence: { ...upgradeReady.sourceEvidence.remoteEvidence, path: unsafeUpgradeEvidencePath },
  },
}, upgradeEnv);
assert.notEqual(unsafeUpgrade.status, 0, "upgrade mode must reject non-release failures");
assert.match(`${unsafeUpgrade.stdout}\n${unsafeUpgrade.stderr}`, /unsafe failures/);

assertGateFails("missing-upgrade-source-evidence", upgradeReady, /upgrade source release evidence: missing or unreadable/, {
  YNX_UPGRADE_DEPLOY: "1",
  YNX_UPGRADE_SOURCE_RELEASE_EVIDENCE_PATH: path.join(workDir, "missing-upgrade-source-release-evidence.json"),
});

const failedUpgradeSourceEvidencePath = path.join(workDir, "failed-upgrade-source-release-evidence.json");
writeJson(failedUpgradeSourceEvidencePath, {
  ...JSON.parse(fs.readFileSync(upgradeSourceEvidencePath, "utf8")),
  status: "failed",
  nodes: JSON.parse(fs.readFileSync(upgradeSourceEvidencePath, "utf8")).nodes.map((node) => node.role === "seoul" ? { ...node, ok: false } : node),
});
assertGateFails("failed-upgrade-source-evidence", upgradeReady, /seoul did not prove/, {
  YNX_UPGRADE_DEPLOY: "1",
  YNX_UPGRADE_SOURCE_RELEASE_EVIDENCE_PATH: failedUpgradeSourceEvidencePath,
});

assertGateFails("endpoint-blocker", {
  ...baseReady,
  deployReady: false,
  deployBlockers: {
    sources: [],
    nodes: [],
    endpoints: [{ name: "rest.status", endpoint: "https://rest.ynxweb4.com/status", classification: "http-error", detail: "HTTP 501" }],
  },
}, /remote SSH or public ingress evidence is not safe for mutation/);

const bootstrapReady = {
  ...baseReady,
  deployReady: false,
  sourceEvidence: {
    ...baseReady.sourceEvidence,
    remoteEvidence: { ...baseReady.sourceEvidence.remoteEvidence, path: failedStatusRemoteEvidencePath },
    legacyInventory: { path: legacyInventoryPath, required: false, exists: true, timestamp: now, classification: "fresh" },
  },
  deployBlockers: {
    sources: [],
    nodes: [],
    endpoints: [{ name: "rpc.status.chain", endpoint: "https://rpc.ynxweb4.com/status", classification: "legacy-chain", detail: "old chain is still serving before bootstrap" }],
  },
};
const bootstrapOk = runGate("explicit-bootstrap", bootstrapReady, { YNX_BOOTSTRAP_DEPLOY: "1" });
assert.equal(bootstrapOk.status, 0, `explicit bootstrap should pass with fresh SSH and inventory evidence: ${bootstrapOk.stderr}`);
assert.match(bootstrapOk.stdout, /passed in explicit bootstrap mode/);

const bootstrapMissingInventory = {
  ...bootstrapReady,
  sourceEvidence: {
    ...bootstrapReady.sourceEvidence,
    legacyInventory: { ...bootstrapReady.sourceEvidence.legacyInventory, exists: false, path: path.join(workDir, "missing-legacy-inventory.txt") },
  },
};
const missingInventoryResult = runGate("bootstrap-missing-inventory", bootstrapMissingInventory, { YNX_BOOTSTRAP_DEPLOY: "1" });
assert.notEqual(missingInventoryResult.status, 0, "bootstrap must fail without a fresh legacy inventory");
assert.match(`${missingInventoryResult.stdout}\n${missingInventoryResult.stderr}`, /legacy deployment inventory/);

const bootstrapUnsafeNode = {
  ...bootstrapReady,
  deployBlockers: {
    ...bootstrapReady.deployBlockers,
    nodes: [{ role: "singapore", login: "root@43.134.23.58", host: "43.134.23.58", classification: "host-key-mismatch", detail: "strict SSH rejected" }],
  },
};
const unsafeBootstrapResult = runGate("bootstrap-unsafe-node", bootstrapUnsafeNode, { YNX_BOOTSTRAP_DEPLOY: "1" });
assert.notEqual(unsafeBootstrapResult.status, 0, "bootstrap must not bypass SSH blockers");
assert.match(`${unsafeBootstrapResult.stdout}\n${unsafeBootstrapResult.stderr}`, /unsafe source or SSH evidence/);

const semanticRemoteEvidencePath = path.join(workDir, "semantic-remote-evidence.json");
const semanticHostKeyAuditPath = path.join(workDir, "semantic-host-key-audit.txt");
const semanticReportJsonPath = path.join(workDir, "remote-blockers-semantic-endpoints.json");
writeJson(semanticRemoteEvidencePath, {
  generatedAt: now,
  status: "failed",
  expected: { cosmosChainId: "ynx_6423-1", evmChainId: 6423, evmChainIdHex: "0x1917", nativeSymbol: "YNXT", minValidators: 3 },
  checks: [
    { name: "release.manifest.evidence.present", ok: false, detail: "missing release manifest evidence", observed: {} },
    { name: "rpc.status.buildCommit", ok: false, detail: "expected commit, got missing", observed: {} },
    { name: "rpc.nodeIdentity.configured", ok: false, detail: "missing configured validator identity", observed: { url: "https://rpc.ynxweb4.com/node/identity" } },
    { name: "rpc.status.chainId", ok: false, detail: "expected ynx_6423-1, got ynx_9102-1", observed: { chainId: "ynx_9102-1", url: "https://rpc.ynxweb4.com/status" } },
    { name: "evm.chainId", ok: false, detail: "expected 0x1917, got 0x238e", observed: { result: "0x238e", url: "https://evm.ynxweb4.com" } },
    { name: "rpc.validators.count", ok: false, detail: "expected at least 3 validators, got 0", observed: { count: 0, url: "https://rpc.ynxweb4.com/validators" } },
    { name: "rpc.validators.monikers", ok: false, detail: "missing validator monikers", observed: { monikers: [], url: "https://rpc.ynxweb4.com/validators" } },
    { name: "rpc.validators.peerReadiness", ok: false, detail: "missing validator peer readiness", observed: { url: "https://rpc.ynxweb4.com/validators" } },
    { name: "rpc.validators.peers.expected", ok: false, detail: "missing expected validator peers", observed: { url: "https://rpc.ynxweb4.com/validators/peers" } },
    { name: "rpc.validators.peerSync", ok: false, detail: "missing validator peer sync", observed: { url: "https://rpc.ynxweb4.com/validators/peer-sync" } },
    { name: "rpc.blockGrowth", ok: false, detail: "height did not grow", observed: { before: 10, after: 10, url: "https://rpc.ynxweb4.com/status" } },
    { name: "mutable.remote.actions", ok: false, detail: "skipped because public chain readiness failed", observed: { reason: "publicChainReady=false" } },
  ],
});
fs.writeFileSync(semanticHostKeyAuditPath, [
  "== primary ynx@43.153.202.237 ==",
  "OK strict ssh accepted current host key",
  "",
].join("\n"));
const semanticReport = runNode(reportScript, {
  YNX_VERIFY_TESTNET_OUT: workDir,
  YNX_REMOTE_EVIDENCE_PATH: semanticRemoteEvidencePath,
  YNX_HOST_KEY_AUDIT_REPORT: semanticHostKeyAuditPath,
  YNX_LEGACY_INVENTORY_REPORT: path.join(workDir, "missing-legacy-inventory.txt"),
  YNX_REMOTE_BLOCKER_REPORT: path.join(workDir, "SEMANTIC_REMOTE_BLOCKERS.md"),
  YNX_REMOTE_BLOCKER_JSON: semanticReportJsonPath,
  YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
});
assert.equal(semanticReport.status, 0, `remote-blocker-report semantic endpoint run should write diagnostics: ${semanticReport.stderr}`);
const semanticJson = JSON.parse(fs.readFileSync(semanticReportJsonPath, "utf8"));
assert.equal(semanticJson.deployReady, false, "semantic public endpoint failures must block deploy readiness");
for (const classification of [
  "legacy-chain",
  "release-manifest-missing",
  "release-identity-missing",
  "validator-node-identity-missing",
  "wrong-chain-id",
  "validator-set-empty",
  "validator-metadata-missing",
  "validator-peer-readiness-missing",
  "validator-peer-discovery-missing",
  "validator-peer-sync-missing",
  "dependent-height-failure",
  "gated-mutation-skipped",
]) {
  assert(
    semanticJson.deployBlockers.endpoints.some((item) => item.classification === classification),
    `expected ${classification} endpoint finding to be deploy-blocking`
  );
}

const staleCommitReportJsonPath = path.join(workDir, "remote-blockers-stale-commit-source.json");
const staleCommitHostKeyAuditPath = path.join(workDir, "stale-commit-host-key-audit.txt");
fs.writeFileSync(staleCommitHostKeyAuditPath, [
  "== primary ynx@43.153.202.237 ==",
  "OK strict ssh accepted current host key",
  "",
].join("\n"));
const staleCommitReport = runNode(reportScript, {
  YNX_VERIFY_TESTNET_OUT: workDir,
  YNX_REMOTE_EVIDENCE_PATH: staleCommitRemoteEvidencePath,
  YNX_HOST_KEY_AUDIT_REPORT: staleCommitHostKeyAuditPath,
  YNX_LEGACY_INVENTORY_REPORT: path.join(workDir, "missing-legacy-inventory.txt"),
  YNX_REMOTE_BLOCKER_REPORT: path.join(workDir, "STALE_COMMIT_REMOTE_BLOCKERS.md"),
  YNX_REMOTE_BLOCKER_JSON: staleCommitReportJsonPath,
  YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
});
assert.equal(staleCommitReport.status, 0, `remote-blocker-report stale commit run should write diagnostics: ${staleCommitReport.stderr}`);
const staleCommitReportJson = JSON.parse(fs.readFileSync(staleCommitReportJsonPath, "utf8"));
assert.equal(staleCommitReportJson.sourceEvidence.remoteEvidence.classification, "remote-evidence-identity-mismatch");
assert(staleCommitReportJson.deployBlockers.sources.some((item) => item.name === "remoteEvidence" && item.classification === "remote-evidence-identity-mismatch"));

const reportJsonPath = path.join(workDir, "remote-blockers-missing-sources.json");
const report = runNode(reportScript, {
  YNX_VERIFY_TESTNET_OUT: workDir,
  YNX_REMOTE_EVIDENCE_PATH: path.join(workDir, "missing-remote-evidence.json"),
  YNX_HOST_KEY_AUDIT_REPORT: path.join(workDir, "missing-host-key-audit.txt"),
  YNX_LEGACY_INVENTORY_REPORT: path.join(workDir, "missing-legacy-inventory.txt"),
  YNX_REMOTE_BLOCKER_REPORT: path.join(workDir, "REMOTE_BLOCKERS.md"),
  YNX_REMOTE_BLOCKER_JSON: reportJsonPath,
  YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
});
assert.equal(report.status, 0, `remote-blocker-report missing-source run should write diagnostics: ${report.stderr}`);
const reportJson = JSON.parse(fs.readFileSync(reportJsonPath, "utf8"));
assert.equal(reportJson.deployReady, false, "missing source evidence must block deploy readiness");
assert.equal(reportJson.sourceEvidence.remoteEvidence.exists, false, "remote evidence missing must be recorded");
assert.equal(reportJson.sourceEvidence.hostKeyAudit.exists, false, "host-key audit missing must be recorded");
assert(reportJson.deployBlockers.sources.some((item) => item.name === "remoteEvidence" && item.classification === "missing-required-evidence"));
assert(reportJson.deployBlockers.sources.some((item) => item.name === "hostKeyAudit" && item.classification === "missing-required-evidence"));

const mismatchRemoteEvidencePath = path.join(workDir, "mismatch-remote-evidence.json");
const mismatchHostKeyAuditPath = path.join(workDir, "mismatch-host-key-audit.txt");
const missingApprovalRequestPath = path.join(workDir, "missing-approval-request.md");
const missingApprovalRequestJsonPath = path.join(workDir, "missing-approval-request.json");
const missingApprovalPacketPath = path.join(workDir, "missing-approval-packet.md");
const missingApprovalPacketJsonPath = path.join(workDir, "missing-approval-packet.json");
const missingApprovalStatusJsonPath = path.join(workDir, "missing-approval-status.json");
const mismatchReportJsonPath = path.join(workDir, "remote-blockers-missing-approval-request.json");
writeJson(mismatchRemoteEvidencePath, {
  generatedAt: now,
  status: "failed",
  expected: { cosmosChainId: "ynx_6423-1", evmChainId: 6423, evmChainIdHex: "0x1917", nativeSymbol: "YNXT", minValidators: 3 },
  checks: [],
});
fs.writeFileSync(mismatchHostKeyAuditPath, [
  "== singapore root@43.134.23.58 ==",
  "-- presented host key fingerprints",
  "256 SHA256:expected-singapore-ed25519 43.134.23.58 (ED25519)",
  "-- strict ssh check",
  "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @",
  "Host key verification failed.",
  "",
].join("\n"));
const mismatchHostKeyAuditSha256 = fileSha256(mismatchHostKeyAuditPath);
const mismatchReport = runNode(reportScript, {
  YNX_VERIFY_TESTNET_OUT: workDir,
  YNX_REMOTE_EVIDENCE_PATH: mismatchRemoteEvidencePath,
  YNX_HOST_KEY_AUDIT_REPORT: mismatchHostKeyAuditPath,
  YNX_HOST_KEY_APPROVAL_REQUEST: missingApprovalRequestPath,
  YNX_HOST_KEY_APPROVAL_REQUEST_JSON: missingApprovalRequestJsonPath,
  YNX_HOST_KEY_APPROVAL_PACKET: missingApprovalPacketPath,
  YNX_HOST_KEY_APPROVAL_PACKET_JSON: missingApprovalPacketJsonPath,
  YNX_HOST_KEY_APPROVAL_STATUS_JSON: missingApprovalStatusJsonPath,
  YNX_LEGACY_INVENTORY_REPORT: path.join(workDir, "missing-legacy-inventory.txt"),
  YNX_REMOTE_BLOCKER_REPORT: path.join(workDir, "MISMATCH_REMOTE_BLOCKERS.md"),
  YNX_REMOTE_BLOCKER_JSON: mismatchReportJsonPath,
  YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
});
assert.equal(mismatchReport.status, 0, `remote-blocker-report mismatch run should write diagnostics: ${mismatchReport.stderr}`);
const mismatchReportJson = JSON.parse(fs.readFileSync(mismatchReportJsonPath, "utf8"));
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalRequest.required, true, "approval request must be required while host-key mismatch exists");
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalRequest.exists, false, "missing approval request must be recorded");
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalRequestJson.required, true, "approval request JSON must be required while host-key mismatch exists");
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalRequestJson.exists, false, "missing approval request JSON must be recorded");
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalPacket.required, true, "approval packet must be required while host-key mismatch exists");
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalPacket.exists, false, "missing approval packet must be recorded");
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalPacketJson.required, true, "approval packet JSON must be required while host-key mismatch exists");
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalPacketJson.exists, false, "missing approval packet JSON must be recorded");
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalStatusJson.required, true, "approval status JSON must be required while host-key mismatch exists");
assert.equal(mismatchReportJson.sourceEvidence.hostKeyApprovalStatusJson.exists, false, "missing approval status JSON must be recorded");
assert(mismatchReportJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalRequest" && item.classification === "missing-required-evidence"));
assert(mismatchReportJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalRequestJson" && item.classification === "missing-required-evidence"));
assert(mismatchReportJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalPacket" && item.classification === "missing-required-evidence"));
assert(mismatchReportJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalPacketJson" && item.classification === "missing-required-evidence"));
assert(mismatchReportJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalStatusJson" && item.classification === "missing-required-evidence"));
assertGateFails("missing-dynamic-required-source", {
  ...baseReady,
  deployReady: false,
  sourceEvidence: {
    ...baseReady.sourceEvidence,
    hostKeyApprovalRequest: { path: missingApprovalRequestPath, required: true, exists: false, classification: "missing-required-evidence" },
  },
  deployBlockers: {
    sources: [{ name: "hostKeyApprovalRequest", path: missingApprovalRequestPath, required: true, exists: false, classification: "missing-required-evidence" }],
    nodes: [],
    endpoints: [],
  },
}, /required source evidence is missing or stale/);

const badApprovalRequestPath = path.join(workDir, "bad-approval-request.md");
const badApprovalRequestJsonPath = path.join(workDir, "bad-approval-request.json");
const badApprovalPacketPath = path.join(workDir, "bad-approval-packet.md");
const badApprovalPacketJsonPath = path.join(workDir, "bad-approval-packet.json");
const awaitingApprovalStatusJsonPath = path.join(workDir, "awaiting-approval-status.json");
const mismatchBadJsonReportPath = path.join(workDir, "remote-blockers-bad-approval-request.json");
fs.writeFileSync(badApprovalRequestPath, "# Host Key Approval Request\n");
writeJson(badApprovalRequestJsonPath, {
  generatedAt: now,
  trustedApproval: false,
  rows: [{
    role: "singapore",
    host: "43.134.23.58",
    keyType: "ED25519",
    presentedFingerprint: "SHA256:stale-singapore-ed25519",
    trustedFingerprint: "",
    status: "needs-out-of-band-confirmation",
  }],
});
fs.writeFileSync(badApprovalPacketPath, "# Host Key External Approval Packet\n");
writeJson(badApprovalPacketJsonPath, {
  generatedAt: now,
  hostKeyAuditPath: mismatchHostKeyAuditPath,
  hostKeyAuditSha256: mismatchHostKeyAuditSha256,
  trustedApproval: false,
  trustedSourceRequired: true,
  rows: [{
    role: "singapore",
    host: "43.134.23.58",
    keyType: "ED25519",
    presentedFingerprint: "SHA256:expected-singapore-ed25519",
    trustedFingerprint: "",
    operatorDecision: "",
  }],
  approvalDraft: {
    nodes: [{
      role: "singapore",
      host: "43.134.23.58",
      fingerprints: { ED25519: "SHA256:should-remain-blank" },
    }],
  },
});
writeJson(awaitingApprovalStatusJsonPath, {
  generatedAt: now,
  ok: false,
  status: "awaiting-trusted-approval",
  approvalPath: path.join(workDir, ".host-key-approvals.json"),
  approvalFileExists: false,
  approvalFileReadable: false,
  approvalRequestJsonPath: badApprovalRequestJsonPath,
  approvalRequestJsonExists: true,
  approvalRequestJsonReadable: true,
  approvalRequestRowCount: 1,
  mismatchNodeCount: 1,
  findings: [{
    role: "singapore",
    host: "43.134.23.58",
    keyType: "ED25519",
    presented: "SHA256:expected-singapore-ed25519",
    approved: "",
    ok: false,
    reason: "trusted fingerprint not yet recorded in ignored .host-key-approvals.json",
  }],
  note: "Non-mutating status only; not trusted approval and not known_hosts repair.",
});
const mismatchBadJsonReport = runNode(reportScript, {
  YNX_VERIFY_TESTNET_OUT: workDir,
  YNX_REMOTE_EVIDENCE_PATH: mismatchRemoteEvidencePath,
  YNX_HOST_KEY_AUDIT_REPORT: mismatchHostKeyAuditPath,
  YNX_HOST_KEY_APPROVAL_REQUEST: badApprovalRequestPath,
  YNX_HOST_KEY_APPROVAL_REQUEST_JSON: badApprovalRequestJsonPath,
  YNX_HOST_KEY_APPROVAL_PACKET: badApprovalPacketPath,
  YNX_HOST_KEY_APPROVAL_PACKET_JSON: badApprovalPacketJsonPath,
  YNX_HOST_KEY_APPROVAL_STATUS_JSON: awaitingApprovalStatusJsonPath,
  YNX_LEGACY_INVENTORY_REPORT: path.join(workDir, "missing-legacy-inventory.txt"),
  YNX_REMOTE_BLOCKER_REPORT: path.join(workDir, "BAD_APPROVAL_REQUEST_BLOCKERS.md"),
  YNX_REMOTE_BLOCKER_JSON: mismatchBadJsonReportPath,
  YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
});
assert.equal(mismatchBadJsonReport.status, 0, `remote-blocker-report bad approval request run should write diagnostics: ${mismatchBadJsonReport.stderr}`);
const mismatchBadJson = JSON.parse(fs.readFileSync(mismatchBadJsonReportPath, "utf8"));
assert.equal(mismatchBadJson.sourceEvidence.hostKeyApprovalRequestJson.classification, "approval-request-mismatch");
assert.equal(mismatchBadJson.sourceEvidence.hostKeyApprovalPacketJson.classification, "approval-packet-mismatch");
assert.equal(mismatchBadJson.sourceEvidence.hostKeyApprovalStatusJson.classification, "approval-awaiting-trusted-confirmation");
assert(mismatchBadJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalRequestJson" && item.classification === "approval-request-mismatch"));
assert(mismatchBadJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalPacketJson" && item.classification === "approval-packet-mismatch"));
assert(mismatchBadJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalStatusJson" && item.classification === "approval-awaiting-trusted-confirmation"));

const approvedApprovalRequestPath = path.join(workDir, "approved-approval-request.md");
const approvedApprovalRequestJsonPath = path.join(workDir, "approved-approval-request.json");
const approvedApprovalPacketPath = path.join(workDir, "approved-approval-packet.md");
const approvedApprovalPacketJsonPath = path.join(workDir, "approved-approval-packet.json");
const oldApprovedStatusJsonPath = path.join(workDir, "old-approved-status.json");
const oldApprovedStatusReportPath = path.join(workDir, "remote-blockers-old-approved-status.json");
fs.writeFileSync(approvedApprovalRequestPath, "# Host Key Approval Request\n");
writeJson(approvedApprovalRequestJsonPath, {
  generatedAt: now,
  trustedApproval: false,
  rows: [{
    role: "singapore",
    host: "43.134.23.58",
    keyType: "ED25519",
    presentedFingerprint: "SHA256:expected-singapore-ed25519",
    trustedFingerprint: "",
    status: "needs-out-of-band-confirmation",
  }],
});
fs.writeFileSync(approvedApprovalPacketPath, "# Host Key External Approval Packet\n");
writeJson(approvedApprovalPacketJsonPath, {
  generatedAt: now,
  hostKeyAuditPath: mismatchHostKeyAuditPath,
  hostKeyAuditSha256: mismatchHostKeyAuditSha256,
  trustedApproval: false,
  trustedSourceRequired: true,
  rows: [{
    role: "singapore",
    host: "43.134.23.58",
    keyType: "ED25519",
    presentedFingerprint: "SHA256:expected-singapore-ed25519",
    trustedFingerprint: "",
    operatorDecision: "",
  }],
  approvalDraft: {
    nodes: [{
      role: "singapore",
      host: "43.134.23.58",
      fingerprints: { ED25519: "" },
    }],
  },
});
writeJson(oldApprovedStatusJsonPath, {
  generatedAt: now,
  ok: true,
  status: "approved-current-scan",
  approvalRequestJsonPath: approvedApprovalRequestJsonPath,
  approvalRequestJsonExists: true,
  approvalRequestJsonReadable: true,
  approvalRequestRowCount: 1,
  mismatchNodeCount: 1,
  findings: [{
    role: "singapore",
    host: "43.134.23.58",
    keyType: "ED25519",
    presented: "SHA256:expected-singapore-ed25519",
    approved: "SHA256:expected-singapore-ed25519",
    ok: true,
    reason: "compared",
  }],
  note: "Non-mutating status only; not trusted approval and not known_hosts repair.",
});
const oldApprovedStatusReport = runNode(reportScript, {
  YNX_VERIFY_TESTNET_OUT: workDir,
  YNX_REMOTE_EVIDENCE_PATH: mismatchRemoteEvidencePath,
  YNX_HOST_KEY_AUDIT_REPORT: mismatchHostKeyAuditPath,
  YNX_HOST_KEY_APPROVAL_REQUEST: approvedApprovalRequestPath,
  YNX_HOST_KEY_APPROVAL_REQUEST_JSON: approvedApprovalRequestJsonPath,
  YNX_HOST_KEY_APPROVAL_PACKET: approvedApprovalPacketPath,
  YNX_HOST_KEY_APPROVAL_PACKET_JSON: approvedApprovalPacketJsonPath,
  YNX_HOST_KEY_APPROVAL_STATUS_JSON: oldApprovedStatusJsonPath,
  YNX_LEGACY_INVENTORY_REPORT: path.join(workDir, "missing-legacy-inventory.txt"),
  YNX_REMOTE_BLOCKER_REPORT: path.join(workDir, "OLD_APPROVED_STATUS_BLOCKERS.md"),
  YNX_REMOTE_BLOCKER_JSON: oldApprovedStatusReportPath,
  YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
});
assert.equal(oldApprovedStatusReport.status, 0, `remote-blocker-report old approved status run should write diagnostics: ${oldApprovedStatusReport.stderr}`);
const oldApprovedStatusJson = JSON.parse(fs.readFileSync(oldApprovedStatusReportPath, "utf8"));
assert.equal(oldApprovedStatusJson.sourceEvidence.hostKeyApprovalStatusJson.classification, "approval-status-missing-audit-metadata");
assert(oldApprovedStatusJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalStatusJson" && item.classification === "approval-status-missing-audit-metadata"));

const wrongAuditApprovedStatusJsonPath = path.join(workDir, "wrong-audit-approved-status.json");
const wrongAuditApprovedStatusReportPath = path.join(workDir, "remote-blockers-wrong-audit-approved-status.json");
writeJson(wrongAuditApprovedStatusJsonPath, {
  generatedAt: now,
  ok: true,
  status: "approved-current-scan",
  currentHostKeyAuditSha256: mismatchHostKeyAuditSha256,
  approvalMetadata: {
    hostKeyAuditSha256: "wrong-audit-sha256",
    source: "cloud-console",
    approvedAt: now,
    approvedBy: "fixture approver",
    verificationChannel: "fixture trusted channel",
    evidence: "fixture evidence",
  },
  approvalRequestJsonPath: approvedApprovalRequestJsonPath,
  approvalRequestJsonExists: true,
  approvalRequestJsonReadable: true,
  approvalRequestRowCount: 1,
  mismatchNodeCount: 1,
  findings: [{
    role: "singapore",
    host: "43.134.23.58",
    keyType: "ED25519",
    presented: "SHA256:expected-singapore-ed25519",
    approved: "SHA256:expected-singapore-ed25519",
    ok: true,
    reason: "compared",
  }],
  note: "Non-mutating status only; not trusted approval and not known_hosts repair.",
});
const wrongAuditApprovedStatusReport = runNode(reportScript, {
  YNX_VERIFY_TESTNET_OUT: workDir,
  YNX_REMOTE_EVIDENCE_PATH: mismatchRemoteEvidencePath,
  YNX_HOST_KEY_AUDIT_REPORT: mismatchHostKeyAuditPath,
  YNX_HOST_KEY_APPROVAL_REQUEST: approvedApprovalRequestPath,
  YNX_HOST_KEY_APPROVAL_REQUEST_JSON: approvedApprovalRequestJsonPath,
  YNX_HOST_KEY_APPROVAL_PACKET: approvedApprovalPacketPath,
  YNX_HOST_KEY_APPROVAL_PACKET_JSON: approvedApprovalPacketJsonPath,
  YNX_HOST_KEY_APPROVAL_STATUS_JSON: wrongAuditApprovedStatusJsonPath,
  YNX_LEGACY_INVENTORY_REPORT: path.join(workDir, "missing-legacy-inventory.txt"),
  YNX_REMOTE_BLOCKER_REPORT: path.join(workDir, "WRONG_AUDIT_APPROVED_STATUS_BLOCKERS.md"),
  YNX_REMOTE_BLOCKER_JSON: wrongAuditApprovedStatusReportPath,
  YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
});
assert.equal(wrongAuditApprovedStatusReport.status, 0, `remote-blocker-report wrong audit approved status run should write diagnostics: ${wrongAuditApprovedStatusReport.stderr}`);
const wrongAuditApprovedStatusJson = JSON.parse(fs.readFileSync(wrongAuditApprovedStatusReportPath, "utf8"));
assert.equal(wrongAuditApprovedStatusJson.sourceEvidence.hostKeyApprovalStatusJson.classification, "approval-status-audit-mismatch");
assert(wrongAuditApprovedStatusJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalStatusJson" && item.classification === "approval-status-audit-mismatch"));

console.log("deploy-readiness-gate-check passed");
