#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-exchange-readiness-package tmp/packages/exchange docs/exchange-listing docs/security docs/compliance docs/operations docs/mainnet-readiness infra/monitoring scripts/verify/monitoring-check.sh chain-metadata/ynx-testnet.json
