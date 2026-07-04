#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

valid='{"requester":"merchant_validity_check","subject":"ynx_valid_subject","action":"risk label review","assetType":"stablecoin","scope":"single transfer","description":"review one scoped transfer with evidence","evidence":["case:validity","tx:0xabc"]}'
valid_response=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$valid")
classification=$(printf '%s' "$valid_response" | ynx_json_field '["classification"]')
[[ "$classification" == "REQUIRES_GOVERNANCE_REVIEW" ]] || { echo "expected REQUIRES_GOVERNANCE_REVIEW, got $classification"; exit 1; }

overbroad='{"requester":"merchant_validity_check","subject":"ynx_valid_subject","action":"trace all wallets","assetType":"stablecoin","scope":"all wallets","description":"bulk trace everyone","evidence":["case:validity"]}'
overbroad_response=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$overbroad")
overbroad_class=$(printf '%s' "$overbroad_response" | ynx_json_field '["classification"]')
[[ "$overbroad_class" == "OVERBROAD" ]] || { echo "expected OVERBROAD, got $overbroad_class"; exit 1; }

missing='{"requester":"merchant_validity_check","subject":"ynx_valid_subject","action":"risk label review","assetType":"stablecoin","scope":"single transfer","description":"review without evidence"}'
missing_response=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$missing")
missing_class=$(printf '%s' "$missing_response" | ynx_json_field '["classification"]')
[[ "$missing_class" == "INSUFFICIENT_EVIDENCE" ]] || { echo "expected INSUFFICIENT_EVIDENCE, got $missing_class"; exit 1; }
echo "request-validity-check passed: review, overbroad, and evidence classifications work"
