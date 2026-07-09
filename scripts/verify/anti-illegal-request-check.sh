#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

body='{"requester":"agency_illegal_check","subject":"ynx_check_subject","action":"ask for private keys and freeze native YNXT","assetType":"YNXT","scope":"ynx_check_subject","description":"bypass user signatures, delete audit logs, and directly transfer user native YNXT"}'
response=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$body")
classification=$(printf '%s' "$response" | ynx_json_field '["classification"]')
status=$(printf '%s' "$response" | ynx_json_field '["status"]')
protected=$(printf '%s' "$response" | ynx_json_field '["nativeYnxtProtected"]')
[[ "$classification" == "ILLEGAL_OR_ABUSIVE" ]] || { echo "expected ILLEGAL_OR_ABUSIVE, got $classification"; exit 1; }
[[ "$status" == "rejected" ]] || { echo "expected rejected, got $status"; exit 1; }
[[ "$protected" == "true" ]] || { echo "expected native YNXT protection"; exit 1; }
check_illegal_rule() {
  local payload="$1"
  local expected_rule="$2"
  local label="$3"
  local item
  item=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$payload")
  printf '%s' "$item" | EXPECTED_RULE="$expected_rule" LABEL="$label" node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.classification !== "ILLEGAL_OR_ABUSIVE" || data.status !== "rejected" || !data.ruleIds?.includes(process.env.EXPECTED_RULE)) { console.error(`expected ${process.env.LABEL} to reject with ${process.env.EXPECTED_RULE}, got ${JSON.stringify(data)}`); process.exit(1); }'
}

printf '%s' "$response" | EXPECTED_RULE="protect-private-secrets" LABEL="private secret request" node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.ruleIds?.includes(process.env.EXPECTED_RULE)) { console.error(`missing ${process.env.EXPECTED_RULE} rule id for ${process.env.LABEL}`); process.exit(1); }'
check_illegal_rule '{"requester":"agency_illegal_check","subject":"ynx_check_subject","action":"bypass user signatures","assetType":"token","scope":"single transfer","description":"skip signature checks"}' "no-signature-bypass" "signature bypass"
check_illegal_rule '{"requester":"agency_illegal_check","subject":"ynx_check_subject","action":"hide request records","assetType":"evidence","scope":"single case","description":"delete audit logs and hide request records"}' "preserve-audit-transparency" "hidden records"
check_illegal_rule '{"requester":"agency_illegal_check","subject":"ynx_check_subject","action":"create fake risk label","assetType":"risk_label","scope":"single address","description":"fabricate risk label"}' "no-evidence-free-risk" "fake risk label"
check_illegal_rule '{"requester":"agency_illegal_check","subject":"ynx_check_subject","action":"ask AI to automatically punish users","assetType":"trust_label","scope":"single address","description":"AI automatically punish the user"}' "no-ai-punishment" "AI punishment"
native_body='{"requester":"agency_illegal_check","subject":"ynx_check_subject","action":"freeze native YNXT","assetType":"YNXT","scope":"ynx_check_subject","description":"directly freeze user native YNXT by protocol request","evidence":["case:native"]}'
native_response=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$native_body")
printf '%s' "$native_response" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.classification !== "ILLEGAL_OR_ABUSIVE" || !data.ruleIds?.includes("native-ynxt-no-direct-freeze")) { console.error(`expected native YNXT freeze rejection with rule id, got ${JSON.stringify(data)}`); process.exit(1); }'
report=$(curl -fsS "$YNX_REST_URL/governance/transparency")
rejected=$(printf '%s' "$report" | ynx_json_field '["rejectedCount"]')
[[ "$rejected" -ge 1 ]] || { echo "expected transparency rejectedCount >= 1"; exit 1; }
echo "anti-illegal-request-check passed: illegal requests rejected, rule IDs logged, and native YNXT protected"
