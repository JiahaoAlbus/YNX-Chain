#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
upstream_key="local-ai-gateway-upstream-key"
export YNX_AI_GATEWAY_UPSTREAM_KEY="$upstream_key"
ynx_start_local_testnet
provider_pid=""
gateway_pid=""
cleanup() {
  [[ -n "$gateway_pid" ]] && ynx_kill_tree "$gateway_pid"
  [[ -n "$provider_pid" ]] && ynx_kill_tree "$provider_pid"
  ynx_stop_local_testnet
}
trap cleanup EXIT

gateway_url="http://127.0.0.1:6429"
access_key="local-ai-gateway-access-key"
provider_key="local-provider-key"
audit_log="$YNX_VERIFY_WORK/ai-gateway-audit.jsonl"

YNX_FAKE_AI_PROVIDER_PORT=6430 YNX_FAKE_AI_PROVIDER_KEY="$provider_key" \
  node scripts/verify/fixtures/fake-ai-provider.mjs >"$YNX_VERIFY_WORK/ai-provider.log" 2>&1 &
provider_pid=$!

YNX_AI_GATEWAY_CHAIN_URL="$YNX_REST_URL" \
YNX_AI_GATEWAY_HTTP_ADDR=127.0.0.1:6429 \
YNX_AI_PROVIDER_URL=http://127.0.0.1:6430 \
OPENAI_API_KEY="$provider_key" \
AI_MODEL_NAME=ynx-local-provider-check \
YNX_AI_GATEWAY_API_KEY="$access_key" \
YNX_AI_GATEWAY_UPSTREAM_KEY="$upstream_key" \
YNX_AI_GATEWAY_AUDIT_LOG="$audit_log" \
YNX_AI_GATEWAY_RATE_LIMIT_WINDOW=1m \
YNX_AI_GATEWAY_RATE_LIMIT_MAX=20 \
  go run ./cmd/ynx-ai-gatewayd >"$YNX_VERIFY_WORK/ai-gateway.log" 2>&1 &
gateway_pid=$!

for _ in {1..80}; do
  curl -fsS "$gateway_url/health" >/dev/null 2>&1 && break
  sleep 0.25
done
health="$(curl -fsS "$gateway_url/health")" || { echo "AI Gateway did not become healthy"; sed -n '1,160p' "$YNX_VERIFY_WORK/ai-gateway.log"; exit 1; }
printf '%s' "$health" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.ok || d.service !== "ynx-ai-gatewayd" || d.chainId !== 6423 || d.nativeSymbol !== "YNXT" || !d.upstreamOk || !d.providerConfigured || d.truthfulStatus !== "chain-context-and-provider-backed-ai-gateway") throw new Error(`bad AI Gateway health: ${JSON.stringify(d)}`);'

status="$(curl -s -o "$YNX_VERIFY_WORK/ai-direct-bypass.json" -w '%{http_code}' -X POST "$YNX_REST_URL/ai/actions" -H 'content-type: application/json' -d '{"sessionId":"bypass","requester":"bypass","scope":"status_read","actionType":"summarize","description":"bypass gateway"}')"
[[ "$status" == "401" ]] || { echo "expected direct chain AI route bypass to return 401, got $status"; cat "$YNX_VERIFY_WORK/ai-direct-bypass.json"; exit 1; }

status="$(curl -s -o "$YNX_VERIFY_WORK/ai-unauthorized.json" -w '%{http_code}' "$gateway_url/ai/stream?session=unauthorized&q=status")"
[[ "$status" == "401" ]] || { echo "expected unauthorized AI stream to return 401, got $status"; exit 1; }

curl -fsS "$gateway_url/ai/stream?session=ai_check_a&q=alpha-session-query" -H "X-YNX-AI-Key: $access_key" >"$YNX_VERIFY_WORK/ai-stream-a.txt" &
stream_a_pid=$!
curl -fsS "$gateway_url/ai/stream?session=ai_check_b&q=beta-session-query" -H "Authorization: Bearer $access_key" >"$YNX_VERIFY_WORK/ai-stream-b.txt" &
stream_b_pid=$!
wait "$stream_a_pid" "$stream_b_pid"
grep -Fq '"sessionId":"ai_check_a"' "$YNX_VERIFY_WORK/ai-stream-a.txt"
grep -Fq "alpha-session-query" "$YNX_VERIFY_WORK/ai-stream-a.txt"
! grep -Fq "beta-session-query" "$YNX_VERIFY_WORK/ai-stream-a.txt"
grep -Fq '"sessionId":"ai_check_b"' "$YNX_VERIFY_WORK/ai-stream-b.txt"
grep -Fq "beta-session-query" "$YNX_VERIFY_WORK/ai-stream-b.txt"
! grep -Fq "alpha-session-query" "$YNX_VERIFY_WORK/ai-stream-b.txt"
grep -Fq "event: done" "$YNX_VERIFY_WORK/ai-stream-a.txt"
grep -Fq "event: done" "$YNX_VERIFY_WORK/ai-stream-b.txt"

auth=(-H "X-YNX-AI-Key: $access_key")
action="$(curl -fsS -X POST "$gateway_url/ai/actions" "${auth[@]}" -H 'content-type: application/json' -d '{"sessionId":"ai-check-session","requester":"ai-checker","scope":"sensitive_data","actionType":"export evidence","description":"Export protected case file evidence"}')"
action_id="$(printf '%s' "$action" | ynx_json_field '["id"]')"
printf '%s' "$action" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.sensitive || !data.requiresApproval || data.executable || !data.auditHash || !data.transparencyEntryId) { console.error(`sensitive AI action gate failed: ${JSON.stringify(data)}`); process.exit(1); }'

status="$(curl -s -o "$YNX_VERIFY_WORK/ai-approval-denied.json" -w '%{http_code}' -X POST "$gateway_url/ai/actions/$action_id/approve" "${auth[@]}" -H 'content-type: application/json' -d '{"approver":"ai-reviewer","permissionId":"missing"}')"
[[ "$status" == "400" ]] || { echo "expected missing permission approval to fail, got $status"; cat "$YNX_VERIFY_WORK/ai-approval-denied.json"; exit 1; }

permission="$(curl -fsS -X POST "$gateway_url/ai/permissions" "${auth[@]}" -H 'content-type: application/json' -d '{"sessionId":"ai-check-session","requester":"ai-checker","scope":"sensitive_data","purpose":"approve protected evidence export","expiryHours":2}')"
permission_id="$(printf '%s' "$permission" | ynx_json_field '["id"]')"
printf '%s' "$permission" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.status !== "active" || !data.auditHash) { console.error(`AI permission audit failed: ${JSON.stringify(data)}`); process.exit(1); }'

approved="$(curl -fsS -X POST "$gateway_url/ai/actions/$action_id/approve" "${auth[@]}" -H 'content-type: application/json' -d "{\"approver\":\"ai-reviewer\",\"permissionId\":\"$permission_id\"}")"
printf '%s' "$approved" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.status !== "approved" || data.executable !== true || !data.permissionId || !data.auditHash) { console.error(`AI approval gate failed: ${JSON.stringify(data)}`); process.exit(1); }'

curl -fsS "$gateway_url/ai/permissions/$permission_id" "${auth[@]}" >/dev/null
curl -fsS "$gateway_url/ai/actions/$action_id" "${auth[@]}" >/dev/null
actions="$(curl -fsS "$gateway_url/ai/actions?sessionId=ai-check-session" "${auth[@]}")"
printf '%s' "$actions" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(data.actions) || data.actions.length !== 1 || data.actions[0].status !== "approved") { console.error(`AI action list audit failed: ${JSON.stringify(data)}`); process.exit(1); }'

metrics="$(curl -fsS "$gateway_url/metrics")"
grep -Fq "ynx_ai_gateway_requests_total" <<<"$metrics"
grep -Fq 'native_symbol="YNXT"' <<<"$metrics"
test -s "$audit_log"
grep -Fq '"outcome":"unauthorized"' "$audit_log"
grep -Fq '"outcome":"streamed"' "$audit_log"
grep -Fq '"path":"/ai/actions"' "$audit_log"
! grep -Fq "alpha-session-query" "$audit_log"
! grep -Fq "beta-session-query" "$audit_log"
! grep -Fq "$access_key" "$audit_log"
! grep -Fq "$provider_key" "$audit_log"

echo "ai-gateway-check passed: standalone gateway health/auth/rate-limit boundary, concurrent provider-backed session streams, chain-backed permission/action audit, metrics, and redacted JSONL audit"
