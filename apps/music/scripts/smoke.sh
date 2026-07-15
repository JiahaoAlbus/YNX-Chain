#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp="$(mktemp -d)"
port="${YNX_MUSIC_SMOKE_PORT:-16436}"
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

cd "$root"
go build -o "$tmp/ynx-musicd" ./apps/music/cmd/ynx-musicd
"$tmp/ynx-musicd" -http "127.0.0.1:$port" -data "$tmp/data" >"$tmp/server.log" 2>&1 &
pid=$!
for _ in $(seq 1 50); do
  if curl --fail --silent "http://127.0.0.1:$port/health" >"$tmp/health.json"; then break; fi
  sleep 0.1
done
grep -q '"ok":true' "$tmp/health.json"
grep -q '"licensedPublicCatalog":false' "$tmp/health.json"
curl --fail --silent "http://127.0.0.1:$port/" | grep -q 'YNX Music'
status="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$port/api/me")"
test "$status" = "401"
echo "YNX Music smoke passed: health, embedded Web, truthful catalog boundary, fail-closed auth"
