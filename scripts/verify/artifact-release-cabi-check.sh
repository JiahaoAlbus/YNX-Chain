#!/usr/bin/env bash
set -euo pipefail
umask 077

# Original normal CI only: genuine C -> c-archive -> fixed PQ math -> Go
# verifier. This script never accepts a library/provider override or real keys.
[[ $# == 1 && "$1" == /* && ! -e "$1" && ! -L "$1" ]] || { echo 'fresh absolute CI case directory required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
case_root=$1
mkdir -m 0700 -- "$case_root"
cleanup_synthetic_private() {
  # These generated test-only private files are not deliverable artifacts.
  # Removing them is not a claim about physical disk/provider memory erasure.
  rm -f -- "$case_root/input/SYNTHETIC-ONLY-a.der" "$case_root/input/SYNTHETIC-ONLY-b.der"
}
trap cleanup_synthetic_private EXIT
cd -- "$root"
host_os=$(go env GOHOSTOS)
host_arch=$(go env GOHOSTARCH)
[[ "$host_os" == linux || "$host_os" == darwin ]] || { echo 'Linux or macOS native CI host required' >&2; exit 1; }
[[ "$host_arch" == amd64 || "$host_arch" == arm64 ]] || { echo 'amd64 or arm64 native CI host required' >&2; exit 1; }
CGO_ENABLED=0 GOOS="$host_os" GOARCH="$host_arch" go build -p 1 -trimpath -o "$case_root/fixture" ./scripts/fixtures/verify-artifact-release-cabi
CGO_ENABLED=1 GOOS="$host_os" GOARCH="$host_arch" go build -p 1 -trimpath -buildmode=c-archive -o "$case_root/libynx_artifact_release.a" ./cmd/ynx-artifact-release-cabi
"$case_root/fixture" generate "$case_root/input"
link_flags=(-pthread -lm)
if [[ "$host_os" == linux ]]; then
  link_flags+=(-ldl)
else
  link_flags+=(-framework CoreFoundation -framework Security)
fi
cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-artifact-release-cabi/c/driver.c" "$case_root/libynx_artifact_release.a" \
  "${link_flags[@]}" -o "$case_root/c-driver"
"$case_root/c-driver" "$case_root/input" "$case_root/output"
"$case_root/fixture" verify "$case_root/input" "$case_root/output"
test -s "$case_root/output/PUBLIC-INTEROP.json"
test -s "$case_root/output/PUBLIC-RECEIPT.json"
printf 'YNX_ARTIFACT_RELEASE_CABI_CHECK_PASS host=%s/%s actualCABI=true authority=false\n' "$host_os" "$host_arch"
