#!/usr/bin/env bash
set -euo pipefail

pattern='-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'
scan_targets=(.ai-bridge .github Makefile README.md package.json configs internal cmd contracts chain-metadata scripts docs release apps economics evidence product-release.json public-product-metadata.json)
found=1

if command -v rg >/dev/null 2>&1; then
  if rg -n --hidden --no-messages \
    -g '!.git/**' \
    -g '!**/node_modules/**' \
    -g '!**/vendor/**' \
    -g '!**/dist/**' \
    -g '!**/build/**' \
    -g '!**/.next/**' \
    -g '!**/.gradle/**' \
    -g '!**/Pods/**' \
    -g '!**/DerivedData/**' \
    -g '!**/coverage/**' \
    -g '!**/.expo/**' \
    -g '!*.lock' \
    -g '!*.map' \
    -g '!*.min.js' \
    -g '!*.wasm' \
    -g '!tools/scaffold-ynx-chain.mjs' \
    -g '!scripts/validate/secret-scan.sh' \
    -e "$pattern" "${scan_targets[@]}"; then
    found=0
  else
    scan_status=$?
    if [[ "$scan_status" -ne 1 ]]; then
      echo "credential-pattern scan failed with exit code $scan_status" >&2
      exit "$scan_status"
    fi
  fi
else
  echo "ripgrep unavailable; using bounded recursive grep fallback" >&2
  if grep -RInE --binary-files=without-match \
    --exclude='*.lock' \
    --exclude='*.map' \
    --exclude='*.min.js' \
    --exclude='*.wasm' \
    --exclude='scaffold-ynx-chain.mjs' \
    --exclude='secret-scan.sh' \
    --exclude-dir='.git' \
    --exclude-dir='node_modules' \
    --exclude-dir='vendor' \
    --exclude-dir='dist' \
    --exclude-dir='build' \
    --exclude-dir='.next' \
    --exclude-dir='.gradle' \
    --exclude-dir='Pods' \
    --exclude-dir='DerivedData' \
    --exclude-dir='coverage' \
    --exclude-dir='.expo' \
    -- "$pattern" "${scan_targets[@]}"; then
    found=0
  else
    scan_status=$?
    if [[ "$scan_status" -ne 1 ]]; then
      echo "credential-pattern scan failed with exit code $scan_status" >&2
      exit "$scan_status"
    fi
  fi
fi

if [[ "$found" -eq 0 ]]; then
  echo "possible secret found"
  exit 1
fi

echo "secret scan passed"
