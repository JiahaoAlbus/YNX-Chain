#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

request=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d '{"requester":"appeal_check","subject":"ynx_appeal_subject","action":"risk label review","assetType":"stablecoin","scope":"single transfer","description":"review with evidence","evidence":["case:appeal","tx:0xdef"]}')
request_id=$(printf '%s' "$request" | ynx_json_field '["id"]')
appeal=$(curl -fsS -X POST "$YNX_REST_URL/trust/appeals" -H 'content-type: application/json' -d "{\"requestId\":\"$request_id\",\"subject\":\"ynx_appeal_subject\",\"appellant\":\"ynx_appeal_subject\",\"reason\":\"false positive correction\",\"evidence\":[\"owner proof\"]}")
appeal_id=$(printf '%s' "$appeal" | ynx_json_field '["id"]')
status=$(printf '%s' "$appeal" | ynx_json_field '["status"]')
[[ "$status" == "open" ]] || { echo "expected open appeal, got $status"; exit 1; }
curl -fsS "$YNX_REST_URL/trust/appeals/$appeal_id" >/dev/null
report=$(curl -fsS "$YNX_REST_URL/governance/transparency")
appeals=$(printf '%s' "$report" | ynx_json_field '["appealCount"]')
[[ "$appeals" -ge 1 ]] || { echo "expected appealCount >= 1"; exit 1; }
echo "trust-appeal-check passed: appeal persisted and transparency report counted it"
