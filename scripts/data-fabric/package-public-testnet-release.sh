#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

output="${1:-tmp/data-fabric-public-testnet-release}"
system_tmp="${TMPDIR:-/tmp}"
system_tmp="${system_tmp%/}"
case "$output" in
  tmp/*) output="$root/$output" ;;
  "$root"/tmp/* | "$system_tmp"/* | /tmp/* | /private/tmp/*) ;;
  *) echo "output must be under repository tmp/ or the system temporary directory" >&2; exit 1 ;;
esac

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"
rm -rf "$output"
mkdir -p "$output"
release_dir="$(bash scripts/data-fabric/build-testnet-release.sh "$output/build")"
node scripts/data-fabric/package-public-testnet-release.mjs "$release_dir" "$output" "$commit" "$release"
node scripts/data-fabric/verify-public-testnet-release.mjs "$output" "$commit" "$release" >&2
printf '%s\n' "$output"
