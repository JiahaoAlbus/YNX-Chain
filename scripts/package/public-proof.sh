#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

out="tmp/packages/public-proof"
rm -rf "$out"
mkdir -p "$out/final"

export YNX_REMOTE_EVIDENCE_PATH="$out/remote-public-evidence.json"
proof_status="passed"
if ! bash scripts/verify/remote-smoke-test.sh; then
  proof_status="failed"
fi
if ! node scripts/verify/public-proof-evidence-check.mjs "$YNX_REMOTE_EVIDENCE_PATH" --out "$out/public-proof-validation.json"; then
  proof_status="failed"
fi

cp docs/public-proof/PUBLIC_TESTNET_PROOF.md "$out/final/PUBLIC_TESTNET_PROOF.md"
cp docs/acceptance/TESTNET_ACCEPTANCE_REPORT.md "$out/final/TESTNET_ACCEPTANCE_REPORT.md"
cp "$YNX_REMOTE_EVIDENCE_PATH" "$out/final/remote-public-evidence.json"
cp "$out/public-proof-validation.json" "$out/final/public-proof-validation.json"
release_manifest_evidence="${YNX_RELEASE_MANIFEST_EVIDENCE_PATH:-tmp/verify-testnet/release-manifest-evidence.json}"
if [[ -f "$release_manifest_evidence" ]]; then
  cp "$release_manifest_evidence" "$out/final/release-manifest-evidence.json"
else
  node - "$out/final/release-manifest-evidence.json" "$release_manifest_evidence" <<'NODE'
const fs = require("fs");
const [outPath, expectedPath] = process.argv.slice(2);
fs.writeFileSync(outPath, `${JSON.stringify({
  schema: "ynx-release-manifest-evidence/v1",
  generatedAt: new Date().toISOString(),
  source: "public-proof-package",
  remotePublicProof: false,
  status: "missing",
  expectedPath,
  note: "release manifest evidence was not available; public proof must remain invalid",
}, null, 2)}\n`);
NODE
fi

node - "$out" "$proof_status" "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const [out, status, gitCommit, generatedAt] = process.argv.slice(2);
const finalDir = path.join(out, "final");
const evidencePath = path.join(finalDir, "remote-public-evidence.json");
const validationPath = path.join(finalDir, "public-proof-validation.json");
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));
const failed = (evidence.checks || []).filter((check) => !check.ok).map((check) => check.name);
const validPublicProof = status === "passed" && validation.validPublicProof === true;
const summary = [
  "# Generated Public Testnet Proof",
  "",
  `- Status: ${status}`,
  `- Valid public proof: ${validPublicProof ? "yes" : "no"}`,
  `- Generated at: ${generatedAt}`,
  `- Git commit: ${gitCommit}`,
  `- Evidence file: remote-public-evidence.json`,
  `- Validation file: public-proof-validation.json`,
  `- Expected chain: ${evidence.expected?.cosmosChainId || ""} / ${evidence.expected?.evmChainIdHex || ""}`,
  `- Public RPC: ${evidence.endpoints?.rpc || ""}`,
  `- Public faucet: ${evidence.endpoints?.faucet || ""}`,
  `- Public explorer: ${evidence.endpoints?.explorer || ""}`,
  "",
  "## Failed Checks",
  "",
  failed.length ? failed.map((name) => `- ${name}`).join("\n") : "- none",
  "",
  "## Evidence Policy",
  "",
  "This package is valid only when Status is passed, Valid public proof is yes, release-manifest-evidence.json proves the deployed release manifest checksum handoff, and public-proof-validation.json shows every required remote Chain Law, appeal, transparency, validator, release, endpoint, and mutation proof check present and passed. Failed packages are retained as diagnostics and must not be presented as completed public proof.",
  "",
].join("\n");
fs.writeFileSync(path.join(finalDir, "PUBLIC_TESTNET_PROOF.generated.md"), summary);
const files = fs.readdirSync(finalDir).filter((file) => file !== "manifest.json").sort().map((file) => {
  const body = fs.readFileSync(path.join(finalDir, file));
  return { file, bytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") };
});
fs.writeFileSync(path.join(finalDir, "manifest.json"), JSON.stringify({
  package: "ynx-remote-public-proof-package",
  generatedAt,
  gitCommit,
  status,
  validPublicProof,
  validation,
  failedChecks: failed,
  files,
}, null, 2) + "\n");
NODE

if ! node scripts/verify/public-proof-package-check.mjs "$out/final"; then
  proof_status="failed"
fi

find "$out" -type f | sort
if [[ "$proof_status" != "passed" ]]; then
  echo "public-proof package generated diagnostics at $out, but remote public proof is not complete"
  exit 1
fi

echo "public-proof package generated $out"
