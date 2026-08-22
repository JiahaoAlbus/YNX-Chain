#!/usr/bin/env bash
# Phase 1 only: create a unique empty hierarchy and emit observed tuples.
set -euo pipefail
if [[ $# -ne 2 ]]; then echo 'usage: phase1-bootstrap <run-id> <signed-root-tuple>' >&2; exit 64; fi
run_id=$1
signed_root_tuple=$2
case "$run_id" in ''|*/*|.|..|*..*) exit 65;; esac
root=/opt/ynx
stage_parent="$root/stage"
stage="$stage_parent/finance"
leases_parent="$root/leases"
leases="$leases_parent/finance-preparation"
carrier="$stage/$run_id"
absent(){ test ! -e "$1" && test ! -L "$1"; }
empty(){ test -z "$(find "$1" -mindepth 1 -print -quit)"; }
directory_tuple(){
  if ! test -d "$1" || test -L "$1"; then
    return 1
  fi
  stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"
}
stage_parent_created=false
stage_created=false
leases_parent_created=false
leases_created=false
carrier_created=false
cleanup(){
  if [[ "$carrier_created" = true ]]; then
    test "$(directory_tuple "$carrier")" = "$carrier_tuple"
    test -z "$(find "$carrier" -mindepth 1 -print -quit)"
    rmdir "$carrier"
  fi
  if [[ "$leases_created" = true ]]; then
    test "$(directory_tuple "$leases")" = "$leases_tuple"
    test -z "$(find "$leases" -mindepth 1 -print -quit)"
    rmdir "$leases"
  fi
  if [[ "$leases_parent_created" = true ]]; then
    test "$(directory_tuple "$leases_parent")" = "$leases_parent_tuple"
    test -z "$(find "$leases_parent" -mindepth 1 -print -quit)"
    rmdir "$leases_parent"
  fi
  if [[ "$stage_created" = true ]]; then
    test "$(directory_tuple "$stage")" = "$stage_tuple"
    test -z "$(find "$stage" -mindepth 1 -print -quit)"
    rmdir "$stage"
  fi
  if [[ "$stage_parent_created" = true ]]; then
    test "$(directory_tuple "$stage_parent")" = "$stage_parent_tuple"
    test -z "$(find "$stage_parent" -mindepth 1 -print -quit)"
    rmdir "$stage_parent"
  fi
}
trap cleanup EXIT
root_tuple=$(directory_tuple "$root")
test "$root_tuple" = "$signed_root_tuple"
absent "$stage_parent"
absent "$stage"
absent "$leases_parent"
absent "$leases"
mkdir -m 0750 "$stage_parent"
stage_parent_created=true
stage_parent_tuple=$(directory_tuple "$stage_parent")
empty "$stage_parent"
mkdir -m 0750 "$stage"
stage_created=true
stage_tuple=$(directory_tuple "$stage")
empty "$stage"
mkdir -m 0750 "$leases_parent"
leases_parent_created=true
leases_parent_tuple=$(directory_tuple "$leases_parent")
empty "$leases_parent"
mkdir -m 0750 "$leases"
leases_created=true
leases_tuple=$(directory_tuple "$leases")
empty "$leases"
absent "$carrier"
mkdir -m 0700 "$carrier"
carrier_created=true
carrier_tuple=$(directory_tuple "$carrier")
empty "$carrier"
printf 'phase=1\nroot=%s\nrootTuple=%s\nstageParent=%s\nstageParentTuple=%s\nstage=%s\nstageTuple=%s\nleasesParent=%s\nleasesParentTuple=%s\nleases=%s\nleasesTuple=%s\ncarrier=%s\ncarrierTuple=%s\ncarrierEmpty=true\n' "$root" "$root_tuple" "$stage_parent" "$stage_parent_tuple" "$stage" "$stage_tuple" "$leases_parent" "$leases_parent_tuple" "$leases" "$leases_tuple" "$carrier" "$carrier_tuple"
stage_parent_created=false; stage_created=false; leases_parent_created=false; leases_created=false; carrier_created=false; trap - EXIT
