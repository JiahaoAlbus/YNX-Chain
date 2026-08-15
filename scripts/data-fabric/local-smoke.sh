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
binary_mode="host-build"
if [[ -n "${YNX_DATA_FABRIC_BIN_DIR:-}" ]]; then
  binary_mode="packaged"
  for command in ynx-data-fabricd ynx-data-fabric-worker ynx-data-fabricctl; do
    [[ -x "$YNX_DATA_FABRIC_BIN_DIR/$command" ]] || { echo "packaged binary is not executable: $command" >&2; exit 1; }
    cp "$YNX_DATA_FABRIC_BIN_DIR/$command" "$WORK/bin/$command"
  done
else
  CGO_ENABLED=0 go build -trimpath -o "$WORK/bin/ynx-data-fabricd" "$ROOT/cmd/ynx-data-fabricd"
  CGO_ENABLED=0 go build -trimpath -o "$WORK/bin/ynx-data-fabric-worker" "$ROOT/cmd/ynx-data-fabric-worker"
  CGO_ENABLED=0 go build -trimpath -o "$WORK/bin/ynx-data-fabricctl" "$ROOT/cmd/ynx-data-fabricctl"
fi

openssl rand -hex 32 > "$WORK/config/pay.key"
chmod 600 "$WORK/config/pay.key"
openssl rand -hex 32 > "$WORK/config/privacy.key"
chmod 600 "$WORK/config/privacy.key"
printf '{"keys":[{"keyId":"key.pay.smoke.0001","product":"pay","keyFile":"%s"}]}\n' "$WORK/config/pay.key" > "$WORK/config/event-keys.json"
chmod 600 "$WORK/config/event-keys.json"
: > "$WORK/data/events.jsonl"
chmod 600 "$WORK/data/events.jsonl"

SOURCE_COMMIT="${YNX_DATA_FABRIC_SMOKE_SOURCE_COMMIT:-$(git -C "$ROOT" rev-parse HEAD)}"
SOURCE_RELEASE="${YNX_DATA_FABRIC_SMOKE_SOURCE_RELEASE:-data-fabric-local-smoke}"
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
  --source-release "$SOURCE_RELEASE" > "$WORK/daemon.log" 2>&1 &
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

jq -e --arg commit "$SOURCE_COMMIT" '.ok == true and .integrity == "verified" and .commit == $commit' "$WORK/health.json" >/dev/null
curl --fail --silent --show-error http://127.0.0.1:18094/version | jq -e --arg commit "$SOURCE_COMMIT" '.service == "ynx-data-fabric" and .commit == $commit' >/dev/null
curl --fail --silent --show-error http://127.0.0.1:18094/metrics | grep -q '^ynx_data_fabric_outbox_pending 0$'
curl --fail --silent --show-error --dump-header "$WORK/operator.headers" http://127.0.0.1:18094/operator/ > "$WORK/operator.html"
grep -q 'YNX Data Fabric Operator' "$WORK/operator.html"
grep -qi "content-security-policy:.*script-src 'self'" "$WORK/operator.headers"
curl --fail --silent --show-error http://127.0.0.1:18094/operator/app.js | grep -q 'requestBoundHeaders'

assert_security_headers() {
  local headers="$1"
  grep -qi '^cache-control: no-store' "$headers"
  grep -qi "^content-security-policy: default-src 'none'; frame-ancestors 'none'" "$headers"
  grep -qi '^x-content-type-options: nosniff' "$headers"
  grep -qi '^referrer-policy: no-referrer' "$headers"
  grep -qi '^traceparent: 00-[0-9a-f]\{32\}-[0-9a-f]\{16\}-0[01]' "$headers"
}

assert_no_diagnostic_leak() {
  local body="$1"
  if grep -Eqi '(/Users/|/home/runner/|goroutine [0-9]+|panic:|stack trace|runtime/debug)' "$body"; then
    echo "HTTP response exposed an internal diagnostic" >&2
    exit 1
  fi
}

# Black-box, live-HTTP security probes. These assert fail-closed behavior and
# absence of mutations; they do not claim a public, remote or production DAST.
unknown_status=$(curl --path-as-is --silent --dump-header "$WORK/unknown.headers" --output "$WORK/unknown.body" --write-out '%{http_code}' http://127.0.0.1:18094/v1/not-a-route)
test "$unknown_status" = 404
assert_security_headers "$WORK/unknown.headers"
assert_no_diagnostic_leak "$WORK/unknown.body"

traversal_status=$(curl --path-as-is --silent --dump-header "$WORK/traversal.headers" --output "$WORK/traversal.body" --write-out '%{http_code}' http://127.0.0.1:18094/operator/%2e%2e/%2e%2e/etc/passwd)
test "$traversal_status" = 404
assert_no_diagnostic_leak "$WORK/traversal.body"
if grep -q 'root:.*:0:0:' "$WORK/traversal.body"; then
  echo "path traversal exposed a local account file" >&2
  exit 1
fi

method_status=$(curl --silent --dump-header "$WORK/method.headers" --output "$WORK/method.body" --write-out '%{http_code}' --request PUT --header 'Content-Type: application/json' --data '{}' http://127.0.0.1:18094/v1/events)
test "$method_status" = 405
grep -qi '^allow:.*GET' "$WORK/method.headers"
grep -qi '^allow:.*POST' "$WORK/method.headers"
assert_security_headers "$WORK/method.headers"
assert_no_diagnostic_leak "$WORK/method.body"

unauthorized_status=$(curl --silent --dump-header "$WORK/unauthorized.headers" --output "$WORK/unauthorized.json" --write-out '%{http_code}' --request POST --header 'Authorization: Bearer forged-local-dast-token' --header 'Content-Type: application/json' --data '{}' http://127.0.0.1:18094/v1/events)
test "$unauthorized_status" = 401
jq -e '.error == "canonical_session_required" and (.errorId | startswith("err_"))' "$WORK/unauthorized.json" >/dev/null
assert_security_headers "$WORK/unauthorized.headers"
assert_no_diagnostic_leak "$WORK/unauthorized.json"

oversized_status=$(
  head -c 1048577 /dev/zero |
    tr '\0' x |
    curl --silent --dump-header "$WORK/oversized.headers" --output "$WORK/oversized.json" --write-out '%{http_code}' \
      --request POST \
      --header 'Content-Type: application/json' \
      --header 'X-YNX-Producer-Key-ID: key.pay.smoke.0001' \
      --header "X-YNX-Producer-Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      --header 'X-YNX-Producer-Nonce: nonce.dast.oversized.0001' \
      --header 'X-YNX-Producer-Signature: invalid' \
      --data-binary @- \
      http://127.0.0.1:18094/v1/producer/events
)
test "$oversized_status" = 400
jq -e '.error == "DF_EVENT_OVERSIZED_PAYLOAD_V1" and (.errorId | startswith("err_"))' "$WORK/oversized.json" >/dev/null
assert_security_headers "$WORK/oversized.headers"
assert_no_diagnostic_leak "$WORK/oversized.json"

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
  --source-release "$SOURCE_RELEASE" | jq -e '.integrity == "verified" and .eventCount == 0 and .eventLogCount == 0' >/dev/null
"$WORK/bin/ynx-data-fabricctl" restore \
  --backup "$WORK/backup" \
  --target-state "$WORK/restored/state.json" \
  --target-event-log "$WORK/restored/events.jsonl" \
  --event-keys "$WORK/config/event-keys.json" | jq -e '.status == "restored-and-verified"' >/dev/null
"$WORK/bin/ynx-data-fabricctl" verify --state "$WORK/restored/state.json" --event-log "$WORK/restored/events.jsonl" --event-keys "$WORK/config/event-keys.json" | jq -e '.status == "verified"' >/dev/null
if [[ -n "${YNX_DATA_FABRIC_SMOKE_RECEIPT_OUTPUT:-}" ]]; then
  [[ "$YNX_DATA_FABRIC_SMOKE_RECEIPT_OUTPUT" == /* && ! -e "$YNX_DATA_FABRIC_SMOKE_RECEIPT_OUTPUT" ]] ||
    { echo "smoke receipt output must be a new absolute path" >&2; exit 1; }
  jq -n \
    --arg commit "$SOURCE_COMMIT" \
    --arg release "$SOURCE_RELEASE" \
    --arg binaryMode "$binary_mode" \
    --arg verifiedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    '{
      schema:"ynx-data-fabric-smoke-receipt/v1",
      commit:$commit,
      release:$release,
      binaryMode:$binaryMode,
      verifiedAt:$verifiedAt,
      checks:{
        daemonHealth:true,
        runtimeIdentity:true,
        metrics:true,
        operatorSurface:true,
        unauthorizedWriteRejected:true,
        liveHTTPDAST:true,
        methodConfusionRejected:true,
        pathTraversalRejected:true,
        oversizedProducerBodyRejected:true,
        diagnosticLeakRejected:true,
        zeroMutationAfterDAST:true,
        fileIntegrityAudit:true,
        backupRestore:true
      }
    }' >"$YNX_DATA_FABRIC_SMOKE_RECEIPT_OUTPUT"
  chmod 0600 "$YNX_DATA_FABRIC_SMOKE_RECEIPT_OUTPUT"
fi
printf 'YNX Data Fabric local cold-start smoke passed\n'
