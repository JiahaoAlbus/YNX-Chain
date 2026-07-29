#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {canonicalJSON} from "../lib/sdk-release.mjs";

const [packageDir, extractedReleaseDir, smokeReceiptPath, outputPath, expectedCommit, expectedRelease] = process.argv.slice(2);
const fail = (message) => { throw new Error(message); };
if (
  !packageDir
  || !extractedReleaseDir
  || !smokeReceiptPath
  || !outputPath
  || process.platform !== "linux"
  || process.arch !== "x64"
  || !/^[0-9a-f]{12}$/.test(expectedCommit ?? "")
  || expectedRelease !== `ynx-data-fabric-${expectedCommit}`
) fail("cold-start evidence requires Linux x86_64 and commit-bound package, extracted release, smoke receipt, and output paths");

const candidate = JSON.parse(fs.readFileSync(path.join(packageDir, `${expectedRelease}-release-index.json`), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(extractedReleaseDir, "release-manifest.json"), "utf8"));
const smoke = JSON.parse(fs.readFileSync(smokeReceiptPath, "utf8"));
if (
  candidate.schema !== "ynx-data-fabric-public-testnet-release/v1"
  || candidate.commit !== expectedCommit
  || candidate.release !== expectedRelease
  || !/^[0-9a-f]{64}$/.test(candidate.artifact?.sha256 ?? "")
  || manifest.commit !== expectedCommit
  || manifest.release !== expectedRelease
) fail("cold-start package identity is invalid");
const requiredSmokeChecks = [
  "daemonHealth",
  "runtimeIdentity",
  "metrics",
  "operatorSurface",
  "unauthorizedWriteRejected",
  "fileIntegrityAudit",
  "backupRestore",
];
if (
  smoke.schema !== "ynx-data-fabric-smoke-receipt/v1"
  || smoke.commit !== expectedCommit
  || smoke.release !== expectedRelease
  || smoke.binaryMode !== "packaged"
  || typeof smoke.verifiedAt !== "string"
  || requiredSmokeChecks.some((check) => smoke.checks?.[check] !== true)
) fail("packaged smoke receipt is incomplete or not commit-bound");

const binaryNames = ["ynx-data-fabricctl", "ynx-data-fabricd", "ynx-data-fabric-worker", "ynx-pay-data-fabric-bridge"];
const sha256 = (body) => crypto.createHash("sha256").update(body).digest("hex");
const binaries = binaryNames.map((name) => {
  const binaryPath = path.join(extractedReleaseDir, "bin", name);
  const stat = fs.statSync(binaryPath);
  const body = fs.readFileSync(binaryPath);
  if (
    !stat.isFile()
    || (stat.mode & 0o111) === 0
    || body.length < 20
    || body[0] !== 0x7f
    || body.subarray(1, 4).toString("ascii") !== "ELF"
    || body[4] !== 2
    || body[5] !== 1
    || body.readUInt16LE(18) !== 0x3e
  ) fail(`packaged binary is not executable Linux amd64 ELF: ${name}`);
  const artifact = manifest.artifacts.find((candidateArtifact) => candidateArtifact.path === `bin/${name}`);
  if (!artifact || artifact.bytes !== body.length || artifact.sha256 !== sha256(body)) fail(`packaged binary manifest mismatch: ${name}`);
  return {path: `bin/${name}`, bytes: body.length, sha256: artifact.sha256, format: "elf64-x86-64"};
});

const evidence = {
  schema: "ynx-data-fabric-cold-start-evidence/v1",
  product: "ynx-data-fabric",
  commit: expectedCommit,
  release: expectedRelease,
  target: {os: "linux", architecture: "amd64"},
  environment: "linux-runtime",
  status: "verified",
  archiveSha256: candidate.artifact.sha256,
  verifiedAt: smoke.verifiedAt,
  verificationScope: "packaged-daemon-and-cli-cold-start; worker-and-bridge-load-verified",
  checks: {
    archiveIntegrity: true,
    extractedManifestIntegrity: true,
    executableELFInventory: true,
    daemonHealth: true,
    runtimeIdentity: true,
    metrics: true,
    operatorSurface: true,
    unauthorizedWriteRejected: true,
    fileIntegrityAudit: true,
    backupRestore: true,
    workerProcessLoad: true,
    payBridgeProcessLoad: true,
  },
  runner: {kernel: os.release(), node: process.version},
  binaries,
};
fs.writeFileSync(outputPath, canonicalJSON(evidence), {mode: 0o600, flag: "wx"});
