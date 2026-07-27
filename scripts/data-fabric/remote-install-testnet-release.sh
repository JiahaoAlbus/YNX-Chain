#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="${1:?usage: remote-install-testnet-release.sh <release-dir> <operator-env> <event-keys>}"
operator_env="${2:?missing operator env}"
event_keys="${3:?missing event keys}"
[[ "$(id -u)" == "0" ]] || { echo "remote installation transaction requires root" >&2; exit 1; }

manifest="$release_dir/release-manifest.json"
commit="$(jq -er '.commit | select(test("^[0-9a-f]{12}$"))' "$manifest")"
release="$(jq -er '.release' "$manifest")"
[[ "$release" == "ynx-data-fabric-${commit}" ]] || { echo "remote release identity mismatch" >&2; exit 1; }

env_value() {
  local name="$1"
  awk -F= -v name="$name" '$1 == name { print substr($0, index($0, "=") + 1); found=1; exit } END { if (!found) exit 1 }' "$operator_env"
}

fabric_origin="$(env_value YNX_PAY_DATA_FABRIC_URL)"
bft_origin="$(env_value YNX_PAY_DATA_FABRIC_SOURCE_URL)"
bft_release="ynx-bft-gateway-${commit}"
"$release_dir/scripts/install-testnet-release.sh" --dry-run "$release_dir" "$operator_env" "$event_keys" >/dev/null
systemctl is-active ynx-bft-gateway-candidate.service >/dev/null || { echo "BFT candidate gateway is not active" >&2; exit 1; }
bft_health="$(curl --fail --silent --show-error --max-time 10 "$bft_origin/health")"
jq -e --arg commit "$commit" --arg release "$bft_release" \
  '.ok == true and .build.commit == $commit and .build.release == $release and .chainId == 6423 and .validatorCount == 4' \
  <<<"$bft_health" >/dev/null || { echo "BFT candidate preflight identity mismatch" >&2; exit 1; }

backup_root="/var/backups/ynx-data-fabric/${release}"
backup_archive="$backup_root/previous-install.tar.gz"
active_services="$backup_root/previous-active-services"
enabled_services="$backup_root/previous-enabled-services"
if [[ -s "$backup_archive" && -f "$active_services" && -f "$enabled_services" ]]; then
  "$release_dir/scripts/verify-testnet-deployment.sh" \
    "$fabric_origin" "$bft_origin" "$commit" "$release" /etc/ynx-data-fabric/data-fabric.env /usr/local/bin/ynx-pay-data-fabric-bridge
  printf 'release=%s\ncommit=%s\nbackup=%s\ninstalled=true\nverified=true\nreused=true\n' "$release" "$commit" "$backup_archive"
  exit 0
fi
install -d -m 0700 "$backup_root"
[[ ! -e "$backup_archive" && ! -e "$active_services" && ! -e "$enabled_services" ]] || { echo "incomplete backup for this release already exists; refusing to overwrite rollback state" >&2; exit 1; }

services=(ynx-data-fabricd.service ynx-data-fabric-worker.service ynx-pay-data-fabric-bridge.service)
for service in "${services[@]}"; do
  if systemctl is-active --quiet "$service"; then printf '%s\n' "$service" >>"$active_services"; fi
  if systemctl is-enabled --quiet "$service"; then printf '%s\n' "$service" >>"$enabled_services"; fi
done
chmod 0600 "$active_services" "$enabled_services"

targets=(
  usr/local/bin/ynx-data-fabricctl
  usr/local/bin/ynx-data-fabricd
  usr/local/bin/ynx-data-fabric-worker
  usr/local/bin/ynx-pay-data-fabric-bridge
  etc/ynx-data-fabric
  etc/systemd/system/ynx-data-fabricd.service
  etc/systemd/system/ynx-data-fabric-worker.service
  etc/systemd/system/ynx-pay-data-fabric-bridge.service
)
existing=()
for target in "${targets[@]}"; do [[ -e "/$target" ]] && existing+=("$target"); done
if ((${#existing[@]} > 0)); then
  tar -czf "$backup_archive" -C / "${existing[@]}"
else
  tar -czf "$backup_archive" --files-from /dev/null
fi
chmod 0600 "$backup_archive"

mutation_started=0
completed=0
rollback() {
  local status="$?"
  trap - ERR EXIT
  if [[ "$mutation_started" == "1" && "$completed" == "0" ]]; then
    set +e
    systemctl disable --now "${services[@]}" >/dev/null 2>&1
    for target in "${targets[@]}"; do rm -rf "/$target"; done
    tar -xzf "$backup_archive" -C /
    systemctl daemon-reload
    while IFS= read -r service; do [[ -n "$service" ]] && systemctl enable "$service"; done <"$enabled_services"
    while IFS= read -r service; do [[ -n "$service" ]] && systemctl start "$service"; done <"$active_services"
    echo "Data Fabric Testnet installation failed and previous files/services were restored" >&2
  fi
  exit "$status"
}
trap rollback ERR EXIT

mutation_started=1
"$release_dir/scripts/install-testnet-release.sh" "$release_dir" "$operator_env" "$event_keys"
"$release_dir/scripts/verify-testnet-deployment.sh" \
  "$fabric_origin" "$bft_origin" "$commit" "$release" /etc/ynx-data-fabric/data-fabric.env /usr/local/bin/ynx-pay-data-fabric-bridge
for service in "${services[@]}"; do systemctl is-active "$service" >/dev/null; done

completed=1
trap - ERR EXIT
printf 'release=%s\ncommit=%s\nbackup=%s\ninstalled=true\nverified=true\n' "$release" "$commit" "$backup_archive"
