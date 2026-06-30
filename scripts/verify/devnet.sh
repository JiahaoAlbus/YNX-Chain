#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADDR="${YNX_HTTP_ADDR:-127.0.0.1:6420}"
BASE_URL="http://${ADDR}"
LOG_FILE="${ROOT_DIR}/tmp/ynx-devnet.log"
DATA_DIR="${ROOT_DIR}/tmp/verify-devnet-state"
PID=""

mkdir -p "${ROOT_DIR}/tmp"
rm -rf "${DATA_DIR}"

go test ./...

start_node() {
  go run ./cmd/ynx-chaind --http "${ADDR}" --block-interval 250ms --data-dir "${DATA_DIR}" >"${LOG_FILE}" 2>&1 &
  PID=$!
  for _ in {1..40}; do
    if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
      return
    fi
    sleep 0.25
  done
  curl -fsS "${BASE_URL}/health" >/dev/null
}

stop_node() {
  if [[ -n "${PID}" ]]; then
    kill "${PID}" >/dev/null 2>&1 || true
    wait "${PID}" >/dev/null 2>&1 || true
    PID=""
  fi
}

trap 'stop_node' EXIT

start_node

HEIGHT_A="$(curl -fsS "${BASE_URL}/status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["height"])')"
sleep 0.7
HEIGHT_B="$(curl -fsS "${BASE_URL}/status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["height"])')"
if [[ "${HEIGHT_B}" -le "${HEIGHT_A}" ]]; then
  echo "block height did not increase: ${HEIGHT_A} -> ${HEIGHT_B}" >&2
  exit 1
fi

FAUCET_TX="$(curl -fsS -X POST "${BASE_URL}/faucet" \
  -H 'Content-Type: application/json' \
  -d '{"address":"ynx_verify_alice","amount":1000}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["hash"])')"

TRANSFER_TX="$(curl -fsS -X POST "${BASE_URL}/transfer" \
  -H 'Content-Type: application/json' \
  -d '{"from":"ynx_verify_alice","to":"ynx_verify_bob","amount":125}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["hash"])')"

curl -fsS "${BASE_URL}/resources/ynx_verify_alice" >/dev/null
curl -fsS "${BASE_URL}/trust/trace/ynx_verify_bob" >/dev/null
curl -fsS "${BASE_URL}/accounts/ynx_verify_bob" >/dev/null
curl -fsS "${BASE_URL}/validators" >/dev/null
curl -fsS "${BASE_URL}/txs?limit=5" >/dev/null
curl -fsS "${BASE_URL}/explorer/summary" >/dev/null
curl -fsS -X POST "${BASE_URL}/staking/stake" \
  -H 'Content-Type: application/json' \
  -d '{"address":"ynx_verify_alice","amount":100}' >/dev/null
curl -fsS -X POST "${BASE_URL}/pay/intents" \
  -H 'Content-Type: application/json' \
  -d '{"merchant":"ynx_demo_merchant","amount":50}' >/dev/null
curl -fsS -X POST "${BASE_URL}/ide/compile" \
  -H 'Content-Type: application/json' \
  -d '{"name":"HelloYNX","source":"pragma solidity ^0.8.20; contract HelloYNX { function ping() public pure returns (uint256) { return 1; } }"}' >/dev/null
curl -fsS -N "${BASE_URL}/ai/stream?session=verify&q=latest" | grep -q "event: done"

sleep 0.4
curl -fsS "${BASE_URL}/txs/${FAUCET_TX}" >/dev/null
curl -fsS "${BASE_URL}/txs/${TRANSFER_TX}" >/dev/null
HEIGHT_BEFORE_RESTART="$(curl -fsS "${BASE_URL}/status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["height"])')"

stop_node
start_node

HEIGHT_AFTER_RESTART="$(curl -fsS "${BASE_URL}/status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["height"])')"
if [[ "${HEIGHT_AFTER_RESTART}" -lt "${HEIGHT_BEFORE_RESTART}" ]]; then
  echo "persistent height regressed after restart: ${HEIGHT_BEFORE_RESTART} -> ${HEIGHT_AFTER_RESTART}" >&2
  exit 1
fi
curl -fsS "${BASE_URL}/txs/${TRANSFER_TX}" >/dev/null
curl -fsS "${BASE_URL}/accounts/ynx_verify_bob" | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data["account"]["balance"] == 125'

echo "YNX devnet verification passed at ${BASE_URL}"
