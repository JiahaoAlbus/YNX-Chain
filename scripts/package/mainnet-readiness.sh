#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/package/build-package.mjs ynx-mainnet-readiness-package tmp/packages/mainnet-readiness docs/mainnet-readiness docs/security docs/compliance docs/operations docs/architecture infra/monitoring scripts/verify/monitoring-check.sh
