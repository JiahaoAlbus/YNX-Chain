#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
# shellcheck source=../../../scripts/verify/lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT
node apps/developer/scripts/live-client-check.mjs
