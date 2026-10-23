#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
ynx_ops_init
# A lost SSH response may follow successful key creation. Shared transport
# retry is never appropriate for this one-shot ceremony, including copy/inspect.
export YNX_DEPLOY_CONNECTION_ATTEMPTS=1

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" && "${CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED:-}" != "yes" ]]; then
  echo "CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED=yes is required" >&2
  exit 1
fi

case "${CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME:-}" in
  ''|no) mode=create ;;
  yes) mode=inspect ;;
  *) echo 'CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME must be yes, no or empty' >&2; exit 64 ;;
esac

commit="$(git rev-parse --short=12 HEAD)"
if [[ "${DEPLOY_DRY_RUN:-0}" == "1" && -z "${CONSENSUS_CANDIDATE_KEY_WORK_ROOT:-}" ]]; then
  work="$(mktemp -d)"
else
  work="${CONSENSUS_CANDIDATE_KEY_WORK_ROOT:-tmp/consensus-candidate-key-ceremony}"
  # A new attempt cannot replace any earlier public record, partial output or
  # UNKNOWN. Mkdir is the exclusive reservation even after the precheck races.
  [[ ! -e "$work" && ! -L "$work" ]] || { echo "key ceremony work directory already exists; retain and reconcile it: $work" >&2; exit 1; }
  mkdir -p -- "$(dirname "$work")"
  mkdir -m 0700 -- "$work"
fi
work="$(cd "$work" && pwd -P)"
trap 'status=$?; printf "key ceremony attempt retained (exit=%s): %s; no automatic retry or regeneration\n" "$status" "$work" >&2; exit "$status"' ERR
mkdir -m 0700 "$work/public"
# The token reserves only a public transport attempt, never a validator epoch.
# It gives each host a new exclusive stage without overwriting old /tmp files.
attempt="$(basename "$(mktemp -d "$work/attempt.XXXXXXXXXXXX")")"
printf 'mode=%s\ncommit=%s\nattempt=%s\n' "$mode" "$commit" "$attempt" >"$work/intent.txt"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$work/ynx-consensus-key-init" ./cmd/ynx-consensus-key-init >"$work/build.stdout" 2>"$work/build.stderr"

preflight_key_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_dir="/etc/ynx/consensus-candidate/$role"
  if [[ "$mode" == "create" ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "id -u ynx >/dev/null && sudo test ! -e '$key_dir' && sudo test ! -L '$key_dir' && systemctl is-active ynx-chaind >/dev/null" >"$work/$role.preflight.stdout" 2>"$work/$role.preflight.stderr"
  else
    # Metadata only. A missing directory/key/HRS is not evidence that identity
    # was never used; resume must never turn it into a new create operation.
    ynx_ops_ssh "$role" "$user" "$host" "$key" "id -u ynx >/dev/null && sudo test -d '$key_dir' && sudo test ! -L '$key_dir' && test \"\$(sudo realpath -e '$key_dir')\" = '$key_dir' && test \"\$(sudo stat -c %U:%a '$key_dir')\" = ynx:700 && for name in priv_validator_key.json priv_validator_state.json node_key.json; do sudo test -f '$key_dir'/\"\$name\" && sudo test ! -L '$key_dir'/\"\$name\" && sudo test -s '$key_dir'/\"\$name\" && test \"\$(sudo stat -c %U:%a:%h '$key_dir'/\"\$name\")\" = ynx:600:1 || exit 1; done && systemctl is-active ynx-chaind >/dev/null" >"$work/$role.preflight.stdout" 2>"$work/$role.preflight.stderr"
  fi
}
ynx_ops_each_node preflight_key_role

initialize_key_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_dir="/etc/ynx/consensus-candidate/$role" remote_stage="/var/tmp/ynx-consensus-key-ceremony-${commit}-${attempt}-${role}"
  local remote_binary="$remote_stage/ynx-consensus-key-init" remote_record="$remote_stage/public-record.json" prepare_custody='' finalize=''
  ynx_ops_ssh "$role" "$user" "$host" "$key" "umask 077; mkdir -m 0700 '$remote_stage' && (set -o noclobber; : > '$remote_binary')" >"$work/$role.reserve.stdout" 2>"$work/$role.reserve.stderr"
  ynx_ops_copy "$role" "$user" "$host" "$key" "$work/ynx-consensus-key-init" "$remote_binary" >"$work/$role.copy.stdout" 2>"$work/$role.copy.stderr"
  if [[ "$mode" == create ]]; then
    prepare_custody="sudo install -d -m 0750 -o root -g ynx /etc/ynx/consensus-candidate && "
    finalize=" && sudo chown -R ynx:ynx '$key_dir' && sudo chmod 0700 '$key_dir' && sudo chmod 0600 '$key_dir/priv_validator_key.json' '$key_dir/priv_validator_state.json' '$key_dir/node_key.json'"
  fi
  # Neither custody nor transport/public evidence is deleted after failure or
  # success. The only cat is the newly written PUBLIC record, never a key/HRS.
  ynx_ops_ssh "$role" "$user" "$host" "$key" "chmod 0755 '$remote_binary' && ${prepare_custody}sudo '$remote_binary' -mode '$mode' -owner-controlled -role '$role' -key-dir '$key_dir' -public-record '$remote_record' >/dev/null$finalize && sudo cat '$remote_record'" >"$work/public/$role.json.partial" 2>"$work/$role.ceremony.stderr"
  if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
    node -e 'const fs=require("fs"),p=process.argv[1],r=process.argv[2],v=JSON.parse(fs.readFileSync(p)); if(v.role!==r||v.custodyBoundary!=="owner-controlled-host-local"||!/^[0-9A-F]{40}$/.test(v.consensusAddress)||!/^[0-9a-f]{40}$/.test(v.nodeId)) process.exit(1)' "$work/public/$role.json.partial" "$role" >"$work/$role.validation.stdout" 2>"$work/$role.validation.stderr"
    (set -o noclobber; cat "$work/public/$role.json.partial" >"$work/public/$role.json")
  fi
}
ynx_ops_each_node initialize_key_role

if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  echo "candidate key ceremony dry-run completed; no keys were generated"
else
  echo "candidate public key records written to $work/public; secret keys remain mode-restricted on their assigned owner-controlled hosts"
fi
