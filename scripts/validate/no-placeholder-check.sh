#!/usr/bin/env bash
set -euo pipefail

scan_targets=(Makefile README.md .github apps configs internal cmd contracts chain-metadata scripts docs)
bad='example\.com|your_key_here|changeme|fake TPS|fake TVL|fake user|fake provider|fake transaction|fake price|fake revenue|fake APY|fake liquidity|hard-coded success|coming soon|NYXT'
if rg -n --hidden -g '!.git/**' -g '!tools/scaffold-ynx-chain.mjs' -g '!scripts/validate/no-placeholder-check.sh' -g '!scripts/deploy/lib.sh' -g '!docs/architecture/ZERO_PLACEHOLDER_POLICY.md' -g '!docs/coordination/PARALLEL_ECOSYSTEM_OBJECTIVES.md' -e "$bad" "${scan_targets[@]}"; then
  echo "disallowed deployment filler or fake claim found"
  exit 1
fi
echo "no disallowed deployment filler found in runtime, docs, or scripts"
