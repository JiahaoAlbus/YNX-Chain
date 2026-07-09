#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

bash -n scripts/verify/verify-testnet.sh

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
)

for pattern in "${required_patterns[@]}"; do
  grep -Fq "$pattern" scripts/verify/verify-testnet.sh || {
    echo "verify-testnet.sh missing required verifier pattern: $pattern"
    exit 1
  }
done

if grep -Eq 'cat[[:space:]]+/etc/ynx/ynx-chaind.env|head[[:space:]].*/etc/ynx/ynx-chaind.env' scripts/verify/verify-testnet.sh; then
  echo "verify-testnet.sh must not print the full remote chain env"
  exit 1
fi

echo "verify-testnet-check passed"
