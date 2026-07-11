#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
ynx_ops_init

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" && "${CONSENSUS_CANDIDATE_ROLLBACK_APPROVED:-}" != "yes" ]]; then
  echo "CONSENSUS_CANDIDATE_ROLLBACK_APPROVED=yes is required" >&2
  exit 1
fi

backup_release="${CONSENSUS_CANDIDATE_BACKUP_RELEASE:-}"

rollback_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local command="sudo systemctl disable --now ynx-consensus-comet-candidate.service ynx-consensus-abci-candidate.service || true"
  if [[ -n "$backup_release" ]]; then
    local snapshot="/var/backups/ynx-chain/consensus-candidate-before-${backup_release}-${role}.tar.gz"
    command+="; sudo test -s '$snapshot'; entries=\$(sudo tar -tzf '$snapshot'); while IFS= read -r entry; do case \"\$entry\" in var/lib/ynx-chain/consensus-candidate|var/lib/ynx-chain/consensus-candidate/*|etc/systemd/system/ynx-consensus-abci-candidate.service|etc/systemd/system/ynx-consensus-comet-candidate.service) ;; *) echo \"unsafe candidate snapshot entry: \$entry\" >&2; exit 1 ;; esac; done <<< \"\$entries\"; sudo rm -rf /var/lib/ynx-chain/consensus-candidate; sudo tar -xzf '$snapshot' -C /; sudo systemctl daemon-reload"
  else
    command+="; sudo rm -rf /var/lib/ynx-chain/consensus-candidate; sudo rm -f /etc/systemd/system/ynx-consensus-abci-candidate.service /etc/systemd/system/ynx-consensus-comet-candidate.service; sudo systemctl daemon-reload"
  fi
  command+="; systemctl is-active ynx-chaind >/dev/null; echo 'candidate rolled back; authoritative ynx-chaind remains active'"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "$command"
}

ynx_ops_each_node rollback_candidate_role
