#!/usr/bin/env bash
set -euo pipefail

pattern='example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|(^|[^[:alnum:]_])NYXT([^[:alnum:]_]|$)'

collect_files() {
  git ls-files --cached --others --exclude-standard -z -- . \
    | while IFS= read -r -d '' path; do
        case "$path" in
          tools/scaffold-ynx-chain.mjs|scripts/validate/no-placeholder-check.sh|scripts/deploy/lib.sh|docs/architecture/ZERO_PLACEHOLDER_POLICY.md|release/docs-compliance-completion-evidence.json) continue ;;
        esac
        printf '%s\0' "$path"
      done
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
    scan_file "$path"
    status=$?
    case "$status" in
      0) found=0 ;;
      1) ;;
      *) return "$status" ;;
    esac
  done < <(collect_files)
  return "$found"
}

set +e
scan
status=$?
set -e
case "$status" in
  0)
    echo "disallowed deployment filler or fake claim found"
    exit 1
    ;;
  1)
    echo "no disallowed deployment filler found in tracked or pending source files"
    ;;
  *)
    echo "placeholder scan could not complete" >&2
    exit "$status"
    ;;
esac
