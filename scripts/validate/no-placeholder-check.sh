#!/usr/bin/env bash
set -euo pipefail

scan_targets=(Makefile README.md .github apps configs internal cmd contracts chain-metadata scripts docs release economics evidence product-release.json public-product-metadata.json)
bad='example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|fake provider|fake transaction|fake price|fake revenue|fake APY|fake liquidity|hard-coded success|coming soon|NYXT'

found=1
if command -v rg >/dev/null 2>&1; then
  if rg -n --hidden \
    -g '!.git/**' \
    -g '!**/node_modules/**' \
    -g '!**/dist/**' \
    -g '!**/build/**' \
    -g '!**/tests/**' \
    -g '!**/*.test.*' \
    -g '!**/*_test.go' \
    -g '!tools/scaffold-ynx-chain.mjs' \
    -g '!scripts/validate/no-placeholder-check.sh' \
    -g '!apps/wallet/scripts/release-content-check.mjs' \
    -g '!scripts/deploy/lib.sh' \
    -g '!docs/architecture/ZERO_PLACEHOLDER_POLICY.md' \
    -g '!docs/coordination/PARALLEL_ECOSYSTEM_OBJECTIVES.md' \
    -e "$bad" "${scan_targets[@]}"; then
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
    --exclude='release-content-check.mjs' \
    --exclude='lib.sh' \
    --exclude='ZERO_PLACEHOLDER_POLICY.md' \
    --exclude='PARALLEL_ECOSYSTEM_OBJECTIVES.md' \
    --exclude='*.test.*' \
    --exclude='*_test.go' \
    --exclude-dir='.git' \
    --exclude-dir='node_modules' \
    --exclude-dir='dist' \
    --exclude-dir='build' \
    --exclude-dir='tests' \
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
