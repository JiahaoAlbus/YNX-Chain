#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
export YNX_REST_URL="${YNX_REST_URL:-http://127.0.0.1:6460}"
export YNX_VALIDATOR_SET="ynx_val_primary|primary|127.0.0.1|primary validator|peer-primary;ynx_val_secondary|secondary|127.0.0.2|bonded validator|peer-secondary"
export YNX_BOOTSTRAP_PEERS="ynx_val_primary|peer-primary|127.0.0.1|127.0.0.1:26656|primary validator;ynx_val_secondary|peer-secondary|127.0.0.2|127.0.0.2:26656|bonded validator"
work="$(mktemp -d)"
primary_pid=""
secondary_pid=""
cleanup() {
  ynx_kill_tree "$primary_pid"
  ynx_kill_tree "$secondary_pid"
  rm -rf "$work"
}
trap cleanup EXIT

YNX_NETWORK=testnet \
YNX_HTTP_ADDR=127.0.0.1:6461 \
YNX_DATA_DIR="$work/secondary-state" \
YNX_LOCAL_VALIDATOR_ADDRESS=ynx_val_secondary \
YNX_PEER_RPC_URLS="ynx_val_primary|http://127.0.0.1:6460" \
YNX_PEER_SYNC_INTERVAL=250ms \
go run ./cmd/ynx-chaind >"$work/secondary.log" 2>&1 &
secondary_pid=$!
for _ in {1..60}; do
  curl -fsS http://127.0.0.1:6461/health >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS http://127.0.0.1:6461/health >/dev/null || { echo "secondary validator did not become healthy"; sed -n '1,120p' "$work/secondary.log" 2>/dev/null || true; exit 1; }

YNX_NETWORK=testnet \
YNX_HTTP_ADDR=127.0.0.1:6460 \
YNX_DATA_DIR="$work/primary-state" \
YNX_LOCAL_VALIDATOR_ADDRESS=ynx_val_primary \
YNX_PEER_RPC_URLS="ynx_val_secondary|http://127.0.0.1:6461" \
YNX_PEER_SYNC_INTERVAL=250ms \
go run ./cmd/ynx-chaind >"$work/primary.log" 2>&1 &
primary_pid=$!
for _ in {1..60}; do
  curl -fsS "$YNX_REST_URL/health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "$YNX_REST_URL/health" >/dev/null || { echo "primary validator did not become healthy"; sed -n '1,120p' "$work/primary.log" 2>/dev/null || true; exit 1; }

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

for _ in {1..40}; do
  syncs="$(curl -fsS "$YNX_REST_URL/validators/peer-sync")"
  if printf '%s' "$syncs" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const sync=data.syncs?.find((item)=>item.source==="ynx_val_primary" && item.target==="ynx_val_secondary" && item.evidence==="peer-rpc-poll:http://127.0.0.1:6461/status"); process.exit(sync ? 0 : 1);' >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
syncs="$(curl -fsS "$YNX_REST_URL/validators/peer-sync")"
printf '%s' "$syncs" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const sync=data.syncs?.find((item)=>item.source==="ynx_val_primary" && item.target==="ynx_val_secondary"); if (!sync || sync.targetHeight < 0 || !sync.evidence?.startsWith("peer-rpc-poll:")) { console.error(`automatic peer sync state not exposed: ${JSON.stringify(data)}`); process.exit(1); }'

status="$(curl -fsS "$YNX_REST_URL/status")"
printf '%s' "$status" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const sync=data.validatorPeerSync || {}; if (data.readyValidatorCount < 1 || data.validatorPeerReadiness?.ready < 1 || data.validatorPeerReadiness?.total < 2 || data.validatorPeerDiscovery?.expected < 2 || data.validatorPeerDiscovery?.observed < 1 || sync.total < 1 || (sync.synced + sync.lagging) < 1) { console.error(`validator readiness/discovery/sync summary missing: ${JSON.stringify(data)}`); process.exit(1); }'
identity="$(curl -fsS "$YNX_REST_URL/node/identity")"
printf '%s' "$identity" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const freshness=data.peerSyncFreshness || {}; if (data.validatorAddress !== "ynx_val_primary" || data.validatorRole !== "primary validator" || data.expectedValidatorCount !== 2 || data.peerSyncTargetCount !== 1 || !Array.isArray(data.peerSyncTargetAddresses) || data.peerSyncTargetAddresses[0] !== "ynx_val_secondary" || freshness.targetCount !== 1 || freshness.missing !== 0 || freshness.stale !== 0 || freshness.fresh < 1 || !["synced","fresh_with_lag"].includes(freshness.status)) { console.error(`node identity/freshness missing: ${JSON.stringify(data)}`); process.exit(1); }'
printf '%s' "$status" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const identity=data.nodeIdentity || {}; if (identity.validatorAddress !== "ynx_val_primary" || identity.peerSyncFreshness?.missing !== 0 || identity.peerSyncFreshness?.stale !== 0) { console.error(`status node identity/freshness missing: ${JSON.stringify(data)}`); process.exit(1); }'

echo "validator-peer-readiness-check passed: validator=$validator_address"
