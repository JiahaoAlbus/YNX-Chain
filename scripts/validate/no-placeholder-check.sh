#!/usr/bin/env bash
set -euo pipefail

scan_targets=(Makefile README.md configs internal cmd contracts chain-metadata scripts docs)
bad='example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|NYXT'
if rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -g '!scripts/validate/no-placeholder-check.sh' -g '!docs/architecture/ZERO_PLACEHOLDER_POLICY.md' -e "$bad" "${scan_targets[@]}"; then
  echo "disallowed deployment filler or fake claim found"
  exit 1
fi
echo "no disallowed deployment filler found in runtime, docs, or scripts"
