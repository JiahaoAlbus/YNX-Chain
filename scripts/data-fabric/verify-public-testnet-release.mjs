#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {readDeterministicTarGz, sha256} from "../lib/sdk-release.mjs";

const [outputDir, expectedCommit, expectedRelease] = process.argv.slice(2);
const fail = (message) => { throw new Error(message); };
const requiredArtifacts = new Set([
  "bin/ynx-data-fabricctl",
  "bin/ynx-data-fabricd",
  "bin/ynx-data-fabric-worker",
  "bin/ynx-pay-data-fabric-bridge",
  "config/data-fabric.env",
  "config/event-keys.json",
  "provenance.json",
  "sbom/go-runtime.spdx.json",
  "scripts/install-testnet-release.sh",
  "scripts/remote-install-testnet-release.sh",
  "scripts/verify-testnet-deployment.sh",
  "systemd/ynx-data-fabricd.service",
  "systemd/ynx-data-fabric-worker.service",
  "systemd/ynx-pay-data-fabric-bridge.service",
]);
if (!outputDir || !/^[0-9a-f]{12}$/.test(expectedCommit ?? "") || expectedRelease !== `ynx-data-fabric-${expectedCommit}`) {
  fail("usage: verify-public-testnet-release.mjs <output-dir> <commit> <release>");
}

const indexName = `${expectedRelease}-release-index.json`;
const archiveName = `${expectedRelease}-linux-amd64.tar.gz`;
const index = JSON.parse(fs.readFileSync(path.join(outputDir, indexName), "utf8"));
if (
  index.schema !== "ynx-data-fabric-public-testnet-release/v1"
  || index.product !== "ynx-data-fabric"
  || index.commit !== expectedCommit
  || index.release !== expectedRelease
  || index.target?.os !== "linux"
  || index.target?.architecture !== "amd64"
  || index.target?.channel !== "public-testnet-candidate"
  || index.signing?.class !== "unsigned-testnet-build"
  || index.signing?.productionSigned !== false
  || index.hosting?.hosted !== false
  || index.hosting?.immutableURL !== null
  || index.artifact?.path !== archiveName
) fail("public Testnet release index truth is invalid");

const archive = fs.readFileSync(path.join(outputDir, archiveName));
if (index.artifact.bytes !== archive.length || index.artifact.sha256 !== sha256(archive)) {
  fail("public Testnet archive integrity mismatch");
}
const entries = readDeterministicTarGz(archive, {maxOutputLength: 256 * 1024 * 1024});
const prefix = `${expectedRelease}/`;
const byPath = new Map();
for (const entry of entries) {
  if (!entry.path.startsWith(prefix)) fail(`archive entry is outside the release root: ${entry.path}`);
  const relative = entry.path.slice(prefix.length);
  if (!relative) fail("archive contains an empty release-root entry");
  byPath.set(relative, entry);
}

const manifestEntry = byPath.get("release-manifest.json");
if (!manifestEntry || manifestEntry.mode !== 0o644) fail("archive release manifest is missing or has an invalid mode");
const manifest = JSON.parse(manifestEntry.data.toString("utf8"));
if (
  manifest.schema !== "ynx-data-fabric-testnet-release/v1"
  || manifest.commit !== expectedCommit
  || manifest.release !== expectedRelease
  || !Array.isArray(manifest.artifacts)
  || manifest.artifacts.length !== 14
) fail("archive release manifest identity is invalid");
if (entries.length !== manifest.artifacts.length + 1) fail("archive contains files outside the manifest inventory");
const artifactPaths = new Set(manifest.artifacts.map((artifact) => artifact?.path));
if (
  artifactPaths.size !== requiredArtifacts.size
  || [...requiredArtifacts].some((required) => !artifactPaths.has(required))
) fail("archive release manifest inventory is invalid");

for (const artifact of manifest.artifacts) {
  const entry = byPath.get(artifact.path);
  if (!entry) fail(`archive artifact is missing: ${artifact.path}`);
  if (entry.data.length !== artifact.bytes || sha256(entry.data) !== artifact.sha256) {
    fail(`archive artifact integrity mismatch: ${artifact.path}`);
  }
  const expectedMode = artifact.path.startsWith("bin/") || artifact.path.startsWith("scripts/") ? 0o755 : 0o644;
  if (entry.mode !== expectedMode) fail(`archive artifact mode mismatch: ${artifact.path}`);
}

const sbom = JSON.parse(byPath.get("sbom/go-runtime.spdx.json")?.data.toString("utf8") ?? "null");
if (
  sbom?.spdxVersion !== "SPDX-2.3"
  || sbom.name !== `${expectedRelease}-go-runtime`
  || sbom.packages?.[0]?.versionInfo !== expectedCommit
  || !Array.isArray(sbom.packages)
  || sbom.packages.length < 2
) fail("archive SBOM is invalid");

const provenance = JSON.parse(byPath.get("provenance.json")?.data.toString("utf8") ?? "null");
if (
  provenance?.schema !== "ynx-data-fabric-build-provenance/v1"
  || provenance.commit !== expectedCommit
  || provenance.release !== expectedRelease
  || provenance.builder?.target !== "linux/amd64"
  || provenance.signing?.productionSigned !== false
  || provenance.hosting?.hosted !== false
  || !Array.isArray(provenance.binaries)
  || provenance.binaries.length !== 4
) fail("archive provenance is invalid");
for (const binary of provenance.binaries) {
  const artifact = manifest.artifacts.find((candidate) => candidate.path === binary.path);
  if (!artifact || binary.bytes !== artifact.bytes || binary.sha256 !== artifact.sha256) {
    fail(`archive provenance mismatch: ${binary.path}`);
  }
}

process.stdout.write(`${JSON.stringify({
  status: "verified",
  commit: expectedCommit,
  release: expectedRelease,
  archiveSha256: index.artifact.sha256,
  files: entries.length,
})}\n`);
