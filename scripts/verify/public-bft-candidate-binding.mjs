#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(`public BFT candidate binding rejected: ${message}`);
}

function readJSON(file, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be a JSON object`);
  return value;
}

function requireRestrictedFile(file, label) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) fail(`${label} is not a regular file`);
  if ((stat.mode & 0o077) !== 0) fail(`${label} permissions must be 0600 or stricter`);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function canonicalSecond(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value || "")) fail(`${label} must be whole-second UTC RFC3339`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(`${label} is invalid`);
  return timestamp;
}

const rawArgs = process.argv.slice(2);
const inputsOnly = rawArgs[0] === "--inputs-only";
if (inputsOnly) rawArgs.shift();
const [transactionDirValue, expectedCommit, expectedRelease, validatorManifestValue, genesisTime, packageRootValue] = rawArgs;
if (!transactionDirValue || !expectedCommit || !expectedRelease || !validatorManifestValue || !genesisTime || (!inputsOnly && !packageRootValue)) {
  fail("transaction directory, commit, release, validator manifest, genesis time, and package root are required");
}
if (!/^[0-9a-f]{12}$/.test(expectedCommit)) fail("expected commit is invalid");
if (expectedRelease !== `ynx-bft-gateway-${expectedCommit}`) fail("expected release is not commit-bound");

const transactionDir = path.resolve(transactionDirValue);
const transactionId = path.basename(transactionDir);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(transactionId)) fail("transaction id is invalid");
const approvalPath = path.join(transactionDir, "approval.json");
const snapshotPath = path.join(transactionDir, "final-snapshot", "migration.json");
const snapshotEvidencePath = path.join(transactionDir, "final-snapshot", "remote-evidence.json");
const validatorManifestPath = path.resolve(validatorManifestValue);
const packageRoot = inputsOnly ? "" : path.resolve(packageRootValue);
const packageManifestPath = inputsOnly ? "" : path.join(packageRoot, "package-manifest.json");

for (const [file, label] of [[approvalPath, "transaction approval"], [snapshotPath, "final snapshot"], [snapshotEvidencePath, "final snapshot evidence"]]) {
  requireRestrictedFile(file, label);
}
const validatorStat = fs.statSync(validatorManifestPath);
if (!validatorStat.isFile()) fail("validator manifest is not a regular file");
if ((validatorStat.mode & 0o022) !== 0) fail("validator manifest must not be group/world writable");
if (!inputsOnly) {
  if (!fs.statSync(packageRoot).isDirectory()) fail("candidate package root is not a directory");
  if (!fs.statSync(packageManifestPath).isFile()) fail("candidate package manifest is missing");
}

const approval = readJSON(approvalPath, "transaction approval");
if (approval.schemaVersion !== 1 || approval.action !== "ynx-public-bft-cutover" || approval.approved !== true || approval.commit !== expectedCommit || approval.release !== expectedRelease) fail("transaction approval identity mismatch");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(approval.approvalId || "") || typeof approval.approver !== "string" || approval.approver.trim().length < 3) fail("transaction approval attribution is invalid");
if (approval.publicCutoverAuthorized !== true || approval.automaticRollbackRequired !== true) fail("transaction approval does not authorize cutover with automatic rollback");
if (approval.candidateGenesisTime !== genesisTime) fail("candidate genesis time differs from approval");
const validatorManifestSha256 = sha256(validatorManifestPath);
if (approval.validatorManifestSha256 !== validatorManifestSha256) fail("validator manifest checksum differs from approval");

const snapshot = readJSON(snapshotPath, "final snapshot");
const snapshotEvidence = readJSON(snapshotEvidencePath, "final snapshot evidence");
const finalSnapshotSha256 = sha256(snapshotPath);
if (snapshotEvidence.transactionId !== transactionId || snapshotEvidence.commit !== expectedCommit || snapshotEvidence.bftRelease !== expectedRelease) fail("final snapshot evidence identity mismatch");
if (snapshotEvidence.authoritativeRelease !== `ynx-chain-${expectedCommit}`) fail("final snapshot authoritative release mismatch");
if (snapshotEvidence.validated !== true || snapshotEvidence.pauseVerified !== true || snapshotEvidence.mutationFreezeVerified !== true) fail("final snapshot evidence is not fully validated");
if (snapshotEvidence.sha256 !== finalSnapshotSha256) fail("final snapshot checksum mismatch");
if (!Number.isSafeInteger(snapshot.height) || snapshot.height < 1 || snapshotEvidence.height !== snapshot.height) fail("final snapshot height mismatch");
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(snapshot.lastBlockHash || "") || snapshotEvidence.lastBlockHash !== snapshot.lastBlockHash) fail("final snapshot block hash mismatch");
if (!/^[0-9a-f]{64}$/.test(snapshot.stateHash || "") || snapshotEvidence.stateHash !== snapshot.stateHash) fail("final snapshot state hash mismatch");

const recordedAt = canonicalSecond(snapshotEvidence.recordedAt, "final snapshot recordedAt");
const genesisAt = canonicalSecond(genesisTime, "candidate genesis time");
const expiresAt = canonicalSecond(approval.expiresAt, "approval expiresAt");
if (expiresAt <= Date.now()) fail("transaction approval has expired");
if (genesisAt < recordedAt || genesisAt > recordedAt + 30 * 60 * 1000) fail("candidate genesis time must be within 30 minutes after the final snapshot");
if (genesisAt > expiresAt) fail("candidate genesis time exceeds approval expiry");

const validatorManifest = readJSON(validatorManifestPath, "validator manifest");
const sensitiveKey = /^(private[-_]?key|secret|mnemonic|seed|password|priv[-_]?validator[-_]?key)$/i;
function rejectSensitive(value, trail = "validator manifest") {
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectSensitive(entry, `${trail}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) fail(`${trail} contains forbidden private material field ${key}`);
    rejectSensitive(child, `${trail}.${key}`);
  }
}
rejectSensitive(validatorManifest);

if (inputsOnly) {
  process.stdout.write(`${JSON.stringify({ transactionId, commit: expectedCommit, release: expectedRelease, finalSnapshotSha256, validatorManifestSha256, candidateGenesisTime: genesisTime, validated: true })}\n`);
  process.exit(0);
}

const packageManifest = readJSON(packageManifestPath, "candidate package manifest");
if (packageManifest.genesisTime !== genesisTime) fail("candidate package genesis time mismatch");
if (packageManifest.chainId !== "ynx_6423-1") fail("candidate package chain ID mismatch");
if (!Array.isArray(packageManifest.roles) || packageManifest.roles.length !== 4) fail("candidate package must contain four roles");
if (!/^[0-9a-f]{64}$/.test(packageManifest.genesisHash || "") || !/^[0-9a-f]{64}$/.test(packageManifest.migrationStateHash || "")) fail("candidate package hash identity is invalid");

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  transactionId,
  commit: expectedCommit,
  authoritativeRelease: `ynx-chain-${expectedCommit}`,
  bftRelease: expectedRelease,
  finalSnapshotSha256,
  finalSnapshotHeight: snapshot.height,
  finalSnapshotBlockHash: snapshot.lastBlockHash,
  finalSnapshotStateHash: snapshot.stateHash,
  validatorManifestSha256,
  candidateGenesisTime: genesisTime,
  packageManifestSha256: sha256(packageManifestPath),
  packageGenesisHash: packageManifest.genesisHash,
  packageMigrationStateHash: packageManifest.migrationStateHash,
  automaticRollbackRequired: true,
  validated: true,
}, null, 2)}\n`);
