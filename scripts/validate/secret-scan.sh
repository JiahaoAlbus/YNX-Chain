#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'
scanner_path='scripts/validate/secret-scan.sh'
scaffold_path='tools/scaffold-ynx-chain.mjs'
public_tls_fixture_path='third_party/cometbft/rpc/jsonrpc/server/test.key'
public_tls_fixture_sha256='2b95a96284cc502dba1d4c30dd6c7c6dad465c9a062d32afd2fafd7a093e808e'
public_r5_vector_path='cmd/ynx-secure-link/p04-consumer-deps/sdk/vector.json'
public_r5_vector_sha256='4c13979678fd2c7ad3de174a2f91ae56e609a0bafb398def1ac6ba446d91186a'

# Preserve the status of git itself. Process substitution would otherwise hide
# a failed inventory as an empty, apparently successful scan.
umask 077
file_list=$(mktemp "${TMPDIR:-/tmp}/ynx-secret-scan.XXXXXX")
trap 'rm -f -- "$file_list"' EXIT
if git ls-files --cached --others --exclude-standard -z -- . >"$file_list"; then
  :
else
  status=$?
  echo "secret scan could not complete: file inventory failed" >&2
  exit "$status"
fi

verify_exact_public_fixture() {
  local path=$1 expected_sha256=$2 label=$3 digest
  # Only the fixed path/SHA pairs below are public test fixtures. This is not
  # a key class, vector class or directory exclusion; changed bytes fail closed.
  if [[ ! -f "$path" || -L "$path" ]]; then
    echo "$label identity mismatch" >&2
    return 2
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    digest=$(sha256sum -- "$path") || {
      echo "$label digest could not be read" >&2
      return 2
    }
  else
    digest=$(shasum -a 256 -- "$path") || {
      echo "$label digest could not be read" >&2
      return 2
    }
  fi
  if [[ ${digest%% *} != "$expected_sha256" ]]; then
    echo "$label identity mismatch" >&2
    return 2
  fi
}

scan_file() {
  local path=$1
  if command -v rg >/dev/null 2>&1; then
    rg -n --with-filename --no-messages -e "$pattern" -- "$path"
    return
  fi
  grep -HInE --binary-files=without-match -e "$pattern" -- "$path"
}

scan() {
  local path status found=1
  while IFS= read -r -d '' path; do
    case "$path" in
      "$scanner_path"|"$scaffold_path") continue ;;
      "$public_tls_fixture_path")
        verify_exact_public_fixture "$path" "$public_tls_fixture_sha256" "public TLS fixture"
        status=$?
        if [[ "$status" != 0 ]]; then
          return "$status"
        fi
        continue
        ;;
      "$public_r5_vector_path")
        verify_exact_public_fixture "$path" "$public_r5_vector_sha256" "public R5 vector"
        status=$?
        if [[ "$status" != 0 ]]; then
          return "$status"
        fi
        continue
        ;;
    esac
    scan_file "$path"
    status=$?
    case "$status" in
      0) found=0 ;;
      1) ;;
      *) return "$status" ;;
    esac
  done <"$file_list"
  return "$found"
}

set +e
scan
status=$?
set -e
case "$status" in
  0)
    echo "possible secret found"
    exit 1
    ;;
  1)
    echo "secret scan passed"
    ;;
  *)
    echo "secret scan could not complete" >&2
    exit "$status"
    ;;
esac
