#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADDR="${YNX_HTTP_ADDR:-127.0.0.1:6420}"
BASE_URL="http://${ADDR}"
LOG_FILE="${ROOT_DIR}/tmp/ynx-devnet.log"

mkdir -p "${ROOT_DIR}/tmp"

go test ./...

go run ./cmd/ynx-chaind --http "${ADDR}" --block-interval 250ms >"${LOG_FILE}" 2>&1 &
PID=$!
trap 'kill ${PID} >/dev/null 2>&1 || true' EXIT

for _ in {1..40}; do
  if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl -fsS "${BASE_URL}/health" >/dev/null

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

echo "YNX devnet verification passed at ${BASE_URL}"
