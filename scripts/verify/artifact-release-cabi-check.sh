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
if [[ "$host_os" == darwin ]]; then
  # Reconstruct the complete exact c2e0 callee from only this constrained
  # five-line repair. The full old SHA must match before its actual compile;
  # no history fetch or arbitrary compiler error substitutes for the real RED.
  # Future substantive driver changes must explicitly retain this old callee.
  old_source="$case_root/c2e0-driver.c"
  old_stderr="$case_root/c2e0-driver.stderr"
  current_driver="$root/scripts/fixtures/verify-artifact-release-cabi/c/driver.c"
  expected_prefix=$'#if defined(__APPLE__)\n/* _POSIX_C_SOURCE alone hides Darwin\'s O_NOFOLLOW declaration. Keep the\n * actual no-symlink flag; never replace it with a permissive fallback. */\n#define _DARWIN_C_SOURCE 1\n#endif'
  [[ "$(head -n 5 "$current_driver")" == "$expected_prefix" ]] || { echo 'exact five-line Darwin repair prefix required' >&2; exit 1; }
  sed '1,5d' "$current_driver" >"$old_source"
  [[ "$(shasum -a 256 "$old_source" | awk '{print $1}')" == 47e37d534909dfac249fe5d3edc2b256207069df68d988b84292ec4e7aaf5bd8 ]] || { echo 'original failed C driver source differs' >&2; exit 1; }
  if LC_ALL=C cc -std=c11 -Wall -Wextra -Werror -pedantic -fsyntax-only -I "$root/cmd/ynx-artifact-release-cabi" \
      "$old_source" >"$case_root/c2e0-driver.stdout" 2>"$old_stderr"; then
    echo 'original Darwin O_NOFOLLOW counterexample unexpectedly compiled' >&2
    exit 1
  else
    old_status=$?
  fi
  [[ "$old_status" == 1 ]] || { echo 'original C counterexample failed outside compiler diagnostics' >&2; exit 1; }
  error_count=$(grep -c 'error:' "$old_stderr" || true)
  expected_count=$(grep -F -c "error: use of undeclared identifier 'O_NOFOLLOW'" "$old_stderr" || true)
  [[ "$error_count" == 2 && "$expected_count" == 2 ]] || { cat "$old_stderr" >&2; echo 'original C failure is not the exact O_NOFOLLOW first cause' >&2; exit 1; }
  grep -F -q ":36:36: error: use of undeclared identifier 'O_NOFOLLOW'" "$old_stderr"
  grep -F -q ":54:55: error: use of undeclared identifier 'O_NOFOLLOW'" "$old_stderr"
  printf 'YNX_ARTIFACT_CABI_ORIGINAL_DARWIN_RED_REPRODUCED commit=c2e0b000ebbd9c6f85120a2a2e9c89a19512b47b errors=2 O_NOFOLLOW=undeclared\n'
fi
CGO_ENABLED=0 GOOS="$host_os" GOARCH="$host_arch" go build -p 1 -trimpath -o "$case_root/fixture" ./scripts/fixtures/verify-artifact-release-cabi
CGO_ENABLED=1 GOOS="$host_os" GOARCH="$host_arch" go build -p 1 -trimpath -buildmode=c-archive -o "$case_root/libynx_artifact_release.a" ./cmd/ynx-artifact-release-cabi
"$case_root/fixture" generate "$case_root/input"
link_flags=(-pthread -lm)
if [[ "$host_os" == linux ]]; then
  link_flags+=(-ldl)
else
  link_flags+=(-framework CoreFoundation -framework Security)
fi
LC_ALL=C cc -std=c11 -Wall -Wextra -Werror -pedantic -I "$root/cmd/ynx-artifact-release-cabi" \
  "$root/scripts/fixtures/verify-artifact-release-cabi/c/driver.c" "$case_root/libynx_artifact_release.a" \
  "${link_flags[@]}" -o "$case_root/c-driver"
"$case_root/c-driver" "$case_root/input" "$case_root/output"
"$case_root/fixture" verify "$case_root/input" "$case_root/output"
test -s "$case_root/output/PUBLIC-INTEROP.json"
test -s "$case_root/output/PUBLIC-RECEIPT.json"
printf 'YNX_ARTIFACT_RELEASE_CABI_CHECK_PASS host=%s/%s actualCABI=true authority=false\n' "$host_os" "$host_arch"
