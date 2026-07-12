#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
upstream_key="local-pay-gateway-upstream-key"
export YNX_PAY_GATEWAY_UPSTREAM_KEY="$upstream_key"
ynx_start_local_testnet
pay_pid=""
cleanup() {
  [[ -n "$pay_pid" ]] && ynx_kill_tree "$pay_pid"
  ynx_stop_local_testnet
}
trap cleanup EXIT

pay_url="http://127.0.0.1:6431"
api_key="local-pay-api-key"
webhook_key="local-pay-webhook-signing-key"
merchant_id="merchant_pay_check"
audit_log="$YNX_VERIFY_WORK/pay-gateway-audit.jsonl"

YNX_PAY_GATEWAY_CHAIN_URL="$YNX_REST_URL" \
YNX_PAY_GATEWAY_HTTP_ADDR=127.0.0.1:6431 \
YNX_PAY_MERCHANT_ID="$merchant_id" \
YNX_PAY_API_KEY="$api_key" \
YNX_PAY_GATEWAY_UPSTREAM_KEY="$upstream_key" \
YNX_PAY_WEBHOOK_SIGNING_KEY="$webhook_key" \
YNX_PAY_GATEWAY_AUDIT_LOG="$audit_log" \
YNX_PAY_GATEWAY_RATE_LIMIT_WINDOW=1m \
YNX_PAY_GATEWAY_RATE_LIMIT_MAX=30 \
  go run ./cmd/ynx-payd >"$YNX_VERIFY_WORK/pay-gateway.log" 2>&1 &
pay_pid=$!

for _ in {1..80}; do
  curl -fsS "$pay_url/health" >/dev/null 2>&1 && break
  sleep 0.25
done
health="$(curl -fsS "$pay_url/health")" || { echo "Pay Gateway did not become healthy"; sed -n '1,160p' "$YNX_VERIFY_WORK/pay-gateway.log"; exit 1; }
printf '%s' "$health" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.ok || d.service !== "ynx-payd" || d.chainId !== 6423 || d.nativeSymbol !== "YNXT" || !d.upstreamOk || !d.merchantConfigured || !d.signingConfigured || d.truthfulStatus !== "authenticated-chain-backed-pay-merchant-gateway") throw new Error(`bad Pay Gateway health: ${JSON.stringify(d)}`);'

status="$(curl -s -o "$YNX_VERIFY_WORK/pay-direct-bypass.json" -w '%{http_code}' -X POST "$YNX_REST_URL/pay/intents" -H 'content-type: application/json' -d '{"merchant":"bypass","amount":1,"idempotencyKey":"bypass"}')"
[[ "$status" == "401" ]] || { echo "expected direct chain Pay route bypass to return 401, got $status"; cat "$YNX_VERIFY_WORK/pay-direct-bypass.json"; exit 1; }

status="$(curl -s -o "$YNX_VERIFY_WORK/pay-unauthorized.json" -w '%{http_code}' -X POST "$pay_url/pay/intents" -H 'content-type: application/json' -d '{"amount":25,"idempotencyKey":"unauthorized"}')"
[[ "$status" == "401" ]] || { echo "expected unauthorized Pay request to return 401, got $status"; exit 1; }

auth=(-H "X-YNX-Pay-Key: $api_key")
status="$(curl -s -o "$YNX_VERIFY_WORK/pay-missing-idempotency.json" -w '%{http_code}' -X POST "$pay_url/pay/intents" "${auth[@]}" -H 'content-type: application/json' -d '{"amount":25}')"
[[ "$status" == "400" ]] || { echo "expected missing idempotency key to return 400, got $status"; exit 1; }
status="$(curl -s -o "$YNX_VERIFY_WORK/pay-merchant-mismatch.json" -w '%{http_code}' -X POST "$pay_url/pay/intents" "${auth[@]}" -H 'content-type: application/json' -d '{"merchant":"other","amount":25,"idempotencyKey":"mismatch"}')"
[[ "$status" == "400" ]] || { echo "expected merchant mismatch to return 400, got $status"; exit 1; }

intent="$(curl -fsS -X POST "$pay_url/pay/intents" "${auth[@]}" -H 'content-type: application/json' -d '{"amount":25,"callbackUrl":"https://merchant.example/callback","idempotencyKey":"pay-check-intent"}')"
intent_id="$(printf '%s' "$intent" | ynx_json_field '["id"]')"
printf '%s' "$intent" | MERCHANT_ID="$merchant_id" node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.merchant !== process.env.MERCHANT_ID || d.currency !== "YNXT" || !d.id) throw new Error(`bad Pay intent: ${JSON.stringify(d)}`);'
intent_replay="$(curl -fsS -X POST "$pay_url/pay/intents" "${auth[@]}" -H 'content-type: application/json' -d '{"amount":25,"callbackUrl":"https://merchant.example/callback","idempotencyKey":"pay-check-intent"}')"
[[ "$(printf '%s' "$intent_replay" | ynx_json_field '["id"]')" == "$intent_id" ]]
status="$(curl -s -o "$YNX_VERIFY_WORK/pay-idempotency-conflict.json" -w '%{http_code}' -X POST "$pay_url/pay/intents" "${auth[@]}" -H 'content-type: application/json' -d '{"amount":999,"idempotencyKey":"pay-check-intent"}')"
[[ "$status" == "400" ]] || { echo "expected changed-input idempotency conflict, got $status"; exit 1; }

invoice="$(curl -fsS -X POST "$pay_url/pay/invoices" "${auth[@]}" -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"dueInHours\":12,\"idempotencyKey\":\"pay-check-invoice\"}")"
invoice_id="$(printf '%s' "$invoice" | ynx_json_field '["id"]')"
curl -fsS "$pay_url/pay/invoices/$invoice_id" "${auth[@]}" >/dev/null

webhook="$(curl -fsS -X POST "$pay_url/pay/webhook-signatures" "${auth[@]}" -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"eventType\":\"payment_intent.created\",\"idempotencyKey\":\"pay-check-webhook\"}")"
webhook_id="$(printf '%s' "$webhook" | ynx_json_field '["eventId"]')"
printf '%s' "$webhook" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.signature || d.algorithm !== "hmac-sha256" || !d.replaySafe || !d.payloadHash) throw new Error(`bad webhook: ${JSON.stringify(d)}`);'
curl -fsS "$pay_url/pay/webhook-signatures/$webhook_id" "${auth[@]}" >/dev/null
status="$(curl -s -o "$YNX_VERIFY_WORK/pay-client-signing-key.json" -w '%{http_code}' -X POST "$pay_url/pay/webhook-signatures" "${auth[@]}" -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"eventType\":\"payment_intent.created\",\"idempotencyKey\":\"pay-check-client-key\",\"signingKey\":\"client-secret\"}")"
[[ "$status" == "400" ]] || { echo "expected client signing key to be rejected, got $status"; exit 1; }

refund="$(curl -fsS -X POST "$pay_url/pay/refunds" "${auth[@]}" -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"amount\":5,\"reason\":\"pay check\",\"idempotencyKey\":\"pay-check-refund\"}")"
refund_id="$(printf '%s' "$refund" | ynx_json_field '["id"]')"
[[ -n "$refund_id" ]]
events="$(curl -fsS "$pay_url/pay/events?intentId=$intent_id" "${auth[@]}")"
printf '%s' "$events" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(d.events) || d.events.length < 4 || d.events.some((e)=>!e.auditHash)) throw new Error(`bad Pay events: ${JSON.stringify(d)}`);'

metrics="$(curl -fsS "$pay_url/metrics")"
grep -Fq "ynx_pay_gateway_requests_total" <<<"$metrics"
grep -Fq 'native_symbol="YNXT"' <<<"$metrics"
test -s "$audit_log"
grep -Fq '"outcome":"unauthorized"' "$audit_log"
grep -Fq '"outcome":"accepted"' "$audit_log"
grep -Fq '"outcome":"proxied"' "$audit_log"
! grep -Fq "$api_key" "$audit_log"
! grep -Fq "$upstream_key" "$audit_log"
! grep -Fq "$webhook_key" "$audit_log"
! grep -Fq "client-secret" "$audit_log"
! grep -Fq "merchant.example/callback" "$audit_log"

echo "pay-api-check passed: standalone merchant auth, chain bypass protection, idempotency, managed webhook signing, persistent Pay events, metrics, and redacted audit"
