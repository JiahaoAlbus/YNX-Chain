#!/usr/bin/env bash
set -euo pipefail
umask 077

# CI-only: link one existing native archive. This fixture neither invokes Main
# nor provides a real Source/current/custodian/Root grant or registration.
[[ $# == 2 && "$1" == /* && "$2" == /* && -f "$1" && ! -L "$1" && ! -e "$2" && ! -L "$2" ]] || { echo 'original native archive and new absolute fixture case required' >&2; exit 1; }
[[ $(basename -- "$1") == libynx_artifact_release.a ]] || { echo 'original same-job shared archive required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
archive=$1
case_root=$2
mkdir -m 0700 -- "$case_root"
cleanup_synthetic_private() {
  # Only this new fixture's synthetic custodian material. The C-generated
  # publisher custody was never written to disk. No physical erase is claimed.
  rm -f -- "$case_root/input/SYNTHETIC-ONLY-custodian-a.der" "$case_root/input/SYNTHETIC-ONLY-custodian-b.der"
}
trap cleanup_synthetic_private EXIT
cd -- "$root"
host_os=$(go env GOHOSTOS)
host_arch=$(go env GOHOSTARCH)
[[ $host_os == linux || $host_os == darwin ]] || { echo 'normal native Linux/macOS CI required' >&2; exit 1; }
[[ $host_arch == amd64 || $host_arch == arm64 ]] || { echo 'normal native amd64/arm64 CI required' >&2; exit 1; }
archive_sha=$(shasum -a 256 "$archive" | awk '{print $1}')
CGO_ENABLED=0 GOOS="$host_os" GOARCH="$host_arch" go build -p 1 -trimpath \
  -o "$case_root/fixture" ./scripts/fixtures/verify-publisher-registration-cabi
"$case_root/fixture" prepare "$case_root/input"
link_flags=(-pthread -lm)
if [[ $host_os == linux ]]; then link_flags+=(-ldl); else link_flags+=(-framework CoreFoundation -framework Security); fi
LC_ALL=C cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-publisher-registration-cabi/c/driver.c" "$archive" "${link_flags[@]}" -o "$case_root/publisher-c-driver"
"$case_root/publisher-c-driver" "$case_root/input" "$case_root/fixture"
"$case_root/fixture" verify "$case_root/input"
[[ $(shasum -a 256 "$archive" | awk '{print $1}') == "$archive_sha" ]] || { echo 'original shared archive changed' >&2; exit 1; }
test -s "$case_root/input/PUBLIC-INTEROP.json"
test -s "$case_root/input/PUBLIC-RECEIPT.json"
printf 'YNX_PUBLISHER_REGISTRATION_CABI_CHECK_PASS host=%s/%s actualCABI=true authority=false\n' "$host_os" "$host_arch"
