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

go test -race ./internal/square ./cmd/ynx-squared
go build -trimpath -o "$tmp/ynx-squared" ./cmd/ynx-squared

api_key="square-api-check-key-123456789"
state="$tmp/state/square.json"
url="http://127.0.0.1:16436"
log="$tmp/square.log"
service_env=(
  YNX_SQUARE_API_KEY="$api_key"
  YNX_SQUARE_STATE_PATH="$state"
  YNX_SQUARE_MAX_BODY_BYTES=16384
  YNX_SQUARE_RATE_LIMIT_WINDOW=1m
  YNX_SQUARE_RATE_LIMIT_MAX=120
)

env "${service_env[@]}" "$tmp/ynx-squared" --check-config >/dev/null
env "${service_env[@]}" YNX_SQUARE_HTTP_ADDR=127.0.0.1:16436 "$tmp/ynx-squared" >"$log" 2>&1 &
pid=$!
for _ in {1..80}; do
  curl -fsS "$url/health" >/dev/null 2>&1 && break
  sleep 0.1
done

health="$(curl -fsS "$url/health")" || { sed -n '1,120p' "$log" >&2; exit 1; }
printf '%s' "$health" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!d.ok||d.service!=="ynx-squared"||d.nativeIdentity!=="ynx1"||d.persistence!=="atomic-json-mode-0600"||d.remoteDeployed!==false||d.truthfulStatus!=="local-bounded-square-core-not-remote-deployed")throw new Error(`bad square health ${JSON.stringify(d)}`)'
status="$(curl -sS -o "$tmp/unauthorized.json" -w '%{http_code}' "$url/square/feed")"
[[ "$status" == 401 ]]
metrics="$(curl -fsS "$url/metrics")"
grep -Fq 'ynx_square_posts 0' <<<"$metrics"
grep -Fq 'ynx_square_remote_deployed 0' <<<"$metrics"
[[ "$(stat -f %Lp "$state" 2>/dev/null || stat -c %a "$state")" == 600 ]]
! grep -Fq "$api_key" "$state" "$log"

echo "square-api-check passed: signed ynx1 authors, persistent feed/posts/comments/reactions/follows/reports, replay/access/rate bounds, restart/tamper checks, truthful health, and mode-0600 state"
