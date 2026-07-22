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

go test -race ./internal/bridgegateway ./cmd/ynx-bridged
go build -trimpath -o "$tmp/ynx-bridged" ./cmd/ynx-bridged

api_key="bridge-api-check-key"
relayers='{"relayer-a":"11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=","relayer-b":"PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw=","relayer-c":"/FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU="}'
policies='[{"sourceChain":"ethereum-sepolia","destinationChain":"ynx_6423-1","sourceAsset":"sepolia-usdc","destinationAsset":"ynx-usdc","minConfirmations":12,"maxAmount":"1000","maxOutstanding":"1000","assetBoundary":"canonical-to-represented","externalSubmission":false}]'
state="$tmp/state/bridge.json"
url="http://127.0.0.1:16433"
log="$tmp/bridge.log"

bridge_env=(
  YNX_BRIDGE_API_KEY="$api_key"
  YNX_BRIDGE_RELAYERS_JSON="$relayers"
  YNX_BRIDGE_ROUTE_POLICIES_JSON="$policies"
  YNX_BRIDGE_RELAYER_THRESHOLD=2
  YNX_BRIDGE_STATE_PATH="$state"
)
env "${bridge_env[@]}" "$tmp/ynx-bridged" --check-config >/dev/null

start_bridge() {
  env "${bridge_env[@]}" YNX_BRIDGE_HTTP_ADDR=127.0.0.1:16433 "$tmp/ynx-bridged" >"$log" 2>&1 &
  pid=$!
  for _ in {1..80}; do
    curl -fsS "$url/health" >/dev/null 2>&1 && return
    sleep 0.1
  done
  echo "ynx-bridged did not become healthy" >&2
  sed -n '1,120p' "$log" >&2
  exit 1
}

start_bridge
health="$(curl -fsS "$url/health")"
printf '%s' "$health" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!d.ok||d.service!=="ynx-bridged"||d.nativeSymbol!=="YNXT"||d.routeCount!==1||d.relayerCount!==3||d.requiredAttestations!==2||d.liveBridge!==false||d.externalSubmissionEnabled!==false||d.truthfulStatus!=="local-coordinator-only-no-external-submission")throw new Error(`bad bridge health ${JSON.stringify(d)}`)'

status="$(curl -sS -o "$tmp/unauthorized.json" -w '%{http_code}' "$url/bridge/transfers")"
[[ "$status" == 401 ]]

body='{"idempotencyKey":"bridge-check-create-001","sourceChain":"ethereum-sepolia","sourceTxHash":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sourceEventIndex":7,"sourceAsset":"sepolia-usdc","destinationChain":"ynx_6423-1","destinationAsset":"ynx-usdc","amount":"100","sender":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","recipient":"ynx1recipient000000000000000000000000000001"}'
created="$(curl -fsS -X POST "$url/bridge/transfers" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "$body")"
transfer_id="$(printf '%s' "$created" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.replayed||d.transfer?.status!=="pending_attestations"||d.transfer?.phase!=="source_submitted"||d.transfer?.externalSubmissionEnabled!==false)throw new Error(`bad create ${JSON.stringify(d)}`);process.stdout.write(d.transfer.id)')"

curl -fsS -X POST "$url/bridge/safety" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d '{"idempotencyKey":"bridge-check-pause-001","paused":true,"reason":"bounded-safety-drill"}' | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!d.safety?.paused||d.replayed)process.exit(1)'
status="$(curl -sS -o "$tmp/paused.json" -w '%{http_code}' -X POST "$url/bridge/transfers" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "${body/bridge-check-create-001/bridge-check-paused-001}")"
[[ "$status" == 409 ]]
curl -fsS -X POST "$url/bridge/safety" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d '{"idempotencyKey":"bridge-check-resume-001","paused":false,"reason":"bounded-safety-cleared"}' | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.safety?.paused||d.replayed)process.exit(1)'

status="$(curl -sS -o "$tmp/replay.json" -w '%{http_code}' -X POST "$url/bridge/transfers" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "$body")"
[[ "$status" == 200 ]]
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!d.replayed)process.exit(1)' "$tmp/replay.json"

changed="${body/\"amount\":\"100\"/\"amount\":\"101\"}"
status="$(curl -sS -o "$tmp/conflict.json" -w '%{http_code}' -X POST "$url/bridge/transfers" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "$changed")"
[[ "$status" == 409 ]]
unsafe="${body%?},\"action\":\"freeze_native_ynxt\"}"
status="$(curl -sS -o "$tmp/unsafe.json" -w '%{http_code}' -X POST "$url/bridge/transfers" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "$unsafe")"
[[ "$status" == 400 ]]

kill "$pid"
wait "$pid" 2>/dev/null || true
pid=""
start_bridge
persisted="$(curl -fsS "$url/bridge/transfers/$transfer_id" -H "X-YNX-Bridge-Key: $api_key")"
printf '%s' "$persisted" | TRANSFER_ID="$transfer_id" node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.id!==process.env.TRANSFER_ID||d.status!=="pending_attestations"||d.amount!=="100")throw new Error(`restart mismatch ${JSON.stringify(d)}`)'

metrics="$(curl -fsS "$url/metrics")"
grep -Fq "ynx_bridge_transfers_total" <<<"$metrics"
grep -Fq "ynx_bridge_external_submission_enabled" <<<"$metrics"
grep -Fq "ynx_bridge_paused" <<<"$metrics"
[[ "$(stat -f %Lp "$state" 2>/dev/null || stat -c %a "$state")" == 600 ]]
! grep -Fq "$api_key" "$state" "$log"

echo "bridge-api-check passed: persistent restart-safe intents, exact replay/conflict, bounded exposure policy, pause/resume drill, auth, truthful no-external-submission health/metrics, and mode-0600 state"
