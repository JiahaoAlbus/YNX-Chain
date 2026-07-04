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
report=$(curl -fsS "$YNX_REST_URL/governance/transparency")
rejected=$(printf '%s' "$report" | ynx_json_field '["rejectedCount"]')
[[ "$rejected" -ge 1 ]] || { echo "expected transparency rejectedCount >= 1"; exit 1; }
echo "anti-illegal-request-check passed: illegal native YNXT request rejected and logged"
