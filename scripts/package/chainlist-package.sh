#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
out="tmp/packages/chainlist"
rm -rf "$out"
mkdir -p "$out"

node - <<'NODE'
const fs = require("fs");
const metadata = JSON.parse(fs.readFileSync("chain-metadata/ynx-testnet.json", "utf8"));
if (metadata.name !== "YNX Testnet") throw new Error("chain name mismatch");
if (metadata.chainId !== 6423) throw new Error("chainId must be 6423");
if (metadata.nativeCurrency?.name !== "YNXT") throw new Error("native currency name must be YNXT");
if (metadata.nativeCurrency?.symbol !== "YNXT") throw new Error("native currency symbol must be YNXT");
if (metadata.nativeCurrency?.decimals !== 18) throw new Error("native currency decimals must be 18");
if (!metadata.status.includes("requires real public URLs")) throw new Error("testnet metadata must not pretend public submission is complete");
NODE

cp chain-metadata/ynx-testnet.json "$out/"
cp chain-metadata/ynx-mainnet-draft.json "$out/"
cp docs/ecosystem/CHAINLIST_SUBMISSION_PACKAGE.md "$out/"
cp docs/ecosystem/CHAIN_METADATA.md "$out/"

git_commit="$(git rev-parse HEAD)"
generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node - "$out" "$git_commit" "$generated_at" <<'NODE'
const fs = require("fs");
const crypto = require("crypto");
const [out, gitCommit, generatedAt] = process.argv.slice(2);
const files = fs.readdirSync(out).sort().map((file) => {
  const body = fs.readFileSync(`${out}/${file}`);
  return {file, sha256: crypto.createHash("sha256").update(body).digest("hex"), bytes: body.length};
});
fs.writeFileSync(`${out}/manifest.json`, JSON.stringify({
  package: "ynx-chainlist-submission",
  generatedAt,
  gitCommit,
  status: "draft-ready; public URLs and proof hashes required before submission",
  files
}, null, 2) + "\n");
NODE

find "$out" -type f | sort
echo "chainlist-package generated $out"
