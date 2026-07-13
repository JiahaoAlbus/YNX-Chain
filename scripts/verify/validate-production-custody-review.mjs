#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const [reviewPath, expectedCommit, expectedManifestSha256] = process.argv.slice(2);
if (!reviewPath || !/^[0-9a-f]{12}$/.test(expectedCommit || "") || !/^[0-9a-f]{64}$/.test(expectedManifestSha256 || "")) {
  fail("usage: validate-production-custody-review.mjs <review.json> <commit12> <public-manifest-sha256>");
}
let raw;
let review;
try {
  const stat = fs.statSync(reviewPath);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) fail("custody review must be a mode-restricted regular file");
  raw = fs.readFileSync(reviewPath);
  review = JSON.parse(raw);
} catch (error) {
  fail(`failed to read custody review: ${error.message}`);
}
if (review.schemaVersion !== 1 || review.action !== "ynx-production-custody-review" || review.reviewed !== true) fail("custody review is not affirmatively completed");
const allowedKeys = new Set([
  "schemaVersion", "action", "reviewId", "reviewer", "reviewed", "commit", "publicManifestSha256", "sourceCeremonyStatusSha256",
  "signerCount", "records", "validatorKeyRecoveryVerified", "serviceSignerRecoveryVerified", "ownerHandoverVerified", "rotationProcedureVerified",
  "validatorRecoveryEvidence", "serviceSignerRecoveryEvidence", "ownerHandoverEvidence", "rotationProcedureEvidence", "reviewedAt", "expiresAt",
]);
for (const key of Object.keys(review)) if (!allowedKeys.has(key)) fail(`custody review contains unexpected field ${key}`);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(review.reviewId || "") || typeof review.reviewer !== "string" || review.reviewer.trim().length < 3) fail("custody review attribution is invalid");
if (review.commit !== expectedCommit || review.publicManifestSha256 !== expectedManifestSha256 || !/^[0-9a-f]{64}$/.test(review.sourceCeremonyStatusSha256 || "")) fail("custody review source binding is invalid");
if (review.signerCount !== 5 || !Array.isArray(review.records) || review.records.length !== 5) fail("custody review must contain five public signer identities");
const roles = ["faucet", "ai", "pay", "trust", "resource"];
for (let index = 0; index < roles.length; index += 1) {
  const role = roles[index];
  const record = review.records[index];
  if (!record || Object.keys(record).sort().join(",") !== "address,purpose,role") fail(`custody review ${role} signer record contains unexpected fields`);
  if (record?.role !== role || record.purpose !== `ynx-production-${role}-signer` || !/^0x[0-9a-f]{40}$/.test(record.address || "")) fail(`custody review ${role} signer identity is invalid`);
}
if (new Set(review.records.map((record) => record.address)).size !== 5) fail("custody review signer identities are not distinct");
if (review.validatorKeyRecoveryVerified !== true || review.serviceSignerRecoveryVerified !== true || review.ownerHandoverVerified !== true || review.rotationProcedureVerified !== true) fail("custody recovery, handover, and rotation review is incomplete");
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{7,255}$/;
for (const field of ["validatorRecoveryEvidence", "serviceSignerRecoveryEvidence", "ownerHandoverEvidence", "rotationProcedureEvidence"]) {
  if (typeof review[field] !== "string" || !referencePattern.test(review[field])) fail(`${field} must be a compact non-secret reference`);
}
const reviewedAt = Date.parse(review.reviewedAt || "");
const expiresAt = Date.parse(review.expiresAt || "");
const now = Date.now();
if (!Number.isFinite(reviewedAt) || !Number.isFinite(expiresAt) || reviewedAt > now + 5 * 60 * 1000 || expiresAt <= now || expiresAt <= reviewedAt || expiresAt - reviewedAt > 7 * 24 * 60 * 60 * 1000) {
  fail("custody review timestamps are invalid, expired, or exceed seven days");
}
const evidenceSha256 = crypto.createHash("sha256").update(raw).digest("hex");
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  status: "passed",
  reviewId: review.reviewId,
  reviewer: review.reviewer.trim(),
  commit: expectedCommit,
  publicManifestSha256: expectedManifestSha256,
  custodyEvidence: `sha256:${evidenceSha256}`,
  validatorKeyRecoveryVerified: true,
  serviceSignerRecoveryVerified: true,
  ownerHandoverVerified: true,
  rotationProcedureVerified: true,
  expiresAt: new Date(expiresAt).toISOString().replace(".000Z", "Z"),
})}\n`);
