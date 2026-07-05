#!/usr/bin/env bash
set -euo pipefail

ynx_kill_tree() {
  local pid="${1:-}"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  pkill -TERM -P "$pid" >/dev/null 2>&1 || true
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
}

ynx_start_local_testnet() {
  export YNX_VERIFY_WORK="${YNX_VERIFY_WORK:-$(mktemp -d)}"
  export YNX_REST_URL="${YNX_REST_URL:-http://127.0.0.1:6420}"
  export YNX_EVM_RPC_URL="${YNX_EVM_RPC_URL:-$YNX_REST_URL/evm}"
  if curl -fsS "$YNX_REST_URL/health" >/dev/null 2>&1; then
    export YNX_STARTED_PID=""
    return 0
  fi
  YNX_NETWORK=testnet YNX_HTTP_ADDR=127.0.0.1:6420 YNX_DATA_DIR="$YNX_VERIFY_WORK/state" go run ./cmd/ynx-chaind >"$YNX_VERIFY_WORK/server.log" 2>&1 &
  export YNX_STARTED_PID=$!
  for _ in {1..60}; do
    curl -fsS "$YNX_REST_URL/health" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  echo "local YNX Testnet did not become healthy"
  sed -n '1,120p' "$YNX_VERIFY_WORK/server.log" 2>/dev/null || true
  return 1
}

ynx_stop_local_testnet() {
  if [[ -n "${YNX_STARTED_PID:-}" ]]; then
    ynx_kill_tree "$YNX_STARTED_PID"
  fi
  if [[ -n "${YNX_VERIFY_WORK:-}" && "${YNX_KEEP_VERIFY_WORK:-0}" != "1" ]]; then
    rm -rf "$YNX_VERIFY_WORK"
  fi
}

ynx_jsonrpc() {
  local method="$1"
  local params="${2:-[]}"
  curl -fsS -X POST "$YNX_EVM_RPC_URL" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$method\",\"params\":$params}"
}

ynx_json_field() {
  local field="$1"
  node -e "const data=JSON.parse(require('fs').readFileSync(0,'utf8')); const value=data${field}; if (value === undefined || value === null) process.exit(2); if (typeof value === 'object') console.log(JSON.stringify(value)); else console.log(value);"
}
