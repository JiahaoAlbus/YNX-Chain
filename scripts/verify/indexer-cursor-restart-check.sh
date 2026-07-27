#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh

gotest="./internal/indexer"
go test "$gotest"
ynx_start_local_testnet

cleanup() {
  if [[ -n "${INDEXER_PID:-}" ]]; then
    ynx_kill_tree "$INDEXER_PID"
  fi
  ynx_stop_local_testnet
}
trap cleanup EXIT

work="${YNX_VERIFY_WORK:-$(mktemp -d)}"
db="$work/cursor-restart-indexer-db.json"
indexer_url="http://127.0.0.1:6428"
indexer_addr="127.0.0.1:6428"
configured_log="$work/indexer-configured.log"
process_log="$work/indexer-process.log"

curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_cursor_alice","amount":1000}' >/dev/null
curl -fsS -X POST "$YNX_REST_URL/transfer" -H 'content-type: application/json' -d '{"from":"ynx_cursor_alice","to":"ynx_cursor_bob","amount":101}' >/dev/null
curl -fsS -X POST "$YNX_REST_URL/transfer" -H 'content-type: application/json' -d '{"from":"ynx_cursor_alice","to":"ynx_cursor_carol","amount":102}' >/dev/null
sleep 3

go run ./cmd/ynx-indexerd -rpc "$YNX_REST_URL" -db "$db" -once >/dev/null
cursor_key="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"

wait_for_indexer() {
  local log="$1"
  for _ in {1..80}; do
    curl -fsS "$indexer_url/health" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  echo "indexer did not become healthy"
  sed -n '1,120p' "$log" 2>/dev/null || true
  return 1
}

start_configured_indexer() {
  YNX_INDEXER_CURSOR_KEY="$cursor_key" YNX_INDEXER_RPC_URL="$YNX_REST_URL" YNX_INDEXER_DB_PATH="$db" YNX_INDEXER_HTTP_ADDR="$indexer_addr" go run ./cmd/ynx-indexerd >"$configured_log" 2>&1 &
  INDEXER_PID=$!
  wait_for_indexer "$configured_log"
}

start_process_scoped_indexer() {
  env -u YNX_INDEXER_CURSOR_KEY YNX_INDEXER_RPC_URL="$YNX_REST_URL" YNX_INDEXER_DB_PATH="$db" YNX_INDEXER_HTTP_ADDR="$indexer_addr" go run ./cmd/ynx-indexerd >"$process_log" 2>&1 &
  INDEXER_PID=$!
  wait_for_indexer "$process_log"
}

stop_indexer() {
  ynx_kill_tree "$INDEXER_PID"
  INDEXER_PID=""
}

start_configured_indexer
configured_health="$(curl -fsS "$indexer_url/health")"
[[ "$(printf '%s' "$configured_health" | ynx_json_field '["cursorPersistence"]')" == "configured-key" ]] || { echo "configured cursor persistence not reported"; exit 1; }
configured_first="$(curl -fsS "$indexer_url/blocks/latest?limit=1")"
configured_cursor="$(printf '%s' "$configured_first" | ynx_json_field '["nextCursor"]')"
configured_first_height="$(printf '%s' "$configured_first" | ynx_json_field '["blocks"][0]["height"]')"
[[ -n "$configured_cursor" ]] || { echo "configured-key first page did not issue a continuation cursor"; exit 1; }
stop_indexer

start_configured_indexer
configured_after_restart="$(curl -fsS --get --data-urlencode 'limit=1' --data-urlencode "cursor=$configured_cursor" "$indexer_url/blocks/latest")"
configured_next_height="$(printf '%s' "$configured_after_restart" | ynx_json_field '["blocks"][0]["height"]')"
[[ "$configured_next_height" -lt "$configured_first_height" ]] || { echo "configured-key cursor did not continue after restart"; exit 1; }
stop_indexer

start_process_scoped_indexer
process_health="$(curl -fsS "$indexer_url/health")"
[[ "$(printf '%s' "$process_health" | ynx_json_field '["cursorPersistence"]')" == "process-scoped" ]] || { echo "process-scoped cursor persistence not reported"; exit 1; }
process_first="$(curl -fsS "$indexer_url/blocks/latest?limit=1")"
process_cursor="$(printf '%s' "$process_first" | ynx_json_field '["nextCursor"]')"
[[ -n "$process_cursor" ]] || { echo "process-scoped first page did not issue a continuation cursor"; exit 1; }
stop_indexer

start_process_scoped_indexer
expired_body="$work/process-scoped-expired.json"
expired_status="$(curl -sS -o "$expired_body" -w '%{http_code}' --get --data-urlencode 'limit=1' --data-urlencode "cursor=$process_cursor" "$indexer_url/blocks/latest")"
[[ "$expired_status" == "400" ]] || { echo "process-scoped cursor survived restart unexpectedly: HTTP $expired_status"; exit 1; }
[[ "$(ynx_json_field '["error"]' <"$expired_body")" == "invalid_cursor" ]] || { echo "expired process-scoped cursor did not fail with invalid_cursor"; exit 1; }

printf 'indexer-cursor-restart-check passed: configured %s→%s, process-scoped cursor expired\n' "$configured_first_height" "$configured_next_height"
