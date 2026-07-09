#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh
ynx_load_env

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-43.153.202.237}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-ubuntu}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"

SG_NODE_HOST="${SG_NODE_HOST:-43.134.23.58}"
SG_NODE_USER="${SG_NODE_USER:-root}"
SG_NODE_SSH_KEY="${SG_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
SG_OBSERVER_FILE="${SG_OBSERVER_FILE:-/var/lib/ynx-ops-observer/latest.json}"

SILICON_VALLEY_NODE_HOST="${SILICON_VALLEY_NODE_HOST:-43.162.100.54}"
SILICON_VALLEY_NODE_USER="${SILICON_VALLEY_NODE_USER:-ubuntu}"
SILICON_VALLEY_NODE_SSH_KEY="${SILICON_VALLEY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang2.pem}"

SEOUL_NODE_HOST="${SEOUL_NODE_HOST:-43.164.132.81}"
SEOUL_NODE_USER="${SEOUL_NODE_USER:-root}"
SEOUL_NODE_SSH_KEY="${SEOUL_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang3.pem}"

PRIMARY_VALIDATOR_ADDRESS="${PRIMARY_VALIDATOR_ADDRESS:-ynx_validator_primary}"
SG_VALIDATOR_ADDRESS="${SG_VALIDATOR_ADDRESS:-ynx_validator_singapore}"
SILICON_VALLEY_VALIDATOR_ADDRESS="${SILICON_VALLEY_VALIDATOR_ADDRESS:-ynx_validator_silicon_valley}"
SEOUL_VALIDATOR_ADDRESS="${SEOUL_VALIDATOR_ADDRESS:-ynx_validator_seoul}"

out="${YNX_VERIFY_TESTNET_OUT:-tmp/verify-testnet}"
mkdir -p "$out"
report="$out/ssh-services.txt"
: > "$report"

failures=0

check_node() {
  local name="$1" user="$2" host="$3" key="$4" services="$5" expected_validator="$6" observer_file="${7:-}"
  local node_out="$out/${name}.txt"
  : > "$node_out"
  local failed=0
  {
    echo "== $name $user@$host =="
    if [[ ! -r "$key" ]]; then
      echo "FAIL key is not readable: $key"
      failed=1
    else
      local remote_script
      remote_script=$(cat <<'REMOTE'
set -u
failed=0
echo "hostname=$(hostname)"
echo "kernel=$(uname -srm)"
safe_env() {
  key="$1"
  env_file=/etc/ynx/ynx-chaind.env
  if [ -r "$env_file" ]; then
    grep -E "^$key=" "$env_file" | tail -1 | sed "s/^$key=//"
  elif command -v sudo >/dev/null 2>&1 && sudo -n test -r "$env_file" 2>/dev/null; then
    sudo -n grep -E "^$key=" "$env_file" | tail -1 | sed "s/^$key=//"
  fi
}
compact_json() {
  tr -d '[:space:]'
}
check_json_contains() {
  label="$1"
  json="$2"
  needle="$3"
  if printf "%s" "$json" | grep -Fq "$needle"; then
    echo "$label=ok"
  else
    echo "$label=missing:$needle"
    failed=1
  fi
}
local_validator="$(safe_env YNX_LOCAL_VALIDATOR_ADDRESS || true)"
expected_validator="__EXPECTED_VALIDATOR__"
echo "localValidatorAddress=$local_validator"
if [ "$local_validator" != "$expected_validator" ]; then
  echo "localValidatorAddressMismatch expected=$expected_validator observed=$local_validator"
  failed=1
fi
peer_rpc_urls="$(safe_env YNX_PEER_RPC_URLS || true)"
if [ -n "$peer_rpc_urls" ]; then
  echo "peerRpcUrlsConfigured=yes"
else
  echo "peerRpcUrlsConfigured=no"
  failed=1
fi
expected_count="$(safe_env YNX_EXPECTED_VALIDATOR_COUNT || true)"
echo "expectedValidatorCount=${expected_count:-missing}"
if [ "${expected_count:-}" != "4" ]; then
  failed=1
fi
status_json="$(curl -fsS http://127.0.0.1:6420/status 2>/dev/null || true)"
identity_json="$(curl -fsS http://127.0.0.1:6420/node/identity 2>/dev/null || true)"
validators_json="$(curl -fsS http://127.0.0.1:6420/validators 2>/dev/null || true)"
peers_json="$(curl -fsS http://127.0.0.1:6420/validators/peers 2>/dev/null || true)"
sync_json="$(curl -fsS http://127.0.0.1:6420/validators/peer-sync 2>/dev/null || true)"
if [ -z "$status_json" ]; then echo "statusEndpoint=unreachable"; failed=1; else echo "statusEndpoint=ok"; fi
if [ -z "$identity_json" ]; then echo "nodeIdentityEndpoint=unreachable"; failed=1; else echo "nodeIdentityEndpoint=ok"; fi
if [ -z "$validators_json" ]; then echo "validatorsEndpoint=unreachable"; failed=1; else echo "validatorsEndpoint=ok"; fi
if [ -z "$peers_json" ]; then echo "validatorPeersEndpoint=unreachable"; failed=1; else echo "validatorPeersEndpoint=ok"; fi
if [ -z "$sync_json" ]; then echo "validatorPeerSyncEndpoint=unreachable"; failed=1; else echo "validatorPeerSyncEndpoint=ok"; fi
status_compact="$(printf "%s" "$status_json" | compact_json)"
identity_compact="$(printf "%s" "$identity_json" | compact_json)"
validators_compact="$(printf "%s" "$validators_json" | compact_json)"
peers_compact="$(printf "%s" "$peers_json" | compact_json)"
sync_compact="$(printf "%s" "$sync_json" | compact_json)"
check_json_contains status.chainId "$status_compact" '"chainId":6423'
check_json_contains status.validatorPeerReadiness "$status_compact" '"validatorPeerReadiness"'
check_json_contains status.validatorPeerDiscovery "$status_compact" '"validatorPeerDiscovery"'
check_json_contains status.validatorPeerSync "$status_compact" '"validatorPeerSync"'
check_json_contains status.nodeIdentity "$status_compact" '"nodeIdentity"'
check_json_contains nodeIdentity.localIdentity "$identity_compact" "\"validatorAddress\":\"$expected_validator\""
check_json_contains nodeIdentity.expectedCount "$identity_compact" '"expectedValidatorCount":4'
check_json_contains nodeIdentity.targetCount "$identity_compact" '"peerSyncTargetCount":3'
check_json_contains nodeIdentity.freshness "$identity_compact" '"peerSyncFreshness"'
check_json_contains nodeIdentity.freshnessStatus "$identity_compact" '"status":"synced"'
check_json_contains validators.localIdentity "$validators_compact" "\"address\":\"$expected_validator\""
check_json_contains validators.expectedCount "$validators_compact" '"expectedValidatorCount":4'
check_json_contains validatorPeers.records "$peers_compact" '"peers"'
check_json_contains validatorPeerSync.records "$sync_compact" '"syncs"'
REMOTE
)
      remote_script="${remote_script/__EXPECTED_VALIDATOR__/$expected_validator}"
      for service in $services; do
        remote_script="${remote_script}"$'\n'"status=\$(systemctl is-active '$service' 2>/dev/null || true); echo '$service'=\$status; test \"\$status\" = active || failed=1;"
      done
      if [[ -n "$observer_file" ]]; then
        remote_script="${remote_script}"$'\n'"test -r '$observer_file' && head -c 1200 '$observer_file' || echo 'observer file unavailable: $observer_file';"
      fi
      remote_script="${remote_script}"$'\n'"exit \$failed;"
      if ssh -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 "$user@$host" "$remote_script"; then
        echo "OK $name"
      else
        echo "FAIL $name ssh or service check failed"
        failed=1
      fi
    fi
    echo
  } > "$node_out" 2>&1
  cat "$node_out"
  cat "$node_out" >> "$report"
  if [[ "$failed" != "0" ]]; then
    failures=$((failures + 1))
  fi
}

check_node "primary" "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd" "$PRIMARY_VALIDATOR_ADDRESS"
check_node "singapore" "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY" "ynx-chaind" "$SG_VALIDATOR_ADDRESS" "$SG_OBSERVER_FILE"
check_node "silicon-valley" "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY" "ynx-chaind" "$SILICON_VALLEY_VALIDATOR_ADDRESS"
check_node "seoul" "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY" "ynx-chaind" "$SEOUL_VALIDATOR_ADDRESS"

export YNX_REMOTE_EVIDENCE_PATH="$out/remote-evidence.json"
if bash scripts/verify/remote-smoke-test.sh; then
  echo "OK remote-smoke-test" | tee -a "$report"
else
  echo "FAIL remote-smoke-test" | tee -a "$report"
  failures=$((failures + 1))
fi

if [[ "$failures" != "0" ]]; then
  echo "verify-testnet failed with $failures failure(s); see $out"
  exit 1
fi

echo "verify-testnet passed; see $out"
