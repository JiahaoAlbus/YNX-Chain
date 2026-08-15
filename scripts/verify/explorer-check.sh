#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
cleanup() {
  if [[ -n "${sampler_pid:-}" ]]; then
    kill "$sampler_pid" >/dev/null 2>&1 || true
    wait "$sampler_pid" >/dev/null 2>&1 || true
  fi
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
start_explorer() {
  YNX_EXPLORER_RPC_URL="$YNX_REST_URL" YNX_EXPLORER_INDEXER_URL="$indexer_url" YNX_EXPLORER_HTTP_ADDR=127.0.0.1:6437 YNX_EXPLORER_PUBLIC_RPC_URL="$YNX_REST_URL" YNX_EXPLORER_PUBLIC_URL="$explorer_url" "$work/ynx-explorerd" >"$work/explorer.log" 2>&1 &
  explorer_pid=$!
}
tree_rss_kib() {
  local root_pid="$1"
  local total_rss
  local child_pid
  local child_rss
  total_rss="$(ps -o rss= -p "$root_pid" 2>/dev/null | awk '{sum += $1} END {print sum+0}')"
  while read -r child_pid; do
    [[ -n "$child_pid" ]] || continue
    child_rss="$(ps -o rss= -p "$child_pid" 2>/dev/null | awk '{sum += $1} END {print sum+0}')"
    total_rss=$((total_rss + child_rss))
  done < <(pgrep -P "$root_pid" 2>/dev/null || true)
  printf '%s\n' "$total_rss"
}
indexer_store_bytes() {
  local store_file
  local total_bytes=0
  for store_file in "$db" "$db.journal"; do
    if [[ -f "$store_file" ]]; then
      total_bytes=$((total_bytes + $(wc -c <"$store_file" | tr -d ' ')))
    fi
  done
  printf '%s\n' "$total_bytes"
}

curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_explorer_alice","amount":1000}' >/dev/null
transfer="$(curl -fsS -X POST "$YNX_REST_URL/transfer" -H 'content-type: application/json' -d '{"from":"ynx_explorer_alice","to":"ynx_explorer_bob","amount":125}')"
tx_hash="$(printf '%s' "$transfer" | ynx_json_field '["hash"]')"
sleep 2

go build -o "$work/ynx-indexerd" ./cmd/ynx-indexerd
go build -o "$work/ynx-explorerd" ./cmd/ynx-explorerd
go build -o "$work/ynx-explorer-load" ./cmd/ynx-explorer-load
"$work/ynx-indexerd" -rpc "$YNX_REST_URL" -db "$db" -once >/dev/null
YNX_INDEXER_RPC_URL="$YNX_REST_URL" YNX_INDEXER_DB_PATH="$db" YNX_INDEXER_HTTP_ADDR=127.0.0.1:6436 "$work/ynx-indexerd" >"$work/indexer.log" 2>&1 &
indexer_pid=$!
start_explorer

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

stable_rounds=0
for _ in {1..40}; do
  if curl -fsS --max-time 2 "$explorer_url/api/summary" >/dev/null 2>&1 && \
    curl -fsS --max-time 2 "$explorer_url/api/blocks/latest?limit=3" >/dev/null 2>&1 && \
    curl -fsS --max-time 2 "$explorer_url/api/txs?limit=3" >/dev/null 2>&1 && \
    curl -fsS --max-time 2 "$explorer_url/api/search?q=$tx_hash" >/dev/null 2>&1; then
    stable_rounds=$((stable_rounds + 1))
    [[ "$stable_rounds" -ge 5 ]] && break
  else
    stable_rounds=0
  fi
  sleep 0.25
done
[[ "$stable_rounds" -ge 5 ]] || { echo "explorer did not hold a five-round stable readiness window" >&2; exit 1; }
"$work/ynx-explorer-load" \
  --base-url "$explorer_url" \
  --allow-http-local \
  --duration 3s \
  --concurrency 5 \
  --requests-per-second 10 \
  --sse-clients 1 \
  --search-query "$tx_hash" \
  --timeout 3s >"$work/explorer-load.json"
grep -Fq '"errorRate": 0' "$work/explorer-load.json"
grep -Fq '"sseErrors": 0' "$work/explorer-load.json"

"$work/ynx-explorer-load" \
  --base-url "$explorer_url" \
  --allow-http-local \
  --expected-outage \
  --duration 12s \
  --concurrency 2 \
  --requests-per-second 4 \
  --sse-clients 1 \
  --search-query "$tx_hash" \
  --timeout 2s >"$work/explorer-recovery.json" &
recovery_pid=$!
sleep 4
ynx_kill_tree "$explorer_pid"
explorer_pid=""
outage_observed=0
for _ in {1..20}; do
  if ! curl -fsS --max-time 0.2 "$explorer_url/health" >/dev/null 2>&1; then
    outage_observed=1
    break
  fi
  sleep 0.1
done
[[ "$outage_observed" == "1" ]] || { echo "Explorer fault injection did not make the scoped listener unavailable" >&2; exit 1; }
sleep 1
start_explorer
for _ in {1..80}; do
  curl -fsS "$explorer_url/health" >/dev/null 2>&1 && break
  sleep 0.25
done
wait "$recovery_pid"
grep -Eq '"sseReconnects": [1-9][0-9]*' "$work/explorer-recovery.json"
grep -Eq '"sseRecoveries": [1-9][0-9]*' "$work/explorer-recovery.json"
grep -Eq '"sseRecoveryMillis": [1-9][0-9]*(\.[0-9]+)?' "$work/explorer-recovery.json"

store_bytes_before="$(indexer_store_bytes)"
rss_samples="$work/explorer-runtime-rss.txt"
(
  while kill -0 "$explorer_pid" >/dev/null 2>&1 && kill -0 "$indexer_pid" >/dev/null 2>&1; do
    explorer_rss="$(tree_rss_kib "$explorer_pid")"
    indexer_rss="$(tree_rss_kib "$indexer_pid")"
    if [[ -n "$explorer_rss" && -n "$indexer_rss" ]]; then
      printf '%s %s\n' "$explorer_rss" "$indexer_rss"
    fi
    sleep 0.2
  done
) >"$rss_samples" &
sampler_pid=$!
"$work/ynx-explorer-load" \
  --base-url "$explorer_url" \
  --allow-http-local \
  --duration 5s \
  --concurrency 20 \
  --requests-per-second 50 \
  --sse-clients 5 \
  --search-query "$tx_hash" \
  --timeout 3s >"$work/explorer-search-storm.json"
grep -Fq '"errorRate": 0' "$work/explorer-search-storm.json"
grep -Fq '"sseErrors": 0' "$work/explorer-search-storm.json"
kill "$sampler_pid" >/dev/null 2>&1 || true
wait "$sampler_pid" >/dev/null 2>&1 || true
sampler_pid=""
explorer_rss_max="$(awk '{if ($1 > max) max=$1} END {print max+0}' "$rss_samples")"
indexer_rss_max="$(awk '{if ($2 > max) max=$2} END {print max+0}' "$rss_samples")"
store_bytes_after="$(indexer_store_bytes)"
node - "$explorer_rss_max" "$indexer_rss_max" "$store_bytes_before" "$store_bytes_after" <<'NODE' >"$work/explorer-runtime.json"
const [explorerRSSKiB,indexerRSSKiB,storeBytesBefore,storeBytesAfter] = process.argv.slice(2).map(Number);
console.log(JSON.stringify({
  schema:'ynx.explorer.runtime.v1',
  checkedAt:new Date().toISOString(),
  explorerMaxRSSKiB:explorerRSSKiB,
  indexerMaxRSSKiB:indexerRSSKiB,
  indexerStoreBytesBefore:storeBytesBefore,
  indexerStoreBytesAfter:storeBytesAfter,
  indexerStoreGrowthBytes:storeBytesAfter-storeBytesBefore,
},null,2));
NODE
grep -Eq '"explorerMaxRSSKiB": [1-9][0-9]*' "$work/explorer-runtime.json"
grep -Eq '"indexerMaxRSSKiB": [1-9][0-9]*' "$work/explorer-runtime.json"
grep -Eq '"indexerStoreGrowthBytes": [0-9]+' "$work/explorer-runtime.json"

html="$(curl -fsS "$explorer_url/")"
grep -Fq "Open MetaMask compatibility" <<<"$html"
grep -Fq "const fieldKeys = ['delegatedYnxt'" <<<"$html"
grep -Fq "EVM compatibility address" <<<"$html"
grep -Fq "/api/summary" <<<"$html"
metrics="$(curl -fsS "$explorer_url/metrics")"
grep -Fq "ynx_explorer_rpc_height" <<<"$metrics"
grep -Fq 'native_symbol="YNXT"' <<<"$metrics"

echo "explorer-check passed: url=$explorer_url tx=$tx_hash"
