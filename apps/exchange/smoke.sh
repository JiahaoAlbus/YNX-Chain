#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
port="${YNX_EXCHANGE_SMOKE_PORT:-16442}"
pid=""
cleanup() { if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; rm -rf "$work"; }
trap cleanup EXIT
cd "$repo"
YNX_EXCHANGE_ADMIN_API_KEY="smoke-admin-key-123456" \
YNX_EXCHANGE_STATE_PATH="$work/state.json" \
YNX_EXCHANGE_HTTP_ADDR="127.0.0.1:$port" \
go run ./apps/exchange/server >"$work/server.log" 2>&1 &
pid=$!
ready=false
for _ in {1..120}; do
	if curl -fsS "http://127.0.0.1:$port/api/health" >"$work/health.json" 2>/dev/null; then ready=true; break; fi
	if ! kill -0 "$pid" 2>/dev/null; then cat "$work/server.log" >&2; exit 1; fi
	sleep 0.25
done
if [[ "$ready" != true ]]; then cat "$work/server.log" >&2; exit 1; fi
curl -fsS "http://127.0.0.1:$port/" | grep -Fq "YNX-owned deterministic testnet venue"
curl -fsS "http://127.0.0.1:$port/api/v1/markets" | grep -Fq '"externalPrice":false'
curl -fsS "http://127.0.0.1:$port/api/v1/orderbook" | grep -Fq '"bids":[]'
grep -Fq '"productionCustody":false' "$work/health.json"
echo "YNX Exchange smoke passed: Web terminal, truthful health, markets and empty real order book"
