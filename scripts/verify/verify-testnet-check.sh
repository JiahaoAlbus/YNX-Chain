#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

bash -n scripts/verify/verify-testnet.sh
bash -n scripts/verify/replication-proof.sh

# shellcheck source=replication-proof.sh
source scripts/verify/replication-proof.sh

if ynx_replication_proof_matches "" "" "" ""; then
  echo "replication proof must reject an all-empty observation"
  exit 1
fi
if ynx_replication_proof_matches "0" "hash-a" "hash-a" "hash-a"; then
  echo "replication proof must reject height zero"
  exit 1
fi
if ynx_replication_proof_matches "42" "hash-a" "hash-b" "hash-a"; then
  echo "replication proof must reject a replica hash mismatch"
  exit 1
fi
if ynx_replication_proof_matches "42" "hash-a" "hash-a" "hash-b"; then
  echo "replication proof must reject a primary hash mismatch"
  exit 1
fi
ynx_replication_proof_matches "42" "hash-a" "hash-a" "hash-a" || {
  echo "replication proof rejected a valid canonical hash observation"
  exit 1
}
bash -n scripts/deploy/install-bridge-testnet-remote.sh

required_patterns=(
  "StrictHostKeyChecking=yes"
  "YNX_LOCAL_VALIDATOR_ADDRESS"
  "YNX_PEER_RPC_URLS"
  "YNX_EXPECTED_VALIDATOR_COUNT"
  "ynx_validator_primary"
  "ynx_validator_singapore"
  "ynx_validator_silicon_valley"
  "ynx_validator_seoul"
  "http://127.0.0.1:6420/status"
  "http://127.0.0.1:6420/node/identity"
  "http://127.0.0.1:6420/validators"
  "http://127.0.0.1:6420/validators/peers"
  "http://127.0.0.1:6420/validators/peer-sync"
  "nodeIdentity"
  "validatorAddress"
  "peerSyncFreshness"
  "peerSyncTargetCount"
  "validatorPeerReadiness"
  "validatorPeerDiscovery"
  "validatorPeerSync"
  "YNX_EXPECTED_RELEASE_COMMIT"
  "YNX_EXPECTED_RELEASE_NAME"
  "__EXPECTED_RELEASE_COMMIT__"
  "__EXPECTED_RELEASE_NAME__"
  "release-manifest.json"
  "releaseManifest.schema"
  "releaseManifest.commit"
  "releaseManifest.commitValue"
  "releaseManifest.release"
  "releaseManifest.releaseValue"
  "releaseManifest.chaindPath"
  "releaseManifest.chaindPathValue"
  "releaseManifest.manifestSha256"
  "releaseManifest.chaindSha256"
  "releaseManifest.chaindChecksum"
  "sha256sum /usr/local/bin/ynx-chaind"
  "release-manifest-evidence.mjs"
  "YNX_RELEASE_MANIFEST_EVIDENCE_PATH"
  "status.buildCommit"
  "status.buildRelease"
  "nodeIdentity.buildCommit"
  "nodeIdentity.buildRelease"
  "r.status===\"synced\""
  "r.catchingUp===false"
  "r.fresh===true"
  "r.localHeight===r.sourceHeight"
  "r.localBlockHash===r.sourceBlockHash"
  "replica_hash"
  "primary_hash"
  "ynx_replication_proof_matches"
  "replicationReadOnly"
  "YNX_EXPECT_BRIDGE_SERVICE"
  "ynx-bridged"
  "bridge-testnet-surface"
  "/etc/ynx/ynx-bridged.env"
  "/var/lib/ynx-chain/bridge/state.json"
  "bin/ynx-bridged"
  "check-local-services.sh"
)

for pattern in "${required_patterns[@]}"; do
  grep -Fq "$pattern" scripts/verify/verify-testnet.sh || {
    echo "verify-testnet.sh missing required verifier pattern: $pattern"
    exit 1
  }
done

bridge_installer_patterns=(
  "connectivityProbeEnabled"
  "connectivityProbeIntervalSeconds"
  "circle-cctp-v2"
  "ethereum-sepolia"
  "base-sepolia"
  "providerConnectivityProbe=connected-live-fee-api"
  "ynxRouteExecutable=false"
  "officialStablecoinRouteAvailable"
  "externalSubmissionEnabled"
  "userAssetMovementEnabled"
)

for pattern in "${bridge_installer_patterns[@]}"; do
  grep -Fq "$pattern" scripts/deploy/install-bridge-testnet-remote.sh || {
    echo "Bridge Testnet installer missing Provider boundary: $pattern"
    exit 1
  }
done

remote_smoke_patterns=(
  "release.manifest.evidence.present"
  "release.manifest.schema"
  "release.manifest.commit"
  "release.manifest.release"
  "release.manifest.chaindChecksum"
)

for pattern in "${remote_smoke_patterns[@]}"; do
  grep -Fq "$pattern" scripts/verify/remote-smoke-test.mjs || {
    echo "remote-smoke-test.mjs missing required release manifest proof pattern: $pattern"
    exit 1
  }
done

bash scripts/deploy/check-local-services.sh --self-test

if grep -Eq 'cat[[:space:]]+/etc/ynx/ynx-chaind.env|head[[:space:]].*/etc/ynx/ynx-chaind.env' scripts/verify/verify-testnet.sh; then
  echo "verify-testnet.sh must not print the full remote chain env"
  exit 1
fi

echo "verify-testnet-check passed"
