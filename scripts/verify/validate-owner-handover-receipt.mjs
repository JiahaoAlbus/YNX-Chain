#!/usr/bin/env node
import fs from "node:fs";
import { readRestricted, sha256, validateInventory } from "./lib/owner-handover.mjs";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const [receiptPath, inventoryPath, expectedCommit] = process.argv.slice(2);
if (!receiptPath || !inventoryPath || !/^[0-9a-f]{12}$/.test(expectedCommit || "")) fail("usage: validate-owner-handover-receipt.mjs <receipt.json> <inventory.json> <commit12>");
let receiptSource;
let inventorySource;
let inventory;
try {
  receiptSource = readRestricted(receiptPath, "owner handover receipt");
  inventorySource = readRestricted(inventoryPath, "owner handover inventory");
  inventory = validateInventory(inventorySource.value, expectedCommit);
} catch (error) {
  fail(error.message);
}
const receipt = receiptSource.value;
const allowed = [
  "schemaVersion", "action", "receiptId", "owner", "independentReviewer", "acknowledged", "commit", "inventoryDigest", "inventoryFileSha256",
  "recordCount", "handoverRequiredIds", "allIdentitiesClassified", "validatorRecoveryVerified", "serviceSignerOfflineRecoveryVerified",
  "ownerHandoverVerified", "rotationProcedureVerified", "validatorRecoveryEvidence", "serviceSignerRecoveryEvidence", "ownerHandoverEvidence",
  "rotationProcedureEvidence", "acknowledgedAt", "expiresAt",
];
if (Object.keys(receipt).sort().join(",") !== allowed.sort().join(",")) fail("owner handover receipt contains unexpected fields");
if (receipt.schemaVersion !== 1 || receipt.action !== "ynx-owner-custody-handover" || receipt.acknowledged !== true || receipt.commit !== expectedCommit) fail("owner handover receipt is not affirmatively completed for this commit");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(receipt.receiptId || "") || typeof receipt.owner !== "string" || receipt.owner.trim().length < 3 || typeof receipt.independentReviewer !== "string" || receipt.independentReviewer.trim().length < 3) fail("owner handover receipt attribution is invalid");
if (receipt.owner.trim().toLowerCase() === receipt.independentReviewer.trim().toLowerCase()) fail("owner and independent reviewer must differ");
if (receipt.inventoryDigest !== inventory.inventoryDigest || receipt.inventoryFileSha256 !== sha256(inventorySource.raw) || receipt.recordCount !== inventory.records.length) fail("owner handover receipt inventory binding is invalid");
const requiredIds = inventory.records.filter((record) => record.handoverRequired).map((record) => record.id);
if (!Array.isArray(receipt.handoverRequiredIds) || JSON.stringify(receipt.handoverRequiredIds) !== JSON.stringify(requiredIds)) fail("owner handover receipt required identity set is invalid");
if (inventory.readiness.unknownOwnershipCount !== 0 || receipt.allIdentitiesClassified !== true) fail("owner handover inventory contains unclassified ownership");
if (receipt.validatorRecoveryVerified !== true || receipt.serviceSignerOfflineRecoveryVerified !== true || receipt.ownerHandoverVerified !== true || receipt.rotationProcedureVerified !== true) fail("owner recovery, handover, and rotation evidence is incomplete");
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{7,255}$/;
for (const field of ["validatorRecoveryEvidence", "serviceSignerRecoveryEvidence", "ownerHandoverEvidence", "rotationProcedureEvidence"]) if (typeof receipt[field] !== "string" || !referencePattern.test(receipt[field])) fail(`${field} must be a compact non-secret reference`);
const acknowledgedAt = Date.parse(receipt.acknowledgedAt || "");
const expiresAt = Date.parse(receipt.expiresAt || "");
const now = Date.now();
if (!Number.isFinite(acknowledgedAt) || !Number.isFinite(expiresAt) || acknowledgedAt > now + 5 * 60 * 1000 || expiresAt <= now || expiresAt <= acknowledgedAt || expiresAt - acknowledgedAt > 7 * 24 * 60 * 60 * 1000) fail("owner handover receipt timestamps are invalid, expired, or exceed seven days");
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  status: "passed",
  receiptId: receipt.receiptId,
  owner: receipt.owner.trim(),
  independentReviewer: receipt.independentReviewer.trim(),
  commit: expectedCommit,
  inventoryDigest: inventory.inventoryDigest,
  inventoryEvidence: `sha256:${sha256(inventorySource.raw)}`,
  handoverEvidence: `sha256:${sha256(receiptSource.raw)}`,
  recordCount: inventory.records.length,
  handoverRequiredCount: requiredIds.length,
  publicBFTReady: false,
  expiresAt: new Date(expiresAt).toISOString().replace(".000Z", "Z"),
})}\n`);
