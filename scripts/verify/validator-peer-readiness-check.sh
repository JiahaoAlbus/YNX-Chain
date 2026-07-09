#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
export YNX_VALIDATOR_SET="ynx_val_primary|primary|127.0.0.1|primary validator|peer-primary;ynx_val_secondary|secondary|127.0.0.2|bonded validator|peer-secondary"
export YNX_BOOTSTRAP_PEERS="ynx_val_primary|peer-primary|127.0.0.1|127.0.0.1:26656|primary validator;ynx_val_secondary|peer-secondary|127.0.0.2|127.0.0.2:26656|bonded validator"
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

validators="$(curl -fsS "$YNX_REST_URL/validators")"
validator_address="$(printf '%s' "$validators" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const validator=data.validators?.[0]; if (!validator?.address) { console.error(`missing validator address: ${JSON.stringify(data)}`); process.exit(1); } console.log(validator.address);')"

heartbeat="$(curl -fsS -X POST "$YNX_REST_URL/validators/$validator_address/heartbeat" -H 'content-type: application/json' -d '{"peerId":"local-peer-readiness-check","host":"127.0.0.1:26656","ready":true,"status":"reachable","latestHeight":3,"evidence":"validator-peer-readiness-check"}')"
printf '%s' "$heartbeat" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.peerReady || data.peerStatus !== "reachable" || data.latestHeight < 3 || data.peerId !== "local-peer-readiness-check" || data.peerEvidence !== "validator-peer-readiness-check" || !data.lastSeenAt || !data.updatedAt) { console.error(`unexpected heartbeat response: ${JSON.stringify(data)}`); process.exit(1); }'

validators_after="$(curl -fsS "$YNX_REST_URL/validators")"
printf '%s' "$validators_after" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const found=data.validators?.find((validator)=>validator.peerId==="local-peer-readiness-check"); if (!found?.peerReady || found.peerStatus !== "reachable" || found.latestHeight < 3) { console.error(`validator readiness not exposed: ${JSON.stringify(data)}`); process.exit(1); }'

peers="$(curl -fsS "$YNX_REST_URL/validators/peers")"
printf '%s' "$peers" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const found=data.peers?.find((peer)=>peer.address); if (!found?.expected || !found.p2pAddress?.endsWith(":26656")) { console.error(`validator peer bootstrap state not exposed: ${JSON.stringify(data)}`); process.exit(1); }'

observed="$(curl -fsS -X POST "$YNX_REST_URL/validators/$validator_address/peers/observe" -H 'content-type: application/json' -d '{"peerId":"local-peer-observe-check","host":"127.0.0.1","p2pAddress":"127.0.0.1:26656","status":"reachable","latestHeight":4,"evidence":"validator-peer-observe-check"}')"
printf '%s' "$observed" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.expected || !data.observed || data.peerId !== "local-peer-observe-check" || data.p2pAddress !== "127.0.0.1:26656" || data.latestHeight < 4 || data.evidence !== "validator-peer-observe-check") { console.error(`unexpected observed peer response: ${JSON.stringify(data)}`); process.exit(1); }'

sync="$(curl -fsS -X POST "$YNX_REST_URL/validators/ynx_val_primary/peer-sync" -H 'content-type: application/json' -d '{"target":"ynx_val_secondary","sourceHeight":4,"targetHeight":3,"evidence":"validator-peer-sync-check"}')"
printf '%s' "$sync" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.source !== "ynx_val_primary" || data.target !== "ynx_val_secondary" || data.status !== "synced" || data.lagBlocks !== 1 || data.evidence !== "validator-peer-sync-check") { console.error(`unexpected sync response: ${JSON.stringify(data)}`); process.exit(1); }'

syncs="$(curl -fsS "$YNX_REST_URL/validators/peer-sync")"
printf '%s' "$syncs" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.syncs?.some((sync)=>sync.source==="ynx_val_primary" && sync.target==="ynx_val_secondary" && sync.status==="synced")) { console.error(`peer sync state not exposed: ${JSON.stringify(data)}`); process.exit(1); }'

status="$(curl -fsS "$YNX_REST_URL/status")"
printf '%s' "$status" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.readyValidatorCount < 1 || data.validatorPeerReadiness?.ready < 1 || data.validatorPeerReadiness?.total < 2 || data.validatorPeerDiscovery?.expected < 2 || data.validatorPeerDiscovery?.observed < 1 || data.validatorPeerSync?.synced < 1 || data.validatorPeerSync?.total < 1) { console.error(`validator readiness/discovery/sync summary missing: ${JSON.stringify(data)}`); process.exit(1); }'

echo "validator-peer-readiness-check passed: validator=$validator_address"
