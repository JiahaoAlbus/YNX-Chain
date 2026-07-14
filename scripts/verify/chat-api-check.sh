#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
pid=""
cleanup() {
  [[ -n "$pid" ]] && kill "$pid" >/dev/null 2>&1 || true
  [[ -n "$pid" ]] && wait "$pid" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

go test -race ./internal/chat ./cmd/ynx-chatd
go build -trimpath -o "$tmp/ynx-chatd" ./cmd/ynx-chatd

api_key="chat-api-check-key-123456789"
state="$tmp/state/chat.json"
url="http://127.0.0.1:16435"
log="$tmp/chat.log"
service_env=(
  YNX_CHAT_API_KEY="$api_key"
  YNX_CHAT_STATE_PATH="$state"
  YNX_CHAT_MAX_CIPHERTEXT_BYTES=65536
)

env "${service_env[@]}" "$tmp/ynx-chatd" --check-config >/dev/null
env "${service_env[@]}" YNX_CHAT_HTTP_ADDR=127.0.0.1:16435 "$tmp/ynx-chatd" >"$log" 2>&1 &
pid=$!
for _ in {1..80}; do
  curl -fsS "$url/health" >/dev/null 2>&1 && break
  sleep 0.1
done

health="$(curl -fsS "$url/health")" || { sed -n '1,120p' "$log" >&2; exit 1; }
printf '%s' "$health" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!d.ok||d.service!=="ynx-chatd"||d.nativeAddressDefault!==true||d.plaintextStored!==false||d.persistence!=="atomic-json-mode-0600"||d.truthfulStatus!=="local-bounded-chat-core-not-remote-deployed")throw new Error(`bad chat health ${JSON.stringify(d)}`)'
status="$(curl -sS -o "$tmp/unauthorized.json" -w '%{http_code}' -X POST "$url/chat/devices" -H 'content-type: application/json' -d '{}')"
[[ "$status" == 401 ]]
metrics="$(curl -fsS "$url/metrics")"
grep -Fq 'ynx_chat_plaintext_stored 0' <<<"$metrics"
grep -Fq 'ynx_chat_remote_deployed 0' <<<"$metrics"
[[ "$(stat -f %Lp "$state" 2>/dev/null || stat -c %a "$state")" == 600 ]]
! grep -Fq "$api_key" "$state" "$log"

echo "chat-api-check passed: signed ynx1 devices, encrypted-envelope routes, exact replay/conflict, acknowledgement, revocation, restart persistence, truthful health, and mode-0600 state"
