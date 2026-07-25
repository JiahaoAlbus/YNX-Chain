#!/usr/bin/env bash
set -euo pipefail

scan_targets=(Makefile README.md configs internal cmd contracts chain-metadata scripts docs)
bad='example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|NYXT'

scan_with_ripgrep() {
  rg -n --hidden \
    -g '!.git/**' \
    -g '!tools/scaffold-ynx-chain.mjs' \
    -g '!scripts/validate/no-placeholder-check.sh' \
    -g '!scripts/deploy/lib.sh' \
    -g '!docs/architecture/ZERO_PLACEHOLDER_POLICY.md' \
    -e "$bad" "${scan_targets[@]}"
}

scan_with_grep() {
  local output status
  set +e
  output="$({
    find "${scan_targets[@]}" -type f \
      ! -path 'scripts/validate/no-placeholder-check.sh' \
      ! -path 'scripts/deploy/lib.sh' \
      ! -path 'docs/architecture/ZERO_PLACEHOLDER_POLICY.md' \
      -print0
  } | xargs -0 grep -nHIE "$bad" 2>&1)"
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
      printf 'placeholder scan failed:\n%s\n' "$output" >&2
      exit "$status"
      ;;
  esac
}

if command -v rg >/dev/null 2>&1; then
  scanner=scan_with_ripgrep
elif command -v grep >/dev/null 2>&1 && command -v find >/dev/null 2>&1 && command -v xargs >/dev/null 2>&1; then
  scanner=scan_with_grep
else
  echo "placeholder scan requires rg or the grep/find/xargs fallback" >&2
  exit 1
fi

if "$scanner"; then
  echo "disallowed deployment filler or fake claim found"
  exit 1
fi

echo "no disallowed deployment filler found in runtime, docs, or scripts"
