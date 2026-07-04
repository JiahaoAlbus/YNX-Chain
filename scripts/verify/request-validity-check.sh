#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

rules=$(curl -fsS "$YNX_REST_URL/governance/request-validity-rules")
printf '%s' "$rules" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const ids=new Set(data.rules.map((rule)=>rule.id)); for (const id of ["governance-review-user-rights","targeted-scope-required","evidence-required","native-ynxt-no-direct-freeze"]) { if (!ids.has(id)) { console.error(`missing request validity rule ${id}`); process.exit(1); } }'

valid='{"requester":"merchant_validity_check","subject":"ynx_valid_subject","action":"risk label review","assetType":"stablecoin","scope":"single transfer","description":"review one scoped transfer with evidence","evidence":["case:validity","tx:0xabc"]}'
valid_response=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$valid")
classification=$(printf '%s' "$valid_response" | ynx_json_field '["classification"]')
[[ "$classification" == "REQUIRES_GOVERNANCE_REVIEW" ]] || { echo "expected REQUIRES_GOVERNANCE_REVIEW, got $classification"; exit 1; }
printf '%s' "$valid_response" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.ruleIds?.includes("governance-review-user-rights")) { console.error("missing governance-review-user-rights rule id"); process.exit(1); }'

overbroad='{"requester":"merchant_validity_check","subject":"ynx_valid_subject","action":"trace all wallets","assetType":"stablecoin","scope":"all wallets","description":"bulk trace everyone","evidence":["case:validity"]}'
overbroad_response=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$overbroad")
overbroad_class=$(printf '%s' "$overbroad_response" | ynx_json_field '["classification"]')
[[ "$overbroad_class" == "OVERBROAD" ]] || { echo "expected OVERBROAD, got $overbroad_class"; exit 1; }
printf '%s' "$overbroad_response" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.ruleIds?.includes("targeted-scope-required")) { console.error("missing targeted-scope-required rule id"); process.exit(1); }'

missing='{"requester":"merchant_validity_check","subject":"ynx_valid_subject","action":"risk label review","assetType":"stablecoin","scope":"single transfer","description":"review without evidence"}'
missing_response=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$missing")
missing_class=$(printf '%s' "$missing_response" | ynx_json_field '["classification"]')
[[ "$missing_class" == "INSUFFICIENT_EVIDENCE" ]] || { echo "expected INSUFFICIENT_EVIDENCE, got $missing_class"; exit 1; }
printf '%s' "$missing_response" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.ruleIds?.includes("evidence-required")) { console.error("missing evidence-required rule id"); process.exit(1); }'

label='{"subject":"ynx_valid_subject","label":"scoped-review","labelType":"risk","riskWeightBps":250,"confidenceBps":8200,"source":"request-validity-check","evidenceHash":"sha256:request-validity-check","expiryHours":24,"reviewRequired":true}'
label_response=$(curl -fsS -X POST "$YNX_REST_URL/trust/labels" -H 'content-type: application/json' -d "$label")
printf '%s' "$label_response" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); for (const [key, value] of Object.entries({source:"request-validity-check", evidenceHash:"sha256:request-validity-check", assetEffect:"none_advisory_only"})) { if (data[key] !== value) { console.error(`expected ${key}=${value}, got ${data[key]}`); process.exit(1); } } if (!data.labelId || !data.appealAvailable || !data.expiresAt) { console.error("missing label id, appealability, or expiry metadata"); process.exit(1); }'

echo "request-validity-check passed: registry, rule IDs, and Trust label metadata work"
