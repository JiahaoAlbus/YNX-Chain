#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'
scanner_path='scripts/validate/secret-scan.sh'
scaffold_path='tools/scaffold-ynx-chain.mjs'

collect_files() {
  git ls-files --cached --others --exclude-standard -z -- . \
    | while IFS= read -r -d '' path; do
        case "$path" in
          "$scanner_path"|"$scaffold_path") continue ;;
        esac
        # Build tools may replace tracked artifact directories before this
        # gate runs. A path removed by that build is not available to scan;
        # the source tree remains covered and git diff gates report deletion.
        [[ -f "$path" ]] || continue
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
