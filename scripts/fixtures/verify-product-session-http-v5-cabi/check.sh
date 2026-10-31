#!/usr/bin/env bash
set -euo pipefail
umask 077

# Consume one original archive containing V5. No archive rebuild, HTTP, device
# access, Node.Start or signing authority is acquired by this synthetic fixture.
[[ $# == 2 && "$1" == /* && "$2" == /* && -f "$1" && ! -L "$1" && ! -e "$2" && ! -L "$2" ]] || { echo 'original archive and fresh absolute case required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)
archive=$1
case_root=$2
archive_parent=$(cd -- "$(dirname -- "$archive")" && pwd -P)
case_parent=$(cd -- "$(dirname -- "$case_root")" && pwd -P)
[[ "$archive_parent/$(basename -- "$archive")" == "$archive" && "$case_parent/$(basename -- "$case_root")" == "$case_root" ]] || { echo 'path aliases refused' >&2; exit 1; }
mkdir -m 0700 -- "$case_root"
fixture="$case_root/fixture"
cleanup_owned() {
  local status=$1
  local cleanup_status=0
  trap - EXIT INT TERM
  if [[ -e "$case_root/input" || -L "$case_root/input" ]]; then
    if [[ ! -x "$fixture" || -L "$fixture" ]]; then
      echo 'synthetic cleanup unavailable; preserve case originals' >&2
      cleanup_status=1
    else
      "$fixture" cleanup "$case_root/input" || cleanup_status=$?
    fi
  fi
  if [[ "$status" != 0 ]]; then exit "$status"; fi
  exit "$cleanup_status"
}
trap 'cleanup_owned "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd -- "$root"
host_os=$(GOTOOLCHAIN=auto go env GOHOSTOS)
host_arch=$(GOTOOLCHAIN=auto go env GOHOSTARCH)
[[ "$host_os" == linux || "$host_os" == darwin ]] || { echo 'native Linux/macOS required' >&2; exit 1; }
[[ "$host_arch" == amd64 || "$host_arch" == arm64 ]] || { echo 'native amd64/arm64 required' >&2; exit 1; }
archive_sha=$(shasum -a 256 "$archive" | awk '{print $1}')
archive_bytes=$(wc -c < "$archive" | tr -d '[:space:]')
GOTOOLCHAIN=auto CGO_ENABLED=0 GOOS="$host_os" GOARCH="$host_arch" GOMAXPROCS=2 GOMEMLIMIT=768MiB \
  go build -mod=readonly -p 1 -trimpath -o "$fixture" ./scripts/fixtures/verify-product-session-http-v5-cabi
"$fixture" prepare "$case_root/input"
link_flags=(-pthread -lm)
if [[ "$host_os" == linux ]]; then link_flags+=(-ldl); else link_flags+=(-framework CoreFoundation -framework Security); fi
LC_ALL=C cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-product-session-http-v5-cabi/c/driver.c" "$archive" "${link_flags[@]}" -o "$case_root/c-driver"
"$case_root/c-driver" "$case_root/input"
"$fixture" verify "$case_root/input"
"$fixture" cleanup "$case_root/input"
[[ "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$archive_sha" ]] || { echo 'shared archive changed; preserve UNKNOWN originals' >&2; exit 1; }
[[ "$(wc -c < "$archive" | tr -d '[:space:]')" == "$archive_bytes" ]] || { echo 'shared archive byte count changed' >&2; exit 1; }
"$fixture" result "$case_root/input" "$archive_sha" "$archive_bytes"
test -s "$case_root/PUBLIC-RESULT.json"
printf 'PRODUCT_SESSION_HTTP_V5_CABI_CHECK_PASS host=%s/%s sharedArchive=true actualCABI=true synthetic=true authority=false\n' "$host_os" "$host_arch"
