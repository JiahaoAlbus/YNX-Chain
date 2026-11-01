#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'
scanner_path='scripts/validate/secret-scan.sh'
scaffold_path='tools/scaffold-ynx-chain.mjs'
public_tls_fixture_path='third_party/cometbft/rpc/jsonrpc/server/test.key'
public_tls_fixture_sha256='2b95a96284cc502dba1d4c30dd6c7c6dad465c9a062d32afd2fafd7a093e808e'
public_http_v5_fixture_path='internal/ynxbatch/testdata/product-session-proof-v5-public.json'
public_http_v5_fixture_sha256='caaf17f69d655d4cc2167767fc3130cac68fec579f00f87d79e4cce79be8aa2d'

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

verify_public_tls_fixture() {
  local path=$1 digest
  # This is the existing public upstream TLS test fixture, not a key class or
  # directory exclusion. A changed fixture is refused even without a header.
  if [[ ! -f "$path" || -L "$path" ]]; then
    echo "public TLS fixture identity mismatch" >&2
    return 2
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    digest=$(sha256sum -- "$path") || {
      echo "public TLS fixture digest could not be read" >&2
      return 2
    }
  else
    digest=$(shasum -a 256 -- "$path") || {
      echo "public TLS fixture digest could not be read" >&2
      return 2
    }
  fi
  if [[ ${digest%% *} != "$public_tls_fixture_sha256" ]]; then
    echo "public TLS fixture identity mismatch" >&2
    return 2
  fi
}

public_http_v5_metadata() {
  local metadata parent
  # Recheck aliases after hashing as well as before it: renaming the original
  # into a symlink target can preserve the target's inode and public digest.
  for parent in internal internal/ynxbatch internal/ynxbatch/testdata; do
    [[ -d "$parent" && ! -L "$parent" ]] || return 2
  done
  [[ -f "$1" && ! -L "$1" ]] || return 2
  if metadata=$(stat -c '%d:%i:%h:%a:%s:%Y:%Z' -- "$1" 2>/dev/null); then
    printf '%s\n' "$metadata"
    return
  fi
  if metadata=$(stat -f '%d:%i:%l:%Lp:%z:%m:%c' -- "$1" 2>/dev/null); then
    printf '%s\n' "$metadata"
    return
  fi
  return 2
}

verify_public_http_v5_fixture() {
  local path=$1 parent before after digest
  # Fixed public SDK vector: Member encodes public descriptors, two signatures,
  # message and proofs, never private material. Its exact bytes are also pinned
  # by product_session_http_v5_test.go. No token regex or directory is excluded.
  for parent in internal internal/ynxbatch internal/ynxbatch/testdata; do
    if [[ ! -d "$parent" || -L "$parent" ]]; then
      echo "public HTTP V5 fixture identity mismatch" >&2
      return 2
    fi
  done
  if [[ ! -f "$path" || -L "$path" ]]; then
    echo "public HTTP V5 fixture identity mismatch" >&2
    return 2
  fi
  before=$(public_http_v5_metadata "$path") || {
    echo "public HTTP V5 fixture metadata could not be read" >&2
    return 2
  }
  # The ordinary Git checkout is 0644; private regression copies use 0600.
  # Refuse executable/mutated modes and hardlink aliases, including equal bytes.
  if [[ ! "$before" =~ ^[0-9]+:[0-9]+:1:(600|644):356971:[0-9]+:[0-9]+$ ]]; then
    echo "public HTTP V5 fixture identity mismatch" >&2
    return 2
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    digest=$(sha256sum -- "$path") || {
      echo "public HTTP V5 fixture digest could not be read" >&2
      return 2
    }
  else
    digest=$(shasum -a 256 -- "$path") || {
      echo "public HTTP V5 fixture digest could not be read" >&2
      return 2
    }
  fi
  after=$(public_http_v5_metadata "$path") || {
    echo "public HTTP V5 fixture metadata could not be read" >&2
    return 2
  }
  if [[ "$before" != "$after" || ${digest%% *} != "$public_http_v5_fixture_sha256" ]]; then
    echo "public HTTP V5 fixture identity mismatch" >&2
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
        verify_public_tls_fixture "$path"
        status=$?
        if [[ "$status" != 0 ]]; then
          return "$status"
        fi
        continue
        ;;
      "$public_http_v5_fixture_path")
        verify_public_http_v5_fixture "$path"
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
