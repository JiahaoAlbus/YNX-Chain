#!/usr/bin/env bash
set -Eeuo pipefail

package_dir="${1:?package directory is required}"
release="${2:?release is required}"
source_commit="${3:?source commit is required}"
reserve_mode="${4:?reserve configuration mode is required}"

[[ "$release" =~ ^ynx-economics-explorer-[0-9a-f]{12}$ ]] || { echo "invalid Explorer release"; exit 1; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source commit"; exit 1; }
[[ "$reserve_mode" == "configure" || "$reserve_mode" == "preserve" ]] || { echo "invalid reserve configuration mode"; exit 1; }
[[ -d "$package_dir" && ! -L "$package_dir" ]] || { echo "invalid package directory"; exit 1; }

cd "$package_dir"
sha256sum -c SHA256SUMS
test -x bin/ynx-explorerd
test -f config/ynx-explorerd.env
test -f systemd/ynx-explorerd.service
if [[ "$reserve_mode" == "configure" ]]; then
  test -f config/stable-reserve-attestation.json
fi

backup="/var/backups/ynx-chain/$release"
sudo -n rm -rf "$backup"
sudo -n install -d -m 0700 -o root -g root "$backup"
for path in \
  /usr/local/bin/ynx-explorerd \
  /etc/systemd/system/ynx-explorerd.service \
  /etc/ynx/ynx-explorerd.env \
  /etc/ynx/stable-reserve-attestation.json
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
    restore_path /usr/local/bin/ynx-explorerd
    restore_path /etc/systemd/system/ynx-explorerd.service
    restore_path /etc/ynx/ynx-explorerd.env
    restore_path /etc/ynx/stable-reserve-attestation.json
    sudo -n systemctl daemon-reload
    sudo -n systemctl restart ynx-explorerd.service
    echo "scoped Explorer deployment failed; previous binary and configuration restored" >&2
  fi
  exit "$status"
}
trap rollback EXIT

sudo -n install -m 0755 -o root -g root bin/ynx-explorerd /usr/local/bin/ynx-explorerd
sudo -n install -m 0644 -o root -g root systemd/ynx-explorerd.service /etc/systemd/system/ynx-explorerd.service
if [[ "$reserve_mode" == "configure" ]] || ! sudo -n test -f /etc/ynx/ynx-explorerd.env; then
  sudo -n install -m 0600 -o root -g root config/ynx-explorerd.env /etc/ynx/ynx-explorerd.env
fi
if [[ "$reserve_mode" == "configure" ]]; then
  sudo -n install -m 0640 -o root -g ynx config/stable-reserve-attestation.json /etc/ynx/stable-reserve-attestation.json
fi

sudo -n bash -lc 'set -a; source /etc/ynx/ynx-chaind.env; source /etc/ynx/ynx-explorerd.env; set +a; /usr/local/bin/ynx-explorerd --check-config >/dev/null'
sudo -n systemctl daemon-reload
sudo -n systemctl restart ynx-explorerd.service
sudo -n systemctl is-active --quiet ynx-explorerd.service

probe="$(mktemp)"
cleanup_probe() { rm -f "$probe"; }
trap cleanup_probe RETURN
curl -fsS --max-time 10 http://127.0.0.1:6427/health >"$probe"
grep -Fq "\"commit\":\"$source_commit\"" "$probe"
if [[ "$reserve_mode" == "configure" ]]; then
  curl -fsS --max-time 10 http://127.0.0.1:6427/api/stable/reserve >"$probe"
  grep -Fq '"externalReserveAttested":true' "$probe"
  grep -Fq "\"sourceCommit\":\"$source_commit\"" "$probe"
else
  status="$(curl -sS --max-time 10 -o "$probe" -w '%{http_code}' http://127.0.0.1:6427/api/stable/reserve)"
  if [[ "$status" == "200" ]]; then
    grep -Fq '"externalReserveAttested":true' "$probe"
  else
    [[ "$status" == "503" ]]
    grep -Fq '"YNX_STABLE_RESERVE_UNAVAILABLE"' "$probe"
  fi
fi
cleanup_probe
trap - RETURN

deployment_complete=1
echo "scoped Explorer deployment verified: release=$release reserveMode=$reserve_mode sourceCommit=$source_commit"
