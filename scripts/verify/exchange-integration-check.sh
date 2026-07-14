#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
go test ./internal/consensus ./internal/chain ./internal/api ./internal/mutationfreeze
node ./scripts/verify/exchange-candidate-check.mjs
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT
node ./scripts/verify/exchange-local-check.mjs
