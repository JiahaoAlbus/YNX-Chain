#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-exchange-readiness-package tmp/packages/exchange docs/exchange-listing docs/security docs/compliance docs/operations docs/mainnet-readiness resource-market indexer cmd/ynx-indexerd internal/indexer infra/monitoring infra/systemd/ynx-indexerd.example.service scripts/verify/monitoring-check.sh scripts/verify/indexer-check.sh chain-metadata/ynx-testnet.json
