#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

valid='{"requester":"tracking_check","subject":"ynx_tracking_subject","purpose":"single transaction screening","queryType":"trace","scope":"single transfer","description":"purpose limited transaction review","evidence":["case:tracking","tx:0xabc"],"minimumNecessary":true,"confidenceBps":7600,"expiryHours":24}'
valid_response=$(curl -fsS -X POST "$YNX_REST_URL/trust/tracking-reviews" -H 'content-type: application/json' -d "$valid")
valid_class=$(printf '%s' "$valid_response" | ynx_json_field '["classification"]')
appeal_path=$(printf '%s' "$valid_response" | ynx_json_field '["appealPath"]')
[[ "$valid_class" == "VALID_UNDER_YNX_CHAIN_LAW" ]] || { echo "expected VALID_UNDER_YNX_CHAIN_LAW, got $valid_class"; exit 1; }
[[ "$appeal_path" == "/trust/appeals" ]] || { echo "expected appeal path"; exit 1; }

overbroad='{"requester":"tracking_check","subject":"ynx_tracking_subject","purpose":"bulk profile all wallets","queryType":"batch","scope":"all wallets","description":"mass tracking and bulk profiling","evidence":["case:tracking"],"minimumNecessary":false}'
overbroad_response=$(curl -fsS -X POST "$YNX_REST_URL/trust/tracking-reviews" -H 'content-type: application/json' -d "$overbroad")
overbroad_class=$(printf '%s' "$overbroad_response" | ynx_json_field '["classification"]')
overbroad_status=$(printf '%s' "$overbroad_response" | ynx_json_field '["status"]')
[[ "$overbroad_class" == "OVERBROAD" ]] || { echo "expected OVERBROAD, got $overbroad_class"; exit 1; }
[[ "$overbroad_status" == "rejected" ]] || { echo "expected rejected, got $overbroad_status"; exit 1; }

abusive='{"requester":"tracking_check","subject":"ynx_tracking_subject","purpose":"declare guilt from low confidence taint","queryType":"risk-list","scope":"single transfer","description":"convict ordinary receiver and permanently taint them","evidence":["case:tracking"],"minimumNecessary":true,"confidenceBps":1200}'
abusive_response=$(curl -fsS -X POST "$YNX_REST_URL/trust/tracking-reviews" -H 'content-type: application/json' -d "$abusive")
abusive_class=$(printf '%s' "$abusive_response" | ynx_json_field '["classification"]')
[[ "$abusive_class" == "ILLEGAL_OR_ABUSIVE" ]] || { echo "expected ILLEGAL_OR_ABUSIVE, got $abusive_class"; exit 1; }

report=$(curl -fsS "$YNX_REST_URL/governance/transparency")
rejected=$(printf '%s' "$report" | ynx_json_field '["rejectedCount"]')
[[ "$rejected" -ge 2 ]] || { echo "expected rejected tracking entries in transparency report"; exit 1; }
echo "anti-unreasonable-tracking-check passed: purpose-limited tracking allowed, overbroad/abusive tracking rejected"
