#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-mainnet-readiness-package tmp/packages/mainnet-readiness docs/mainnet-readiness docs/security docs/compliance docs/operations docs/architecture resource-market indexer cmd/ynx-indexerd internal/indexer infra/monitoring infra/systemd/ynx-indexerd.example.service scripts/verify/monitoring-check.sh scripts/verify/indexer-check.sh
