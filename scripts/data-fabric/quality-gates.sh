#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

node scripts/data-fabric/policy-scan.mjs runtime
node scripts/data-fabric/policy-scan.mjs public
npm test --prefix sdk/datafabric-typescript

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

node scripts/data-fabric/evidence-path-check.mjs
node scripts/data-fabric/verify-p0-147-public-runtime-lease-request.mjs
node scripts/data-fabric/release-truth-check-check.mjs
node scripts/data-fabric/policy-scan.mjs secret

git diff --check
bash scripts/data-fabric/testnet-release-check.sh
bash scripts/data-fabric/public-testnet-release-check.sh
bash scripts/data-fabric/public-release-promotion-check.sh
YNX_DATA_FABRIC_TEST_SIGNING_ALGORITHM=rsa bash scripts/data-fabric/public-release-promotion-check.sh
bash scripts/data-fabric/testnet-deployment-check.sh
bash scripts/data-fabric/testnet-remote-deploy-check.sh
bash scripts/data-fabric/service-stop-exit-check.sh
