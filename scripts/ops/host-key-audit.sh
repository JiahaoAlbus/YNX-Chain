#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh
ynx_load_env

PRIMARY_NODE_HOST="${PRIMARY_NODE_HOST:-${SERVER_HOST:-43.153.202.237}}"
PRIMARY_NODE_USER="${PRIMARY_NODE_USER:-${SERVER_USER:-ubuntu}}"
PRIMARY_NODE_SSH_KEY="${PRIMARY_NODE_SSH_KEY:-${SSH_KEY_PATH:-/Users/huangjiahao/Downloads/Huang.pem}}"
SG_NODE_HOST="${SG_NODE_HOST:-43.134.23.58}"
SG_NODE_USER="${SG_NODE_USER:-root}"
SG_NODE_SSH_KEY="${SG_NODE_SSH_KEY:-${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}}"
SILICON_VALLEY_NODE_HOST="${SILICON_VALLEY_NODE_HOST:-43.162.100.54}"
SILICON_VALLEY_NODE_USER="${SILICON_VALLEY_NODE_USER:-ubuntu}"
SILICON_VALLEY_NODE_SSH_KEY="${SILICON_VALLEY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang2.pem}"
SEOUL_NODE_HOST="${SEOUL_NODE_HOST:-43.164.132.81}"
SEOUL_NODE_USER="${SEOUL_NODE_USER:-root}"
SEOUL_NODE_SSH_KEY="${SEOUL_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang3.pem}"

out="${YNX_HOST_KEY_AUDIT_OUT:-tmp/host-key-audit}"
known_hosts="${KNOWN_HOSTS_FILE:-$HOME/.ssh/known_hosts}"
mkdir -p "$out"
report="$out/host-key-audit.txt"
: > "$report"

failures=0

audit_node() {
  local role="$1" user="$2" host="$3" key="$4"
  local scan_file="$out/${role}-${host}.known_hosts"
  local node_report="$out/${role}-${host}.txt"
  {
    echo "== $role $user@$host =="
    echo "key_path=$key"
    echo "known_hosts=$known_hosts"
    if [[ ! -r "$key" ]]; then
      echo "FAIL key is not readable"
      failures=$((failures + 1))
      echo
      return
    fi
    echo "-- local known_hosts entries"
    ssh-keygen -F "$host" -f "$known_hosts" 2>/dev/null || echo "none"
    echo "-- presented host key fingerprints"
    if ssh-keyscan -T 8 -t ed25519,ecdsa,rsa "$host" > "$scan_file" 2>/dev/null && [[ -s "$scan_file" ]]; then
      ssh-keygen -lf "$scan_file"
    else
      echo "FAIL ssh-keyscan returned no keys"
      failures=$((failures + 1))
    fi
    echo "-- strict ssh check"
    if ssh -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 "$user@$host" "hostname >/dev/null"; then
      echo "OK strict ssh accepted current host key"
    else
      echo "FAIL strict ssh rejected current host key or login"
      failures=$((failures + 1))
    fi
    echo
  } > "$node_report" 2>&1
  cat "$node_report"
  cat "$node_report" >> "$report"
}

audit_node "primary" "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY"
audit_node "singapore" "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY"
audit_node "silicon-valley" "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY"
audit_node "seoul" "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY"

echo "host-key audit written: $report"
if [[ "$failures" != "0" ]]; then
  echo "host-key audit failed with $failures failure(s)"
  exit 1
fi
