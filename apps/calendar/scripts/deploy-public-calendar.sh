#!/usr/bin/env bash
set -Eeuo pipefail

# Root-only, single-host Calendar deployment transaction. The caller must stage
# an already verified artifact and provide a fresh backup directory. The
# transaction owns binary + state + state-key rollback as one indivisible set.

calendar_require_absolute() {
  case "$2" in /*) ;; *) echo "$1 must be absolute" >&2; return 64;; esac
}

calendar_require_sha256() {
  [[ "$2" =~ ^[0-9a-f]{64}$ ]] || { echo "$1 must be lowercase sha256" >&2; return 64; }
}

calendar_wait_for_source() {
  local expected_source="$1" output_file="$2"
  local attempts="${3:-60}" delay="${4:-1}" url="${5:-http://127.0.0.1:18097/v1/health}"
  local attempt=1

  : >"$output_file"
  while (( attempt <= attempts )); do
    if "${CALENDAR_CURL_BIN:-curl}" -fsS --max-time 3 "$url" >"$output_file.tmp" 2>/dev/null; then
      if grep -Fq "\"commit\":\"$expected_source\"" "$output_file.tmp"; then
        mv -f "$output_file.tmp" "$output_file"
        return 0
      fi
    fi
    rm -f "$output_file.tmp"
    if (( attempt < attempts )); then
      "${CALENDAR_SLEEP_BIN:-sleep}" "$delay"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

calendar_sha() {
  "${CALENDAR_SHA256_BIN:-sha256sum}" "$1" | awk '{print $1}'
}

calendar_service() {
  "${CALENDAR_SYSTEMCTL_BIN:-systemctl}" "$@"
}

calendar_deploy_main() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "root is required" >&2; return 77; }

  : "${CALENDAR_CANDIDATE:?}"
  : "${CALENDAR_BINARY:?}"
  : "${CALENDAR_STATE:?}"
  : "${CALENDAR_STATE_KEY:?}"
  : "${CALENDAR_BACKUP:?}"
  : "${CALENDAR_SERVICE:?}"
  : "${CALENDAR_EXPECTED_CANDIDATE_SHA:?}"
  : "${CALENDAR_EXPECTED_OLD_BINARY_SHA:?}"
  : "${CALENDAR_EXPECTED_OLD_STATE_SHA:?}"
  : "${CALENDAR_EXPECTED_OLD_KEY_SHA:?}"
  : "${CALENDAR_EXPECTED_OLD_SOURCE:?}"
  : "${CALENDAR_EXPECTED_NEW_SOURCE:?}"

  calendar_require_absolute CALENDAR_CANDIDATE "$CALENDAR_CANDIDATE"
  calendar_require_absolute CALENDAR_BINARY "$CALENDAR_BINARY"
  calendar_require_absolute CALENDAR_STATE "$CALENDAR_STATE"
  calendar_require_absolute CALENDAR_STATE_KEY "$CALENDAR_STATE_KEY"
  calendar_require_absolute CALENDAR_BACKUP "$CALENDAR_BACKUP"
  calendar_require_sha256 CALENDAR_EXPECTED_CANDIDATE_SHA "$CALENDAR_EXPECTED_CANDIDATE_SHA"
  calendar_require_sha256 CALENDAR_EXPECTED_OLD_BINARY_SHA "$CALENDAR_EXPECTED_OLD_BINARY_SHA"
  calendar_require_sha256 CALENDAR_EXPECTED_OLD_STATE_SHA "$CALENDAR_EXPECTED_OLD_STATE_SHA"
  calendar_require_sha256 CALENDAR_EXPECTED_OLD_KEY_SHA "$CALENDAR_EXPECTED_OLD_KEY_SHA"
  [[ ! -e "$CALENDAR_BACKUP" ]] || { echo "fresh backup path required" >&2; return 73; }
  [[ "$(calendar_sha "$CALENDAR_CANDIDATE")" == "$CALENDAR_EXPECTED_CANDIDATE_SHA" ]] || return 65
  [[ "$(calendar_sha "$CALENDAR_BINARY")" == "$CALENDAR_EXPECTED_OLD_BINARY_SHA" ]] || return 65
  [[ "$(calendar_sha "$CALENDAR_STATE")" == "$CALENDAR_EXPECTED_OLD_STATE_SHA" ]] || return 65
  [[ "$(calendar_sha "$CALENDAR_STATE_KEY")" == "$CALENDAR_EXPECTED_OLD_KEY_SHA" ]] || return 65

  # These are intentionally transaction globals. Bash runs EXIT after the main
  # function returns, so locals would be out of scope exactly when rollback is
  # most important.
  CALENDAR_TRANSACTION_COMMITTED=false
  CALENDAR_ROLLBACK_STARTED=false
  CALENDAR_HEALTH_FILE="$(mktemp /var/tmp/ynx-calendar-health.XXXXXX)"

  calendar_rollback() {
    [[ "$CALENDAR_TRANSACTION_COMMITTED" == false && "$CALENDAR_ROLLBACK_STARTED" == false ]] || return 0
    CALENDAR_ROLLBACK_STARTED=true
    calendar_service stop "$CALENDAR_SERVICE" || true
    install -o root -g root -m 0755 "$CALENDAR_BACKUP/ynx-calendard" "$CALENDAR_BINARY"
    install -o ynx -g ynx -m 0600 "$CALENDAR_BACKUP/state.json" "$CALENDAR_STATE"
    install -o ynx -g ynx -m 0600 "$CALENDAR_BACKUP/state.json.hmac-key" "$CALENDAR_STATE_KEY"
    [[ "$(calendar_sha "$CALENDAR_BINARY")" == "$CALENDAR_EXPECTED_OLD_BINARY_SHA" ]]
    [[ "$(calendar_sha "$CALENDAR_STATE")" == "$CALENDAR_EXPECTED_OLD_STATE_SHA" ]]
    [[ "$(calendar_sha "$CALENDAR_STATE_KEY")" == "$CALENDAR_EXPECTED_OLD_KEY_SHA" ]]
    calendar_service reset-failed "$CALENDAR_SERVICE" || true
    calendar_service start "$CALENDAR_SERVICE"
    calendar_wait_for_source "$CALENDAR_EXPECTED_OLD_SOURCE" "$CALENDAR_HEALTH_FILE" "${CALENDAR_READY_ATTEMPTS:-60}" "${CALENDAR_READY_DELAY:-1}"
  }

  calendar_finish() {
    local status=$?
    if [[ "$CALENDAR_TRANSACTION_COMMITTED" == false ]]; then calendar_rollback || status=$?; fi
    rm -f "$CALENDAR_HEALTH_FILE" "$CALENDAR_HEALTH_FILE.tmp"
    return "$status"
  }
  trap calendar_finish EXIT INT TERM

  install -d -o root -g root -m 0700 "$CALENDAR_BACKUP"
  calendar_service stop "$CALENDAR_SERVICE"
  cp -p "$CALENDAR_BINARY" "$CALENDAR_BACKUP/ynx-calendard"
  cp -p "$CALENDAR_STATE" "$CALENDAR_BACKUP/state.json"
  cp -p "$CALENDAR_STATE_KEY" "$CALENDAR_BACKUP/state.json.hmac-key"
  [[ "$(calendar_sha "$CALENDAR_BACKUP/ynx-calendard")" == "$CALENDAR_EXPECTED_OLD_BINARY_SHA" ]]
  [[ "$(calendar_sha "$CALENDAR_BACKUP/state.json")" == "$CALENDAR_EXPECTED_OLD_STATE_SHA" ]]
  [[ "$(calendar_sha "$CALENDAR_BACKUP/state.json.hmac-key")" == "$CALENDAR_EXPECTED_OLD_KEY_SHA" ]]

  install -o root -g root -m 0755 "$CALENDAR_CANDIDATE" "$CALENDAR_BINARY"
  [[ "$(calendar_sha "$CALENDAR_BINARY")" == "$CALENDAR_EXPECTED_CANDIDATE_SHA" ]]
  calendar_service reset-failed "$CALENDAR_SERVICE" || true
  calendar_service start "$CALENDAR_SERVICE"

  # Deliberately not command substitution: transient listener failures remain
  # inside this bounded condition and cannot trigger set -e early exit.
  if ! calendar_wait_for_source "$CALENDAR_EXPECTED_NEW_SOURCE" "$CALENDAR_HEALTH_FILE" "${CALENDAR_READY_ATTEMPTS:-60}" "${CALENDAR_READY_DELAY:-1}"; then
    echo "candidate did not become ready" >&2
    return 1
  fi

  "${CALENDAR_SLEEP_BIN:-sleep}" "${CALENDAR_SOAK_SECONDS:-35}"
  calendar_service restart "$CALENDAR_SERVICE"
  if ! calendar_wait_for_source "$CALENDAR_EXPECTED_NEW_SOURCE" "$CALENDAR_HEALTH_FILE" "${CALENDAR_READY_ATTEMPTS:-60}" "${CALENDAR_READY_DELAY:-1}"; then
    echo "candidate cold restart did not become ready" >&2
    return 1
  fi

  CALENDAR_TRANSACTION_COMMITTED=true
  trap - EXIT INT TERM
  rm -f "$CALENDAR_HEALTH_FILE" "$CALENDAR_HEALTH_FILE.tmp"
  printf '{"ok":true,"source":"%s","rollbackBackup":"%s"}\n' "$CALENDAR_EXPECTED_NEW_SOURCE" "$CALENDAR_BACKUP"
}

if [[ "${CALENDAR_DEPLOY_LIBRARY_ONLY:-false}" != true ]]; then
  calendar_deploy_main "$@"
fi
