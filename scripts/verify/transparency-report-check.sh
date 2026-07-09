#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d '{"requester":"transparency_check","subject":"ynx_transparency_subject","action":"hide request records","assetType":"YNXT","scope":"ynx_transparency_subject","description":"delete audit logs and hide request records"}' >/dev/null
manual=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d '{"requester":"transparency_check","subject":"ynx_transparency_subject","action":"metadata correction","assetType":"evidence","scope":"single evidence packet","description":"correct one evidence packet with case evidence","evidence":["case:transparency"]}')
manual_id=$(printf '%s' "$manual" | ynx_json_field '["id"]')
rejected=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests/$manual_id/reject" -H 'content-type: application/json' -d '{"reason":"manual transparency check rejection"}')
printf '%s' "$rejected" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.classification !== "REJECTED" || data.status !== "rejected" || !data.rejectedAt || !data.reasons?.includes("manual transparency check rejection")) { console.error(`expected manual rejection, got ${JSON.stringify(data)}`); process.exit(1); }'
report=$(curl -fsS "$YNX_REST_URL/governance/transparency")
entries=$(printf '%s' "$report" | ynx_json_field '["entryCount"]')
rejected=$(printf '%s' "$report" | ynx_json_field '["rejectedCount"]')
truth=$(printf '%s' "$report" | ynx_json_field '["truthfulStatus"]')
[[ "$entries" -ge 1 ]] || { echo "expected transparency entries"; exit 1; }
[[ "$rejected" -ge 1 ]] || { echo "expected rejected transparency entries"; exit 1; }
[[ "$truth" == "ynx-testnet-node" ]] || { echo "expected ynx-testnet-node truthful status, got $truth"; exit 1; }
printf '%s' "$report" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.entries?.some((entry)=>entry.type === "governance_rejection" && entry.status === "rejected" && entry.reasons?.includes("manual transparency check rejection"))) { console.error(`expected governance_rejection transparency entry, got ${JSON.stringify(data.entries)}`); process.exit(1); }'
echo "transparency-report-check passed: rejected request appears in transparency report"
