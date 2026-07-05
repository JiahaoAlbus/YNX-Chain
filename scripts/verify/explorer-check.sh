#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
cleanup() {
  if [[ -n "${explorer_pid:-}" ]]; then
    ynx_kill_tree "$explorer_pid"
  fi
  if [[ -n "${indexer_pid:-}" ]]; then
    ynx_kill_tree "$indexer_pid"
  fi
  ynx_stop_local_testnet
}
trap cleanup EXIT

work="${YNX_VERIFY_WORK:-$(mktemp -d)}"
db="$work/explorer-indexer-db.json"
indexer_url="http://127.0.0.1:6436"
explorer_url="http://127.0.0.1:6437"

curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_explorer_alice","amount":1000}' >/dev/null
transfer="$(curl -fsS -X POST "$YNX_REST_URL/transfer" -H 'content-type: application/json' -d '{"from":"ynx_explorer_alice","to":"ynx_explorer_bob","amount":125}')"
tx_hash="$(printf '%s' "$transfer" | ynx_json_field '["hash"]')"
sleep 2

go run ./cmd/ynx-indexerd -rpc "$YNX_REST_URL" -db "$db" -once >/dev/null
YNX_INDEXER_RPC_URL="$YNX_REST_URL" YNX_INDEXER_DB_PATH="$db" YNX_INDEXER_HTTP_ADDR=127.0.0.1:6436 go run ./cmd/ynx-indexerd >"$work/indexer.log" 2>&1 &
indexer_pid=$!
YNX_EXPLORER_RPC_URL="$YNX_REST_URL" YNX_EXPLORER_INDEXER_URL="$indexer_url" YNX_EXPLORER_HTTP_ADDR=127.0.0.1:6437 YNX_EXPLORER_PUBLIC_RPC_URL="$YNX_REST_URL" YNX_EXPLORER_PUBLIC_URL="$explorer_url" go run ./cmd/ynx-explorerd >"$work/explorer.log" 2>&1 &
explorer_pid=$!

for _ in {1..80}; do
  curl -fsS "$explorer_url/health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "$explorer_url/health" >/dev/null || { echo "explorer did not become healthy"; sed -n '1,120p' "$work/explorer.log"; exit 1; }

summary="$(curl -fsS "$explorer_url/api/summary")"
[[ "$(printf '%s' "$summary" | ynx_json_field '["nativeSymbol"]')" == "YNXT" ]] || { echo "explorer native symbol mismatch"; exit 1; }
[[ "$(printf '%s' "$summary" | ynx_json_field '["truthfulStatus"]')" == "rpc-and-indexer-backed" ]] || { echo "explorer truthful status mismatch"; exit 1; }
[[ "$(printf '%s' "$summary" | ynx_json_field '["wallet"]["chainIdHex"]')" == "0x1917" ]] || { echo "explorer wallet chain id mismatch"; exit 1; }

curl -fsS "$explorer_url/api/blocks/latest?limit=3" >/dev/null
curl -fsS "$explorer_url/api/txs?limit=3" >/dev/null
curl -fsS "$explorer_url/api/txs/$tx_hash" >/dev/null
curl -fsS "$explorer_url/api/accounts/ynx_explorer_bob" >/dev/null
curl -fsS "$explorer_url/api/resources/ynx_explorer_bob" >/dev/null
curl -fsS "$explorer_url/api/tokens/YNXT" >/dev/null
curl -fsS "$explorer_url/api/validators" >/dev/null
curl -fsS "$explorer_url/api/resource-market/analytics" >/dev/null
curl -fsS "$explorer_url/api/fees/$tx_hash" >/dev/null
search="$(curl -fsS "$explorer_url/api/search?q=$tx_hash")"
[[ "$(printf '%s' "$search" | ynx_json_field '["type"]')" == "transaction" ]] || { echo "explorer search did not resolve tx"; exit 1; }

html="$(curl -fsS "$explorer_url/")"
grep -Fq "Add YNX Testnet to MetaMask" <<<"$html"
grep -Fq "/api/summary" <<<"$html"
metrics="$(curl -fsS "$explorer_url/metrics")"
grep -Fq "ynx_explorer_rpc_height" <<<"$metrics"
grep -Fq 'native_symbol="YNXT"' <<<"$metrics"

echo "explorer-check passed: url=$explorer_url tx=$tx_hash"
