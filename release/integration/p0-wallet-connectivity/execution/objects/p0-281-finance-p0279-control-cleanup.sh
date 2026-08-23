#!/usr/bin/env bash
# P0-281 removes only the two exact P0-279 control files. It has no deployment,
# configuration, service, network, or Wallet capability.
set -euo pipefail

[[ $# = 1 ]] || exit 64
lease=$1
test -f "$lease" && test ! -L "$lease"
command -v jq >/dev/null || exit 69
get() { jq -er "$1" "$lease"; }

test "$(get '.lease.signed')" = true
test "$(get '.lease.kind')" = FINANCE_P0279_CONTROL_CLEANUP_ONLY
cleanup_id=$(get '.lease.id')
case "$cleanup_id" in p0281-finance-p0279-control-cleanup-[0-9TtZz-]*) ;; *) exit 65 ;; esac
target_id=p0279-finance-phase3-20260823T164408Z

tuple() { test -e "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
stable() { test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%F' -- "$1"; }
sha() { sha256sum -- "$1" | awk '{print $1}'; }
bytes() { wc -c < "$1" | tr -d ' '; }
absent() { test ! -e "$1" && test ! -L "$1"; }

parent=$(get '.parent.path')
executor=$(get '.targets.executor.path')
signed_lease=$(get '.targets.signedLease.path')
test "$parent" = /opt/ynx/leases/finance
case "$lease" in /tmp/ynx-finance-p0281-finance-p0279-control-cleanup-*.json) ;; *) exit 65 ;; esac
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
  test "$(find -P "$parent" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = 2
}

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
printf 'cleanup=P0279_CONTROL_FILES_REMOVED\nparentStableIdentity=%s\n' "$(stable "$parent")"
