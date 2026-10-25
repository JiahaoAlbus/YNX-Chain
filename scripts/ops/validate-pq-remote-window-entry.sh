#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only admission DATA for the original frozen remote-window caller.
# This neither starts a window nor supplies its execution or Root approval.
reject_entry() {
  printf 'YNX_REMOTE_WINDOW_ENTRY_REJECTED: %s\n' "$1" >&2
  exit 1
}

[[ "$#" -eq 9 ]] || reject_entry 'exactly nine explicit positional arguments required'
entry_event="$1"
entry_ref="$2"
entry_github_sha="$3"
entry_candidate_sha="$4"
entry_remote_retained="$5"
entry_paired_n1="$6"
entry_local_e2e="$7"
entry_local_retained="$8"
entry_remote_process="$9"

[[ "$entry_event" == 'workflow_dispatch' ]] || reject_entry 'explicit workflow_dispatch required'
[[ "$entry_github_sha" =~ ^[0-9a-f]{40}$ && "$entry_candidate_sha" =~ ^[0-9a-f]{40}$ ]] || reject_entry 'complete lowercase source and candidate SHA required'
[[ "$entry_github_sha" != '0000000000000000000000000000000000000000' && "$entry_github_sha" == "$entry_candidate_sha" ]] || reject_entry 'nonzero exact candidate source identity required'
[[ "$entry_ref" =~ ^refs/heads/codex/ynx-pq-remote-([0-9a-f]{9,40})$ ]] || reject_entry 'exact frozen remote branch ref required'
entry_suffix="${BASH_REMATCH[1]}"
[[ "$entry_candidate_sha" == "$entry_suffix"* ]] || reject_entry 'frozen branch suffix must bind the exact candidate prefix'
[[ "$entry_remote_retained" == 'true' ]] || reject_entry 'explicit remote retained-history mode required'
for entry_other_mode in "$entry_paired_n1" "$entry_local_e2e" "$entry_local_retained" "$entry_remote_process"; do
  [[ "$entry_other_mode" == '' || "$entry_other_mode" == 'false' ]] || reject_entry 'other window modes must be false or empty'
done

printf '%s\n' 'YNX_REMOTE_WINDOW_ENTRY_VALIDATED_DATA_ONLY'
