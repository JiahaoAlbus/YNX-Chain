#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# == 2 && "$1" == /* && -f "$1" && ! -L "$1" && "$2" == /* && ! -e "$2" && ! -L "$2" ]] || { echo 'original shared archive and fresh absolute case required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)
archive=$1
case_root=$2
mkdir -m 0700 -- "$case_root"
cleanup_test_private() {
  local first_status=$1
  local cleanup_status=0
  local name
  # Only four test-only files created O_EXCL in this new case, never a real
  # Native custody output. Retain every public result, failure and old case.
  for name in SYNTHETIC-ONLY-first-a.der SYNTHETIC-ONLY-first-b.der SYNTHETIC-ONLY-second-a.der SYNTHETIC-ONLY-second-b.der; do
    if [[ -e "$case_root/material/$name" || -L "$case_root/material/$name" ]]; then
      if [[ ! -f "$case_root/material/$name" || -L "$case_root/material/$name" ]]; then
        echo 'unexpected private test leaf preserved' >&2
        cleanup_status=1
      elif ! rm -- "$case_root/material/$name"; then
        cleanup_status=1
      fi
    fi
  done
  # An original compiler/math/caller failure remains the terminal first cause.
  if [[ "$first_status" != 0 ]]; then
    exit "$first_status"
  fi
  exit "$cleanup_status"
}
trap 'cleanup_test_private "$?"' EXIT
cd -- "$root"
link_flags=(-pthread -lm)
case "$(uname -s)" in
  Darwin) link_flags+=(-framework CoreFoundation -framework Security) ;;
  Linux) link_flags+=(-ldl) ;;
  *) echo 'native Darwin/Linux required' >&2; exit 1 ;;
esac
cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-product-device-keypair-v4/c/driver.c" "$archive" "${link_flags[@]}" -o "$case_root/c-driver"
"$case_root/c-driver" "$case_root/material"
# One affected pure-Go compile only; archive build is Root's single shared job.
GOTOOLCHAIN=auto CGO_ENABLED=0 GOMAXPROCS=2 go build -p 1 -trimpath -o "$case_root/independent" ./scripts/fixtures/verify-product-device-keypair-v4
"$case_root/independent" "$case_root/material"
test -s "$case_root/material/PUBLIC-RESULT.json"
printf 'YNX_PRODUCT_DEVICE_KEYPAIR_CHECK_PASS sharedArchive=true authority=false\n'
