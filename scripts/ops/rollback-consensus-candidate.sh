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
candidate_release="${CONSENSUS_CANDIDATE_RELEASE:-}"
if [[ -n "$candidate_release" && ! "$candidate_release" =~ ^ynx-consensus-candidate-[0-9a-f]{12}$ ]]; then
  echo "CONSENSUS_CANDIDATE_RELEASE is invalid" >&2
  exit 1
fi

rollback_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local command="sudo systemctl disable --now ynx-consensus-comet-candidate.service ynx-consensus-abci-candidate.service || true"
  if [[ -n "$backup_release" ]]; then
    local snapshot="/var/backups/ynx-chain/consensus-candidate-before-${backup_release}-${role}.tar.gz"
    command+="; sudo test -s '$snapshot'; entries=\$(sudo tar -tzf '$snapshot'); while IFS= read -r entry; do case \"\$entry\" in var/lib/ynx-chain/consensus-candidate|var/lib/ynx-chain/consensus-candidate/*|etc/systemd/system/ynx-consensus-abci-candidate.service|etc/systemd/system/ynx-consensus-comet-candidate.service) ;; *) echo \"unsafe candidate snapshot entry: \$entry\" >&2; exit 1 ;; esac; done <<< \"\$entries\"; sudo rm -rf /var/lib/ynx-chain/consensus-candidate; sudo tar -xzf '$snapshot' -C /; sudo systemctl daemon-reload"
  else
    command+="; sudo rm -rf /var/lib/ynx-chain/consensus-candidate; sudo rm -f /etc/systemd/system/ynx-consensus-abci-candidate.service /etc/systemd/system/ynx-consensus-comet-candidate.service; sudo systemctl daemon-reload"
  fi
  if [[ -n "$candidate_release" ]]; then
    command+="; sudo rm -rf '/opt/ynx-chain/consensus-candidates/$candidate_release/$role'; rm -f '/tmp/$candidate_release-$role.tar.gz'"
  fi
  command+="; systemctl is-active ynx-chaind >/dev/null; ! systemctl is-active --quiet ynx-consensus-comet-candidate.service; ! systemctl is-active --quiet ynx-consensus-abci-candidate.service"
  if [[ -z "$backup_release" ]]; then
    command+="; sudo test ! -e /var/lib/ynx-chain/consensus-candidate; ! ss -ltn | awk '{print \$4}' | grep -Eq ':(27656|27757|27858)$'"
  fi
  command+="; echo 'candidate rolled back; authoritative ynx-chaind remains active'"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "$command"
}

ynx_ops_each_node rollback_candidate_role
