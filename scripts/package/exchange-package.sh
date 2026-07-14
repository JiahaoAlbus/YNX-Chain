#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/exchange-candidate.mjs --output tmp/packages/exchange
node scripts/verify/exchange-candidate-verify.mjs --candidate tmp/packages/exchange --source-root .
find tmp/packages/exchange -maxdepth 1 -type f -print | sort
echo "exchange-package generated a testnet-only readiness candidate; submitted=false listed=false partnered=false mainnet=false"
