#!/usr/bin/env bash
set -Eeuo pipefail

# Pure shell controls for the real read-only entry callee. No daemon, node,
# compiler, runtime window, network, key, deployment or approval is involved.
[[ "$#" -eq 0 ]] || { printf '%s\n' 'entry controls accept no arguments' >&2; exit 1; }
entry_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
entry_callee="$entry_repo/scripts/ops/validate-pq-remote-window-entry.sh"
entry_sha='a123456789abcdef0123456789abcdef01234567'
entry_other_sha='b123456789abcdef0123456789abcdef01234567'
entry_ref='refs/heads/codex/ynx-pq-remote-a12345678'
entry_positive_count=0
entry_negative_count=0

check_entry() {
  local expected="$1" label="$2" output status
  shift 2
  local original=("$@")
  if output="$(bash "$entry_callee" "$@" 2>&1)"; then status=0; else status="$?"; fi
  if [[ "$expected" == 'accept' ]]; then
    [[ "$status" -eq 0 && "$output" == 'YNX_REMOTE_WINDOW_ENTRY_VALIDATED_DATA_ONLY' ]] || {
      printf 'entry positive control failed: %s (status %s)\n' "$label" "$status" >&2; exit 1;
    }
    entry_positive_count=$((entry_positive_count + 1))
  else
    [[ "$status" -ne 0 && "$output" == YNX_REMOTE_WINDOW_ENTRY_REJECTED:* && "$output" != *'YNX_REMOTE_WINDOW_ENTRY_VALIDATED_DATA_ONLY'* ]] || {
      printf 'entry negative control failed: %s (status %s)\n' "$label" "$status" >&2; exit 1;
    }
    entry_negative_count=$((entry_negative_count + 1))
  fi
  [[ "$#" -eq "${#original[@]}" ]] || { printf '%s\n' 'entry callee changed original argument count' >&2; exit 1; }
  local index=0
  for entry_argument in "$@"; do
    [[ "$entry_argument" == "${original[$index]}" ]] || { printf '%s\n' 'entry callee changed original argument bytes' >&2; exit 1; }
    index=$((index + 1))
  done
}

check_entry accept explicit-false workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false false false
check_entry accept github-empty-defaults workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true '' '' '' ''
check_entry accept mixed-false-and-empty workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false '' false ''
check_entry accept complete-frozen-suffix workflow_dispatch "refs/heads/codex/ynx-pq-remote-$entry_sha" "$entry_sha" "$entry_sha" true false false false false

check_entry reject no-arguments
check_entry reject missing-last-argument workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false false
check_entry reject extra-argument workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false false false extra
for entry_bad_event in '' push pull_request workflow_call workflow_dispatch_extra; do
  check_entry reject wrong-event "$entry_bad_event" "$entry_ref" "$entry_sha" "$entry_sha" true false false false false
done
for entry_bad_ref in '' codex/ynx-pq-remote-a12345678 refs/tags/codex/ynx-pq-remote-a12345678 refs/heads/codex/ynx-pq-perf-integration refs/heads/codex/ynx-pq-remote-a1234567 refs/heads/codex/ynx-pq-remote-A12345678 refs/heads/codex/ynx-pq-remote-a12345678-extra refs/heads/codex/ynx-pq-remote-a123456789abcdef0123456789abcdef012345678 refs/heads/codex/ynx-pq-remote-b12345678; do
  check_entry reject wrong-frozen-ref workflow_dispatch "$entry_bad_ref" "$entry_sha" "$entry_sha" true false false false false
done
check_entry reject ref-prefix-of-other-commit workflow_dispatch "$entry_ref" "$entry_other_sha" "$entry_other_sha" true false false false false
check_entry reject mismatched-candidate workflow_dispatch "$entry_ref" "$entry_sha" "$entry_other_sha" true false false false false
for entry_bad_sha in '' 0000000000000000000000000000000000000000 a12345678 A123456789abcdef0123456789abcdef01234567 a123456789abcdef0123456789abcdef012345678 z123456789abcdef0123456789abcdef01234567 ' a123456789abcdef0123456789abcdef01234567'; do
  check_entry reject wrong-source-sha workflow_dispatch "$entry_ref" "$entry_bad_sha" "$entry_sha" true false false false false
  check_entry reject wrong-candidate-sha workflow_dispatch "$entry_ref" "$entry_sha" "$entry_bad_sha" true false false false false
done
check_entry reject both-zero workflow_dispatch refs/heads/codex/ynx-pq-remote-000000000 0000000000000000000000000000000000000000 0000000000000000000000000000000000000000 true false false false false
for entry_bad_mode in '' false True TRUE 1 true_extra; do
  check_entry reject wrong-remote-mode workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" "$entry_bad_mode" false false false false
done
for entry_bad_other in true False FALSE 0 unknown; do
  check_entry reject paired-conflict workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true "$entry_bad_other" false false false
  check_entry reject local-e2e-conflict workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false "$entry_bad_other" false false
  check_entry reject local-retained-conflict workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false "$entry_bad_other" false
  check_entry reject remote-process-conflict workflow_dispatch "$entry_ref" "$entry_sha" "$entry_sha" true false false false "$entry_bad_other"
done

printf 'YNX_REMOTE_WINDOW_ENTRY_CONTROLS_DATA_ONLY positive=%s negative=%s\n' "$entry_positive_count" "$entry_negative_count"
