#!/usr/bin/env bash
set -euo pipefail
umask 077

# Development/normal-CI mathematical exercise only. Consume Root's sole archive;
# never build another archive or obtain a production key, Source or approval.
[[ $# == 4 && "$1" == --archive && "$3" == --case ]] || { echo 'usage: check.sh --archive ABS_ARCHIVE --case FRESH_ABS_CASE' >&2; exit 1; }
archive=$2
case_root=$4
[[ "$archive" == /* && "$case_root" == /* && -f "$archive" && ! -L "$archive" && ! -e "$case_root" && ! -L "$case_root" ]] || { echo 'original archive and fresh case required' >&2; exit 1; }
[[ "$(basename -- "$archive")" == libynx_artifact_release.a ]] || { echo 'original shared archive name required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)
archive_parent=$(cd -- "$(dirname -- "$archive")" && pwd -P)
case_parent=$(cd -- "$(dirname -- "$case_root")" && pwd -P)
[[ "$archive_parent/$(basename -- "$archive")" == "$archive" && "$case_parent/$(basename -- "$case_root")" == "$case_root" ]] || { echo 'path aliases refused' >&2; exit 1; }
mkdir -m 0700 -- "$case_root"
fixture="$case_root/independent"
input="$case_root/material"
output="$case_root/output"
cleanup_private() {
  local first_status=$1
  local cleanup_status=0
  trap - EXIT INT TERM
  if [[ -e "$input" || -L "$input" ]]; then
    if [[ ! -d "$input" || -L "$input" || ! -x "$fixture" || -L "$fixture" ]]; then
      echo 'synthetic cleanup unavailable; preserve original case' >&2
      cleanup_status=1
    else
      "$fixture" cleanup "$input" || cleanup_status=$?
    fi
  fi
  if [[ "$first_status" != 0 ]]; then exit "$first_status"; fi
  exit "$cleanup_status"
}
trap 'cleanup_private "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd -- "$root"
archive_sha=$(shasum -a 256 "$archive" | awk '{print $1}')
archive_bytes=$(wc -c < "$archive" | tr -d '[:space:]')

# Capture the original public vector, not a reconstructed JSON object. The
# source leaf was read directly from SDK a7bfd7800 Git blob
# f67da3479eca3046836c0a5d673f99b3709a56a3, so a normal shallow checkout does
# not need to fetch the SDK branch/history. Its exact bytes remain mandatory.
vector="$case_root/SDK-a7-deployment-v2-manifest.json"
source_vector="$root/internal/ynxbatch/testdata/deployment_v2_sdk_a7.json"
[[ -f "$source_vector" && ! -L "$source_vector" ]] || { echo 'frozen original SDK vector source required' >&2; exit 1; }
(set -o noclobber; cat -- "$source_vector" > "$vector")
[[ "$(wc -c < "$vector" | tr -d '[:space:]')" == 3139 && "$(shasum -a 256 "$vector" | awk '{print $1}')" == bfff21c8195e2c1a81d46060caa04e73f756b1cb2a1dc164813aa9c6a6b86ecb ]] || { echo 'frozen public SDK vector mismatch' >&2; exit 1; }

# One independent pure-Go fixture compile; the archive is Root's existing
# single native image. There is no second Go runtime linked into the C driver.
GOTOOLCHAIN=auto CGO_ENABLED=0 GOMAXPROCS=2 GOMEMLIMIT=1536MiB \
  go build -mod=readonly -p 1 -trimpath -o "$fixture" ./scripts/fixtures/verify-deployment-manifest-v2-cabi
"$fixture" generate "$input" "$vector"
link_flags=(-pthread -lm)
case "$(uname -s)" in
  Darwin) link_flags+=(-framework CoreFoundation -framework Security) ;;
  Linux) link_flags+=(-ldl) ;;
  *) echo 'native Darwin/Linux required' >&2; exit 1 ;;
esac
LC_ALL=C cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-deployment-manifest-v2-cabi/c/driver.c" "$archive" "${link_flags[@]}" -o "$case_root/c-driver"
"$case_root/c-driver" "$input" "$output" | tee "$case_root/C.stdout"
grep -Fx 'YNX_DEPLOYMENT_MANIFEST_V2_C_BOUNDARY_PASS cases=54 physicalEraseClaimed=false' "$case_root/C.stdout" > /dev/null
"$fixture" verify "$input" "$output" "$vector" | tee "$case_root/Go.stdout"
grep -Fx 'YNX_DEPLOYMENT_MANIFEST_V2_CABI_INTEROP_PASS cCases=54 goNegativeCases=26 actualCABI=true authority=false' "$case_root/Go.stdout" > /dev/null
"$fixture" cleanup "$input"
for name in SYNTHETIC-ONLY-a.der SYNTHETIC-ONLY-b.der; do
  [[ ! -e "$input/$name" && ! -L "$input/$name" ]] || { echo 'synthetic DER remains; preserve case and first failure' >&2; exit 1; }
done
[[ "$(shasum -a 256 "$archive" | awk '{print $1}')" == "$archive_sha" && "$(wc -c < "$archive" | tr -d '[:space:]')" == "$archive_bytes" ]] || { echo 'shared archive changed' >&2; exit 1; }
test -s "$output/PUBLIC-RESULT.json"
printf 'YNX_DEPLOYMENT_MANIFEST_V2_CABI_CHECK_PASS cCases=54 goNegativeCases=26 privateDERAbsent=2 sharedArchive=true SourceAdmission=false RootAdmission=false\n'
