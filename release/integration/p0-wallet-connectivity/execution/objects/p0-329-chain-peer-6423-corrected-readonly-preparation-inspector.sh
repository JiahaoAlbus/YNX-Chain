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
  local role="$1" user="$2" host="$3" identity="$4"
  /usr/bin/ssh -i "$identity" "${ssh_common[@]}" "$user@$host" /bin/bash -s -- "$role" <<'REMOTE'
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
  line="$(grep -E "^[[:space:]]*${key}=" /etc/ynx/ynx-chaind.env 2>/dev/null || true)"
  if [[ -n "$line" ]]; then
    printf 'env.%s=present:lineSha256=%s\n' "$key" "$(printf '%s' "$line" | sha256sum | awk '{print $1}')"
  else
    printf 'env.%s=absent\n' "$key"
  fi
}
status_record() {
  local label="$1" url="$2" code
  code="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
  printf '%s.httpStatus=%s\n' "$label" "${code:-transport-failed}"
}

printf 'role=%s\nidentity=protected-present\n' "$role"
for unit in ynx-chaind.service ynx-v2-peer.service ynx-v2-node.service; do
  printf 'unit.%s=%s:%s:%s:%s:%s:%s:%s\n' "$unit" "$(systemctl show "$unit" -p LoadState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p ActiveState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p SubState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p MainPID --value 2>/dev/null || true)" "$(systemctl show "$unit" -p NRestarts --value 2>/dev/null || true)" "$(systemctl show "$unit" -p UnitFileState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p FragmentPath --value 2>/dev/null || true)"
done
file_record binary /usr/local/bin/ynx-chaind
file_record unit6423 /etc/systemd/system/ynx-chaind.service
file_record env6423 /etc/ynx/ynx-chaind.env
for key in YNX_LOCAL_VALIDATOR_ADDRESS YNX_PEER_RPC_URLS YNX_REPLICATION_SOURCE_URL; do env_key_record "$key"; done
printf 'unit6423.execStartSha256=%s\nunit6423.environmentFilesSha256=%s\n' "$(systemctl show ynx-chaind.service -p ExecStart --value 2>/dev/null | sha256sum | awk '{print $1}')" "$(systemctl show ynx-chaind.service -p EnvironmentFiles --value 2>/dev/null | sha256sum | awk '{print $1}')"
dir_record testnetState /var/lib/ynx-chain/testnet 3
dir_record snapshotV2 /var/lib/ynx-chain/testnet/snapshot-v2 3
printf 'genesisFiles.count=%s\n' "$(find /var/lib/ynx-chain/testnet -maxdepth 5 -type f -name genesis.json -printf . 2>/dev/null | wc -c | tr -d ' ')"
printf 'stateMarkerFiles.count=%s\n' "$(find /var/lib/ynx-chain/testnet -maxdepth 5 -type f \( -name state.json -o -name state.db -o -name snapshot-v2 \) -printf . 2>/dev/null | wc -c | tr -d ' ')"
dir_record releases /opt/ynx-chain/releases 2
dir_record rollbacks /opt/ynx-chain/rollback 2
dir_record backups /var/backups/ynx-chain 2
printf 'listener6420=%s\n' "$(ss -ltnH 2>/dev/null | awk '$4 ~ /:6420$/ {print $4}' | paste -sd, - || true)"
status_record health6420 http://127.0.0.1:6420/health
status_record status6420 http://127.0.0.1:6420/status
REMOTE
}

{
  printf 'inspection=P0-329_CHAIN_PEER_6423_CORRECTED_READONLY_PREPARATION\n'
  inspect_peer singapore root 43.134.23.58 "$YNX_CHAIN_SG_SSH_IDENTITY"
  inspect_peer silicon-valley ubuntu 43.162.100.54 "$YNX_CHAIN_SV_SSH_IDENTITY"
  inspect_peer seoul root 43.164.132.81 "$YNX_CHAIN_SEOUL_SSH_IDENTITY"
  printf 'mutationCount=0\n'
} >"$output_path"
