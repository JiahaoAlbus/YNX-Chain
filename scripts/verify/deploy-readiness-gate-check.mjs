#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

function runNode(script, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function runGate(name, blocker) {
  const blockerPath = path.join(workDir, `${name}.json`);
  writeJson(blockerPath, blocker);
  return runNode(gateScript, {
    YNX_REMOTE_BLOCKER_JSON: blockerPath,
    YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
  });
}

function assertGateFails(name, blocker, expected) {
  const result = runGate(name, blocker);
  assert.notEqual(result.status, 0, `${name} should fail`);
  assert.match(`${result.stdout}\n${result.stderr}`, expected, `${name} should mention ${expected}`);
}

const remoteEvidencePath = path.join(workDir, "remote-evidence.json");
const hostKeyAuditPath = path.join(workDir, "host-key-audit.txt");
fs.writeFileSync(remoteEvidencePath, '{"generatedAt":"fresh"}\n');
fs.writeFileSync(hostKeyAuditPath, "host-key audit fresh\n");

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

assertGateFails("endpoint-blocker", {
  ...baseReady,
  deployReady: false,
  deployBlockers: {
    sources: [],
    nodes: [],
    endpoints: [{ name: "rest.status", endpoint: "https://rest.ynxweb4.com/status", classification: "http-error", detail: "HTTP 501" }],
  },
}, /remote SSH or public ingress evidence is not safe for mutation/);

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
const mismatchReport = runNode(reportScript, {
  YNX_VERIFY_TESTNET_OUT: workDir,
  YNX_REMOTE_EVIDENCE_PATH: mismatchRemoteEvidencePath,
  YNX_HOST_KEY_AUDIT_REPORT: mismatchHostKeyAuditPath,
  YNX_HOST_KEY_APPROVAL_REQUEST: missingApprovalRequestPath,
  YNX_HOST_KEY_APPROVAL_REQUEST_JSON: missingApprovalRequestJsonPath,
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
assert(mismatchReportJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalRequest" && item.classification === "missing-required-evidence"));
assert(mismatchReportJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalRequestJson" && item.classification === "missing-required-evidence"));
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
const mismatchBadJsonReport = runNode(reportScript, {
  YNX_VERIFY_TESTNET_OUT: workDir,
  YNX_REMOTE_EVIDENCE_PATH: mismatchRemoteEvidencePath,
  YNX_HOST_KEY_AUDIT_REPORT: mismatchHostKeyAuditPath,
  YNX_HOST_KEY_APPROVAL_REQUEST: badApprovalRequestPath,
  YNX_HOST_KEY_APPROVAL_REQUEST_JSON: badApprovalRequestJsonPath,
  YNX_LEGACY_INVENTORY_REPORT: path.join(workDir, "missing-legacy-inventory.txt"),
  YNX_REMOTE_BLOCKER_REPORT: path.join(workDir, "BAD_APPROVAL_REQUEST_BLOCKERS.md"),
  YNX_REMOTE_BLOCKER_JSON: mismatchBadJsonReportPath,
  YNX_DEPLOY_GATE_MAX_AGE_MINUTES: "120",
});
assert.equal(mismatchBadJsonReport.status, 0, `remote-blocker-report bad approval request run should write diagnostics: ${mismatchBadJsonReport.stderr}`);
const mismatchBadJson = JSON.parse(fs.readFileSync(mismatchBadJsonReportPath, "utf8"));
assert.equal(mismatchBadJson.sourceEvidence.hostKeyApprovalRequestJson.classification, "approval-request-mismatch");
assert(mismatchBadJson.deployBlockers.sources.some((item) => item.name === "hostKeyApprovalRequestJson" && item.classification === "approval-request-mismatch"));

console.log("deploy-readiness-gate-check passed");
