#!/usr/bin/env bash
set -euo pipefail
umask 077

# Original normal native-host CI only. Link the SAME already-built original
# archive, never a second Go runtime, Main binary or caller-supplied provider.
[[ $# == 2 && "$1" == /* && "$2" == /* && -f "$1" && ! -L "$1" && ! -e "$2" && ! -L "$2" ]] || { echo 'existing native CI archive and fresh absolute case required' >&2; exit 1; }
[[ "$(basename -- "$1")" == libynx_artifact_release.a ]] || { echo 'original shared archive name required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
archive=$1
case_root=$2
mkdir -m 0700 -- "$case_root"
cleanup_synthetic_private() {
  # Test-only generated material; no physical disk-erasure claim.
  rm -f -- "$case_root/input/SYNTHETIC-ONLY-a.der" "$case_root/input/SYNTHETIC-ONLY-b.der"
}
trap cleanup_synthetic_private EXIT
cd -- "$root"
host_os=$(go env GOHOSTOS)
host_arch=$(go env GOHOSTARCH)
[[ "$host_os" == linux || "$host_os" == darwin ]] || { echo 'native Linux/macOS CI required' >&2; exit 1; }
[[ "$host_arch" == amd64 || "$host_arch" == arm64 ]] || { echo 'native amd64/arm64 CI required' >&2; exit 1; }
archive_sha=$(shasum -a 256 "$archive" | awk '{print $1}')
CGO_ENABLED=1 GOOS="$host_os" GOARCH="$host_arch" go test -c -p 1 -trimpath -o "$case_root/fixture" ./cmd/ynx-artifact-release-cabi
YNX_INITIAL_CABI_FIXTURE_MODE=generate YNX_INITIAL_CABI_FIXTURE_DIRECTORY="$case_root/input" "$case_root/fixture" -test.run '^TestAccountInitialCABIProcess$' -test.v
link_flags=(-pthread -lm)
if [[ "$host_os" == linux ]]; then link_flags+=(-ldl); else link_flags+=(-framework CoreFoundation -framework Security); fi
LC_ALL=C cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-account-initial-cabi/c/account_initial_smoke.c" "$archive" "${link_flags[@]}" -o "$case_root/initial-c-driver"
"$case_root/initial-c-driver" "$case_root/input"
YNX_INITIAL_CABI_FIXTURE_MODE=verify YNX_INITIAL_CABI_FIXTURE_DIRECTORY="$case_root/input" "$case_root/fixture" -test.run '^TestAccountInitialCABIProcess$' -test.v
[[ "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$archive_sha" ]] || { echo 'shared native archive changed' >&2; exit 1; }
test -s "$case_root/input/PUBLIC-INTEROP.json"
test -s "$case_root/input/PUBLIC-RECEIPT.json"
printf 'YNX_ACCOUNT_INITIAL_CABI_CHECK_PASS host=%s/%s actualCABI=true authority=false\n' "$host_os" "$host_arch"
