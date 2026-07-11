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

out="${YNX_LEGACY_INVENTORY_OUT:-tmp/legacy-inventory}"
mkdir -p "$out"
report="$out/legacy-inventory.txt"
: > "$report"

failures=0

inventory_node() {
  local role="$1" user="$2" host="$3" key="$4"
  local node_report="$out/${role}-${host}.txt"
  {
    echo "== $role $user@$host =="
    echo "generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "key_path=$key"
    if [[ ! -r "$key" ]]; then
      echo "FAIL key is not readable"
      failures=$((failures + 1))
      echo
    else
      if ! ssh -i "$key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 "$user@$host" 'bash -s' <<'REMOTE'
set -u
set -o pipefail 2>/dev/null || true
echo "-- identity"
hostname || true
uname -a || true
date -u || true
uptime || true

echo "-- selected systemd units"
systemctl list-units --type=service --all --no-pager 2>/dev/null | grep -Ei "ynx|caddy|nginx|web4|ai|evm|geth|cosmos|tendermint|comet|node|pm2" || true

echo "-- selected active statuses"
for service in ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd caddy nginx; do
  status=$(systemctl is-active "$service" 2>/dev/null || true)
  enabled=$(systemctl is-enabled "$service" 2>/dev/null || true)
  echo "$service active=$status enabled=$enabled"
done

echo "-- listening ports"
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null || true) | grep -E "(:80|:443|:6420|:6426|:6427|:6428|:6429|:6430|:6431|:8545|:8546|:26657|:26656|:9090|:1317)\\b" || true

echo "-- config files present"
for path in /etc/caddy/Caddyfile /etc/nginx/conf.d/ynx-chain.conf /etc/nginx/sites-enabled/default /etc/ynx/ynx-chaind.env /etc/ynx/ynx-faucetd.env /etc/ynx/ynx-ai-gatewayd.env /etc/ynx/ynx-payd.env /etc/ynx/ynx-trustd.env; do
  if sudo -n test -e "$path"; then
    size=$(sudo -n stat -c %s "$path" 2>/dev/null || stat -f %z "$path" 2>/dev/null || echo unknown)
    hash=$(sudo -n sha256sum "$path" 2>/dev/null | awk "{print \$1}" || shasum -a 256 "$path" 2>/dev/null | awk "{print \$1}" || echo unreadable)
    echo "$path exists size=$size sha256=$hash"
  else
    echo "$path missing"
  fi
done

echo "-- local service probes"
for url in \
  http://127.0.0.1:6420/status \
  http://127.0.0.1:6426/health \
  http://127.0.0.1:6427/health \
  http://127.0.0.1:6428/health \
  http://127.0.0.1:26657/status \
  http://127.0.0.1:1317/status; do
  echo "probe $url"
  curl -fsS --max-time 5 "$url" 2>/dev/null | head -c 1200 || echo "unavailable"
  echo
done

echo "-- local evm chain id probes"
for url in http://127.0.0.1:8545 http://127.0.0.1:6420; do
  echo "probe $url eth_chainId"
  curl -fsS --max-time 5 -H "content-type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_chainId\",\"params\":[]}" "$url" 2>/dev/null | head -c 800 || echo "unavailable"
  echo
done

echo "-- data directories"
for path in /var/lib/ynx-chain /var/log/ynx-chain /home/ubuntu/.ynx-v2 /root/.ynx-v2 /var/lib/ynx-ops-observer; do
  if sudo -n test -e "$path"; then
    echo "$path exists"
    sudo -n find "$path" -maxdepth 2 -mindepth 0 -printf "%M %u %g %s %p\n" 2>/dev/null | head -80 || true
  else
    echo "$path missing"
  fi
done
REMOTE
      then
        echo "FAIL strict ssh inventory failed"
        failures=$((failures + 1))
      fi
    fi
    echo
  } > "$node_report" 2>&1 || {
    echo "FAIL inventory failed for $role $user@$host" >> "$node_report"
    failures=$((failures + 1))
  }
  cat "$node_report"
  cat "$node_report" >> "$report"
}

inventory_node "primary" "$PRIMARY_NODE_USER" "$PRIMARY_NODE_HOST" "$PRIMARY_NODE_SSH_KEY"
inventory_node "singapore" "$SG_NODE_USER" "$SG_NODE_HOST" "$SG_NODE_SSH_KEY"
inventory_node "silicon-valley" "$SILICON_VALLEY_NODE_USER" "$SILICON_VALLEY_NODE_HOST" "$SILICON_VALLEY_NODE_SSH_KEY"
inventory_node "seoul" "$SEOUL_NODE_USER" "$SEOUL_NODE_HOST" "$SEOUL_NODE_SSH_KEY"

echo "legacy inventory written: $report"
if [[ "$failures" != "0" ]]; then
  echo "legacy inventory completed with $failures failure(s)"
  exit 1
fi
