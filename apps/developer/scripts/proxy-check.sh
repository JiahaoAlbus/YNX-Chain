#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
# shellcheck source=../../../scripts/verify/lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
web_pid=""
cleanup() {
  if [[ -n "$web_pid" ]]; then kill "$web_pid" >/dev/null 2>&1 || true; wait "$web_pid" 2>/dev/null || true; fi
  ynx_stop_local_testnet
}
trap cleanup EXIT
mkdir -p tmp
PORT=4181 node apps/developer/scripts/server.mjs >tmp/ynx-developer-proxy-check.log 2>&1 &
web_pid=$!
for _ in {1..50}; do
  curl -fsS http://127.0.0.1:4181/ >/dev/null 2>&1 && break
  sleep 0.1
done
status=$(curl -fsS http://127.0.0.1:4181/chain/status)
printf '%s' "$status" | node -e 'const v=JSON.parse(require("fs").readFileSync(0)); if(v.chainId!==6423||v.nativeCurrencySymbol!=="YNXT") process.exit(1)'
compiler=$(curl -fsS http://127.0.0.1:4181/chain/ide/compiler)
printf '%s' "$compiler" | node -e 'const v=JSON.parse(require("fs").readFileSync(0)); if(v.version!=="0.8.24"||v.optimizerRuns!==200) process.exit(1)'
echo "YNX Developer same-origin chain proxy check passed."
