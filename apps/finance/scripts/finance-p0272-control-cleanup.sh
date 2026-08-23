#!/usr/bin/env bash
# P0-274 removes only the two P0-272 control files. It has no deployment,
# configuration, service, network, or wallet capability.
set -euo pipefail

[[ $# = 1 ]] || exit 64
lease=$1
test -f "$lease" && test ! -L "$lease"
command -v jq >/dev/null || exit 69
get() { jq -er "$1" "$lease"; }

test "$(get '.lease.signed')" = true
test "$(get '.lease.kind')" = FINANCE_P0272_CONTROL_CLEANUP_ONLY
cleanup_id=$(get '.lease.id')
case "$cleanup_id" in p0275-finance-p0272-control-cleanup-[0-9TtZz-]*) ;; *) exit 65 ;; esac
target_id=p0272-finance-phase3-20260823T152627Z

tuple() { test -e "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
stable() { test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%F' -- "$1"; }
sha() { sha256sum -- "$1" | awk '{print $1}'; }
bytes() { wc -c < "$1" | tr -d ' '; }
absent() { test ! -e "$1" && test ! -L "$1"; }

parent=$(get '.parent.path')
executor=$(get '.targets.executor.path')
signed_lease=$(get '.targets.signedLease.path')
case "$parent" in
  /opt/ynx/leases/finance) ;;
  *) [[ "${FINANCE_P0272_CONTROL_CLEANUP_TEST_ROOT:-}" = 1 ]] || exit 65 ;;
esac
case "$lease" in
  /tmp/ynx-finance-p0275-finance-p0272-control-cleanup-*.json) ;;
  *) [[ "${FINANCE_P0272_CONTROL_CLEANUP_TEST_ROOT:-}" = 1 ]] || exit 65 ;;
esac
test "$executor" = "$parent/$target_id.executor.sh"
test "$signed_lease" = "$parent/$target_id.json"

assert_parent() {
  test -d "$parent" && test ! -L "$parent"
  test "$(realpath -e -- "$parent")" = "$parent"
  test "$(tuple "$parent")" = "$(get '.parent.tuple')"
  test "$(stable "$parent")" = "$(get '.parent.stableIdentity')"
}
assert_target() {
  local key=$1 path=$2
  test -f "$path" && test ! -L "$path"
  test "$(realpath -e -- "$path")" = "$path"
  test "$(tuple "$path")" = "$(get ".targets.$key.tuple")"
  test "$(bytes "$path")" = "$(get ".targets.$key.bytes")"
  test "$(sha "$path")" = "$(get ".targets.$key.sha256")"
}
assert_exact_children() {
  # Both expected names are exact and each target has a full tuple/SHA check.
  # The count therefore rejects any sibling, including a hidden child, without
  # relying on newline-delimited filename parsing.
  test "$(find -P "$parent" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = 2
}

# Complete immediate pre-write check. Any parent or direct-child drift means no
# unlink occurs. Regular-file link-count is part of each full target tuple.
assert_parent
assert_exact_children
assert_target executor "$executor"
assert_target signedLease "$signed_lease"
assert_parent
assert_exact_children
assert_target executor "$executor"
assert_target signedLease "$signed_lease"

rm -- "$executor" "$signed_lease"
absent "$executor" && absent "$signed_lease"
test -z "$(find -P "$parent" -mindepth 1 -maxdepth 1 -print -quit)"
test "$(stable "$parent")" = "$(get '.parent.stableIdentity')"
printf 'cleanup=P0272_CONTROL_FILES_REMOVED\nparentStableIdentity=%s\n' "$(stable "$parent")"
