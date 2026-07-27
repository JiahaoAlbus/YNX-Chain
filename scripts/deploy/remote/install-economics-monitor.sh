#!/usr/bin/env bash
set -Eeuo pipefail

package_dir="${1:?package directory is required}"
release="${2:?release is required}"
source_commit="${3:?source commit is required}"

[[ "$release" =~ ^ynx-economics-monitor-[0-9a-f]{12}$ ]] || { echo "invalid Economics Monitor release"; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source commit"; exit 1; }
[[ -d "$package_dir" && ! -L "$package_dir" ]] || { echo "invalid package directory"; exit 1; }

cd "$package_dir"
sha256sum -c SHA256SUMS
test -x bin/ynx-economics-monitord
test -f config/ynx-economics-monitord.env
test -f systemd/ynx-economics-monitord.service

backup="/var/backups/ynx-chain/$release"
sudo -n rm -rf "$backup"
sudo -n install -d -m 0700 -o root -g root "$backup"
for path in \
  /usr/local/bin/ynx-economics-monitord \
  /etc/systemd/system/ynx-economics-monitord.service \
  /etc/ynx/ynx-economics-monitord.env
do
  name="$(basename "$path")"
  if sudo -n test -e "$path"; then
    sudo -n cp -p "$path" "$backup/$name"
  else
    sudo -n touch "$backup/$name.absent"
  fi
done

restore_path() {
  local destination="$1" name
  name="$(basename "$destination")"
  if sudo -n test -f "$backup/$name.absent"; then
    sudo -n rm -f "$destination"
  elif [[ "$destination" == "/usr/local/bin/ynx-economics-monitord" ]]; then
    sudo -n install -m 0755 -o root -g root "$backup/$name" "${destination}.${release}.restore"
    sudo -n mv -f "${destination}.${release}.restore" "$destination"
  else
    sudo -n cp -p "$backup/$name" "$destination"
  fi
}

deployment_complete=0
rollback() {
  local status="$?"
  trap - EXIT
  if [[ "$status" != "0" && "$deployment_complete" == "0" ]]; then
    set +e
    sudo -n systemctl stop ynx-economics-monitord.service
    restore_path /usr/local/bin/ynx-economics-monitord
    restore_path /etc/systemd/system/ynx-economics-monitord.service
    restore_path /etc/ynx/ynx-economics-monitord.env
    sudo -n systemctl daemon-reload
    if sudo -n test -x /usr/local/bin/ynx-economics-monitord; then
      sudo -n systemctl restart ynx-economics-monitord.service
    fi
    echo "scoped Economics Monitor deployment failed; previous binary and configuration restored" >&2
  fi
  exit "$status"
}
trap rollback EXIT

sudo -n install -m 0755 -o root -g root bin/ynx-economics-monitord "/usr/local/bin/ynx-economics-monitord.${release}.new"
sudo -n mv -f "/usr/local/bin/ynx-economics-monitord.${release}.new" /usr/local/bin/ynx-economics-monitord
sudo -n install -m 0644 -o root -g root systemd/ynx-economics-monitord.service /etc/systemd/system/ynx-economics-monitord.service
sudo -n install -m 0640 -o root -g ynx config/ynx-economics-monitord.env /etc/ynx/ynx-economics-monitord.env
sudo -n bash -lc 'set -a; source /etc/ynx/ynx-economics-monitord.env; set +a; /usr/local/bin/ynx-economics-monitord --check-config >/dev/null'
sudo -n systemctl daemon-reload
sudo -n systemctl enable ynx-economics-monitord.service
sudo -n systemctl restart ynx-economics-monitord.service
sudo -n systemctl is-active --quiet ynx-economics-monitord.service

health="$(mktemp)"
metrics="$(mktemp)"
ready=0
for attempt in $(seq 1 15); do
  if curl -fsS --max-time 10 http://127.0.0.1:6438/health >"$health" &&
    grep -Fq '"service":"ynx-economics-monitord"' "$health" &&
    grep -Fq "\"commit\":\"$source_commit\"" "$health" &&
    grep -Fq '"routeAvailable":true' "$health" &&
    curl -fsS --max-time 5 http://127.0.0.1:6438/metrics >"$metrics" &&
    grep -Fq 'ynx_public_stable_reserve_probe_success 1' "$metrics" &&
    grep -Fq "commit=\\\"$source_commit\\\"" "$metrics"; then
    ready=1
    break
  fi
  sleep 3
done
rm -f "$health" "$metrics"
[[ "$ready" == "1" ]] || { echo "Economics Monitor did not prove a healthy public Stable Reserve route"; exit 1; }

deployment_complete=1
echo "scoped Economics Monitor deployment verified: release=$release sourceCommit=$source_commit"
