#!/usr/bin/env bash
set -euo pipefail
umask 077

# Consume Root's one original native archive. This script never builds an
# archive, creates a real custody item, starts a node or publishes a transaction.
[[ $# == 2 && "$1" == /* && "$2" == /* && -f "$1" && ! -L "$1" && ! -e "$2" && ! -L "$2" ]] || { echo 'original archive and fresh absolute case required' >&2; exit 1; }
[[ "$(basename -- "$1")" == libynx_artifact_release.a ]] || { echo 'original shared archive name required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)
archive=$1
case_root=$2
archive_parent=$(cd -- "$(dirname -- "$archive")" && pwd -P)
case_parent=$(cd -- "$(dirname -- "$case_root")" && pwd -P)
[[ "$archive_parent/$(basename -- "$archive")" == "$archive" && "$case_parent/$(basename -- "$case_root")" == "$case_root" ]] || { echo 'path aliases refused' >&2; exit 1; }
mkdir -m 0700 -- "$case_root"
fixture="$case_root/fixture"
run_fixture() {
  # go test normally selects the package directory; a compiled test binary
  # does not. Preserve the original fixed-vector helper's normal working dir.
  (cd -- "$root/cmd/ynx-artifact-release-cabi" && "$fixture" "$@")
}
cleanup_owned_private() {
  local first_status=$1
  local cleanup_status=0
  trap - EXIT INT TERM
  if [[ -e "$case_root/input" || -L "$case_root/input" ]]; then
    if [[ ! -x "$fixture" || -L "$fixture" ]]; then
      echo 'synthetic cleanup unavailable; preserve original case' >&2
      cleanup_status=1
    else
      YNX_INVOICE_TX_CABI_MODE=cleanup YNX_INVOICE_TX_CABI_DIRECTORY="$case_root/input" \
        run_fixture -test.run '^TestInvoiceTransactionCABIProcess$' -test.count=1 -test.v || cleanup_status=$?
    fi
  fi
  if [[ "$first_status" != 0 ]]; then exit "$first_status"; fi
  exit "$cleanup_status"
}
trap 'cleanup_owned_private "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd -- "$root"
host_os=$(GOTOOLCHAIN=auto go env GOHOSTOS)
host_arch=$(GOTOOLCHAIN=auto go env GOHOSTARCH)
[[ "$host_os" == linux || "$host_os" == darwin ]] || { echo 'native Linux/macOS required' >&2; exit 1; }
[[ "$host_arch" == amd64 || "$host_arch" == arm64 ]] || { echo 'native amd64/arm64 required' >&2; exit 1; }
archive_sha=$(shasum -a 256 "$archive" | awk '{print $1}')
archive_bytes=$(wc -c < "$archive" | tr -d '[:space:]')
# Only the narrow fixture test binary is compiled; the fixed archive is linked
# unchanged. The compiled test process uses -test.run for this feature only.
GOTOOLCHAIN=auto CGO_ENABLED=1 GOOS="$host_os" GOARCH="$host_arch" GOMAXPROCS=2 GOMEMLIMIT=768MiB \
  go test -c -p 1 -trimpath -o "$fixture" ./cmd/ynx-artifact-release-cabi
run_fixture -test.run '^TestInvoiceTransactionCABIFixtureOwnershipAndUnknownFiles$' -test.count=1 -test.v
YNX_INVOICE_TX_CABI_MODE=generate YNX_INVOICE_TX_CABI_DIRECTORY="$case_root/input" \
  run_fixture -test.run '^TestInvoiceTransactionCABIProcess$' -test.count=1 -test.v
link_flags=(-pthread -lm)
if [[ "$host_os" == linux ]]; then link_flags+=(-ldl); else link_flags+=(-framework CoreFoundation -framework Security); fi
LC_ALL=C cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-invoice-tx-cabi/c/driver.c" "$archive" "${link_flags[@]}" -o "$case_root/c-driver"
"$case_root/c-driver" "$case_root/input"
YNX_INVOICE_TX_CABI_MODE=verify YNX_INVOICE_TX_CABI_DIRECTORY="$case_root/input" YNX_INVOICE_TX_CABI_ARCHIVE_SHA256="$archive_sha" YNX_INVOICE_TX_CABI_ARCHIVE_BYTES="$archive_bytes" \
  run_fixture -test.run '^TestInvoiceTransactionCABIProcess$' -test.count=1 -test.v
[[ "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$archive_sha" ]] || { echo 'shared archive changed' >&2; exit 1; }
[[ "$(wc -c < "$archive" | tr -d '[:space:]')" == "$archive_bytes" ]] || { echo 'shared archive byte count changed' >&2; exit 1; }
test -s "$case_root/PUBLIC-RESULT.json"
printf 'INVOICE_TX_CABI_CHECK_PASS host=%s/%s sharedArchive=true actualCABI=true synthetic=true keychainApproval=false authority=false\n' "$host_os" "$host_arch"
