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

cp docs/public-proof/PUBLIC_TESTNET_PROOF.md "$out/final/PUBLIC_TESTNET_PROOF.md"
cp docs/acceptance/TESTNET_ACCEPTANCE_REPORT.md "$out/final/TESTNET_ACCEPTANCE_REPORT.md"
cp "$YNX_REMOTE_EVIDENCE_PATH" "$out/final/remote-public-evidence.json"

node - "$out" "$proof_status" "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const [out, status, gitCommit, generatedAt] = process.argv.slice(2);
const finalDir = path.join(out, "final");
const evidencePath = path.join(finalDir, "remote-public-evidence.json");
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const failed = (evidence.checks || []).filter((check) => !check.ok).map((check) => check.name);
const summary = [
  "# Generated Public Testnet Proof",
  "",
  `- Status: ${status}`,
  `- Generated at: ${generatedAt}`,
  `- Git commit: ${gitCommit}`,
  `- Evidence file: remote-public-evidence.json`,
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
  "This package is valid only when Status is passed. Failed packages are retained as diagnostics and must not be presented as completed public proof.",
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
  validPublicProof: status === "passed",
  failedChecks: failed,
  files,
}, null, 2) + "\n");
NODE

find "$out" -type f | sort
if [[ "$proof_status" != "passed" ]]; then
  echo "public-proof package generated diagnostics at $out, but remote public proof is not complete"
  exit 1
fi

echo "public-proof package generated $out"
