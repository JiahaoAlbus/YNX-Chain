#!/usr/bin/env bash
# Phase 1 only: create a unique empty hierarchy and emit observed tuples.
set -euo pipefail
if [[ $# -ne 1 ]]; then echo 'usage: phase1-bootstrap <run-id>' >&2; exit 64; fi
run_id=$1; case "$run_id" in ''|*/*|.|..|*..*) exit 65;; esac
stage=/opt/ynx/stage/finance; leases=/opt/ynx/leases/finance-preparation; carrier="$stage/$run_id"
full(){ stat -Lc '%d:%i:%u:%g:%a:%h' "$1"; }; absent(){ test ! -e "$1" && test ! -L "$1"; }
stage_created=false; leases_created=false; carrier_created=false
cleanup(){ if [[ "$carrier_created" = true ]]; then test "$(full "$carrier")" = "$carrier_tuple"; test -z "$(find "$carrier" -mindepth 1 -print -quit)"; rmdir "$carrier"; fi; if [[ "$leases_created" = true ]]; then test "$(full "$leases")" = "$leases_tuple"; test -z "$(find "$leases" -mindepth 1 -print -quit)"; rmdir "$leases"; fi; if [[ "$stage_created" = true ]]; then test "$(full "$stage")" = "$stage_tuple"; test -z "$(find "$stage" -mindepth 1 -print -quit)"; rmdir "$stage"; fi; }
trap cleanup EXIT
absent "$stage"; absent "$leases"; mkdir -p -m 0750 "$stage"; stage_created=true; stage_tuple=$(full "$stage"); mkdir -p -m 0750 "$leases"; leases_created=true; leases_tuple=$(full "$leases"); absent "$carrier"; mkdir -m 0700 "$carrier"; carrier_created=true; carrier_tuple=$(full "$carrier")
printf 'phase=1\nstage=%s\nstageTuple=%s\nleases=%s\nleasesTuple=%s\ncarrier=%s\ncarrierTuple=%s\ncarrierEmpty=true\n' "$stage" "$stage_tuple" "$leases" "$leases_tuple" "$carrier" "$carrier_tuple"
stage_created=false; leases_created=false; carrier_created=false; trap - EXIT
