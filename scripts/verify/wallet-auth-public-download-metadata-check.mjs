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
for (const field of ["deployedStaging", "productionSigned", "storeReleased"]) {
  if (record.releaseState[field] !== false) fail(`release record ${field} must remain false`);
}
for (const field of ["productionSigned", "storeReleased"]) {
  if (metadata[field] !== false) fail(`public metadata ${field} must remain false`);
}
if (record.releaseState.deployedPublic !== true || record.releaseState.downloadHosted !== true) fail("release record must preserve the exact official hosted candidate");
if (metadata.websitePublishable !== true || metadata.downloadHosted !== true) fail("public metadata must publish the exact official hosted candidate");
if (/\/Users\/|\/private\/|127\.0\.0\.1|localhost|worktree|codex\//i.test(metadataText)) fail("public download metadata exposes an internal path, host or branch");

const ids = new Set();
const hostedCandidates = new Map([
  ["macos-cli-arm64-0.1.0", { url: "https://www.ynxweb4.com/downloads/wallet/sha256-21db36f1c80d4e88520918de141a7f71921817799270ff671db88179023b5591/ynx-wallet-cli-darwin-arm64.gz", bytes: 4904463, sha256: "21db36f1c80d4e88520918de141a7f71921817799270ff671db88179023b5591" }],
  ["web-pwa-0.1.0", { url: "https://www.ynxweb4.com/downloads/wallet-web/sha256-63d83cd20925f2d52c0f21f548fa7a857a4d056e03e5fa16244f173164a7d287/ynx-wallet-web-pwa-0.1.0.zip", bytes: 272706, sha256: "63d83cd20925f2d52c0f21f548fa7a857a4d056e03e5fa16244f173164a7d287" }],
  ["browser-extension-0.1.0", { url: "https://www.ynxweb4.com/downloads/wallet-web/sha256-c733093dea47c6612c8a9d5ecea40be2227f62402f4b4966955c9e1accf4e2aa/ynx-wallet-chrome-edge-0.1.0.zip", bytes: 188846, sha256: "c733093dea47c6612c8a9d5ecea40be2227f62402f4b4966955c9e1accf4e2aa" }],
  ["firefox-extension-0.1.0", { url: "https://www.ynxweb4.com/downloads/wallet-web/sha256-417d9b9e5babf05fdfdf8161504389eb99c636be75f94444bf4ff91a9b4536b3/ynx-wallet-firefox-0.1.0.zip", bytes: 188883, sha256: "417d9b9e5babf05fdfdf8161504389eb99c636be75f94444bf4ff91a9b4536b3" }],
]);
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
  const hosted = hostedCandidates.get(candidate.id);
  if (hosted) {
    if (candidate.publicUrl !== hosted.url || candidate.immutableUrl !== hosted.url) fail(`${candidate.id} official URL mismatch`);
    if (candidate.bytes !== hosted.bytes || candidate.sha256 !== hosted.sha256) fail(`${candidate.id} byte/hash binding mismatch`);
    if (candidate.downloadHosted !== true || candidate.websitePublishable !== true) fail(`${candidate.id} official hosted state missing`);
  } else {
    if (candidate.publicUrl !== null || candidate.immutableUrl !== null) fail(`${candidate.id} cannot expose a URL while downloadHosted=false`);
    if (candidate.downloadHosted !== false || candidate.websitePublishable !== false) fail(`${candidate.id} must remain unhosted`);
  }
  for (const field of ["productionSigned", "storeReleased"]) if (candidate[field] !== false) fail(`${candidate.id}.${field} must remain false`);
  if (!candidate.exclusionReason) fail(`${candidate.id} requires an exclusionReason`);
}
if (ids.size === 0) fail("download candidates must be non-empty");

if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`PASS wallet-auth public download metadata: ${hostedCandidates.size} official hosted candidates, ${ids.size - hostedCandidates.size} fail-closed candidates, matrix ${matrixSha256}\n`);
