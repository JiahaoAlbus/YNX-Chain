# Sourced by the synthetic history tests. The original command output is retained.
YNX_HISTORY_EVENT_INDEX=0
YNX_HISTORY_EVENT_DIR="$RUNNER_TEMP/ynx-pq-history-public"
mkdir -p "$YNX_HISTORY_EVENT_DIR"
test ! -e "$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE.invalid"
go() {
  YNX_HISTORY_EVENT_INDEX=$((YNX_HISTORY_EVENT_INDEX + 1))
  local path="$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE-$YNX_HISTORY_EVENT_INDEX.log" status=0
  local metadata="$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE-$YNX_HISTORY_EVENT_INDEX.json"
  test ! -e "$path" && test ! -e "$metadata" || return 119
  command go "$@" > "$path" 2>&1 || status=$?
  printf 'YNX-HISTORY-RAW-BEGIN/v1 case=%s index=%s source=%s run=%s attempt=%s exit=%s\n' "$YNX_HISTORY_EVENT_CASE" "$YNX_HISTORY_EVENT_INDEX" "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$status"
  cat "$path"
  printf 'YNX-HISTORY-RAW-END/v1 case=%s index=%s\n' "$YNX_HISTORY_EVENT_CASE" "$YNX_HISTORY_EVENT_INDEX"
  if ! python3 -B scripts/verify/pq-history-events-ci.py "$YNX_HISTORY_EVENT_CASE" "$YNX_HISTORY_EVENT_INDEX" "$status" "$path" > "$metadata"; then
    : > "$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE.invalid"
    return 119
  fi
  printf 'YNX-HISTORY-RAW-METADATA/v1 '; cat "$metadata"
  return "$status"
}
