#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function currentGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function requireFile(dir, file, problems) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) {
    problems.push(`missing required package file: ${file}`);
  }
  return full;
}

function validatePackage(finalDir, { expectedHead = currentGitCommit() } = {}) {
  const problems = [];
  const required = [
    "PUBLIC_TESTNET_PROOF.generated.md",
    "PUBLIC_TESTNET_PROOF.md",
    "TESTNET_ACCEPTANCE_REPORT.md",
    "manifest.json",
    "public-proof-validation.json",
    "release-manifest-evidence.json",
    "remote-public-evidence.json",
  ];
  for (const file of required) requireFile(finalDir, file, problems);
  if (problems.length) return { ok: false, problems };

  const manifestPath = path.join(finalDir, "manifest.json");
  const evidencePath = path.join(finalDir, "remote-public-evidence.json");
  const validationPath = path.join(finalDir, "public-proof-validation.json");
  const releaseManifestPath = path.join(finalDir, "release-manifest-evidence.json");
  const generatedProofPath = path.join(finalDir, "PUBLIC_TESTNET_PROOF.generated.md");

  const manifest = readJson(manifestPath);
  const evidence = readJson(evidencePath);
  const validation = readJson(validationPath);
  const releaseManifest = readJson(releaseManifestPath);
  const generatedProof = fs.readFileSync(generatedProofPath, "utf8");

  if (manifest.package !== "ynx-remote-public-proof-package") {
    problems.push("manifest.package must be ynx-remote-public-proof-package");
  }
  if (!Number.isFinite(Date.parse(manifest.generatedAt || ""))) {
    problems.push("manifest.generatedAt must be a valid timestamp");
  }
  if (!/^[0-9a-f]{40}$/i.test(String(manifest.gitCommit || ""))) {
    problems.push("manifest.gitCommit must be a full git SHA");
  } else if (expectedHead !== "unknown" && manifest.gitCommit !== expectedHead) {
    problems.push(`manifest.gitCommit must match current HEAD ${expectedHead.slice(0, 12)}`);
  }
  if (manifest.gitCommit !== evidence.gitCommit) {
    problems.push("manifest.gitCommit must match remote-public-evidence.gitCommit");
  }

  const evidencePassed = evidence.status === "passed";
  const validationPassed = validation.validPublicProof === true;
  const releaseManifestPassed = releaseManifest.status === "passed";
  const expectedValid = manifest.status === "passed" && evidencePassed && validationPassed && releaseManifestPassed;
  if (manifest.validPublicProof !== expectedValid) {
    problems.push("manifest.validPublicProof must equal passed evidence + validation + release manifest status");
  }
  if (manifest.status === "passed" && manifest.validPublicProof !== true) {
    problems.push("manifest.status passed requires manifest.validPublicProof true");
  }
  if (manifest.status !== "passed" && manifest.validPublicProof !== false) {
    problems.push("failed diagnostic packages must keep manifest.validPublicProof false");
  }

  const expectedReleaseCommit = String(evidence?.expected?.releaseCommit || "");
  const expectedReleaseName = String(evidence?.expected?.releaseName || "");
  if (expectedHead !== "unknown" && expectedReleaseCommit && !expectedHead.startsWith(expectedReleaseCommit)) {
    problems.push(`remote evidence expected.releaseCommit must match current HEAD ${expectedHead.slice(0, 12)}`);
  }
  if (expectedReleaseCommit && expectedReleaseName !== `ynx-chain-${expectedReleaseCommit}`) {
    problems.push("remote evidence expected.releaseName must match ynx-chain-<releaseCommit>");
  }
  if (releaseManifest.status === "passed") {
    if (releaseManifest?.expected?.commit !== expectedReleaseCommit) {
      problems.push("release-manifest-evidence expected.commit must match remote evidence releaseCommit");
    }
    if (releaseManifest?.expected?.release !== expectedReleaseName) {
      problems.push("release-manifest-evidence expected.release must match remote evidence releaseName");
    }
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const fileEntries = new Map(files.map((entry) => [entry.file, entry]));
  for (const file of required.filter((name) => name !== "manifest.json")) {
    const entry = fileEntries.get(file);
    if (!entry) {
      problems.push(`manifest.files missing ${file}`);
      continue;
    }
    const full = path.join(finalDir, file);
    const body = fs.readFileSync(full);
    if (entry.bytes !== body.length) {
      problems.push(`manifest.files ${file} byte size mismatch`);
    }
    if (entry.sha256 !== sha256(full)) {
      problems.push(`manifest.files ${file} sha256 mismatch`);
    }
  }

  const expectedStatusLine = `- Status: ${manifest.status}`;
  const expectedValidLine = `- Valid public proof: ${manifest.validPublicProof ? "yes" : "no"}`;
  if (!generatedProof.includes(expectedStatusLine)) {
    problems.push("generated proof summary must include manifest status");
  }
  if (!generatedProof.includes(expectedValidLine)) {
    problems.push("generated proof summary must include manifest validPublicProof state");
  }

  return { ok: problems.length === 0, problems };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFixturePackage(finalDir, { valid = false } = {}) {
  fs.mkdirSync(finalDir, { recursive: true });
  const head = currentGitCommit();
  const gitCommit = /^[0-9a-f]{40}$/i.test(head) ? head : "abc1234abc1234abc1234abc1234abc1234abc12";
  const releaseCommit = gitCommit.slice(0, 12);
  const status = valid ? "passed" : "failed";
  const evidence = {
    proofType: "remote-public-testnet-smoke",
    generatedAt: "2026-07-10T00:00:00.000Z",
    gitCommit,
    status,
    expected: {
      cosmosChainId: "ynx_6423-1",
      evmChainId: 6423,
      evmChainIdHex: "0x1917",
      nativeSymbol: "YNXT",
      releaseCommit,
      releaseName: `ynx-chain-${releaseCommit}`,
    },
    checks: valid ? [{ name: "fixture", ok: true }] : [{ name: "fixture", ok: false }],
  };
  const validation = { validPublicProof: valid };
  const releaseManifest = valid
    ? {
        schema: "ynx-release-manifest-evidence/v1",
        status: "passed",
        expected: { commit: releaseCommit, release: `ynx-chain-${releaseCommit}` },
      }
    : {
        schema: "ynx-release-manifest-evidence/v1",
        status: "missing",
        expectedPath: "tmp/verify-testnet/release-manifest-evidence.json",
      };
  writeJson(path.join(finalDir, "remote-public-evidence.json"), evidence);
  writeJson(path.join(finalDir, "public-proof-validation.json"), validation);
  writeJson(path.join(finalDir, "release-manifest-evidence.json"), releaseManifest);
  fs.writeFileSync(path.join(finalDir, "PUBLIC_TESTNET_PROOF.md"), "# Static Proof Template\n");
  fs.writeFileSync(path.join(finalDir, "TESTNET_ACCEPTANCE_REPORT.md"), "# Acceptance Report\n");
  fs.writeFileSync(path.join(finalDir, "PUBLIC_TESTNET_PROOF.generated.md"), [
    "# Generated Public Testnet Proof",
    "",
    `- Status: ${status}`,
    `- Valid public proof: ${valid ? "yes" : "no"}`,
    "",
  ].join("\n"));
  const files = fs.readdirSync(finalDir).filter((file) => file !== "manifest.json").sort().map((file) => {
    const full = path.join(finalDir, file);
    return { file, bytes: fs.readFileSync(full).length, sha256: sha256(full) };
  });
  writeJson(path.join(finalDir, "manifest.json"), {
    package: "ynx-remote-public-proof-package",
    generatedAt: "2026-07-10T00:00:00.000Z",
    gitCommit,
    status,
    validPublicProof: valid,
    validation,
    failedChecks: valid ? [] : ["fixture"],
    files,
  });
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-public-proof-package-"));
  const invalidDir = path.join(tmp, "invalid", "final");
  writeFixturePackage(invalidDir, { valid: false });
  const invalidReport = validatePackage(invalidDir);
  assert.equal(invalidReport.ok, true, invalidReport.problems.join("\n"));

  const validDir = path.join(tmp, "valid", "final");
  writeFixturePackage(validDir, { valid: true });
  const validReport = validatePackage(validDir);
  assert.equal(validReport.ok, true, validReport.problems.join("\n"));

  const falseProofDir = path.join(tmp, "false-proof", "final");
  writeFixturePackage(falseProofDir, { valid: false });
  const manifestPath = path.join(falseProofDir, "manifest.json");
  const manifest = readJson(manifestPath);
  manifest.validPublicProof = true;
  writeJson(manifestPath, manifest);
  const falseProofReport = validatePackage(falseProofDir);
  assert.equal(falseProofReport.ok, false, "invalid package marked valid must fail");
  assert(falseProofReport.problems.some((problem) => problem.includes("validPublicProof")));

  const corruptDir = path.join(tmp, "corrupt", "final");
  writeFixturePackage(corruptDir, { valid: false });
  fs.appendFileSync(path.join(corruptDir, "remote-public-evidence.json"), "\n");
  const corruptReport = validatePackage(corruptDir);
  assert.equal(corruptReport.ok, false, "manifest checksum mismatch must fail");
  assert(corruptReport.problems.some((problem) => problem.includes("sha256 mismatch")));

  console.log("public-proof-package-check self-test passed");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const finalDir = path.resolve(repoRoot, args[0] || "tmp/packages/public-proof/final");
const report = validatePackage(finalDir);
if (!report.ok) {
  console.error(`public-proof package invalid: ${finalDir}`);
  for (const problem of report.problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`public-proof package valid: ${finalDir}`);
