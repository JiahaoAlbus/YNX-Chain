#!/usr/bin/env bash
set -Eeuo pipefail

package_dir="${1:?package directory is required}"
release="${2:?release is required}"
source_commit="${3:?source commit is required}"
role="${4:?node role is required}"
mode="${5:?node mode is required}"
replication_interval="${6:?replication interval is required}"

[[ "$release" =~ ^ynx-read-availability-[0-9a-f]{12}$ ]] || { echo "invalid read availability release"; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source commit"; exit 1; }
[[ "$role" =~ ^(primary|singapore|silicon-valley|seoul)$ ]] || { echo "invalid node role"; exit 1; }
[[ "$mode" =~ ^(primary|validator)$ ]] || { echo "invalid node mode"; exit 1; }
[[ "$replication_interval" =~ ^(1s|2s|5s|10s|15s|30s)$ ]] || { echo "invalid replication interval"; exit 1; }
[[ -d "$package_dir" && ! -L "$package_dir" ]] || { echo "invalid package directory"; exit 1; }

cd "$package_dir"
sha256sum -c SHA256SUMS
test -x bin/ynx-chaind
command -v python3 >/dev/null
if [[ "$mode" == "primary" ]]; then
  test -x bin/ynx-indexerd
fi
sudo -n test -f /etc/ynx/ynx-chaind.env
sudo -n test -f /etc/systemd/system/ynx-chaind.service
systemctl is-active --quiet ynx-chaind.service

backup="/var/backups/ynx-chain/$release-$role"
sudo -n rm -rf "$backup"
sudo -n install -d -m 0700 -o root -g root "$backup"
sudo -n cp -p /usr/local/bin/ynx-chaind "$backup/ynx-chaind"
sudo -n cp -p /etc/ynx/ynx-chaind.env "$backup/ynx-chaind.env"
if [[ "$mode" == "primary" ]]; then
  systemctl is-active --quiet ynx-indexerd.service
  sudo -n cp -p /usr/local/bin/ynx-indexerd "$backup/ynx-indexerd"
fi

deployment_complete=0
status_file=""
identity_file=""
rollback() {
  local status="$?"
  trap - EXIT
  rm -f "${status_file:-}" "${identity_file:-}"
  if [[ "$status" != "0" && "$deployment_complete" == "0" ]]; then
    set +e
    if ! sudo -n grep -a -Fq "$source_commit" /usr/local/bin/ynx-chaind; then
      echo "read availability deployment on $role was superseded; rollback skipped to preserve the newer binary" >&2
      exit "$status"
    fi
    sudo -n install -m 0755 -o root -g root "$backup/ynx-chaind" /usr/local/bin/ynx-chaind
    sudo -n cp -p "$backup/ynx-chaind.env" /etc/ynx/ynx-chaind.env
    if [[ "$mode" == "primary" ]]; then
      sudo -n install -m 0755 -o root -g root "$backup/ynx-indexerd" /usr/local/bin/ynx-indexerd
    fi
    sudo -n systemctl restart ynx-chaind.service
    if [[ "$mode" == "primary" ]]; then
      sudo -n systemctl restart ynx-indexerd.service
    fi
    echo "read availability deployment failed on $role; previous binaries restored" >&2
  fi
  exit "$status"
}
trap rollback EXIT

sudo -n install -m 0755 -o root -g root bin/ynx-chaind "/usr/local/bin/ynx-chaind.${release}.new"
sudo -n mv -f "/usr/local/bin/ynx-chaind.${release}.new" /usr/local/bin/ynx-chaind
if [[ "$mode" == "validator" ]]; then
  env_new="$(mktemp)"
  sudo -n grep -v '^YNX_REPLICATION_INTERVAL=' /etc/ynx/ynx-chaind.env >"$env_new" || true
  printf 'YNX_REPLICATION_INTERVAL=%s\n' "$replication_interval" >>"$env_new"
  sudo -n install -m 0600 -o root -g root "$env_new" /etc/ynx/ynx-chaind.env
  rm -f "$env_new"
fi
sudo -n bash -lc 'set -a; source /etc/ynx/ynx-chaind.env; set +a; /usr/local/bin/ynx-chaind --check-config >/dev/null'
sudo -n systemctl restart ynx-chaind.service

status_file="$(mktemp)"
identity_file="$(mktemp)"
ready=0
for _attempt in $(seq 1 120); do
  if curl -fsS --max-time 5 http://127.0.0.1:6420/status >"$status_file" &&
    grep -Fq "\"commit\":\"$source_commit\"" "$status_file" &&
    curl -fsS --max-time 5 http://127.0.0.1:6420/node/identity >"$identity_file" &&
    grep -Fq "\"commit\":\"$source_commit\"" "$identity_file"; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]] || { echo "ynx-chaind did not expose the expected lock-independent build identity on $role"; exit 1; }

height="$(sed -n 's/.*"height":\([0-9][0-9]*\).*/\1/p' "$status_file" | head -1)"
[[ "$height" =~ ^[0-9]+$ ]] || { echo "ynx-chaind status omitted height on $role"; exit 1; }
probe_height="$height"
if (( probe_height > 1000 )); then
  probe_height=$((probe_height - 1000))
fi
curl -fsS --max-time 5 "http://127.0.0.1:6420/blocks/$probe_height" |
  grep -Fq "\"height\":$probe_height"

if [[ "$mode" == "validator" ]]; then
  replication_ready=0
  for _attempt in $(seq 1 180); do
    replication_status="$(curl -sS --max-time 10 http://127.0.0.1:6420/status 2>/dev/null || true)"
    if printf '%s' "$replication_status" | python3 -c '
import json, sys
r = json.load(sys.stdin)["replication"]
if not (r["status"] == "synced" and not r["catchingUp"] and r["fresh"] and
        r["successes"] > 0 and r["consecutiveFailures"] == 0 and r["lagBlocks"] == 0):
    raise SystemExit(1)
' 2>/dev/null; then
      replication_ready=1
      break
    fi
    sleep 2
  done
  [[ "$replication_ready" == "1" ]] || { echo "bounded replication did not become fresh on $role"; exit 1; }
fi

if [[ "$mode" == "primary" ]]; then
  before_height="$(
    curl -sS --max-time 10 http://127.0.0.1:6426/health 2>/dev/null |
      sed -n 's/.*"lastIndexedHeight":\([0-9][0-9]*\).*/\1/p' |
      head -1
  )"
  [[ "$before_height" =~ ^[0-9]+$ ]] || before_height=0

  sudo -n install -m 0755 -o root -g root bin/ynx-indexerd "/usr/local/bin/ynx-indexerd.${release}.new"
  sudo -n mv -f "/usr/local/bin/ynx-indexerd.${release}.new" /usr/local/bin/ynx-indexerd
  sudo -n systemctl restart ynx-indexerd.service

  indexer_progress=0
  for _attempt in $(seq 1 300); do
    health="$(
      curl -sS --max-time 10 http://127.0.0.1:6426/health 2>/dev/null || true
    )"
    indexed_height="$(printf '%s' "$health" | sed -n 's/.*"lastIndexedHeight":\([0-9][0-9]*\).*/\1/p' | head -1)"
    if [[ "$health" == *"\"commit\":\"$source_commit\""* &&
      "$indexed_height" =~ ^[0-9]+$ &&
      "$indexed_height" -gt "$before_height" ]]; then
      indexer_progress=1
      break
    fi
    sleep 2
  done
  [[ "$indexer_progress" == "1" ]] || { echo "ynx-indexerd did not persist forward catch-up progress"; exit 1; }
fi

rm -f "$status_file" "$identity_file"
status_file=""
identity_file=""
deployment_complete=1
trap - EXIT
echo "read availability deployment verified: role=$role mode=$mode release=$release sourceCommit=$source_commit height=$height"
