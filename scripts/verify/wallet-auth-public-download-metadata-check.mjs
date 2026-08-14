#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const record = JSON.parse(readFileSync("release/integration/wallet-auth-release-record.json", "utf8"));
const metadataText = readFileSync("release/integration/wallet-auth-public-download-metadata.json", "utf8");
const metadata = JSON.parse(metadataText);
const matrixBytes = readFileSync(record.evidenceMatrix.path);
const matrixSha256 = createHash("sha256").update(matrixBytes).digest("hex");
const failures = [];
const fail = (message) => failures.push(message);

if (matrixSha256 !== record.evidenceMatrix.sha256) fail("release record matrix SHA-256 mismatch");
if (record.releaseState.integratedCentral !== false) fail("integratedCentral must remain false before central merge evidence");
for (const field of ["deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"]) {
  if (record.releaseState[field] !== false) fail(`release record ${field} must remain false`);
}
for (const field of ["websitePublishable", "downloadHosted", "productionSigned", "storeReleased"]) {
  if (metadata[field] !== false) fail(`public metadata ${field} must remain false`);
}
if (/\/Users\/|\/private\/|127\.0\.0\.1|localhost|worktree|codex\//i.test(metadataText)) fail("public download metadata exposes an internal path, host or branch");

const ids = new Set();
for (const candidate of metadata.candidates ?? []) {
  if (!candidate.id || ids.has(candidate.id)) fail(`duplicate or missing candidate id ${candidate.id ?? "<missing>"}`);
  ids.add(candidate.id);
  if (!/^[0-9a-f]{40}$/.test(candidate.sourceCommit ?? "")) fail(`${candidate.id} sourceCommit must be a full SHA`);
  try {
    execFileSync("git", ["cat-file", "-e", `${candidate.sourceCommit}^{commit}`], { stdio: "ignore" });
  } catch {
    fail(`${candidate.id} source commit is not available`);
  }
  if (!/^[0-9a-f]{64}$/.test(candidate.sha256 ?? "")) fail(`${candidate.id} sha256 must be exact`);
  if (candidate.publicUrl !== null || candidate.immutableUrl !== null) fail(`${candidate.id} cannot expose a URL while downloadHosted=false`);
  for (const field of ["downloadHosted", "productionSigned", "storeReleased", "websitePublishable"]) {
    if (candidate[field] !== false) fail(`${candidate.id}.${field} must remain false`);
  }
  if (!candidate.exclusionReason) fail(`${candidate.id} requires an exclusionReason`);
}
if (ids.size === 0) fail("download candidates must be non-empty");

if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`PASS wallet-auth public download metadata: ${ids.size} non-publishable candidates, matrix ${matrixSha256}\n`);
