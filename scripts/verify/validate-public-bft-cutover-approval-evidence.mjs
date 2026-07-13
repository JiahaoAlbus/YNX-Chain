#!/usr/bin/env node

import fs from "node:fs";

function fail(message) {
  throw new Error(`public BFT cutover approval evidence rejected: ${message}`);
}

const [approvalPath, expectedCommit, expectedRelease] = process.argv.slice(2);
if (!approvalPath || !expectedCommit || !expectedRelease) fail("approval evidence path, commit, and release are required");
if (!/^[0-9a-f]{12}$/.test(expectedCommit) || expectedRelease !== `ynx-bft-gateway-${expectedCommit}`) fail("expected identity is invalid");
const stat = fs.statSync(approvalPath);
if (!stat.isFile() || (stat.mode & 0o077) !== 0) fail("approval evidence must be a mode-0600 regular file");
let approval;
try {
  approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
} catch (error) {
  fail(`approval evidence is not valid JSON: ${error.message}`);
}
if (approval.schemaVersion !== 1 || approval.action !== "ynx-public-bft-cutover" || approval.approved !== true || approval.commit !== expectedCommit || approval.release !== expectedRelease) fail("approval evidence identity mismatch");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(approval.approvalId || "") || typeof approval.approver !== "string" || approval.approver.trim().length < 3) fail("approval evidence attribution is invalid");
if (approval.publicCutoverAuthorized !== true || approval.automaticRollbackRequired !== true) fail("automatic rollback is not authorized");
if (!/^[0-9a-f]{64}$/.test(approval.validatorManifestSha256 || "")) fail("validator manifest checksum is invalid");
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(approval.candidateGenesisTime || "")) fail("candidate genesis time is invalid");
if (!Number.isFinite(Date.parse(approval.expiresAt || ""))) fail("approval expiry is invalid");
process.stdout.write(`${JSON.stringify({
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
  expiresAt: approval.expiresAt,
  validated: true,
})}\n`);
