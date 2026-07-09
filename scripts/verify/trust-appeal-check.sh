#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

request=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d '{"requester":"appeal_check","subject":"ynx_appeal_subject","action":"risk label review","assetType":"stablecoin","scope":"single transfer","description":"review with evidence","evidence":["case:appeal","tx:0xdef"]}')
request_id=$(printf '%s' "$request" | ynx_json_field '["id"]')
missing_status=$(curl -sS -o /tmp/ynx-missing-appeal-response.json -w '%{http_code}' -X POST "$YNX_REST_URL/trust/appeals" -H 'content-type: application/json' -d '{"requestId":"missing_request","subject":"ynx_appeal_subject","appellant":"ynx_appeal_subject","reason":"missing request should not open an appeal"}')
[[ "$missing_status" == "400" ]] || { echo "expected missing request appeal to return 400, got $missing_status"; cat /tmp/ynx-missing-appeal-response.json; exit 1; }
appeal=$(curl -fsS -X POST "$YNX_REST_URL/trust/appeals" -H 'content-type: application/json' -d "{\"requestId\":\"$request_id\",\"subject\":\"ynx_appeal_subject\",\"appellant\":\"ynx_appeal_subject\",\"reason\":\"false positive correction\",\"evidence\":[\"owner proof\"]}")
appeal_id=$(printf '%s' "$appeal" | ynx_json_field '["id"]')
status=$(printf '%s' "$appeal" | ynx_json_field '["status"]')
[[ "$status" == "SUBMITTED" ]] || { echo "expected SUBMITTED appeal, got $status"; exit 1; }
printf '%s' "$appeal" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.transparencyEntryId) { console.error(`expected appeal transparency entry id, got ${JSON.stringify(data)}`); process.exit(1); }'
appeal_read=$(curl -fsS "$YNX_REST_URL/trust/appeals/$appeal_id")
printf '%s' "$appeal_read" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.status !== "SUBMITTED" || !data.transparencyEntryId) { console.error(`expected readable appeal with transparency id, got ${JSON.stringify(data)}`); process.exit(1); }'
resolved=$(curl -fsS -X POST "$YNX_REST_URL/trust/appeals/$appeal_id/resolve" -H 'content-type: application/json' -d '{"reviewer":"appeal_reviewer","decision":"LABEL_REMOVED","resolutionReason":"evidence proved false positive"}')
resolved_status=$(printf '%s' "$resolved" | ynx_json_field '["status"]')
reviewer=$(printf '%s' "$resolved" | ynx_json_field '["reviewer"]')
[[ "$resolved_status" == "LABEL_REMOVED" ]] || { echo "expected LABEL_REMOVED appeal, got $resolved_status"; exit 1; }
[[ "$reviewer" == "appeal_reviewer" ]] || { echo "expected appeal reviewer"; exit 1; }
evidence=$(curl -fsS -X POST "$YNX_REST_URL/trust/evidence" -H 'content-type: application/json' -d '{"subject":"ynx_appeal_subject"}')
printf '%s' "$evidence" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const summary=data.riskSummary; if (!summary || summary.correctionLabelCount < 1 || summary.assetEffect !== "none_advisory_only" || summary.appealPath !== "/trust/appeals" || !summary.reviewerNotes?.some((note)=>note.includes("Appeal correction"))) { console.error(`expected appeal correction in Trust evidence summary, got ${JSON.stringify(summary)}`); process.exit(1); }'
report=$(curl -fsS "$YNX_REST_URL/governance/transparency")
appeals=$(printf '%s' "$report" | ynx_json_field '["appealCount"]')
[[ "$appeals" -ge 1 ]] || { echo "expected appealCount >= 1"; exit 1; }
entries=$(printf '%s' "$report" | ynx_json_field '["entryCount"]')
[[ "$entries" -ge 3 ]] || { echo "expected transparency entries for appeal resolution"; exit 1; }
echo "trust-appeal-check passed: appeal resolved with false-positive correction, Trust evidence summary, and transparency entries"
