#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d '{"requester":"transparency_check","subject":"ynx_transparency_subject","action":"hide request records","assetType":"YNXT","scope":"ynx_transparency_subject","description":"delete audit logs and hide request records"}' >/dev/null
report=$(curl -fsS "$YNX_REST_URL/governance/transparency")
entries=$(printf '%s' "$report" | ynx_json_field '["entryCount"]')
rejected=$(printf '%s' "$report" | ynx_json_field '["rejectedCount"]')
truth=$(printf '%s' "$report" | ynx_json_field '["truthfulStatus"]')
[[ "$entries" -ge 1 ]] || { echo "expected transparency entries"; exit 1; }
[[ "$rejected" -ge 1 ]] || { echo "expected rejected transparency entries"; exit 1; }
[[ "$truth" == "ynx-testnet-node" ]] || { echo "expected ynx-testnet-node truthful status, got $truth"; exit 1; }
echo "transparency-report-check passed: rejected request appears in transparency report"
