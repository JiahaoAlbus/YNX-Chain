#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap '[[ -n "${INDEXER_PID:-}" ]] && kill "$INDEXER_PID" >/dev/null 2>&1 || true; ynx_stop_local_testnet' EXIT

work="${YNX_VERIFY_WORK:-$(mktemp -d)}"
db="$work/indexer-db.json"

curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_indexer_alice","amount":1000}' >/dev/null
curl -fsS -X POST "$YNX_REST_URL/transfer" -H 'content-type: application/json' -d '{"from":"ynx_indexer_alice","to":"ynx_indexer_bob","amount":125}' >/dev/null
sleep 3

first_sync="$(go run ./cmd/ynx-indexerd -rpc "$YNX_REST_URL" -db "$db" -once)"
first_height="$(printf '%s' "$first_sync" | ynx_json_field '["lastIndexedHeight"]')"
[[ "$first_height" -ge 1 ]] || { echo "indexer did not index produced blocks"; exit 1; }

curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_indexer_carol","amount":50}' >/dev/null
sleep 3
second_sync="$(go run ./cmd/ynx-indexerd -rpc "$YNX_REST_URL" -db "$db" -once)"
resume_from="$(printf '%s' "$second_sync" | ynx_json_field '["resumeFromHeight"]')"
second_height="$(printf '%s' "$second_sync" | ynx_json_field '["lastIndexedHeight"]')"
[[ "$second_height" -ge "$first_height" ]] || { echo "indexer height regressed"; exit 1; }
[[ "$resume_from" -gt 0 ]] || { echo "indexer did not report resume height"; exit 1; }

YNX_INDEXER_RPC_URL="$YNX_REST_URL" YNX_INDEXER_DB_PATH="$db" YNX_INDEXER_HTTP_ADDR=127.0.0.1:6426 go run ./cmd/ynx-indexerd >"$work/indexer.log" 2>&1 &
INDEXER_PID=$!
for _ in {1..60}; do
  curl -fsS http://127.0.0.1:6426/health >/dev/null 2>&1 && break
  sleep 0.25
done

health="$(curl -fsS http://127.0.0.1:6426/health)"
[[ "$(printf '%s' "$health" | ynx_json_field '["nativeSymbol"]')" == "YNXT" ]] || { echo "indexer native symbol mismatch"; exit 1; }
curl -fsS http://127.0.0.1:6426/blocks/latest >/dev/null
txs="$(curl -fsS http://127.0.0.1:6426/txs)"
node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(data.transactions) || data.transactions.length < 2) throw new Error("expected indexed transactions");' <<<"$txs"
metrics="$(curl -fsS http://127.0.0.1:6426/metrics)"
grep -Fq "ynx_indexer_last_indexed_height" <<<"$metrics"
grep -Fq 'native_symbol="YNXT"' <<<"$metrics"

echo "indexer-check passed: db=$db height=$second_height resumeFrom=$resume_from"
