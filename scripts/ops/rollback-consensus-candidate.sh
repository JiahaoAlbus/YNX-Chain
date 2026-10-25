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

# Approval to request rollback is not proof that an old archive contains the
# latest HRS/signed history. Refuse before invoking transport or changing any
# service, candidate tree, staged release, archive, or uncertain result.
if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
  echo "UNSAFE_AUTOMATIC_CANDIDATE_ROLLBACK_REFUSED: retain current HRS, signed history, staged packages, archives and UNKNOWN results; independently review recovery without rewinding signing state" >&2
  exit 1
fi

rollback_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  printf 'DRY RUN [%s] UNSAFE_AUTOMATIC_CANDIDATE_ROLLBACK_REFUSED: preserve signing state, staged packages and archives; no transport or rollback performed\n' "$role"
}

ynx_ops_each_node rollback_candidate_role
