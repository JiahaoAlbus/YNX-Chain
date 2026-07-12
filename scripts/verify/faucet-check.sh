#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
go test ./internal/faucet ./cmd/ynx-faucetd
grep -Fq 'bft-gateway-signed-faucet' internal/faucet/faucet.go
grep -Fq 'YNX_FAUCET_PRIVATE_KEY_FILE' cmd/ynx-faucetd/main.go
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

work="${YNX_VERIFY_WORK:-$(mktemp -d)}"
faucet_url="http://127.0.0.1:6428"
request_log="$work/faucet-requests.jsonl"

FAUCET_PRIVATE_KEY=local-test-faucet-key \
YNX_FAUCET_RPC_URL="$YNX_REST_URL" \
YNX_FAUCET_HTTP_ADDR=127.0.0.1:6428 \
YNX_FAUCET_UPSTREAM_MODE=authoritative \
YNX_FAUCET_REQUEST_LOG="$request_log" \
YNX_FAUCET_DEFAULT_AMOUNT=77 \
YNX_FAUCET_MAX_AMOUNT=100 \
YNX_FAUCET_RATE_LIMIT_WINDOW=1h \
YNX_FAUCET_RATE_LIMIT_MAX=1 \
go run ./cmd/ynx-faucetd >"$work/faucet.log" 2>&1 &
faucet_pid=$!
trap 'ynx_kill_tree "$faucet_pid"; ynx_stop_local_testnet' EXIT

for _ in {1..80}; do
  curl -fsS "$faucet_url/health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "$faucet_url/health" >/dev/null || { echo "faucet did not become healthy"; sed -n '1,120p' "$work/faucet.log"; exit 1; }

health="$(curl -fsS "$faucet_url/health")"
[[ "$(printf '%s' "$health" | ynx_json_field '["nativeSymbol"]')" == "YNXT" ]] || { echo "faucet native symbol mismatch"; exit 1; }
[[ "$(printf '%s' "$health" | ynx_json_field '["truthfulStatus"]')" == "rpc-backed-faucet" ]] || { echo "faucet truthful status mismatch"; exit 1; }
[[ "$(printf '%s' "$health" | ynx_json_field '["upstreamOk"]')" == "true" ]] || { echo "faucet upstream is not healthy"; exit 1; }
[[ "$(printf '%s' "$health" | ynx_json_field '["chainId"]')" == "6423" ]] || { echo "faucet chain id mismatch"; exit 1; }

response="$(curl -fsS -X POST "$faucet_url/request" -H 'content-type: application/json' -d '{"address":"ynx_faucet_check"}')"
tx_hash="$(printf '%s' "$response" | ynx_json_field '["transaction"]["hash"]')"
[[ "$tx_hash" == 0x* ]] || { echo "faucet did not return tx hash"; exit 1; }
curl -fsS "$YNX_REST_URL/txs/$tx_hash" >/dev/null

status="$(curl -s -o "$work/rate-limit.json" -w '%{http_code}' -X POST "$faucet_url/request" -H 'content-type: application/json' -d '{"address":"ynx_faucet_check"}')"
[[ "$status" == "429" ]] || { echo "expected rate limit 429, got $status"; cat "$work/rate-limit.json"; exit 1; }
status="$(curl -s -o "$work/invalid-address.json" -w '%{http_code}' -X POST "$faucet_url/request" -H 'content-type: application/json' -d '{"address":"bad"}')"
[[ "$status" == "400" ]] || { echo "expected invalid address 400, got $status"; cat "$work/invalid-address.json"; exit 1; }

test -s "$request_log"
grep -Fq '"status":"sent"' "$request_log"
grep -Fq '"status":"rate_limited"' "$request_log"
metrics="$(curl -fsS "$faucet_url/metrics")"
grep -Fq "ynx_faucet_requests_total" <<<"$metrics"
grep -Fq 'native_symbol="YNXT"' <<<"$metrics"

echo "faucet-check passed: url=$faucet_url tx=$tx_hash log=$request_log"
