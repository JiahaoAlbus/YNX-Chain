#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

export CALENDAR_DEPLOY_LIBRARY_ONLY=true
# shellcheck source=../scripts/deploy-public-calendar.sh
. "$ROOT/scripts/deploy-public-calendar.sh"

calls="$TMP/calls"
printf '0\n' >"$calls"
cat >"$TMP/curl" <<'SH'
#!/usr/bin/env bash
set -eu
calls=${CALENDAR_TEST_CALLS:?}
n=$(cat "$calls")
n=$((n + 1))
printf '%s\n' "$n" >"$calls"
if [ "$n" -le "${CALENDAR_TEST_FAILS:-0}" ]; then exit 7; fi
printf '{"build":{"commit":"%s"},"ok":true}\n' "${CALENDAR_TEST_SOURCE:?}"
SH
chmod +x "$TMP/curl"
export CALENDAR_CURL_BIN="$TMP/curl" CALENDAR_SLEEP_BIN=true
export CALENDAR_TEST_CALLS="$calls" CALENDAR_TEST_FAILS=3
export CALENDAR_TEST_SOURCE=afb1b988e5e47f02928163c345ff5fb1dc7a44e5

out="$TMP/health.json"
calendar_wait_for_source "$CALENDAR_TEST_SOURCE" "$out" 5 0
test "$(cat "$calls")" = 4
grep -Fq "\"commit\":\"$CALENDAR_TEST_SOURCE\"" "$out"

printf '0\n' >"$calls"
export CALENDAR_TEST_FAILS=8
if calendar_wait_for_source "$CALENDAR_TEST_SOURCE" "$out" 4 0; then
  echo "expected bounded readiness failure" >&2
  exit 1
fi
test "$(cat "$calls")" = 4
test ! -e "$out.tmp"

# Stable-file assertions bind content and permissions while treating inode as
# an observed value. This must work on both GNU/Linux and the macOS owner host.
stable="$TMP/stable"
printf 'calendar-state\n' >"$stable"
chmod 0600 "$stable"
stable_sha=$(calendar_sha "$stable")
stable_bytes=$(wc -c <"$stable" | tr -d ' ')
stable_owner="$(id -un):$(id -gn)"
calendar_assert_stable_file fixture "$stable" "$stable_sha" "$stable_bytes" "$stable_owner" 0600 1
test -n "$CALENDAR_ASSERTED_DEVICE_INODE"
if calendar_assert_stable_file fixture "$stable" "$stable_sha" "$stable_bytes" "$stable_owner" 0644 1; then
  echo "expected mode drift rejection" >&2
  exit 1
fi

# Static transaction boundary: readiness must stay in an if-condition and the
# paired rollback must restore binary, state, and state-key before old start.
grep -Fq 'if ! calendar_wait_for_source "$CALENDAR_EXPECTED_NEW_SOURCE"' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'install -o root -g root -m 0755 "$CALENDAR_BACKUP/ynx-calendard"' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'install -o ynx -g ynx -m 0600 "$CALENDAR_BACKUP/state.json"' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'install -o ynx -g ynx -m 0600 "$CALENDAR_BACKUP/state.json.hmac-key"' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'CALENDAR_TRANSACTION_COMMITTED=false' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'CALENDAR_BACKUP_COMPLETE=false' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'if [[ "$CALENDAR_BACKUP_COMPLETE" == true ]]; then' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'if [[ "$CALENDAR_TRANSACTION_COMMITTED" == false ]]; then calendar_rollback' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'trap calendar_abort_signal INT TERM' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'calendar_service start "$CALENDAR_SERVICE" || return' "$ROOT/scripts/deploy-public-calendar.sh"

# Inode-safe ordering: stop precedes backup creation, stopped-state binding
# precedes backup copy, and backup completion precedes candidate installation.
stop_line=$(grep -n 'calendar_service stop "$CALENDAR_SERVICE"' "$ROOT/scripts/deploy-public-calendar.sh" | tail -1 | cut -d: -f1)
state_line=$(grep -n 'CALENDAR_STOPPED_STATE_DEVICE_INODE=' "$ROOT/scripts/deploy-public-calendar.sh" | tail -1 | cut -d: -f1)
backup_line=$(grep -n 'install -d -o root -g root -m 0700 "$CALENDAR_BACKUP"' "$ROOT/scripts/deploy-public-calendar.sh" | cut -d: -f1)
complete_line=$(grep -n 'CALENDAR_BACKUP_COMPLETE=true' "$ROOT/scripts/deploy-public-calendar.sh" | cut -d: -f1)
candidate_line=$(grep -n 'install -o root -g root -m 0755 "$CALENDAR_CANDIDATE"' "$ROOT/scripts/deploy-public-calendar.sh" | cut -d: -f1)
test "$stop_line" -lt "$state_line"
test "$state_line" -lt "$backup_line"
test "$backup_line" -lt "$complete_line"
test "$complete_line" -lt "$candidate_line"
grep -Fq 'calendar_assert_stable_file state "$CALENDAR_STATE"' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq 'calendar_assert_stable_file backup-state "$CALENDAR_BACKUP/state.json"' "$ROOT/scripts/deploy-public-calendar.sh"
grep -Fq '"stoppedStateDeviceInode":"%s"' "$ROOT/scripts/deploy-public-calendar.sh"

echo "calendar deployment readiness tests passed"
