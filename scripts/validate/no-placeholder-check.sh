#!/usr/bin/env bash
set -euo pipefail

scan_targets=(Makefile README.md configs internal cmd contracts chain-metadata scripts docs)
bad='example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|NYXT'

scan_status=0
if command -v rg >/dev/null 2>&1; then
  set +e
  rg -n --hidden \
    -g '!.git/**' \
    -g '!tools/scaffold-ynx-chain.mjs' \
    -g '!scripts/validate/no-placeholder-check.sh' \
    -g '!scripts/deploy/lib.sh' \
    -g '!docs/architecture/ZERO_PLACEHOLDER_POLICY.md' \
    -e "$bad" "${scan_targets[@]}"
  scan_status=$?
  set -e
else
  set +e
  grep -RInE \
    --exclude='scaffold-ynx-chain.mjs' \
    --exclude='no-placeholder-check.sh' \
    --exclude='lib.sh' \
    --exclude='ZERO_PLACEHOLDER_POLICY.md' \
    --exclude-dir='.git' \
    --exclude-dir='node_modules' \
    --exclude-dir='.expo' \
    "$bad" "${scan_targets[@]}"
  scan_status=$?
  set -e
fi

case "$scan_status" in
  0)
    echo "disallowed deployment filler or fake claim found"
    exit 1
    ;;
  1)
    echo "no disallowed deployment filler found in runtime, docs, or scripts"
    ;;
  *)
    echo "placeholder scan failed with status $scan_status"
    exit "$scan_status"
    ;;
esac
