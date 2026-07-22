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
policies='[{"provider":"local-api-check","sourceChain":"ethereum-sepolia","destinationChain":"ynx_6423-1","sourceAsset":"sepolia-usdc","destinationAsset":"ynx-usdc","minConfirmations":12,"maxAmount":"1000","maxOutstanding":"2000","dailyLimit":"1500","userOutstandingLimit":"1000","largeTransferThreshold":"500","largeTransferDelaySeconds":3600,"assetBoundary":"canonical-to-represented","externalSubmission":false}]'
state="$tmp/state/bridge.json"
url="http://127.0.0.1:16433"
log="$tmp/bridge.log"

bridge_env=(
  YNX_BRIDGE_API_KEY="$api_key"
  YNX_BRIDGE_RELAYERS_JSON="$relayers"
  YNX_BRIDGE_ROUTE_POLICIES_JSON="$policies"
  YNX_BRIDGE_RELAYER_THRESHOLD=2
  YNX_BRIDGE_STATE_PATH="$state"
  YNX_BRIDGE_RETENTION_PERIOD=24h
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
curl -fsS -D "$tmp/trace.headers" -o /dev/null -H 'traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' "$url/health"
grep -Eiq '^X-Trace-ID: 4bf92f3577b34da6a3ce929d0e0e4736' "$tmp/trace.headers"
grep -Eiq '^Traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01' "$tmp/trace.headers"
health="$(curl -fsS "$url/health")"
printf '%s' "$health" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!d.ok||d.service!=="ynx-bridged"||d.nativeSymbol!=="YNXT"||d.routeCount!==1||d.relayerCount!==3||d.requiredAttestations!==2||d.liveBridge!==false||d.externalSubmissionEnabled!==false||d.truthfulStatus!=="local-coordinator-only-no-external-submission"||!d.rateLimit||!d.retentionPolicy?.startsWith("24h"))throw new Error(`bad bridge health ${JSON.stringify(d)}`)'
curl -fsS "$url/bridge/transparency" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.source!=="ynx-bridge-coordinator"||d.liveBridge!==false||d.externalSubmissionEnabled!==false||d.routes?.length!==1||d.routes[0].coordinatorOutstanding!=="0")throw new Error(`bad public transparency ${JSON.stringify(d)}`)'
BRIDGE_URL="$url" node --input-type=module -e 'import {YNXBridgeClient} from "./sdk/bridge/index.js";const c=new YNXBridgeClient({baseURL:process.env.BRIDGE_URL});const [h,t]=await Promise.all([c.getHealth(),c.getTransparency()]);if(h.liveBridge!==false||t.routes.length!==1)process.exit(1)'

status="$(curl -sS -D "$tmp/unauthorized.headers" -o "$tmp/unauthorized.json" -w '%{http_code}' "$url/bridge/transfers")"
[[ "$status" == 401 ]]
grep -Eiq '^X-Request-ID: breq_[0-9a-f]{24}' "$tmp/unauthorized.headers"
grep -Eiq '^X-Error-ID: berr_[0-9a-f]{16}' "$tmp/unauthorized.headers"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!d.requestId?.startsWith("breq_")||!d.errorId?.startsWith("berr_"))process.exit(1)' "$tmp/unauthorized.json"

body='{"idempotencyKey":"bridge-check-create-001","sourceChain":"ethereum-sepolia","sourceTxHash":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sourceEventIndex":7,"sourceAsset":"sepolia-usdc","destinationChain":"ynx_6423-1","destinationAsset":"ynx-usdc","amount":"100","sender":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","recipient":"ynx1recipient000000000000000000000000000001"}'
created="$(curl -fsS -X POST "$url/bridge/transfers" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "$body")"
transfer_id="$(printf '%s' "$created" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.replayed||d.transfer?.status!=="pending_attestations"||d.transfer?.phase!=="source_submitted"||d.transfer?.externalSubmissionEnabled!==false)throw new Error(`bad create ${JSON.stringify(d)}`);process.stdout.write(d.transfer.id)')"
account='0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
curl -fsS "$url/bridge/data-exports/$account" -H "X-YNX-Bridge-Key: $api_key" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.schemaVersion!==1||d.source!=="ynx-bridge-coordinator"||d.transfers?.length!==1||d.deletionRequests?.length!==0)throw new Error(`bad data export ${JSON.stringify(d)}`)'
deletion="$(curl -fsS -X POST "$url/bridge/data-deletion-requests" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "{\"idempotencyKey\":\"bridge-check-delete-request-001\",\"account\":\"$account\",\"reason\":\"account-closure\"}")"
deletion_id="$(printf '%s' "$deletion" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.replayed||d.request?.status!=="safety_hold"||d.request?.outstandingTransfers!==1||d.request?.eligibleAt)throw new Error(`bad deletion hold ${JSON.stringify(d)}`);process.stdout.write(d.request.id)')"
status="$(curl -sS -o "$tmp/delete-held.json" -w '%{http_code}' -X POST "$url/bridge/data-deletion-requests/$deletion_id/execute" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d '{"idempotencyKey":"bridge-check-delete-execute-001"}')"
[[ "$status" == 409 ]] && grep -Fq "active or unresolved transfers require safety retention" "$tmp/delete-held.json"

observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
reconciliation="$(curl -fsS -X POST "$url/bridge/reconciliations" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "{\"idempotencyKey\":\"bridge-check-reconcile-001\",\"sourceChain\":\"ethereum-sepolia\",\"destinationChain\":\"ynx_6423-1\",\"sourceAsset\":\"sepolia-usdc\",\"destinationAsset\":\"ynx-usdc\",\"locked\":\"100\",\"burned\":\"0\",\"minted\":\"90\",\"released\":\"0\",\"evidenceRef\":\"fixture:bridge-api-check\",\"observedAt\":\"$observed_at\"}")"
printf '%s' "$reconciliation" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const r=d.reconciliation;if(d.replayed||r.balanced!==false||r.difference!=="10"||r.source!=="operator-submitted-evidence"||r.verification!=="reference-recorded-not-independently-verified")throw new Error(`bad reconciliation ${JSON.stringify(d)}`)'
curl -fsS "$url/bridge/transparency" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const r=d.routes?.[0];if(r.coordinatorOutstanding!=="100"||r.lastReconciliation?.difference!=="10"||r.lastReconciliation?.balanced!==false)throw new Error(`bad exposed reconciliation ${JSON.stringify(d)}`)'

user_over='{"idempotencyKey":"bridge-check-user-limit-001","sourceChain":"ethereum-sepolia","sourceTxHash":"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","sourceEventIndex":8,"sourceAsset":"sepolia-usdc","destinationChain":"ynx_6423-1","destinationAsset":"ynx-usdc","amount":"901","sender":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","recipient":"ynx1recipient000000000000000000000000000001"}'
status="$(curl -sS -o "$tmp/user-limit.json" -w '%{http_code}' -X POST "$url/bridge/transfers" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "$user_over")"
[[ "$status" == 409 ]] && grep -Fq "user outstanding limit exceeded" "$tmp/user-limit.json"
daily_seed='{"idempotencyKey":"bridge-check-daily-seed-001","sourceChain":"ethereum-sepolia","sourceTxHash":"0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","sourceEventIndex":9,"sourceAsset":"sepolia-usdc","destinationChain":"ynx_6423-1","destinationAsset":"ynx-usdc","amount":"1000","sender":"0xcccccccccccccccccccccccccccccccccccccccc","recipient":"ynx1recipient000000000000000000000000000001"}'
curl -fsS -X POST "$url/bridge/transfers" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "$daily_seed" >/dev/null
daily_over='{"idempotencyKey":"bridge-check-daily-limit-001","sourceChain":"ethereum-sepolia","sourceTxHash":"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","sourceEventIndex":10,"sourceAsset":"sepolia-usdc","destinationChain":"ynx_6423-1","destinationAsset":"ynx-usdc","amount":"401","sender":"0xdddddddddddddddddddddddddddddddddddddddd","recipient":"ynx1recipient000000000000000000000000000001"}'
status="$(curl -sS -o "$tmp/daily-limit.json" -w '%{http_code}' -X POST "$url/bridge/transfers" -H "X-YNX-Bridge-Key: $api_key" -H 'content-type: application/json' -d "$daily_over")"
[[ "$status" == 409 ]] && grep -Fq "route daily limit exceeded" "$tmp/daily-limit.json"

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
curl -fsS "$url/bridge/data-exports/$account" -H "X-YNX-Bridge-Key: $api_key" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.transfers?.length!==1||d.deletionRequests?.length!==1||d.deletionRequests[0].status!=="safety_hold")throw new Error(`data request restart mismatch ${JSON.stringify(d)}`)'

metrics="$(curl -fsS "$url/metrics")"
grep -Fq "ynx_bridge_transfers_total" <<<"$metrics"
grep -Fq "ynx_bridge_external_submission_enabled" <<<"$metrics"
grep -Fq "ynx_bridge_paused" <<<"$metrics"
grep -Fq "ynx_bridge_coordinator_outstanding" <<<"$metrics"
grep -Fq "ynx_bridge_rate_limit_denied_total" <<<"$metrics"
grep -Fq "ynx_bridge_route_outstanding{" <<<"$metrics"
grep -Fq "ynx_bridge_route_outstanding_limit{" <<<"$metrics"
grep -Fq "ynx_bridge_reconciliation_balanced{" <<<"$metrics"
grep -Fq "ynx_bridge_reconciliation_timestamp_seconds{" <<<"$metrics"
[[ "$(stat -f %Lp "$state" 2>/dev/null || stat -c %a "$state")" == 600 ]]
! grep -Fq "$api_key" "$state" "$log"

echo "bridge-api-check passed: persistent intents, replay/conflict, limits/delay, pause/resume, reconciliation/transparency, data export/retention hold, auth, tracing, truthful metrics, and mode-0600 state"
