#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

runtime_paths=(
  cmd/ynx-data-fabricctl
  cmd/ynx-data-fabricd
  cmd/ynx-data-fabric-worker
  internal/datafabric
  internal/datafabricapi
  internal/datafabricbackup
  internal/datafabricconfig
  internal/datafabricnats
  internal/datafabricpostgres
  sdk/datafabric
  schemas/data-fabric
  configs/data-fabric.env.example
  configs/data-fabric-event-keys.example.json
  docs/data-fabric
  public-product-metadata.json
  product-release.json
)

forbidden='TODO|FIXME|placeholder|coming[[:space:]-]+soon|example\.com|fake[[:space:]-]+(balance|user|transaction|price|revenue|apy|liquidity|provider|health)|hard[[:space:]-]*coded[[:space:]-]+success|no[[:space:]-]*op[[:space:]-]+button|mock[[:space:]-]+provider'
if rg -n -i --glob '!**/*_test.go' --glob '!**/testdata/**' "$forbidden" "${runtime_paths[@]}"; then
  echo "Data Fabric runtime/public package contains prohibited placeholder or fake-success language" >&2
  exit 1
fi

public_leak='Codex|Worktree|codex/|/Users/|localhost|127\.0\.0\.1|719e101|internal[[:space:]-]+host'
if rg -n -i "$public_leak" public-product-metadata.json product-release.json; then
  echo "Data Fabric public handoff leaks internal development or endpoint details" >&2
  exit 1
fi

jq empty \
  schemas/data-fabric/*.json \
  integration/product-event-contracts.json \
  release/*.json \
  evidence/capacity/*.json \
  evidence/postgres/*.json \
  evidence/ui/*.json \
  public-product-metadata.json \
  product-release.json \
  infra/data-fabric/grafana-dashboard.json

if rg -n -i --glob '!*.example.*' "(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|client_secret[[:space:]]*[:=][[:space:]]*[A-Za-z0-9+/=_-]{16,})" configs schemas/data-fabric public-product-metadata.json product-release.json; then
  echo "Data Fabric scoped secret gate failed" >&2
  exit 1
fi

git diff --check
