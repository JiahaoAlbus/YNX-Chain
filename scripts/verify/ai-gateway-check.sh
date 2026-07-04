#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

curl -fsS "$YNX_REST_URL/ai/stream?session=ai_check_a&q=status" >"$YNX_VERIFY_WORK/ai-stream.txt"
grep -q "session ai_check_a" "$YNX_VERIFY_WORK/ai-stream.txt"

action="$(curl -fsS -X POST "$YNX_REST_URL/ai/actions" -H 'content-type: application/json' -d '{"sessionId":"ai-check-session","requester":"ai-checker","scope":"sensitive_data","actionType":"export evidence","description":"Export protected case file evidence"}')"
action_id="$(printf '%s' "$action" | ynx_json_field '["id"]')"
printf '%s' "$action" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.sensitive || !data.requiresApproval || data.executable || !data.auditHash || !data.transparencyEntryId) { console.error(`sensitive AI action gate failed: ${JSON.stringify(data)}`); process.exit(1); }'

status="$(curl -s -o "$YNX_VERIFY_WORK/ai-approval-denied.json" -w '%{http_code}' -X POST "$YNX_REST_URL/ai/actions/$action_id/approve" -H 'content-type: application/json' -d '{"approver":"ai-reviewer","permissionId":"missing"}')"
[[ "$status" == "400" ]] || { echo "expected missing permission approval to fail, got $status"; cat "$YNX_VERIFY_WORK/ai-approval-denied.json"; exit 1; }

permission="$(curl -fsS -X POST "$YNX_REST_URL/ai/permissions" -H 'content-type: application/json' -d '{"sessionId":"ai-check-session","requester":"ai-checker","scope":"sensitive_data","purpose":"approve protected evidence export","expiryHours":2}')"
permission_id="$(printf '%s' "$permission" | ynx_json_field '["id"]')"
printf '%s' "$permission" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.status !== "active" || !data.auditHash) { console.error(`AI permission audit failed: ${JSON.stringify(data)}`); process.exit(1); }'

approved="$(curl -fsS -X POST "$YNX_REST_URL/ai/actions/$action_id/approve" -H 'content-type: application/json' -d "{\"approver\":\"ai-reviewer\",\"permissionId\":\"$permission_id\"}")"
printf '%s' "$approved" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.status !== "approved" || data.executable !== true || data.permissionId === "") { console.error(`AI approval failed: ${JSON.stringify(data)}`); process.exit(1); }'

report="$(curl -fsS "$YNX_REST_URL/governance/transparency")"
printf '%s' "$report" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(data.entries) || !data.entries.some((entry)=>entry.type === "ai_action_approval")) { console.error(`missing AI transparency entry: ${JSON.stringify(data)}`); process.exit(1); }'

echo "ai-gateway-check passed: action=$action_id permission=$permission_id"
