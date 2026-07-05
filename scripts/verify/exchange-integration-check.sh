#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

curl -fsS "$YNX_REST_URL/health" >/dev/null
[[ "$(ynx_jsonrpc eth_chainId | ynx_json_field '["result"]')" == "0x1917" ]] || { echo "chainId mismatch"; exit 1; }

h1=$(curl -fsS "$YNX_REST_URL/status" | ynx_json_field '["height"]')
sleep 3
h2=$(curl -fsS "$YNX_REST_URL/status" | ynx_json_field '["height"]')
[[ "$h2" -gt "$h1" ]] || { echo "block height did not increase"; exit 1; }

deposit_address="ynx_exchange_deposit"
withdrawal_address="ynx_exchange_withdrawal"
deposit_tx=$(curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d "{\"address\":\"$deposit_address\",\"amount\":1000}")
deposit_hash=$(printf '%s' "$deposit_tx" | ynx_json_field '["hash"]')
sleep 2
curl -fsS "$YNX_REST_URL/txs/$deposit_hash" >/dev/null
balance=$(curl -fsS "$YNX_REST_URL/accounts/$deposit_address" | ynx_json_field '["account"]["balance"]')
[[ "$balance" -ge 1000 ]] || { echo "deposit balance not credited"; exit 1; }

withdrawal_tx=$(curl -fsS -X POST "$YNX_REST_URL/transfer" -H 'content-type: application/json' -d "{\"from\":\"$deposit_address\",\"to\":\"$withdrawal_address\",\"amount\":125}")
withdrawal_hash=$(printf '%s' "$withdrawal_tx" | ynx_json_field '["hash"]')
sleep 2
curl -fsS "$YNX_REST_URL/txs/$withdrawal_hash" >/dev/null

ynx_jsonrpc eth_getTransactionByHash "[\"$withdrawal_hash\"]" | ynx_json_field '["result"]["hash"]' >/dev/null
withdrawal_receipt=$(ynx_jsonrpc eth_getTransactionReceipt "[\"$withdrawal_hash\"]")
receipt_status=$(printf '%s' "$withdrawal_receipt" | ynx_json_field '["result"]["status"]')
[[ "$receipt_status" == "0x1" ]] || { echo "withdrawal receipt not successful"; exit 1; }
printf '%s' "$withdrawal_receipt" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(data.result.logs) || data.result.logs.length < 1) { console.error(`withdrawal receipt has no logs: ${JSON.stringify(data)}`); process.exit(1); }'

ynx_jsonrpc eth_getBlockByNumber '["latest", false]' >/dev/null
ynx_jsonrpc eth_getLogs '[]' | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(data.result) || data.result.length < 1) { console.error(`eth_getLogs returned no logs: ${JSON.stringify(data)}`); process.exit(1); }'

echo "exchange-integration-check passed: deposit=$deposit_hash withdrawal=$withdrawal_hash height=$h2"
