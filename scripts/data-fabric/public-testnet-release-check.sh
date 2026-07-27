#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"

bash scripts/data-fabric/package-public-testnet-release.sh "$work/first" >/dev/null
bash scripts/data-fabric/package-public-testnet-release.sh "$work/second" >/dev/null
archive="$release-linux-amd64.tar.gz"
first_sha="$(sha256sum "$work/first/$archive" | awk '{print $1}')"
second_sha="$(sha256sum "$work/second/$archive" | awk '{print $1}')"
[[ "$first_sha" == "$second_sha" ]] || { echo "public Testnet archive is not deterministic" >&2; exit 1; }

cp -R "$work/first" "$work/corrupt"
printf 'tamper' >> "$work/corrupt/$archive"
if node scripts/data-fabric/verify-public-testnet-release.mjs "$work/corrupt" "$commit" "$release" >/dev/null 2>&1; then
  echo "public Testnet verifier accepted a modified archive" >&2
  exit 1
fi

mkdir "$work/extracted"
node scripts/data-fabric/extract-public-testnet-release.mjs "$work/first/$archive" "$work/extracted" >/dev/null
release_dir="$work/extracted/$release"
node scripts/data-fabric/verify-testnet-release.mjs "$release_dir" "$commit" "$release" >/dev/null

if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  cold_start_evidence="$work/cold-start-evidence.json"
  bash scripts/data-fabric/generate-cold-start-evidence.sh "$work/first" "$cold_start_evidence" >/dev/null
  evidence_sha="$(sha256sum "$cold_start_evidence" | awk '{print $1}')"
  cold_start="packaged-linux-amd64-verified"
else
  bash scripts/data-fabric/local-smoke.sh
  evidence_sha=""
  cold_start="host-runtime-verified; packaged-linux-amd64-deferred-to-ci"
fi

printf '{"status":"verified","commit":"%s","archiveSha256":"%s","coldStart":"%s","coldStartEvidenceSha256":"%s"}\n' "$commit" "$first_sha" "$cold_start" "$evidence_sha"
