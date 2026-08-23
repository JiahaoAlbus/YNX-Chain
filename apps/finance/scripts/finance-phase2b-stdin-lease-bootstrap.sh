#!/usr/bin/env bash
# Phase 2B transport only: receive one signed, non-secret lease on stdin and
# execute the already placed, SHA-bound Phase 2B preparation program once.
set -euo pipefail
if [[ $# -ne 19 ]]; then exit 64; fi
id=$1; carrier=$2; root_tuple=$3; stage_parent_tuple=$4; stage_tuple=$5; leases_parent_tuple=$6; lease_parent_tuple=$7; carrier_tuple=$8
archive_tuple=$9; archive_sha=${10}; archive_bytes=${11}; generator_tuple=${12}; generator_sha=${13}; generator_bytes=${14}; executor_tuple=${15}; executor_sha=${16}; executor_bytes=${17}; lease_bytes=${18}; lease_sha=${19}
case "$id" in p0228-finance-phase1-20260822T234100Z) ;; *) exit 65;; esac
dt(){ test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
ft(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
sha(){ sha256sum "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
exact(){ test "$(ft "$1")" = "$2" && test "$(sha "$1")" = "$3" && test "$(bytes "$1")" = "$4"; }
root=/opt/ynx; stage_parent="$root/stage"; stage="$stage_parent/finance"; leases_parent="$root/leases"; lease_parent="$leases_parent/finance-preparation"
test "$carrier" = "$stage/$id"; test "$(dt "$root")" = "$root_tuple"; test "$(dt "$stage_parent")" = "$stage_parent_tuple"; test "$(dt "$stage")" = "$stage_tuple"; test "$(dt "$leases_parent")" = "$leases_parent_tuple"; test "$(dt "$lease_parent")" = "$lease_parent_tuple"; test "$(dt "$carrier")" = "$carrier_tuple"; test -z "$(find "$carrier" -mindepth 1 -print -quit)"
archive="$lease_parent/$id.archive.tgz"; generator="$lease_parent/$id.generator.sh"; executor="$lease_parent/$id.phase2b.sh"; lease="$lease_parent/$id.json"; pending="$lease.pending"
exact "$archive" "$archive_tuple" "$archive_sha" "$archive_bytes"; exact "$generator" "$generator_tuple" "$generator_sha" "$generator_bytes"; exact "$executor" "$executor_tuple" "$executor_sha" "$executor_bytes"
test ! -e "$lease" && test ! -L "$lease" && test ! -e "$pending" && test ! -L "$pending"
pending_created=false; lease_created=false
cleanup(){ if [[ "$lease_created" = true ]] && exact "$lease" "$lease_tuple" "$lease_post_sha" "$lease_post_bytes"; then rm -f -- "$lease"; fi; if [[ "$pending_created" = true ]] && exact "$pending" "$pending_tuple" "$pending_sha" "$pending_bytes"; then rm -f -- "$pending"; fi; }
trap cleanup EXIT
umask 077; cat > "$pending"; pending_created=true; pending_tuple=$(ft "$pending"); pending_sha=$(sha "$pending"); pending_bytes=$(bytes "$pending")
test "$pending_bytes" = "$lease_bytes"; test "$pending_sha" = "$lease_sha"; jq -e . "$pending" >/dev/null
mv -T -- "$pending" "$lease"; pending_created=false; lease_created=true; lease_tuple=$(ft "$lease"); lease_post_sha=$(sha "$lease"); lease_post_bytes=$(bytes "$lease")
"$executor" "$lease"
printf 'phase2Lease=%s\nphase2LeaseTuple=%s\nphase2LeaseBytes=%s\nphase2LeaseSha256=%s\n' "$lease" "$lease_tuple" "$lease_bytes" "$lease_sha"
lease_created=false; trap - EXIT
