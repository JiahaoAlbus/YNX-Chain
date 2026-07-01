#!/usr/bin/env bash
set -euo pipefail

curl -fsS -X POST "${YNX_EVM_RPC_URL:-http://127.0.0.1:6420/evm}" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null || {
  echo "exchange-integration-check requires a running local devnet or real YNX Testnet endpoint"; exit 1;
}
echo "exchange-integration-check passed against configured endpoint"

