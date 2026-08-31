#!/usr/bin/env bash
# Receive one exact Central-signed manual-rollback lease on stdin, place it
# beside the retained deployment executor, then invoke rollback exactly once.
set -euo pipefail

if [[ $# -ne 8 ]]; then exit 64; fi
id=$1; finance_parent_tuple=$2; executor=$3; executor_tuple=$4
executor_sha=$5; lease_bytes=$6; lease_sha=$7; target_mode=$8
case "$id" in p0[0-9][0-9][0-9]-finance-phase3-[0-9TtZz-]*|finance-combined-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9TtZz-]*) ;; *) exit 65;; esac
case "$id" in *[!A-Za-z0-9-]*|*..*|*/*) exit 65;; esac
test "$target_mode" = 600

dt(){ test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
ft(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
sha(){ sha256sum "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
identity(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i' "$1"; }
exact(){ test "$(ft "$1")" = "$2" && test "$(sha "$1")" = "$3" && test "$(bytes "$1")" = "$4"; }
require(){ "$@" || exit 74; }

finance_parent=/opt/ynx/leases/finance
test "$(dt "$finance_parent")" = "$finance_parent_tuple"
test "$executor" = "$finance_parent/$id.executor.sh"
test "$(ft "$executor")" = "$executor_tuple"
test "$(sha "$executor")" = "$executor_sha"

target="$finance_parent/$id.manual-rollback.json"; pending="$target.pending"
for path in "$target" "$pending"; do require test ! -e "$path"; require test ! -L "$path"; done
pending_created=false; target_created=false
cleanup(){
  if [[ "$target_created" = true ]] && exact "$target" "$target_tuple" "$lease_sha" "$lease_bytes"; then rm -f -- "$target"; fi
  if [[ "$pending_created" = true ]] && test "$(identity "$pending")" = "$pending_identity"; then rm -f -- "$pending"; fi
}
trap cleanup EXIT
umask 077
set -C; exec 3> "$pending"; set +C; pending_created=true; pending_identity=$(identity "$pending")
cat >&3; exec 3>&-; chmod "$target_mode" "$pending"
test "$(identity "$pending")" = "$pending_identity"
pending_tuple=$(ft "$pending"); exact "$pending" "$pending_tuple" "$lease_sha" "$lease_bytes"
jq -e . "$pending" >/dev/null
test "$(jq -r '.lease.signed' "$pending")" = true
test "$(jq -r '.lease.kind' "$pending")" = FINANCE_ROLLBACK_FIRST_PRODUCTION_MANUAL_ROLLBACK
test "$(jq -r '.lease.id' "$pending")" = "$id"
target_tuple=$pending_tuple
mv -T -- "$pending" "$target"; pending_created=false; target_created=true
require test -f "$target"
require test ! -L "$target"
require test "$(identity "$target")" = "$pending_identity"
require exact "$target" "$target_tuple" "$lease_sha" "$lease_bytes"
require test "$(stat -Lc '%a' "$target")" = "$target_mode"

# Retain the exact signed lease once execution begins. This command object never
# retries and never prints the lease body.
trap - EXIT
"$executor" rollback "$target"
printf 'phase=3-manual-rollback\nlease=%s\nleaseTuple=%s\nleaseBytes=%s\nleaseSha256=%s\nrollbackArgv0=%s\nrollbackArgv1=rollback\nrollbackArgv2=%s\n' \
  "$target" "$target_tuple" "$lease_bytes" "$lease_sha" "$executor" "$target"
