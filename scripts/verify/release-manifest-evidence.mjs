#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const verifyDir = process.argv[2] || process.env.YNX_VERIFY_TESTNET_OUT || "tmp/verify-testnet";
const expectedCommit = process.argv[3] || process.env.YNX_EXPECTED_RELEASE_COMMIT || "";
const expectedRelease = process.argv[4] || process.env.YNX_EXPECTED_RELEASE_NAME || (expectedCommit ? `ynx-chain-${expectedCommit}` : "");
const outPath = process.env.YNX_RELEASE_MANIFEST_EVIDENCE_PATH || path.join(verifyDir, "release-manifest-evidence.json");
const roles = ["primary", "singapore", "silicon-valley", "seoul"];
const requiredLines = [
  "releaseManifest=ok",
  "releaseManifest.schema=ok",
  "releaseManifest.commit=ok",
  "releaseManifest.release=ok",
  "releaseManifest.chaindPath=ok",
  "releaseManifest.chaindChecksum=ok",
];

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function nodeEvidence(role) {
  const file = path.join(verifyDir, `${role}.txt`);
  const text = readText(file);
  const checks = Object.fromEntries(requiredLines.map((line) => [line.replace("=ok", ""), text.includes(line)]));
  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    role,
    path: file,
    present: text.length > 0,
    ok: text.length > 0 && missing.length === 0,
    checks,
    missing,
  };
}

const nodes = roles.map(nodeEvidence);
const missingRoles = nodes.filter((node) => !node.present).map((node) => node.role);
const failedRoles = nodes.filter((node) => node.present && !node.ok).map((node) => node.role);
const ok = missingRoles.length === 0 && failedRoles.length === 0 && expectedCommit.length > 0 && expectedRelease.length > 0;
const report = {
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

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`release manifest evidence written: ${outPath}`);
if (!ok) {
  console.error(`release manifest evidence failed: missingRoles=${missingRoles.join(",") || "none"} failedRoles=${failedRoles.join(",") || "none"}`);
  process.exit(1);
}
