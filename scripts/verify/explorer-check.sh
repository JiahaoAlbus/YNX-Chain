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
evidence="$(curl -fsS "$explorer_url/api/evidence/transaction/$tx_hash")"
[[ "$(printf '%s' "$evidence" | ynx_json_field '["schemaVersion"]')" == "explorer.public-evidence.v1" ]] || { echo "explorer evidence schema mismatch"; exit 1; }
[[ "$(printf '%s' "$evidence" | ynx_json_field '["source"]["authority"]')" == "01-chain-core" ]] || { echo "explorer evidence authority mismatch"; exit 1; }
[[ "$(printf '%s' "$evidence" | ynx_json_field '["source"]["transport"]')" == "ynx-indexer" ]] || { echo "explorer evidence transport mismatch"; exit 1; }
[[ "$(printf '%s' "$evidence" | ynx_json_field '["payload"]["hash"]')" == "$tx_hash" ]] || { echo "explorer evidence payload mismatch"; exit 1; }
[[ -n "$(printf '%s' "$evidence" | ynx_json_field '["asOf"]')" ]] || { echo "explorer evidence as-of missing"; exit 1; }
[[ -n "$(printf '%s' "$evidence" | ynx_json_field '["integrity"]["digest"]')" ]] || { echo "explorer evidence integrity missing"; exit 1; }
coverage="$(printf '%s' "$evidence" | ynx_json_field '["coverage"]["status"]')"
[[ "$coverage" == "complete-for-explorer-schema" || "$coverage" == "partial" ]] || { echo "explorer evidence coverage invalid: $coverage"; exit 1; }
curl -fsS "$explorer_url/api/accounts/ynx_explorer_bob" >/dev/null
curl -fsS "$explorer_url/api/resources/ynx_explorer_bob" >/dev/null
curl -fsS "$explorer_url/api/tokens/YNXT" >/dev/null
curl -fsS "$explorer_url/api/validators" >/dev/null
curl -fsS "$explorer_url/api/resource-market/analytics" >/dev/null
curl -fsS "$explorer_url/api/fees/$tx_hash" >/dev/null
search="$(curl -fsS "$explorer_url/api/search?q=$tx_hash")"
[[ "$(printf '%s' "$search" | ynx_json_field '["type"]')" == "transaction" ]] || { echo "explorer search did not resolve tx"; exit 1; }

html="$(curl -fsS "$explorer_url/")"
grep -Fq "Open MetaMask compatibility" <<<"$html"
grep -Fq "YNX native address (default)" <<<"$html"
grep -Fq "EVM compatibility address" <<<"$html"
grep -Fq "/api/summary" <<<"$html"
metrics="$(curl -fsS "$explorer_url/metrics")"
grep -Fq "ynx_explorer_rpc_height" <<<"$metrics"
grep -Fq 'native_symbol="YNXT"' <<<"$metrics"

stream_headers="$work/explorer-stream.headers"
stream_body="$work/explorer-stream.body"
set +e
curl -sS --max-time 6 -D "$stream_headers" -o "$stream_body" "$explorer_url/api/stream"
stream_status=$?
set -e
[[ "$stream_status" -eq 0 || "$stream_status" -eq 28 ]] || { echo "explorer stream request failed: status=$stream_status"; exit 1; }
first_stream_id="$(awk '/^id: / {gsub("\\r", "", $2); print $2; exit}' "$stream_body")"
second_stream_id="$(awk '/^id: / {gsub("\\r", "", $2); count += 1; if (count == 2) { print $2; exit }}' "$stream_body")"
[[ -n "$first_stream_id" && -n "$second_stream_id" ]] || { echo "explorer stream did not retain multiple replayable events"; exit 1; }

replay_headers="$work/explorer-stream-replay.headers"
replay_body="$work/explorer-stream-replay.body"
set +e
curl -sS --max-time 2 -H "Last-Event-ID: $first_stream_id" -D "$replay_headers" -o "$replay_body" "$explorer_url/api/stream"
replay_status=$?
set -e
[[ "$replay_status" -eq 0 || "$replay_status" -eq 28 ]] || { echo "explorer replay request failed: status=$replay_status"; exit 1; }
tr -d '\r' <"$replay_headers" | grep -Fix 'X-YNX-Stream-Recovery: replay' >/dev/null || { echo "explorer replay mode header missing"; exit 1; }
tr -d '\r' <"$replay_body" | grep -Fx "id: $second_stream_id" >/dev/null || { echo "explorer did not replay the retained successor event"; exit 1; }

gap_headers="$work/explorer-stream-gap.headers"
gap_body="$work/explorer-stream-gap.body"
set +e
curl -sS --max-time 2 -H 'Last-Event-ID: 999999999' -D "$gap_headers" -o "$gap_body" "$explorer_url/api/stream"
gap_status=$?
set -e
[[ "$gap_status" -eq 0 || "$gap_status" -eq 28 ]] || { echo "explorer gap request failed: status=$gap_status"; exit 1; }
tr -d '\r' <"$gap_headers" | grep -Fix 'X-YNX-Stream-Recovery: snapshot' >/dev/null || { echo "explorer snapshot recovery mode header missing"; exit 1; }
grep -Fq 'event: stream-reset' "$gap_body" || { echo "explorer stream reset control event missing"; exit 1; }
grep -Fq '"reason":"future_last_event_id"' "$gap_body" || { echo "explorer stream reset reason mismatch"; exit 1; }

echo "explorer-check passed: url=$explorer_url tx=$tx_hash sse_replay=$first_stream_id->$second_stream_id"
