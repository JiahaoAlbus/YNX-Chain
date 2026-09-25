#!/usr/bin/env bash
set -euo pipefail

candidate_targets=(Makefile README.md .github apps configs internal cmd contracts chain-metadata scripts docs release economics evidence product-release.json public-product-metadata.json)
scan_targets=()
for target in "${candidate_targets[@]}"; do
  [[ -e "$target" ]] && scan_targets+=("$target")
done
# Keep single-token sentinels bounded so translated words such as "changement"
# and lockfile integrity digests containing "NYXT" do not become false positives.
bad='example\.com|your_key_here|(^|[^[:alnum:]_])changeme([^[:alnum:]_]|$)|fake TPS|fake TVL|fake user|fake provider|fake transaction|fake price|fake revenue|fake APY|fake liquidity|hard-coded success|coming soon|(^|[^[:alnum:]_])NYXT([^[:alnum:]_]|$)'

# These immutable endpoint policies name a forbidden domain in their denylists.
# Pin every byte before exempting them; changed policies require review.
while read -r policy_hash policy_path; do
  if [[ -f "$policy_path" ]]; then
    node -e 'const fs=require("node:fs"),crypto=require("node:crypto"); const hash=crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"); if(hash!==process.argv[2]) {console.error("Endpoint denylist policy changed; review required: "+process.argv[1]);process.exit(1)}' "$policy_path" "$policy_hash"
  fi
done <<'POLICIES'
d559741a20fe37cf1e0a9fec2bf00d144709a1bfe579a13ec139354fa1fe0e74 apps/card/vendor/public-endpoint-manifest-1.0.0-p0.2.json
fb2b9ba9869c855efe59debc52213318fd3e9c685aa597f81f4e35ae9e6901d8 apps/exchange/mobile/contract/public-endpoint-manifest.json
POLICIES

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
    -g '!release/docs-compliance-completion-evidence.json' \
    -g '!.github/workflows/{seller-console,merchant-console}.yml' \
    -g '!docs/operations/WEEKLY_V3_FINAL_CREDENTIAL_INDEPENDENT_AUDIT.md' \
    -g '!docs/oracle/product/KPI_FRAMEWORK.md' \
    -g '!apps/exchange/docs/THREAT_MODEL.md' \
    -g '!apps/cloud/scripts/security-gate.mjs' \
    -g '!apps/cloud/UNIT_ECONOMICS.md' \
    -g '!apps/finance/mobile/contract/public-endpoint-manifest.json' \
    -g '!apps/exchange/mobile/contract/public-endpoint-manifest.json' \
    -g '!apps/card/vendor/public-endpoint-manifest-1.0.0-p0.2.json' \
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
    --exclude='docs-compliance-completion-evidence.json' \
    --exclude='seller-console.yml' \
    --exclude='merchant-console.yml' \
    --exclude='WEEKLY_V3_FINAL_CREDENTIAL_INDEPENDENT_AUDIT.md' \
    --exclude='KPI_FRAMEWORK.md' \
    --exclude='THREAT_MODEL.md' \
    --exclude='security-gate.mjs' \
    --exclude='UNIT_ECONOMICS.md' \
    --exclude='public-endpoint-manifest.json' \
    --exclude='public-endpoint-manifest-1.0.0-p0.2.json' \
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
