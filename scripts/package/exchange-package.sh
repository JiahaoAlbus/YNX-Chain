#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-exchange-readiness-package tmp/packages/exchange docs/exchange-listing docs/security docs/compliance docs/operations docs/mainnet-readiness resource-market indexer explorer cmd/ynx-indexerd cmd/ynx-explorerd internal/indexer internal/explorer infra/monitoring infra/systemd/ynx-indexerd.example.service infra/systemd/ynx-explorerd.example.service scripts/verify/monitoring-check.sh scripts/verify/indexer-check.sh scripts/verify/explorer-check.sh chain-metadata/ynx-testnet.json
