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
EXPECTED_RELEASE_COMMIT="${YNX_EXPECTED_RELEASE_COMMIT:-$(git rev-parse --short=12 HEAD)}"
EXPECTED_RELEASE_NAME="${YNX_EXPECTED_RELEASE_NAME:-ynx-chain-${EXPECTED_RELEASE_COMMIT}}"

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
json_string_value() {
  key="$1"
  json="$2"
  printf "%s" "$json" | sed -n "s/.*\"$key\":\"\\([^\"]*\\)\".*/\\1/p" | head -1
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
expected_release_commit="__EXPECTED_RELEASE_COMMIT__"
expected_release_name="__EXPECTED_RELEASE_NAME__"
release_dir="/opt/ynx-chain/releases/$expected_release_name"
manifest_file="$release_dir/config/release-manifest.json"
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
manifest_json=""
if [ -r "$manifest_file" ]; then
  manifest_json="$(cat "$manifest_file")"
elif command -v sudo >/dev/null 2>&1 && sudo -n test -r "$manifest_file" 2>/dev/null; then
  manifest_json="$(sudo -n cat "$manifest_file")"
fi
if [ -z "$manifest_json" ]; then
  echo "releaseManifest=missing:$manifest_file"
  failed=1
else
  echo "releaseManifest=ok"
fi
manifest_sha="$(if [ -r "$manifest_file" ]; then sha256sum "$manifest_file" 2>/dev/null | awk '{print $1}'; elif command -v sudo >/dev/null 2>&1 && sudo -n test -r "$manifest_file" 2>/dev/null; then sudo -n sha256sum "$manifest_file" 2>/dev/null | awk '{print $1}'; fi || true)"
if [ -n "$manifest_sha" ]; then
  echo "releaseManifest.manifestSha256=$manifest_sha"
else
  echo "releaseManifest.manifestSha256=missing"
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
manifest_compact="$(printf "%s" "$manifest_json" | compact_json)"
validators_compact="$(printf "%s" "$validators_json" | compact_json)"
peers_compact="$(printf "%s" "$peers_json" | compact_json)"
sync_compact="$(printf "%s" "$sync_json" | compact_json)"
manifest_commit="$(json_string_value commit "$manifest_compact")"
manifest_release="$(json_string_value release "$manifest_compact")"
echo "releaseManifest.commitValue=${manifest_commit:-missing}"
echo "releaseManifest.releaseValue=${manifest_release:-missing}"
if printf "%s" "$manifest_compact" | grep -Fq '"path":"bin/ynx-chaind"'; then
  echo "releaseManifest.chaindPathValue=bin/ynx-chaind"
else
  echo "releaseManifest.chaindPathValue=missing"
fi
check_json_contains releaseManifest.schema "$manifest_compact" '"schema":"ynx-chain-release-manifest/v1"'
check_json_contains releaseManifest.commit "$manifest_compact" "\"commit\":\"$expected_release_commit\""
check_json_contains releaseManifest.release "$manifest_compact" "\"release\":\"$expected_release_name\""
check_json_contains releaseManifest.chaindPath "$manifest_compact" '"path":"bin/ynx-chaind"'
chaind_sha="$(sha256sum /usr/local/bin/ynx-chaind 2>/dev/null | awk '{print $1}' || true)"
if [ -n "$chaind_sha" ]; then
  echo "releaseManifest.chaindSha256=$chaind_sha"
else
  echo "releaseManifest.chaindSha256=missing"
fi
if [ -n "$chaind_sha" ] && printf "%s" "$manifest_compact" | grep -Fq "\"sha256\":\"$chaind_sha\""; then
  echo "releaseManifest.chaindChecksum=ok"
else
  echo "releaseManifest.chaindChecksum=missing:${chaind_sha:-unreadable}"
  failed=1
fi
check_json_contains status.chainId "$status_compact" '"chainId":6423'
check_json_contains status.validatorPeerReadiness "$status_compact" '"validatorPeerReadiness"'
check_json_contains status.validatorPeerDiscovery "$status_compact" '"validatorPeerDiscovery"'
check_json_contains status.validatorPeerSync "$status_compact" '"validatorPeerSync"'
check_json_contains status.nodeIdentity "$status_compact" '"nodeIdentity"'
check_json_contains status.build "$status_compact" '"build"'
check_json_contains status.buildCommit "$status_compact" "\"commit\":\"$expected_release_commit\""
check_json_contains status.buildRelease "$status_compact" "\"release\":\"$expected_release_name\""
check_json_contains status.buildTime "$status_compact" '"buildTime"'
check_json_contains nodeIdentity.localIdentity "$identity_compact" "\"validatorAddress\":\"$expected_validator\""
check_json_contains nodeIdentity.expectedCount "$identity_compact" '"expectedValidatorCount":4'
check_json_contains nodeIdentity.targetCount "$identity_compact" '"peerSyncTargetCount":3'
check_json_contains nodeIdentity.freshness "$identity_compact" '"peerSyncFreshness"'
if printf "%s" "$identity_compact" | grep -Eq '"status":"(synced|fresh_with_lag)"' && \
   printf "%s" "$identity_compact" | grep -Fq '"missing":0' && \
   printf "%s" "$identity_compact" | grep -Fq '"stale":0'; then
  echo "nodeIdentity.freshPeerObservation=ok"
else
  echo "nodeIdentity.freshPeerObservation=missing"
  failed=1
fi
check_json_contains nodeIdentity.build "$identity_compact" '"build"'
check_json_contains nodeIdentity.buildCommit "$identity_compact" "\"commit\":\"$expected_release_commit\""
check_json_contains nodeIdentity.buildRelease "$identity_compact" "\"release\":\"$expected_release_name\""
check_json_contains nodeIdentity.buildTime "$identity_compact" '"buildTime"'
check_json_contains validators.localIdentity "$validators_compact" "\"address\":\"$expected_validator\""
check_json_contains validators.expectedCount "$validators_compact" '"expectedValidatorCount":4'
check_json_contains validatorPeers.records "$peers_compact" '"peers"'
check_json_contains validatorPeerSync.records "$sync_compact" '"syncs"'
REMOTE
)
      remote_script="${remote_script/__EXPECTED_VALIDATOR__/$expected_validator}"
      remote_script="${remote_script/__EXPECTED_RELEASE_COMMIT__/$EXPECTED_RELEASE_COMMIT}"
      remote_script="${remote_script/__EXPECTED_RELEASE_NAME__/$EXPECTED_RELEASE_NAME}"
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

check_replication_convergence() {
  local primary_status target_height target_hash
  primary_status="$(ssh -i "$PRIMARY_NODE_SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 "$PRIMARY_NODE_USER@$PRIMARY_NODE_HOST" "curl -fsS http://127.0.0.1:6420/status")" || return 1
  target_height="$(printf '%s' "$primary_status" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String(x.height ?? ""));')"
  target_hash="$(printf '%s' "$primary_status" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String(x.latestBlockHash ?? ""));')"
  [[ "$target_height" =~ ^[0-9]+$ && -n "$target_hash" ]] || return 1

  check_replica() {
    local role="$1" user="$2" host="$3" key="$4" block="" identity="" observed_hash="" write_code=""
    for _ in {1..20}; do
      block="$(ssh -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 "$user@$host" "curl -fsS http://127.0.0.1:6420/blocks/$target_height" 2>/dev/null || true)"
      observed_hash="$(printf '%s' "$block" | node -e 'let x={}; try{x=JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{} process.stdout.write(String(x.hash ?? ""));')"
      [[ "$observed_hash" == "$target_hash" ]] && break
      sleep 1
    done
    [[ "$observed_hash" == "$target_hash" ]] || { echo "replicationConvergence.$role=failed target=$target_height/$target_hash observed=$observed_hash"; return 1; }
    identity="$(ssh -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 "$user@$host" "curl -fsS http://127.0.0.1:6420/node/identity")" || return 1
    printf '%s' "$identity" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); if (x.blockProductionEnabled !== false || x.replicationMode !== "authoritative_follower" || !String(x.replicationSource||"").includes("'"$PRIMARY_NODE_HOST"':6420")) process.exit(1);' || return 1
    write_code="$(ssh -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 "$user@$host" "curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{\"address\":\"ynx_replica_write_probe\",\"amount\":1}' http://127.0.0.1:6420/faucet")" || return 1
    [[ "$write_code" == "409" ]] || { echo "replicationReadOnly.$role=failed HTTP=$write_code"; return 1; }
    echo "replicationConvergence.$role=ok height=$target_height hash=$target_hash"
    echo "replicationReadOnly.$role=ok HTTP=409"
  }

  check_replica singapore "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY" || return 1
  check_replica silicon-valley "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY" || return 1
  check_replica seoul "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY" || return 1
  echo "replicationConvergence=passed height=$target_height hash=$target_hash"
}

if check_replication_convergence | tee -a "$report"; then
  echo "OK replication-convergence" | tee -a "$report"
else
  echo "FAIL replication-convergence" | tee -a "$report"
  failures=$((failures + 1))
fi

export YNX_RELEASE_MANIFEST_EVIDENCE_PATH="$out/release-manifest-evidence.json"
if node scripts/verify/release-manifest-evidence.mjs "$out" "$EXPECTED_RELEASE_COMMIT" "$EXPECTED_RELEASE_NAME"; then
  echo "OK release-manifest-evidence" | tee -a "$report"
else
  echo "FAIL release-manifest-evidence" | tee -a "$report"
  failures=$((failures + 1))
fi

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
