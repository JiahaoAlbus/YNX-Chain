#!/usr/bin/env bash
set -euo pipefail
umask 077

# Normal CI only: genuine C -> fixed-domain ABI in the original shared Go
# c-archive -> Go AND verifier. Never link two Go runtimes into Main.
# No real key, Native Source/current, user review or authority input.
[[ $# == 1 && "$1" == /* && ! -e "$1" && ! -L "$1" ]] || { echo 'fresh absolute CI case directory required' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
case_root=$1
mkdir -m 0700 -- "$case_root"
cleanup_synthetic_private() {
  # Generated test-only material, never original custody or a delivery input.
  # Unlinking these two files makes no physical erasure claim.
  rm -f -- "$case_root/input/SYNTHETIC-ONLY-a.der" "$case_root/input/SYNTHETIC-ONLY-b.der"
}
trap cleanup_synthetic_private EXIT
cd -- "$root"
host_os=$(go env GOHOSTOS)
host_arch=$(go env GOHOSTARCH)
[[ "$host_os" == linux || "$host_os" == darwin ]] || { echo 'Linux or macOS native CI host required' >&2; exit 1; }
[[ "$host_arch" == amd64 || "$host_arch" == arm64 ]] || { echo 'amd64 or arm64 native CI host required' >&2; exit 1; }
CGO_ENABLED=0 GOOS="$host_os" GOARCH="$host_arch" go build -p 1 -trimpath \
  -o "$case_root/fixture" ./scripts/fixtures/verify-project-control-cabi
: "${RUNNER_TEMP:?normal CI RUNNER_TEMP is required}"
original_case="$RUNNER_TEMP/ynx-artifact-release-cabi"
original_archive="$original_case/libynx_artifact_release.a"
[[ -f "$original_archive" && -s "$original_archive" && ! -L "$original_archive" && \
   -f "$original_case/output/PUBLIC-RECEIPT.json" && -s "$original_case/output/PUBLIC-RECEIPT.json" ]] || \
  { echo 'original same-job archive and executed Artifact CABI receipt required' >&2; exit 1; }
original_sha=$(shasum -a 256 "$original_archive" | awk '{print $1}')
cp -- "$original_archive" "$case_root/libynx_project_control.a"
cmp -s -- "$original_archive" "$case_root/libynx_project_control.a"
[[ "$(shasum -a 256 "$original_archive" | awk '{print $1}')" == "$original_sha" && \
   "$(shasum -a 256 "$case_root/libynx_project_control.a" | awk '{print $1}')" == "$original_sha" ]] || \
  { echo 'original shared archive changed during copy' >&2; exit 1; }
cp -- "$root/cmd/ynx-artifact-release-cabi/ynx_project_control.h" "$case_root/ynx_project_control.h"
"$case_root/fixture" generate "$case_root/input"
link_flags=(-pthread -lm)
if [[ "$host_os" == linux ]]; then
  link_flags+=(-ldl)
else
  link_flags+=(-framework CoreFoundation -framework Security)
fi
LC_ALL=C cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-project-control-cabi/c/driver.c" "$case_root/libynx_project_control.a" \
  "${link_flags[@]}" -o "$case_root/c-driver"
"$case_root/c-driver" "$case_root/input" "$case_root/output"
"$case_root/fixture" verify "$case_root/input" "$case_root/output"
test -s "$case_root/libynx_project_control.a"
test -s "$case_root/ynx_project_control.h"
test -s "$case_root/output/PUBLIC-INTEROP.json"
test -s "$case_root/output/PUBLIC-RECEIPT.json"
printf 'YNX_PROJECT_CONTROL_CABI_CHECK_PASS host=%s/%s actualCABI=true authority=false\n' "$host_os" "$host_arch"
printf 'YNX_PROJECT_CONTROL_SHARED_ARCHIVE_SHA256 %s\n' "$original_sha"
