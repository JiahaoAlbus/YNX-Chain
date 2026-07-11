#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
ynx_ops_init

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" && "${CONSENSUS_OVERLAY_KEY_CEREMONY_APPROVED:-}" != "yes" ]]; then
  echo "CONSENSUS_OVERLAY_KEY_CEREMONY_APPROVED=yes is required" >&2
  exit 1
fi

mode=create
if [[ "${CONSENSUS_OVERLAY_KEY_CEREMONY_RESUME:-}" == "yes" ]]; then
  mode=inspect
fi

work="${CONSENSUS_OVERLAY_KEY_WORK_ROOT:-tmp/consensus-overlay-key-ceremony}"
rm -rf "$work"
mkdir -p "$work/public"

overlay_address_for_role() {
  case "$1" in
    primary) printf '10.77.42.1' ;;
    singapore) printf '10.77.42.2' ;;
    silicon-valley) printf '10.77.42.3' ;;
    seoul) printf '10.77.42.4' ;;
    *) return 1 ;;
  esac
}

preflight_overlay_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_path="/etc/ynx/consensus-candidate/$role/wireguard.key"
  if [[ "$mode" == "create" ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "modinfo wireguard >/dev/null && sudo test ! -e '$key_path' && systemctl is-active ynx-chaind >/dev/null"
  else
    ynx_ops_ssh "$role" "$user" "$host" "$key" "modinfo wireguard >/dev/null && sudo test -s '$key_path' && systemctl is-active ynx-chaind >/dev/null"
  fi
}
ynx_ops_each_node preflight_overlay_role

initialize_overlay_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_path="/etc/ynx/consensus-candidate/$role/wireguard.key" public_key overlay_address
  overlay_address="$(overlay_address_for_role "$role")"
  local install_tools="command -v wg >/dev/null || { sudo apt-get update >/dev/null && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard-tools >/dev/null; }"
  local create_key="sudo sh -c 'umask 077; wg genkey > \"$key_path\"'"
  [[ "$mode" == "inspect" ]] && create_key=":"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "$install_tools; $create_key; sudo test \"\$(stat -c %a '$key_path')\" = 600; sudo sh -c 'wg pubkey < \"$key_path\"'; systemctl is-active ynx-chaind >/dev/null"
    return 0
  fi
  public_key="$(ynx_ops_ssh "$role" "$user" "$host" "$key" "$install_tools; $create_key; sudo test \"\$(stat -c %a '$key_path')\" = 600; sudo sh -c 'wg pubkey < \"$key_path\"'; systemctl is-active ynx-chaind >/dev/null")"
  [[ "$public_key" =~ ^[A-Za-z0-9+/]{43}=$ ]] || { echo "invalid WireGuard public key returned for $role" >&2; return 1; }
  node -e 'const fs=require("fs"),[file,role,endpoint,address,key]=process.argv.slice(1); fs.writeFileSync(file, JSON.stringify({version:1,purpose:"ynx-consensus-private-overlay-public-keys-only",role,publicEndpoint:endpoint,overlayAddress:address,listenPort:51820,wireGuardPublicKey:key,custodyBoundary:"owner-controlled-host-local"},null,2)+"\n",{mode:0o600})' "$work/public/$role.json" "$role" "$host" "$overlay_address" "$public_key"
}
ynx_ops_each_node initialize_overlay_role

if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  echo "consensus overlay key ceremony dry-run completed; no packages or keys were installed"
else
  node - "$work/public" <<'NODE'
const fs = require("fs"), path = require("path");
const root = process.argv[2], roles = ["primary", "singapore", "silicon-valley", "seoul"];
const records = roles.map((role) => JSON.parse(fs.readFileSync(path.join(root, `${role}.json`))));
if (new Set(records.map((record) => record.wireGuardPublicKey)).size !== 4 || new Set(records.map((record) => record.overlayAddress)).size !== 4) throw new Error("overlay ceremony public records are not unique");
NODE
  echo "consensus overlay public records written to $work/public; WireGuard secret keys remain on their assigned hosts and no interface was configured"
fi
