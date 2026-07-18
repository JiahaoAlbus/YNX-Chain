#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const roles = ["primary", "singapore", "silicon-valley", "seoul"];
const required = [
  "statusEndpoint=ok", "sourceManifest=ok", "sourceManifest.schema=ok",
  "sourceManifest.commitMatchesStatus=ok", "sourceManifest.releaseMatchesStatus=ok",
  "sourceManifest.chaindPath=ok", "sourceManifest.chaindChecksum=ok",
];
const sha = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{12}$/;

function value(text, key) {
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

export function buildReport(dir, targetCommit, targetRelease) {
  const nodes = roles.map((role) => {
    const file = path.join(dir, `${role}.txt`);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const sourceCommit = value(text, "sourceCommit");
    const sourceRelease = value(text, "sourceRelease");
    const manifestSha256 = value(text, "sourceManifestSha256");
    const chaindSha256 = value(text, "sourceChaindSha256");
    const missing = required.filter((line) => !text.includes(line));
    if (!commitPattern.test(sourceCommit)) missing.push("sourceCommit");
    if (sourceRelease !== `ynx-chain-${sourceCommit}`) missing.push("sourceRelease");
    if (!sha.test(manifestSha256)) missing.push("sourceManifestSha256");
    if (!sha.test(chaindSha256)) missing.push("sourceChaindSha256");
    return { role, path: file, present: text.length > 0, ok: text.length > 0 && missing.length === 0, missing, observed: { sourceCommit, sourceRelease, manifestSha256, chaindSha256 } };
  });
  const sourceCommits = [...new Set(nodes.map((node) => node.observed.sourceCommit).filter(Boolean))];
  const sourceReleases = [...new Set(nodes.map((node) => node.observed.sourceRelease).filter(Boolean))];
  const sourceCommit = sourceCommits.length === 1 ? sourceCommits[0] : "";
  const sourceRelease = sourceReleases.length === 1 ? sourceReleases[0] : "";
  const targetValid = commitPattern.test(targetCommit) && targetRelease === `ynx-chain-${targetCommit}`;
  const sourceValid = commitPattern.test(sourceCommit) && sourceRelease === `ynx-chain-${sourceCommit}`;
  const distinct = sourceValid && targetValid && sourceCommit !== targetCommit;
  const failedRoles = nodes.filter((node) => !node.ok).map((node) => node.role);
  const ok = failedRoles.length === 0 && sourceCommits.length === 1 && sourceReleases.length === 1 && distinct;
  return {
    schema: "ynx-upgrade-source-release-evidence/v1", generatedAt: new Date().toISOString(), remotePublicProof: false,
    target: { commit: targetCommit, release: targetRelease }, source: { commit: sourceCommit, release: sourceRelease },
    checks: { targetValid, sourceValid, sourceConsistent: sourceCommits.length === 1 && sourceReleases.length === 1, sourceDiffersFromTarget: distinct },
    status: ok ? "passed" : "failed", failedRoles, nodes,
  };
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ynx-upgrade-source-release-"));
  for (const role of roles) fs.writeFileSync(path.join(dir, `${role}.txt`), `${required.join("\n")}\nsourceCommit=111111111111\nsourceRelease=ynx-chain-111111111111\nsourceManifestSha256=${"a".repeat(64)}\nsourceChaindSha256=${"b".repeat(64)}\n`);
  assert.equal(buildReport(dir, "222222222222", "ynx-chain-222222222222").status, "passed");
  fs.writeFileSync(path.join(dir, "seoul.txt"), "statusEndpoint=ok\n");
  assert.equal(buildReport(dir, "222222222222", "ynx-chain-222222222222").status, "failed");
  console.log("upgrade-source-release-evidence self-test passed");
}

if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }
const dir = process.argv[2] || "tmp/verify-testnet/upgrade-source-release";
const targetCommit = process.argv[3] || "";
const targetRelease = process.argv[4] || "";
const output = process.env.YNX_UPGRADE_SOURCE_RELEASE_EVIDENCE_PATH || "tmp/verify-testnet/upgrade-source-release-evidence.json";
const report = buildReport(dir, targetCommit, targetRelease);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`upgrade source release evidence written: ${output}`);
if (report.status !== "passed") {
  console.error(`upgrade source release evidence failed: roles=${report.failedRoles.join(",") || "none"}`);
  process.exit(1);
}
