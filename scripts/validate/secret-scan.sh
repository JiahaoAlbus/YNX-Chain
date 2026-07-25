#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'

scan_with_ripgrep() {
  rg -n --hidden \
    -g '!.git/**' \
    -g '!tools/scaffold-ynx-chain.mjs' \
    -e "$pattern" .
}

scan_with_grep() {
  local output status
  set +e
  output="$(git ls-files -co --exclude-standard -z -- . ':(exclude)tools/scaffold-ynx-chain.mjs' \
    | xargs -0 grep -nHIE -- "$pattern" 2>&1)"
  status=$?
  set -e

  case "$status" in
    0)
      printf '%s\n' "$output"
      return 0
      ;;
    1)
      return 1
      ;;
    *)
      printf 'credential scan failed:\n%s\n' "$output" >&2
      exit "$status"
      ;;
  esac
}

if command -v rg >/dev/null 2>&1; then
  scanner=scan_with_ripgrep
elif command -v git >/dev/null 2>&1 && command -v grep >/dev/null 2>&1 && command -v xargs >/dev/null 2>&1; then
  scanner=scan_with_grep
else
  echo "credential scan requires rg or the git/grep/xargs fallback" >&2
  exit 1
fi

if "$scanner"; then
  echo "possible credential material found"
  exit 1
fi

echo "credential scan passed"
