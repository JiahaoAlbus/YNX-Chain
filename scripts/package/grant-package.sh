#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-grant-package tmp/packages/grant docs/grants docs/whitepaper docs/architecture docs/security docs/compliance docs/public-proof/PUBLIC_TESTNET_PROOF.md docs/acceptance/TESTNET_ACCEPTANCE_REPORT.md resource-market indexer explorer cmd/ynx-indexerd cmd/ynx-explorerd internal/indexer internal/explorer infra/monitoring scripts/verify/monitoring-check.sh scripts/verify/indexer-check.sh scripts/verify/explorer-check.sh
