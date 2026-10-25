#!/usr/bin/env bash
set -euo pipefail

# Exercise the production callee from isolated repositories. Keep generated
# positive inputs and captured scanner output out of the real source tree.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
source_root=$(cd -- "$script_dir/../.." && pwd -P)
scanner="$script_dir/secret-scan.sh"
fixture_path='third_party/cometbft/rpc/jsonrpc/server/test.key'
public_fixture="$source_root/$fixture_path"
bash_bin=$(command -v bash)
git_bin=$(command -v git)
original_path=$PATH
# A parent Git command may export these. Keep all fixture Git I/O in the new
# private repositories rather than inheriting an outer index/object store.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
unset GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

if [[ ! -f "$scanner" || ! -f "$public_fixture" || -L "$public_fixture" ]]; then
  echo 'secret-scan-check: required production source or public fixture missing' >&2
  exit 1
fi

umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/ynx-secret-scan-check.XXXXXX")
chmod 0700 "$work"
all_passed=0
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" == 0 && "$all_passed" == 1 ]]; then
    rm -rf -- "$work"
  else
    printf 'secret-scan-check: private diagnostics retained at %s\n' "$work" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

new_case() {
  case_name=$1
  case_dir="$work/$case_name"
  repo="$case_dir/repo"
  mkdir -m 0700 "$case_dir"
  "$git_bin" init -q "$repo" >"$case_dir/setup.stdout" 2>"$case_dir/setup.stderr"
}

public_fixture_copy() {
  mkdir -p -- "$repo/$(dirname -- "$fixture_path")"
  cp -- "$public_fixture" "$repo/$fixture_path"
}

key_header() {
  # Split literals so this regression source is itself clean under the scanner.
  printf '%s%s%s\n' '-----BEGIN ' 'PRIVATE ' 'KEY-----'
}

expect_exit() {
  local expected=$1 scan_path=${2:-$original_path} status
  if (cd -- "$repo" && PATH="$scan_path" "$bash_bin" "$scanner") \
    >"$case_dir/scanner.stdout" 2>"$case_dir/scanner.stderr"; then
    status=0
  else
    status=$?
  fi
  printf '%s: %s\n' "$case_name" "$status"
  if [[ "$status" != "$expected" ]]; then
    printf '%s: expected exit %s, got %s\n' "$case_name" "$expected" "$status" >&2
    exit 1
  fi
}

stub_command() {
  local name=$1 status=$2
  mkdir -p -- "$case_dir/bin"
  printf '#!/bin/sh\nexit %s\n' "$status" >"$case_dir/bin/$name"
  chmod 0700 "$case_dir/bin/$name"
}

new_case clean
printf 'ordinary source input\n' >"$repo/clean.txt"
expect_exit 0

new_case exact-public-fixture
public_fixture_copy
expect_exit 0

new_case changed-public-fixture
public_fixture_copy
printf '\n' >>"$repo/$fixture_path"
expect_exit 2

new_case changed-public-fixture-without-header
mkdir -p -- "$repo/$(dirname -- "$fixture_path")"
sed '1d' "$public_fixture" >"$repo/$fixture_path"
expect_exit 2

new_case public-fixture-at-another-path
cp -- "$public_fixture" "$repo/unlisted.key"
expect_exit 1

new_case public-fixture-symlink
mkdir -p -- "$repo/$(dirname -- "$fixture_path")"
cp -- "$public_fixture" "$case_dir/public.key"
ln -s -- "$case_dir/public.key" "$repo/$fixture_path"
expect_exit 2

new_case private-key-pattern
key_header >"$repo/input.txt"
expect_exit 1

new_case api-pattern
printf '%s%s\n' 'sk-' 'AAAAAAAAAAAAAAAAAAAA' >"$repo/input.txt"
expect_exit 1

new_case aws-pattern
printf '%s%s\n' 'AKIA' '0000000000000000' >"$repo/input.txt"
expect_exit 1

new_case slack-pattern
printf '%s%s%s\n' 'xox' 'b-' 'synthetic' >"$repo/input.txt"
expect_exit 1

new_case existing-source-exclusions
mkdir -p -- "$repo/scripts/validate" "$repo/tools"
key_header >"$repo/scripts/validate/secret-scan.sh"
key_header >"$repo/tools/scaffold-ynx-chain.mjs"
expect_exit 0

new_case scan-command-error
printf 'ordinary source input\n' >"$repo/clean.txt"
stub_command rg 2
expect_exit 2 "$case_dir/bin:$original_path"

new_case file-inventory-error
printf 'ordinary source input\n' >"$repo/clean.txt"
stub_command git 23
expect_exit 23 "$case_dir/bin:$original_path"

new_case fixture-digest-command-error
public_fixture_copy
stub_command sha256sum 1
expect_exit 2 "$case_dir/bin:$original_path"

all_passed=1
