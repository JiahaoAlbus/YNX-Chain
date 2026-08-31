#!/usr/bin/env bash
set -Eeuo pipefail

output_path="${1:?local output path required}"
[[ ! -e "$output_path" && ! -L "$output_path" ]] || { printf 'LOCAL_OUTPUT_PREEXISTS\n' >&2; exit 65; }
for name in YNX_CHAIN_SG_SSH_IDENTITY YNX_CHAIN_SV_SSH_IDENTITY YNX_CHAIN_SEOUL_SSH_IDENTITY; do
  value="${!name:-}"
  [[ -n "$value" && -f "$value" && ! -L "$value" && -r "$value" ]] || { printf 'IDENTITY_UNAVAILABLE:%s\n' "$name" >&2; exit 65; }
done

known_hosts="/Users/huangjiahao/.ssh/known_hosts"
ssh_common=(-o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts" -o ConnectTimeout=10 -o ConnectionAttempts=1)

inspect_peer() {
  local role="$1" user="$2" host="$3" identity="$4" remote_bash
  if [[ "$user" == root ]]; then remote_bash=(/bin/bash -s -- "$role"); else remote_bash=(sudo -n /bin/bash -s -- "$role"); fi
  /usr/bin/ssh -i "$identity" "${ssh_common[@]}" "$user@$host" "${remote_bash[@]}" <<'REMOTE'
set -Eeuo pipefail
role="$1"
sha() { sha256sum "$1" | awk '{print $1}'; }
tuple() { stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
file_record() {
  local label="$1" path="$2"
  if [[ -L "$path" ]]; then printf '%s=symlink:%s\n' "$label" "$(readlink "$path")"; return; fi
  if [[ -f "$path" ]]; then printf '%s=regular:%s:%s\n' "$label" "$(tuple "$path")" "$(sha "$path")"; return; fi
  if [[ -e "$path" ]]; then printf '%s=other:%s\n' "$label" "$(tuple "$path")"; return; fi
  printf '%s=absent\n' "$label"
}
dir_record() {
  local label="$1" path="$2" depth="$3" inventory children
  if [[ -L "$path" ]]; then printf '%s=symlink:%s\n' "$label" "$(readlink "$path")"; return; fi
  if [[ -d "$path" ]]; then
    inventory="$(find "$path" -maxdepth "$depth" -mindepth 1 -printf '%P:%y:%s\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')"
    children="$(find "$path" -maxdepth 1 -mindepth 1 -printf . | wc -c | tr -d ' ')"
    printf '%s=directory:%s:children=%s:inventory=%s\n' "$label" "$(tuple "$path")" "$children" "$inventory"
    return
  fi
  printf '%s=absent\n' "$label"
}
env_key_record() {
  local key="$1" line
  line="$(grep -E "^[[:space:]]*${key}=" /etc/ynx/ynx-chaind.env || true)"
  if [[ -n "$line" ]]; then printf 'env.%s=present:lineSha256=%s\n' "$key" "$(printf '%s' "$line" | sha256sum | awk '{print $1}')"; else printf 'env.%s=absent\n' "$key"; fi
}
http_record() { printf '%s.httpStatus=%s\n' "$1" "$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$2" 2>/dev/null || true)"; }
manifest_inventory() {
  local path="$1" count digest
  count="$(find "$path" -maxdepth 4 -type f \( -name manifest.json -o -name release-manifest.json -o -name SHA256SUMS \) -printf . 2>/dev/null | wc -c | tr -d ' ')"
  digest="$(find "$path" -maxdepth 4 -type f \( -name manifest.json -o -name release-manifest.json -o -name SHA256SUMS \) -printf '%P:%s\n' 2>/dev/null | LC_ALL=C sort | sha256sum | awk '{print $1}')"
  printf 'manifestInventory[%s]=count=%s:sha256=%s\n' "$path" "$count" "$digest"
}

printf 'role=%s\nidentity=protected-present\n' "$role"
for unit in ynx-chaind.service ynx-v2-peer.service ynx-v2-node.service; do
  printf 'unit.%s=%s:%s:%s:%s:%s:%s:%s\n' "$unit" "$(systemctl show "$unit" -p LoadState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p ActiveState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p SubState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p MainPID --value 2>/dev/null || true)" "$(systemctl show "$unit" -p NRestarts --value 2>/dev/null || true)" "$(systemctl show "$unit" -p UnitFileState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p FragmentPath --value 2>/dev/null || true)"
done
file_record binary /usr/local/bin/ynx-chaind
file_record unit6423 /etc/systemd/system/ynx-chaind.service
file_record env6423 /etc/ynx/ynx-chaind.env
for key in YNX_LOCAL_VALIDATOR_ADDRESS YNX_PEER_RPC_URLS YNX_REPLICATION_SOURCE_URL; do env_key_record "$key"; done
printf 'unit6423.execStartSha256=%s\nunit6423.environmentFilesSha256=%s\n' "$(systemctl show ynx-chaind.service -p ExecStart --value | sha256sum | awk '{print $1}')" "$(systemctl show ynx-chaind.service -p EnvironmentFiles --value | sha256sum | awk '{print $1}')"
dir_record testnetState /var/lib/ynx-chain/testnet 4
dir_record snapshotV2 /var/lib/ynx-chain/testnet/snapshot-v2 4
printf 'genesisFiles.count=%s\n' "$(find /var/lib/ynx-chain/testnet -maxdepth 5 -type f -name genesis.json -printf . 2>/dev/null | wc -c | tr -d ' ')"
dir_record releases /opt/ynx-chain/releases 3
dir_record rollbacks /opt/ynx-chain/rollback 3
dir_record backups /var/backups/ynx-chain 3
manifest_inventory /opt/ynx-chain/releases
manifest_inventory /var/backups/ynx-chain
printf 'listener6420=%s\n' "$(ss -ltnH | awk '$4 ~ /:6420$/ {print $4}' | paste -sd, - || true)"
http_record health6420 http://127.0.0.1:6420/health
http_record status6420 http://127.0.0.1:6420/status
REMOTE
}

{
  printf 'inspection=P0-330_CHAIN_PEER_6423_PRIVILEGED_READONLY_PREPARATION\n'
  inspect_peer singapore root 43.134.23.58 "$YNX_CHAIN_SG_SSH_IDENTITY"
  inspect_peer silicon-valley ubuntu 43.162.100.54 "$YNX_CHAIN_SV_SSH_IDENTITY"
  inspect_peer seoul root 43.164.132.81 "$YNX_CHAIN_SEOUL_SSH_IDENTITY"
  printf 'mutationCount=0\n'
} >"$output_path"
