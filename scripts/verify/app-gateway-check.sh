#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  done
  rm -rf "$tmp"
}
trap cleanup EXIT

go test -race ./internal/appgateway ./cmd/ynx-app-gatewayd
go build -trimpath -o "$tmp/ynx-chatd" ./cmd/ynx-chatd
go build -trimpath -o "$tmp/ynx-squared" ./cmd/ynx-squared
go build -trimpath -o "$tmp/ynx-app-gatewayd" ./cmd/ynx-app-gatewayd

chat_key="chat-app-gateway-check-key"
square_key="square-app-gateway-check-key"
common_gateway_env=(
  YNX_APP_GATEWAY_CHAT_URL=http://127.0.0.1:17435
  YNX_APP_GATEWAY_CHAT_API_KEY="$chat_key"
  YNX_APP_GATEWAY_SQUARE_URL=http://127.0.0.1:17436
  YNX_APP_GATEWAY_SQUARE_API_KEY="$square_key"
  YNX_APP_GATEWAY_ALLOWED_ORIGINS=https://www.ynxweb4.com,https://ynxweb4.com
  YNX_APP_GATEWAY_MAX_BODY_BYTES=131072
  YNX_APP_GATEWAY_MAX_RESPONSE_BYTES=1048576
  YNX_APP_GATEWAY_RATE_LIMIT_MAX=300
  YNX_APP_GATEWAY_RATE_LIMIT_WINDOW=1m
)

env "${common_gateway_env[@]}" "$tmp/ynx-app-gatewayd" --check-config >/dev/null
env YNX_CHAT_API_KEY="$chat_key" YNX_CHAT_STATE_PATH="$tmp/chat/state.json" YNX_CHAT_HTTP_ADDR=127.0.0.1:17435 "$tmp/ynx-chatd" >"$tmp/chat.log" 2>&1 &
pids+=("$!")
env YNX_SQUARE_API_KEY="$square_key" YNX_SQUARE_STATE_PATH="$tmp/square/state.json" YNX_SQUARE_HTTP_ADDR=127.0.0.1:17436 "$tmp/ynx-squared" >"$tmp/square.log" 2>&1 &
pids+=("$!")
env "${common_gateway_env[@]}" YNX_APP_GATEWAY_HTTP_ADDR=127.0.0.1:17437 "$tmp/ynx-app-gatewayd" >"$tmp/gateway.log" 2>&1 &
pids+=("$!")

for _ in {1..100}; do
  curl -fsS http://127.0.0.1:17437/health >"$tmp/health.json" 2>/dev/null && break
  sleep 0.1
done

node - "$tmp/health.json" <<'NODE'
const fs = require("fs");
const health = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!health.ok || health.service !== "ynx-app-gatewayd" || health.remoteDeployed !== false || health.browserBoundary !== "exact-route-allowlist-device-signatures-service-keys-server-side" || health.truthfulStatus !== "local-browser-safe-gateway-not-remote-deployed" || !health.upstreams?.chat?.ok || !health.upstreams?.square?.ok) {
  throw new Error(`bad app gateway health: ${JSON.stringify(health)}`);
}
NODE

status="$(curl -sS -o "$tmp/direct.json" -w '%{http_code}' http://127.0.0.1:17436/square/feed)"
[[ "$status" == "401" ]] || { echo "direct Square service unexpectedly public: $status"; exit 1; }
status="$(curl -sS -H 'Origin: https://www.ynxweb4.com' -o "$tmp/feed.json" -w '%{http_code}' 'http://127.0.0.1:17437/app/square/feed?limit=10')"
[[ "$status" == "200" ]] || { echo "gateway feed failed: $status"; cat "$tmp/feed.json"; exit 1; }
node - "$tmp/feed.json" <<'NODE'
const fs = require("fs");
const feed = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(feed.posts) || feed.posts.length !== 0) throw new Error(`bad feed: ${JSON.stringify(feed)}`);
NODE
status="$(curl -sS -H 'Origin: https://evil.example' -o "$tmp/bad-origin.json" -w '%{http_code}' http://127.0.0.1:17437/app/square/feed)"
[[ "$status" == "403" ]] || { echo "bad origin accepted: $status"; exit 1; }
status="$(curl -sS -X OPTIONS -H 'Origin: https://www.ynxweb4.com' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: Content-Type, X-YNX-Device-Signature' -o /dev/null -w '%{http_code}' http://127.0.0.1:17437/app/square/posts)"
[[ "$status" == "204" ]] || { echo "browser preflight failed: $status"; exit 1; }
status="$(curl -sS -H 'Origin: https://www.ynxweb4.com' -H 'X-YNX-Square-Key: attacker-value' -o "$tmp/unknown.json" -w '%{http_code}' http://127.0.0.1:17437/app/square/metrics)"
[[ "$status" == "404" ]] || { echo "unlisted Square route accepted: $status"; exit 1; }
! grep -R -F "$chat_key" "$tmp" --exclude='ynx-*' >/dev/null
! grep -R -F "$square_key" "$tmp" --exclude='ynx-*' >/dev/null

echo "app-gateway-check passed: exact first-party origins/routes, server-side credentials, public feed proxy, CORS preflight, bounds, rate limit, health, and direct-service denial"
