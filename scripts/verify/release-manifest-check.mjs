#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const releaseDir = process.argv[2];
const expectedCommit = process.argv[3] || "";
const expectedRelease = process.argv[4] || "";

if (!releaseDir) {
  console.error("usage: node scripts/verify/release-manifest-check.mjs <release-dir> [expected-commit] [expected-release]");
  process.exit(2);
}

const manifestPath = path.join(releaseDir, "config/release-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

assert.equal(manifest.schema, "ynx-chain-release-manifest/v1", "manifest schema mismatch");
if (expectedCommit) assert.equal(manifest.commit, expectedCommit, "manifest commit mismatch");
if (expectedRelease) assert.equal(manifest.release, expectedRelease, "manifest release mismatch");
assert.match(manifest.buildTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "manifest buildTime must be UTC seconds");
assert.equal(manifest.provenance?.remotePublicProof, false, "local manifest must not claim remote public proof");
assert(Array.isArray(manifest.provenance?.binaryIdentityEndpoint), "manifest must list binary identity endpoints");

const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
const required = [
  "bin/ynx-chaind",
  "bin/ynx-indexerd",
  "bin/ynx-explorerd",
  "bin/ynx-faucetd",
  "bin/ynx-ai-gatewayd",
  "config/ynx-ai-gatewayd.env",
  "config/ynx-chaind-primary.env",
  "config/ynx-chaind-singapore.env",
  "config/ynx-chaind-silicon-valley.env",
  "config/ynx-chaind-seoul.env",
  "systemd/ynx-chaind.service",
  "systemd/ynx-ai-gatewayd.service",
  "nginx/ynx-chain.conf",
];

for (const relativePath of required) {
  const artifact = byPath.get(relativePath);
  assert(artifact, `manifest missing ${relativePath}`);
  const fullPath = path.join(releaseDir, relativePath);
  const body = fs.readFileSync(fullPath);
  assert.equal(artifact.bytes, body.length, `${relativePath} byte size mismatch`);
  assert.equal(artifact.sha256, sha256(fullPath), `${relativePath} sha256 mismatch`);
}

const chaind = byPath.get("bin/ynx-chaind");
assert.equal(chaind.kind, "binary", "ynx-chaind artifact kind mismatch");
assert.match(chaind.sha256, /^[0-9a-f]{64}$/, "ynx-chaind checksum must be sha256 hex");

console.log(`release-manifest-check passed: ${manifest.release} ${manifest.commit}`);
