#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
ynx_ops_init

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" && "${CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED:-}" != "yes" ]]; then
  echo "CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED=yes is required" >&2
  exit 1
fi

mode=create
if [[ "${CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME:-}" == "yes" ]]; then
  mode=inspect
fi

commit="$(git rev-parse --short=12 HEAD)"
work="${CONSENSUS_CANDIDATE_KEY_WORK_ROOT:-tmp/consensus-candidate-key-ceremony}"
rm -rf "$work"
mkdir -p "$work/public"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$work/ynx-consensus-key-init" ./cmd/ynx-consensus-key-init

preflight_key_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_dir="/etc/ynx/consensus-candidate/$role"
  if [[ "$mode" == "create" ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "id -u ynx >/dev/null && sudo test ! -e '$key_dir' && systemctl is-active ynx-chaind >/dev/null"
  else
    ynx_ops_ssh "$role" "$user" "$host" "$key" "id -u ynx >/dev/null && { sudo test ! -e '$key_dir' || { sudo test -s '$key_dir/priv_validator_key.json' && sudo test -s '$key_dir/priv_validator_state.json' && sudo test -s '$key_dir/node_key.json'; }; } && systemctl is-active ynx-chaind >/dev/null"
  fi
}
ynx_ops_each_node preflight_key_role

initialize_key_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local remote_binary="/tmp/ynx-consensus-key-init-${commit}" key_dir="/etc/ynx/consensus-candidate/$role" remote_record="/tmp/ynx-consensus-public-${role}-${commit}.json"
  local remote_mode="$mode"
  [[ "$mode" == "inspect" ]] && remote_mode="\$(if sudo test -d '$key_dir'; then printf inspect; else printf create; fi)"
  if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN [%s] scp -i %q %q %q:%q\n' "$role" "$key" "$work/ynx-consensus-key-init" "$user@$host" "$remote_binary"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo install -d -m 0700 /etc/ynx/consensus-candidate && sudo '$remote_binary' -mode \"$remote_mode\" -owner-controlled -role '$role' -key-dir '$key_dir' -public-record '$remote_record' >/dev/null && sudo chown -R ynx:ynx '$key_dir' && sudo chmod 0700 '$key_dir' && sudo chmod 0600 '$key_dir/priv_validator_key.json' '$key_dir/priv_validator_state.json' '$key_dir/node_key.json' && sudo cat '$remote_record' && sudo rm -f '$remote_record' '$remote_binary'"
    return 0
  fi
  scp -i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "$work/ynx-consensus-key-init" "$user@$host:$remote_binary"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "chmod 0755 '$remote_binary' && sudo install -d -m 0700 /etc/ynx/consensus-candidate && sudo '$remote_binary' -mode \"$remote_mode\" -owner-controlled -role '$role' -key-dir '$key_dir' -public-record '$remote_record' >/dev/null && sudo chown -R ynx:ynx '$key_dir' && sudo chmod 0700 '$key_dir' && sudo chmod 0600 '$key_dir/priv_validator_key.json' '$key_dir/priv_validator_state.json' '$key_dir/node_key.json' && sudo cat '$remote_record' && sudo rm -f '$remote_record' '$remote_binary'" >"$work/public/$role.json"
  chmod 0600 "$work/public/$role.json"
  node -e 'const fs=require("fs"),p=process.argv[1],r=process.argv[2],v=JSON.parse(fs.readFileSync(p)); if(v.role!==r||v.custodyBoundary!=="owner-controlled-host-local"||!/^[0-9A-F]{40}$/.test(v.consensusAddress)||!/^[0-9a-f]{40}$/.test(v.nodeId)) process.exit(1)' "$work/public/$role.json" "$role"
}
ynx_ops_each_node initialize_key_role

if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  echo "candidate key ceremony dry-run completed; no keys were generated"
else
  echo "candidate public key records written to $work/public; secret keys remain mode-restricted on their assigned owner-controlled hosts"
fi
