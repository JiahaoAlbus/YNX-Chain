#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"
PORT="${YNX_AI_SMOKE_PORT:-16438}"
PID=""

cleanup() {
  if [[ -n "${PID}" ]]; then
    kill "${PID}" 2>/dev/null || true
    wait "${PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

cd "${ROOT}"
go test ./internal/aiproduct ./apps/ai
node --check apps/ai/web/app.js
go build -trimpath -o "${TMP_DIR}/ynx-ai-clientd" ./apps/ai

YNX_AI_CLIENT_HTTP_ADDR="127.0.0.1:${PORT}" \
YNX_AI_CLIENT_STATE_PATH="${TMP_DIR}/state.json" \
YNX_AI_CLIENT_CONTENT_KEY="0909090909090909090909090909090909090909090909090909090909090909" \
YNX_AI_CLIENT_GATEWAY_URL="http://127.0.0.1:1" \
YNX_AI_GATEWAY_API_KEY="smoke-gateway-access-key" \
"${TMP_DIR}/ynx-ai-clientd" >"${TMP_DIR}/server.log" 2>&1 &
PID="$!"

for _ in {1..50}; do
  if curl --fail --silent "http://127.0.0.1:${PORT}/api/meta" >"${TMP_DIR}/meta.json"; then
    break
  fi
  sleep 0.1
done

curl --fail --silent "http://127.0.0.1:${PORT}/" >"${TMP_DIR}/index.html"
grep -q '"product":"ynx-ai"' "${TMP_DIR}/meta.json"
grep -q '"chainId":6423' "${TMP_DIR}/meta.json"
grep -q 'Bring your Wallet' "${TMP_DIR}/index.html"
grep -q 'No substitute answers' "${ROOT}/apps/ai/web/app.js"

echo "YNX AI smoke passed: tests, JavaScript, build, cold start, embedded UI, and truthful metadata"
