#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-mainnet-readiness-package tmp/packages/mainnet-readiness docs/mainnet-readiness docs/security docs/compliance docs/operations docs/architecture resource-market indexer explorer faucet cmd/ynx-indexerd cmd/ynx-explorerd cmd/ynx-faucetd internal/indexer internal/explorer internal/faucet infra/monitoring infra/systemd/ynx-indexerd.example.service infra/systemd/ynx-explorerd.example.service infra/systemd/ynx-faucetd.example.service scripts/verify/monitoring-check.sh scripts/verify/indexer-check.sh scripts/verify/explorer-check.sh scripts/verify/faucet-check.sh scripts/verify/remote-smoke-test.sh scripts/verify/remote-smoke-test.mjs scripts/verify/verify-testnet.sh
