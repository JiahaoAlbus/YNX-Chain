#!/usr/bin/env bash
# One-invocation P0-281 transport. Two signed frames are materialized only as
# identity-bound /tmp files, used once, and finalized on every terminal path.
set -euo pipefail
[[ $# = 7 ]] || exit 64
id=$1; executor=$2; executor_bytes=$3; executor_sha=$4; lease=$5; lease_bytes=$6; lease_sha=$7
case "$id" in p0281-finance-p0279-control-cleanup-[0-9TtZz-]*) ;; *) exit 65 ;; esac
test "$executor" = "/tmp/ynx-finance-$id.executor.sh"
test "$lease" = "/tmp/ynx-finance-$id.json"
for path in "$executor" "$lease"; do test ! -e "$path" && test ! -L "$path"; done

sha() { sha256sum -- "$1" | awk '{print $1}'; }
bytes() { wc -c < "$1" | tr -d ' '; }
tuple() { test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
exact() { test "$(bytes "$1")" = "$2" && test "$(sha "$1")" = "$3" && test "$(tuple "$1")" = "$4"; }
absent() { test ! -e "$1" && test ! -L "$1"; }
executor_created=false; lease_created=false; executor_identity=; lease_identity=
safe_remove_created() {
  local path=$1 created=$2 identity=$3
  if [[ "$created" = true && -n "$identity" && -f "$path" && ! -L "$path" ]] &&
     [[ "$(stat -Lc '%d:%i:%u:%g:%h:%F' -- "$path")" = "$identity" ]]; then
    rm -- "$path"
  fi
}
cleanup() {
  safe_remove_created "$lease" "$lease_created" "$lease_identity"
  safe_remove_created "$executor" "$executor_created" "$executor_identity"
  absent "$lease" && absent "$executor"
}
trap cleanup EXIT

read_frame() {
  local expected_name=$1 path=$2 expected_bytes=$3 expected_sha=$4 expected_mode=$5 created_flag=$6 identity_var=$7 line name fbytes fsha fmode payload extra
  IFS= read -r line || return 65
  IFS=$'\t' read -r name fbytes fsha fmode payload extra <<<"$line"
  test -z "${extra:-}" && test "$name" = "$expected_name" && test "$fbytes" = "$expected_bytes" && test "$fsha" = "$expected_sha" && test "$fmode" = "$expected_mode" || return 65
  case "$payload" in ''|*[!A-Za-z0-9+/=]*) return 65 ;; esac
  set -C; exec 3> "$path" || return 65; set +C
  printf -v "$created_flag" '%s' true
  printf -v "$identity_var" '%s' "$(stat -Lc '%d:%i:%u:%g:%h:%F' -- "$path")"
  printf %s "$payload" | base64 -d >&3 || return 65
  exec 3>&-
  chmod "$expected_mode" "$path"
  local written_tuple
  written_tuple=$(tuple "$path")
  exact "$path" "$expected_bytes" "$expected_sha" "$written_tuple" || return 65
  frame_tuple=$written_tuple
}

read_frame executor "$executor" "$executor_bytes" "$executor_sha" 700 executor_created executor_identity || exit 65; executor_tuple=$frame_tuple
read_frame signedLease "$lease" "$lease_bytes" "$lease_sha" 600 lease_created lease_identity || exit 65; lease_tuple=$frame_tuple
IFS= read -r terminal && test "$terminal" = END
if IFS= read -r extra; then exit 65; fi
test "$(jq -r '.lease.signed' "$lease")" = true
test "$(jq -r '.lease.kind' "$lease")" = FINANCE_P0279_CONTROL_CLEANUP_ONLY
test "$(jq -r '.lease.id' "$lease")" = "$id"
test "$(jq -r '.transport.executor.path' "$lease")" = "$executor"
test "$(jq -r '.transport.executor.bytes' "$lease")" = "$executor_bytes"
test "$(jq -r '.transport.executor.sha256' "$lease")" = "$executor_sha"
test "$(jq -r '.transport.lease.path' "$lease")" = "$lease"
set +e
receipt=$("$executor" "$lease" 2>&1); rc=$?
set -e
test "$rc" = 0
test "$(printf '%s\n' "$receipt" | grep -Fxc 'cleanup=P0279_CONTROL_FILES_REMOVED')" = 1
test "$(printf '%s\n' "$receipt" | grep -c '^parentStableIdentity=')" = 1
printf '%s\nremoteExitStatus=%s\ntemporaryControlsFinalAbsent=true\n' "$receipt" "$rc"
