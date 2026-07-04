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

out="${YNX_VERIFY_TESTNET_OUT:-tmp/verify-testnet}"
mkdir -p "$out"
report="$out/ssh-services.txt"
: > "$report"

failures=0

check_node() {
  local name="$1" user="$2" host="$3" key="$4" services="$5" observer_file="${6:-}"
  local node_out="$out/${name}.txt"
  : > "$node_out"
  local failed=0
  {
    echo "== $name $user@$host =="
    if [[ ! -r "$key" ]]; then
      echo "FAIL key is not readable: $key"
      failed=1
    else
      local remote_script="set -e; hostname; uname -srm; failed=0;"
      for service in $services; do
        remote_script="$remote_script status=\$(systemctl is-active '$service' 2>/dev/null || true); echo '$service'=\$status; test \"\$status\" = active || failed=1;"
      done
      if [[ -n "$observer_file" ]]; then
        remote_script="$remote_script test -r '$observer_file' && head -c 1200 '$observer_file' || echo 'observer file unavailable: $observer_file';"
      fi
      remote_script="$remote_script exit \$failed;"
      if ssh -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 "$user@$host" "$remote_script"; then
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

check_node "primary" "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY" "ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd"
check_node "singapore" "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY" "ynx-chaind" "$SG_OBSERVER_FILE"
check_node "silicon-valley" "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY" "ynx-chaind"
check_node "seoul" "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY" "ynx-chaind"

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
