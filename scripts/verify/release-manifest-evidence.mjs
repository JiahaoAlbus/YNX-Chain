#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const roles = ["primary", "singapore", "silicon-valley", "seoul"];
const requiredLines = [
  "releaseManifest=ok",
  "releaseManifest.schema=ok",
  "releaseManifest.commit=ok",
  "releaseManifest.release=ok",
  "releaseManifest.chaindPath=ok",
  "releaseManifest.chaindChecksum=ok",
];
const sha256Pattern = /^[0-9a-f]{64}$/;

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function keyValue(text, key) {
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) return "";
  return line.slice(key.length + 1).trim();
}

function nodeEvidence(verifyDir, role) {
  const file = path.join(verifyDir, `${role}.txt`);
  const text = readText(file);
  const checks = Object.fromEntries(requiredLines.map((line) => [line.replace("=ok", ""), text.includes(line)]));
  const manifestSha256 = keyValue(text, "releaseManifest.manifestSha256");
  const chaindSha256 = keyValue(text, "releaseManifest.chaindSha256");
  checks["releaseManifest.manifestSha256"] = sha256Pattern.test(manifestSha256);
  checks["releaseManifest.chaindSha256"] = sha256Pattern.test(chaindSha256);
  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    role,
    path: file,
    present: text.length > 0,
    ok: text.length > 0 && missing.length === 0,
    checks,
    missing,
    observed: {
      manifestSha256,
      chaindSha256,
    },
  };
}

function buildReport(verifyDir, expectedCommit, expectedRelease) {
  const nodes = roles.map((role) => nodeEvidence(verifyDir, role));
  const missingRoles = nodes.filter((node) => !node.present).map((node) => node.role);
  const failedRoles = nodes.filter((node) => node.present && !node.ok).map((node) => node.role);
  const ok = missingRoles.length === 0 && failedRoles.length === 0 && expectedCommit.length > 0 && expectedRelease.length > 0;
  return {
    schema: "ynx-release-manifest-evidence/v1",
    generatedAt: new Date().toISOString(),
    source: "verify-testnet-ssh-services",
    remotePublicProof: false,
    expected: {
      commit: expectedCommit,
      release: expectedRelease,
    },
    status: ok ? "passed" : "failed",
    missingRoles,
    failedRoles,
    nodes,
  };
}

function writeReport(outPath, report) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

function writeNodeFixture(dir, role, options = {}) {
  const manifestSha256 = options.manifestSha256 ?? "a".repeat(64);
  const chaindSha256 = options.chaindSha256 ?? "b".repeat(64);
  const lines = [
    "releaseManifest=ok",
    "releaseManifest.schema=ok",
    "releaseManifest.commit=ok",
    "releaseManifest.release=ok",
    "releaseManifest.chaindPath=ok",
    `releaseManifest.manifestSha256=${manifestSha256}`,
    `releaseManifest.chaindSha256=${chaindSha256}`,
    options.failChecksum ? "releaseManifest.chaindChecksum=missing:bad" : "releaseManifest.chaindChecksum=ok",
  ];
  fs.writeFileSync(path.join(dir, `${role}.txt`), `${lines.join("\n")}\n`);
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-release-manifest-evidence-"));
  for (const role of roles) writeNodeFixture(tmp, role);
  const passed = buildReport(tmp, "abc123", "ynx-chain-abc123");
  assert.equal(passed.status, "passed", "complete fixture should pass");
  assert.equal(passed.nodes[0].observed.manifestSha256, "a".repeat(64), "manifest sha should be captured");
  assert.equal(passed.nodes[0].observed.chaindSha256, "b".repeat(64), "chaind sha should be captured");
  const out = path.join(tmp, "release-manifest-evidence.json");
  writeReport(out, passed);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).status, "passed", "report should be written");

  const badHashDir = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-release-manifest-evidence-bad-hash-"));
  for (const role of roles) writeNodeFixture(badHashDir, role, { manifestSha256: role === "seoul" ? "bad" : undefined });
  const badHash = buildReport(badHashDir, "abc123", "ynx-chain-abc123");
  assert.equal(badHash.status, "failed", "invalid sha fixture should fail");
  assert(badHash.failedRoles.includes("seoul"), "invalid sha role should be reported");

  const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-release-manifest-evidence-missing-"));
  writeNodeFixture(missingDir, "primary");
  const missing = buildReport(missingDir, "abc123", "ynx-chain-abc123");
  assert.equal(missing.status, "failed", "missing roles should fail");
  assert(missing.missingRoles.includes("singapore"), "missing role should be reported");
  console.log("release-manifest-evidence self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const verifyDir = process.argv[2] || process.env.YNX_VERIFY_TESTNET_OUT || "tmp/verify-testnet";
const expectedCommit = process.argv[3] || process.env.YNX_EXPECTED_RELEASE_COMMIT || "";
const expectedRelease = process.argv[4] || process.env.YNX_EXPECTED_RELEASE_NAME || (expectedCommit ? `ynx-chain-${expectedCommit}` : "");
const outPath = process.env.YNX_RELEASE_MANIFEST_EVIDENCE_PATH || path.join(verifyDir, "release-manifest-evidence.json");
const report = buildReport(verifyDir, expectedCommit, expectedRelease);

writeReport(outPath, report);
console.log(`release manifest evidence written: ${outPath}`);
if (report.status !== "passed") {
  console.error(`release manifest evidence failed: missingRoles=${report.missingRoles.join(",") || "none"} failedRoles=${report.failedRoles.join(",") || "none"}`);
  process.exit(1);
}
