#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function fail(message) {
  throw new Error("public BFT freeze rehearsal approval rejected: " + message);
}

const approvalPath = process.argv[2];
const expectedCommit = String(process.argv[3] || "");
const expectedRelease = String(process.argv[4] || "");
const expectedTransactionId = String(process.argv[5] || "");
const custodyReviewPath = String(process.argv[6] || "");
if (!approvalPath || !expectedCommit || !expectedRelease || !expectedTransactionId || !custodyReviewPath) {
  fail("approval path, commit, release, transaction id, and custody review path are required");
}
if (!/^[0-9a-f]{12}$/.test(expectedCommit)) fail("expected commit must be 12 lowercase hexadecimal characters");
if (expectedRelease !== "ynx-bft-gateway-" + expectedCommit) fail("expected release is not bound to the expected commit");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(expectedTransactionId)) fail("expected transaction id is invalid");

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
if (approval.schemaVersion !== 1 || approval.action !== "ynx-public-bft-freeze-rehearsal" || approval.approved !== true) {
  fail("schema, action, or approved flag is invalid");
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(approval.approvalId || "")) fail("approvalId is invalid");
if (typeof approval.approver !== "string" || approval.approver.trim().length < 3) fail("approver is required");
if (typeof approval.custodyReviewer !== "string" || approval.custodyReviewer.trim().length < 3) fail("independent custody reviewer is required");
if (approval.custodyReviewer.trim().toLowerCase() === approval.approver.trim().toLowerCase()) fail("custody reviewer must differ from transaction approver");
if (typeof approval.custodyEvidence !== "string" || !/^sha256:[0-9a-f]{64}$/.test(approval.custodyEvidence.trim())) {
  fail("an exact sha256 custody review evidence reference is required");
}
if (approval.commit !== expectedCommit || approval.release !== expectedRelease || approval.transactionId !== expectedTransactionId) {
  fail("approval is bound to a different commit, release, or transaction");
}
if (approval.scopedBackupAuthorized !== true || approval.temporaryMutationFreezeAuthorized !== true || approval.automaticUnfreezeRequired !== true) {
  fail("scoped backup, temporary freeze, and automatic unfreeze consent are required");
}
if (approval.validatorKeyRecoveryVerified !== true || approval.serviceSignerRecoveryVerified !== true || approval.ownerHandoverVerified !== true || approval.rotationProcedureVerified !== true) {
  fail("validator/service signer recovery, owner handover, and rotation verification are required");
}
if (!/^[0-9a-f]{64}$/.test(approval.serviceSignerManifestSha256 || "")) fail("serviceSignerManifestSha256 is required");
let custodyReview;
try {
  const validator = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-production-custody-review.mjs");
  custodyReview = JSON.parse(execFileSync(process.execPath, [validator, custodyReviewPath, expectedCommit, approval.serviceSignerManifestSha256], { encoding: "utf8" }));
} catch (error) {
  fail(`custody review validation failed: ${error.stderr?.toString().trim() || error.message}`);
}
if (custodyReview.reviewer.toLowerCase() !== approval.custodyReviewer.trim().toLowerCase() || custodyReview.custodyEvidence !== approval.custodyEvidence.trim()) fail("custody review attribution or exact file hash differs from approval");
const participants = [approval.approver, custodyReview.reviewer, custodyReview.owner, custodyReview.ownerHandoverReviewer].map((value) => String(value || "").trim().toLowerCase());
if (participants.some((value) => value.length < 3) || new Set(participants).size !== participants.length) fail("transaction approver, custody reviewer, owner, and owner handover reviewer must be distinct");
if (approval.authoritativePauseAuthorized !== false || approval.publicIngressChangeAuthorized !== false || approval.publicCutoverAuthorized !== false) {
  fail("pause, ingress change, and public cutover must be explicitly unauthorized");
}
if (!Number.isInteger(approval.maxFreezeSeconds) || approval.maxFreezeSeconds < 30 || approval.maxFreezeSeconds > 300) {
  fail("maxFreezeSeconds must be an integer between 30 and 300");
}
const expiresAt = Date.parse(approval.expiresAt || "");
if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 2 * 60 * 60 * 1000) {
  fail("expiresAt must be in the future and no more than 2 hours away");
}

process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  action: approval.action,
  approvalId: approval.approvalId,
  approver: approval.approver.trim(),
  custodyReviewer: approval.custodyReviewer.trim(),
  custodyEvidence: approval.custodyEvidence.trim(),
  owner: custodyReview.owner,
  ownerHandoverReviewer: custodyReview.ownerHandoverReviewer,
  ownerHandoverInventoryDigest: custodyReview.ownerHandoverInventoryDigest,
  ownerHandoverInventoryEvidence: custodyReview.ownerHandoverInventoryEvidence,
  ownerHandoverReceiptEvidence: custodyReview.ownerHandoverReceiptEvidence,
  commit: expectedCommit,
  release: expectedRelease,
  transactionId: expectedTransactionId,
  maxFreezeSeconds: approval.maxFreezeSeconds,
  validatorKeyRecoveryVerified: true,
  serviceSignerRecoveryVerified: true,
  ownerHandoverVerified: true,
  rotationProcedureVerified: true,
  serviceSignerManifestSha256: approval.serviceSignerManifestSha256,
  authoritativePauseAuthorized: false,
  publicIngressChangeAuthorized: false,
  publicCutoverAuthorized: false,
  expiresAt: new Date(expiresAt).toISOString(),
}) + "\n");
