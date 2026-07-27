#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
package_dir="${1:?usage: generate-cold-start-evidence.sh <verified-package-dir> <new-evidence-file>}"
output="${2:?missing evidence output file}"
[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] ||
  { echo "packaged cold-start evidence requires Linux x86_64" >&2; exit 1; }
[[ "$output" == /* && ! -e "$output" && -d "$(dirname "$output")" ]] ||
  { echo "cold-start evidence output must be a new absolute path with an existing parent" >&2; exit 1; }

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"
node scripts/data-fabric/verify-public-testnet-release.mjs "$package_dir" "$commit" "$release" >/dev/null
archive="$package_dir/${release}-linux-amd64.tar.gz"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/extracted"
node scripts/data-fabric/extract-public-testnet-release.mjs "$archive" "$work/extracted" >/dev/null
release_dir="$work/extracted/$release"
node scripts/data-fabric/verify-testnet-release.mjs "$release_dir" "$commit" "$release" >/dev/null

"$release_dir/bin/ynx-data-fabric-worker" -h >/dev/null 2>&1
"$release_dir/bin/ynx-pay-data-fabric-bridge" -h >/dev/null 2>&1
smoke_receipt="$work/smoke-receipt.json"
YNX_DATA_FABRIC_BIN_DIR="$release_dir/bin" \
YNX_DATA_FABRIC_SMOKE_SOURCE_COMMIT="$commit" \
YNX_DATA_FABRIC_SMOKE_SOURCE_RELEASE="$release" \
YNX_DATA_FABRIC_SMOKE_RECEIPT_OUTPUT="$smoke_receipt" \
  bash scripts/data-fabric/local-smoke.sh
node scripts/data-fabric/write-cold-start-evidence.mjs "$package_dir" "$release_dir" "$smoke_receipt" "$output" "$commit" "$release"
jq -e --arg commit "$commit" --arg release "$release" \
  '.status == "verified" and .environment == "linux-runtime" and .commit == $commit and .release == $release and (.binaries | length) == 4' \
  "$output" >/dev/null
printf '{"status":"verified","commit":"%s","release":"%s","evidence":"%s"}\n' "$commit" "$release" "$output"
