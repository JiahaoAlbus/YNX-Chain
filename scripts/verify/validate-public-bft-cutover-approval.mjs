#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error("public BFT cutover approval rejected: " + message);
}

const approvalPath = process.argv[2];
const expectedCommit = String(process.argv[3] || "");
const expectedRelease = String(process.argv[4] || "");
if (!approvalPath || !expectedCommit || !expectedRelease) fail("approval path, commit, and release are required");
if (!/^[0-9a-f]{12}$/.test(expectedCommit)) fail("expected commit must be 12 lowercase hexadecimal characters");
if (expectedRelease !== "ynx-bft-gateway-" + expectedCommit) fail("expected release is not bound to the expected commit");

const absolutePath = path.resolve(approvalPath);
const stat = fs.statSync(absolutePath);
if (!stat.isFile()) fail("approval path is not a regular file");
if ((stat.mode & 0o077) !== 0) fail("approval file permissions must be 0600 or stricter");

let approval;
try {
  approval = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
} catch (error) {
  fail("approval file is not valid JSON: " + error.message);
}
if (approval.schemaVersion !== 1 || approval.action !== "ynx-public-bft-cutover" || approval.approved !== true) {
  fail("schema, action, or approved flag is invalid");
}
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(approval.approvalId || "")) fail("approvalId is invalid");
if (typeof approval.approver !== "string" || approval.approver.trim().length < 3) fail("approver is required");
if (approval.commit !== expectedCommit || approval.release !== expectedRelease) fail("approval is bound to a different commit or release");
if (approval.publicCutoverAuthorized !== true || approval.automaticRollbackRequired !== true) {
  fail("explicit cutover authorization and automatic rollback consent are required");
}
if (!/^[0-9a-f]{64}$/.test(approval.validatorManifestSha256 || "")) {
  fail("validatorManifestSha256 is required");
}
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(approval.candidateGenesisTime || "") || !Number.isFinite(Date.parse(approval.candidateGenesisTime))) {
  fail("candidateGenesisTime must be whole-second UTC RFC3339");
}
const expiresAt = Date.parse(approval.expiresAt || "");
if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 24 * 60 * 60 * 1000) {
  fail("expiresAt must be in the future and no more than 24 hours away");
}
if (Date.parse(approval.candidateGenesisTime) > expiresAt) fail("candidateGenesisTime must not exceed approval expiry");

process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  action: "ynx-public-bft-cutover",
  approved: true,
  approvalId: approval.approvalId,
  approver: approval.approver.trim(),
  commit: expectedCommit,
  release: expectedRelease,
  publicCutoverAuthorized: true,
  automaticRollbackRequired: true,
  validatorManifestSha256: approval.validatorManifestSha256,
  candidateGenesisTime: approval.candidateGenesisTime,
  expiresAt: new Date(expiresAt).toISOString().replace(".000Z", "Z"),
}) + "\n");
