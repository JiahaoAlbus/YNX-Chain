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
  local label="$1" path="$2" inventory
  if [[ -L "$path" ]]; then printf '%s=symlink:%s\n' "$label" "$(readlink "$path")"; return; fi
  if [[ -d "$path" ]]; then
    inventory="$(find "$path" -maxdepth 1 -mindepth 1 -printf '%f:%y\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')"
    printf '%s=directory:%s:children=%s:inventory=%s\n' "$label" "$(tuple "$path")" "$(find "$path" -maxdepth 1 -mindepth 1 -printf . | wc -c | tr -d ' ')" "$inventory"
    return
  fi
  printf '%s=absent\n' "$label"
}
config_record() {
  local label="$1" path="$2" seed peers chain
  file_record "$label" "$path"
  [[ -f "$path" && ! -L "$path" ]] || return
  seed="$(grep -E '^[[:space:]]*seeds[[:space:]]*=' "$path" 2>/dev/null | sha256sum | awk '{print $1}')"
  peers="$(grep -E '^[[:space:]]*persistent_peers[[:space:]]*=' "$path" 2>/dev/null | sha256sum | awk '{print $1}')"
  chain="$(grep -E '^[[:space:]]*chain-id[[:space:]]*=' "$path" 2>/dev/null | sed -E 's/.*=[[:space:]]*"?([^"[:space:]]+).*/\1/' | head -n 1 || true)"
  printf '%s.seedLineSha256=%s\n%s.persistentPeersLineSha256=%s\n%s.chainId=%s\n' "$label" "$seed" "$label" "$peers" "$label" "${chain:-absent}"
}
status_record() {
  local label="$1" url="$2" code
  code="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
  printf '%s.httpStatus=%s\n' "$label" "${code:-transport-failed}"
}

printf 'role=%s\n' "$role"
printf 'identity=protected-present\n'
for unit in ynx-chaind.service ynx-v2-peer.service ynx-v2-node.service; do
  printf 'unit.%s=%s:%s:%s:%s:%s:%s\n' "$unit" "$(systemctl show "$unit" -p LoadState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p ActiveState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p SubState --value 2>/dev/null || true)" "$(systemctl show "$unit" -p MainPID --value 2>/dev/null || true)" "$(systemctl show "$unit" -p NRestarts --value 2>/dev/null || true)" "$(systemctl show "$unit" -p FragmentPath --value 2>/dev/null || true)"
done
file_record binary /usr/local/bin/ynx-chaind
file_record unit6423 /etc/systemd/system/ynx-chaind.service
file_record env6423 /etc/ynx-chain/ynx-chaind.env
dir_record optChain /opt/ynx-chain
dir_record varChain /var/lib/ynx-chain
for home in /opt/ynx-chain /var/lib/ynx-chain /root/.ynx /home/ubuntu/.ynx; do
  if [[ -d "$home/config" && ! -L "$home/config" ]]; then
    printf 'home=%s\n' "$home"
    config_record "config[$home]" "$home/config/config.toml"
    file_record "genesis[$home]" "$home/config/genesis.json"
    file_record "nodeKey[$home]" "$home/config/node_key.json"
    if [[ -x /usr/local/bin/ynx-chaind ]]; then
      printf 'nodeId[%s]=%s\n' "$home" "$(timeout 5 /usr/local/bin/ynx-chaind tendermint show-node-id --home "$home" 2>/dev/null || true)"
    fi
  fi
done
printf 'listener6420=%s\n' "$(ss -ltnH 2>/dev/null | awk '$4 ~ /:6420$/ {print $4}' | paste -sd, - || true)"
status_record health6420 http://127.0.0.1:6420/health
status_record status6420 http://127.0.0.1:6420/status
REMOTE
}

{
  printf 'inspection=P0-328_CHAIN_PEER_6423_DEPLOYMENT_PREPARATION_READONLY\n'
  inspect_peer singapore root 43.134.23.58 "$YNX_CHAIN_SG_SSH_IDENTITY"
  inspect_peer silicon-valley ubuntu 43.162.100.54 "$YNX_CHAIN_SV_SSH_IDENTITY"
  inspect_peer seoul root 43.164.132.81 "$YNX_CHAIN_SEOUL_SSH_IDENTITY"
  printf 'mutationCount=0\n'
} >"$output_path"
