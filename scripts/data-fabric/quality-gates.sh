#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ $# -gt 1 || ( -n "${1:-}" && "${1:-}" != "--integrated" ) ]]; then
  echo "usage: $0 [--integrated]" >&2
  exit 2
fi

mode="owner"
branch="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
if [[ "${1:-}" == "--integrated" || ( -n "$branch" && "$branch" != "codex/final-data-fabric" ) ]]; then
  mode="integrated"
fi

node scripts/data-fabric/policy-scan.mjs runtime
node scripts/data-fabric/policy-scan.mjs public

jq empty \
  schemas/data-fabric/*.json \
  integration/product-event-contracts.json \
  release/*.json \
  release/integration/*.json \
  docs/integration/*.json \
  .ai-bridge/full-goal-coverage.json \
  evidence/capacity/*.json \
  evidence/postgres/*.json \
  evidence/ui/*.json \
  public-product-metadata.json \
  product-release.json \
  infra/data-fabric/grafana-dashboard.json

if [[ "$mode" == "integrated" ]]; then
  node scripts/verify/integration-acceptance-check.mjs
else
  node scripts/data-fabric/evidence-path-check.mjs
  node scripts/data-fabric/release-truth-check-check.mjs
fi
node scripts/data-fabric/policy-scan.mjs secret

git diff --check
bash scripts/data-fabric/testnet-release-check.sh
bash scripts/data-fabric/public-testnet-release-check.sh
bash scripts/data-fabric/public-release-promotion-check.sh
YNX_DATA_FABRIC_TEST_SIGNING_ALGORITHM=rsa bash scripts/data-fabric/public-release-promotion-check.sh
bash scripts/data-fabric/testnet-deployment-check.sh
bash scripts/data-fabric/testnet-remote-deploy-check.sh
bash scripts/data-fabric/service-stop-exit-check.sh
