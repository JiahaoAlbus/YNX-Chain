#!/usr/bin/env bash
set -euo pipefail

scan_targets=(Makefile README.md configs internal cmd contracts chain-metadata scripts docs)
bad='example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|NYXT'

found=1
if command -v rg >/dev/null 2>&1; then
  if rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -g '!scripts/validate/no-placeholder-check.sh' -g '!scripts/deploy/lib.sh' -g '!docs/architecture/ZERO_PLACEHOLDER_POLICY.md' -e "$bad" "${scan_targets[@]}"; then
    found=0
  else
    scan_status=$?
    if [[ "$scan_status" -ne 1 ]]; then
      echo "placeholder scan failed with exit code $scan_status" >&2
      exit "$scan_status"
    fi
  fi
else
  echo "ripgrep unavailable; using recursive grep fallback" >&2
  if grep -RInE \
    --exclude='scaffold-ynx-chain.mjs' \
    --exclude='no-placeholder-check.sh' \
    --exclude='lib.sh' \
    --exclude='ZERO_PLACEHOLDER_POLICY.md' \
    --exclude-dir='.git' \
    -- "$bad" "${scan_targets[@]}"; then
    found=0
  else
    scan_status=$?
    if [[ "$scan_status" -ne 1 ]]; then
      echo "placeholder scan failed with exit code $scan_status" >&2
      exit "$scan_status"
    fi
  fi
fi

if [[ "$found" -eq 0 ]]; then
  echo "disallowed deployment filler or fake claim found"
  exit 1
fi

echo "no disallowed deployment filler found in runtime, docs, or scripts"
