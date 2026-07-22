#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/ynx-data-fabric-smoke.XXXXXX")
DAEMON_PID=""

cleanup() {
  if [[ -n "$DAEMON_PID" ]] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    kill -TERM "$DAEMON_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/bin" "$WORK/config" "$WORK/data"
CGO_ENABLED=0 go build -trimpath -o "$WORK/bin/ynx-data-fabricd" "$ROOT/cmd/ynx-data-fabricd"
CGO_ENABLED=0 go build -trimpath -o "$WORK/bin/ynx-data-fabric-worker" "$ROOT/cmd/ynx-data-fabric-worker"
CGO_ENABLED=0 go build -trimpath -o "$WORK/bin/ynx-data-fabricctl" "$ROOT/cmd/ynx-data-fabricctl"

openssl rand -hex 32 > "$WORK/config/pay.key"
chmod 600 "$WORK/config/pay.key"
openssl rand -hex 32 > "$WORK/config/privacy.key"
chmod 600 "$WORK/config/privacy.key"
printf '{"keys":[{"keyId":"key.pay.smoke.0001","product":"pay","keyFile":"%s"}]}\n' "$WORK/config/pay.key" > "$WORK/config/event-keys.json"
chmod 600 "$WORK/config/event-keys.json"
: > "$WORK/data/events.jsonl"
chmod 600 "$WORK/data/events.jsonl"

SOURCE_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
"$WORK/bin/ynx-data-fabricd" \
	--store=file \
	--broker=file \
  --listen 127.0.0.1:18094 \
  --state "$WORK/data/state.json" \
  --event-log "$WORK/data/events.jsonl" \
  --event-keys "$WORK/config/event-keys.json" \
  --privacy-key "$WORK/config/privacy.key" \
  --introspection-url http://127.0.0.1:18095/app/session/introspect \
  --source-commit "$SOURCE_COMMIT" \
  --source-release data-fabric-local-smoke > "$WORK/daemon.log" 2>&1 &
DAEMON_PID=$!

ready=false
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:18094/healthz > "$WORK/health.json" 2>/dev/null; then
    ready=true
    break
  fi
  sleep 0.2
done
if [[ "$ready" != true ]]; then
  sed -n '1,160p' "$WORK/daemon.log" >&2
  exit 1
fi

jq -e --arg commit "$SOURCE_COMMIT" '.ok == true and .integrity == "verified" and .sourceCommit == $commit' "$WORK/health.json" >/dev/null
curl --fail --silent --show-error http://127.0.0.1:18094/version | jq -e --arg commit "$SOURCE_COMMIT" '.service == "ynx-data-fabric" and .sourceCommit == $commit' >/dev/null
curl --fail --silent --show-error http://127.0.0.1:18094/metrics | grep -q '^ynx_data_fabric_outbox_pending 0$'
curl --fail --silent --show-error --dump-header "$WORK/operator.headers" http://127.0.0.1:18094/operator/ > "$WORK/operator.html"
grep -q 'YNX Data Fabric Operator' "$WORK/operator.html"
grep -qi "content-security-policy:.*script-src 'self'" "$WORK/operator.headers"
curl --fail --silent --show-error http://127.0.0.1:18094/operator/app.js | grep -q 'requestBoundHeaders'

unauthorized_status=$(curl --silent --output "$WORK/unauthorized.json" --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' --data '{}' http://127.0.0.1:18094/v1/events)
test "$unauthorized_status" = 401
jq -e '.error == "canonical_session_required" and (.errorId | startswith("err_"))' "$WORK/unauthorized.json" >/dev/null

kill -TERM "$DAEMON_PID"
wait "$DAEMON_PID"
DAEMON_PID=""

"$WORK/bin/ynx-data-fabricctl" verify --state "$WORK/data/state.json" --event-log "$WORK/data/events.jsonl" --event-keys "$WORK/config/event-keys.json" | jq -e '.status == "verified" and .events == 0 and .eventLogRecords == 0' >/dev/null
"$WORK/bin/ynx-data-fabricctl" backup \
  --state "$WORK/data/state.json" \
  --event-log "$WORK/data/events.jsonl" \
  --event-keys "$WORK/config/event-keys.json" \
  --output "$WORK/backup" \
  --source-commit "$SOURCE_COMMIT" \
  --source-release data-fabric-local-smoke | jq -e '.integrity == "verified" and .eventCount == 0 and .eventLogCount == 0' >/dev/null
"$WORK/bin/ynx-data-fabricctl" restore \
  --backup "$WORK/backup" \
  --target-state "$WORK/restored/state.json" \
  --target-event-log "$WORK/restored/events.jsonl" \
  --event-keys "$WORK/config/event-keys.json" | jq -e '.status == "restored-and-verified"' >/dev/null
"$WORK/bin/ynx-data-fabricctl" verify --state "$WORK/restored/state.json" --event-log "$WORK/restored/events.jsonl" --event-keys "$WORK/config/event-keys.json" | jq -e '.status == "verified"' >/dev/null
printf 'YNX Data Fabric local cold-start smoke passed\n'
