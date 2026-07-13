#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRestricted, validateInventory } from "./lib/owner-handover.mjs";

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
  "ownerHandoverReceiptId", "owner", "ownerHandoverReviewer", "ownerHandoverInventoryDigest", "ownerHandoverInventoryEvidence", "ownerHandoverReceiptEvidence",
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
const packetDir = path.dirname(path.resolve(reviewPath));
const ownerInventoryPath = path.join(packetDir, "owner-handover-inventory.json");
const ownerReceiptPath = path.join(packetDir, "owner-handover-receipt.json");
let ownerValidation;
let ownerInventory;
let ownerReceipt;
try {
  const ownerValidator = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-owner-handover-receipt.mjs");
  ownerValidation = JSON.parse(execFileSync(process.execPath, [ownerValidator, ownerReceiptPath, ownerInventoryPath, expectedCommit], { encoding: "utf8" }));
  ownerInventory = validateInventory(readRestricted(ownerInventoryPath, "owner handover inventory").value, expectedCommit);
  ownerReceipt = readRestricted(ownerReceiptPath, "owner handover receipt").value;
} catch (error) {
  fail(`owner handover validation failed: ${error.stderr?.toString().trim() || error.message}`);
}
if (review.ownerHandoverReceiptId !== ownerValidation.receiptId || review.owner !== ownerValidation.owner || review.ownerHandoverReviewer !== ownerValidation.independentReviewer) fail("custody review owner handover attribution is invalid");
if (review.ownerHandoverInventoryDigest !== ownerValidation.inventoryDigest || review.ownerHandoverInventoryEvidence !== ownerValidation.inventoryEvidence || review.ownerHandoverReceiptEvidence !== ownerValidation.handoverEvidence) fail("custody review owner evidence binding is invalid");
const people = [review.reviewer, ownerValidation.owner, ownerValidation.independentReviewer].map((value) => String(value || "").trim().toLowerCase());
if (people.some((value) => value.length < 3) || new Set(people).size !== people.length) fail("owner, owner handover reviewer, and custody reviewer must be distinct");
const ownerServiceRecords = ownerInventory.records.filter((record) => record.category === "service-signer");
if (ownerServiceRecords.length !== 5 || review.records.some((record, index) => ownerServiceRecords[index]?.role !== record.role || ownerServiceRecords[index]?.publicIdentity !== record.address)) fail("custody review signer identities differ from owner handover inventory");
if (review.validatorKeyRecoveryVerified !== true || review.serviceSignerRecoveryVerified !== true || review.ownerHandoverVerified !== true || review.rotationProcedureVerified !== true) fail("custody recovery, handover, and rotation review is incomplete");
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{7,255}$/;
for (const field of ["validatorRecoveryEvidence", "serviceSignerRecoveryEvidence", "ownerHandoverEvidence", "rotationProcedureEvidence"]) {
  if (typeof review[field] !== "string" || !referencePattern.test(review[field])) fail(`${field} must be a compact non-secret reference`);
}
if (review.validatorRecoveryEvidence !== ownerReceipt.validatorRecoveryEvidence || review.serviceSignerRecoveryEvidence !== ownerReceipt.serviceSignerRecoveryEvidence || review.ownerHandoverEvidence !== ownerReceipt.ownerHandoverEvidence || review.rotationProcedureEvidence !== ownerReceipt.rotationProcedureEvidence) fail("custody review evidence references differ from the validated owner receipt");
const reviewedAt = Date.parse(review.reviewedAt || "");
const expiresAt = Date.parse(review.expiresAt || "");
const now = Date.now();
if (!Number.isFinite(reviewedAt) || !Number.isFinite(expiresAt) || reviewedAt > now + 5 * 60 * 1000 || expiresAt <= now || expiresAt <= reviewedAt || expiresAt - reviewedAt > 7 * 24 * 60 * 60 * 1000) {
  fail("custody review timestamps are invalid, expired, or exceed seven days");
}
if (expiresAt > Date.parse(ownerValidation.expiresAt)) fail("custody review cannot outlive the owner handover receipt");
const evidenceSha256 = crypto.createHash("sha256").update(raw).digest("hex");
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  status: "passed",
  reviewId: review.reviewId,
  reviewer: review.reviewer.trim(),
  commit: expectedCommit,
  publicManifestSha256: expectedManifestSha256,
  custodyEvidence: `sha256:${evidenceSha256}`,
  ownerHandoverReceiptId: ownerValidation.receiptId,
  owner: ownerValidation.owner,
  ownerHandoverReviewer: ownerValidation.independentReviewer,
  ownerHandoverInventoryDigest: ownerValidation.inventoryDigest,
  ownerHandoverInventoryEvidence: ownerValidation.inventoryEvidence,
  ownerHandoverReceiptEvidence: ownerValidation.handoverEvidence,
  validatorKeyRecoveryVerified: true,
  serviceSignerRecoveryVerified: true,
  ownerHandoverVerified: true,
  rotationProcedureVerified: true,
  expiresAt: new Date(expiresAt).toISOString().replace(".000Z", "Z"),
})}\n`);
