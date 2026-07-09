#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

validators="$(curl -fsS "$YNX_REST_URL/validators")"
validator_address="$(printf '%s' "$validators" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const validator=data.validators?.[0]; if (!validator?.address) { console.error(`missing validator address: ${JSON.stringify(data)}`); process.exit(1); } console.log(validator.address);')"

heartbeat="$(curl -fsS -X POST "$YNX_REST_URL/validators/$validator_address/heartbeat" -H 'content-type: application/json' -d '{"peerId":"local-peer-readiness-check","host":"127.0.0.1:26656","ready":true,"status":"reachable","latestHeight":3,"evidence":"validator-peer-readiness-check"}')"
printf '%s' "$heartbeat" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.peerReady || data.peerStatus !== "reachable" || data.latestHeight < 3 || data.peerId !== "local-peer-readiness-check" || data.peerEvidence !== "validator-peer-readiness-check" || !data.lastSeenAt || !data.updatedAt) { console.error(`unexpected heartbeat response: ${JSON.stringify(data)}`); process.exit(1); }'

validators_after="$(curl -fsS "$YNX_REST_URL/validators")"
printf '%s' "$validators_after" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const found=data.validators?.find((validator)=>validator.peerId==="local-peer-readiness-check"); if (!found?.peerReady || found.peerStatus !== "reachable" || found.latestHeight < 3) { console.error(`validator readiness not exposed: ${JSON.stringify(data)}`); process.exit(1); }'

status="$(curl -fsS "$YNX_REST_URL/status")"
printf '%s' "$status" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.readyValidatorCount < 1 || data.validatorPeerReadiness?.ready < 1 || data.validatorPeerReadiness?.total < 1) { console.error(`validator readiness summary missing: ${JSON.stringify(data)}`); process.exit(1); }'

echo "validator-peer-readiness-check passed: validator=$validator_address"
