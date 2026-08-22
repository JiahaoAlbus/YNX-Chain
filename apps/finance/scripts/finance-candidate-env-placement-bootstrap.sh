#!/usr/bin/env bash
# Bootstrap only: stage exact frozen objects, then invoke the frozen preparation
# command. No service, Caddy, current-release, state, or public-route action.
set -euo pipefail
if [[ $# -ne 5 ]]; then echo 'usage: bootstrap <lease> <generator> <preparation> <archive> <run-id>' >&2; exit 64; fi
lease_in=$1; generator_in=$2; preparation_in=$3; archive_in=$4; run_id=$5
case "$run_id" in ''|*/*|.|..|*..*) exit 65;; esac
stage_parent=/opt/ynx/stage/finance; lease_parent=/opt/ynx/leases/finance-preparation; carrier="$stage_parent/$run_id"; tools="$carrier/tools"; lease="$lease_parent/$run_id.json"
full(){ stat -Lc '%d:%i:%u:%g:%a:%h' "$1"; }; hash(){ sha256sum "$1"|awk '{print $1}'; }; safe_file(){ test -f "$1" && test ! -L "$1"; }
for f in "$lease_in" "$generator_in" "$preparation_in" "$archive_in"; do safe_file "$f"; done
lease_sha=$(hash "$lease_in"); generator_sha=$(hash "$generator_in"); preparation_sha=$(hash "$preparation_in"); archive_sha=$(hash "$archive_in")
stage_created=false; lease_created=false; carrier_created=false; cleanup(){
  for f in "$tools/finance-candidate-env-preparation.sh" "$tools/finance-candidate-env-generator.sh" "$carrier/archive.tgz" "$carrier/finance.env" "$lease"; do if test -e "$f"; then safe_file "$f" || exit 70; rm -- "$f"; fi; done
  if [[ "$carrier_created" = true ]]; then test "$(full "$carrier")" = "$carrier_tuple"; rmdir "$tools" 2>/dev/null || true; rmdir "$carrier"; fi
  if [[ "$lease_created" = true ]]; then test "$(full "$lease_parent")" = "$lease_parent_tuple"; rmdir "$lease_parent"; fi
  if [[ "$stage_created" = true ]]; then test "$(full "$stage_parent")" = "$stage_parent_tuple"; rmdir "$stage_parent"; fi
}; trap cleanup EXIT
if test ! -e "$stage_parent" && test ! -L "$stage_parent"; then mkdir -p -m 0750 "$stage_parent"; stage_created=true; fi; test -d "$stage_parent" && test ! -L "$stage_parent"; stage_parent_tuple=$(full "$stage_parent")
if test ! -e "$lease_parent" && test ! -L "$lease_parent"; then mkdir -p -m 0750 "$lease_parent"; lease_created=true; fi; test -d "$lease_parent" && test ! -L "$lease_parent"; lease_parent_tuple=$(full "$lease_parent")
test ! -e "$carrier" && test ! -L "$carrier" && test ! -e "$lease" && test ! -L "$lease"; mkdir -m 0700 "$carrier"; carrier_created=true; carrier_tuple=$(full "$carrier"); mkdir -m 0700 "$tools"
install -m 0600 "$lease_in" "$lease"; install -m 0700 "$generator_in" "$tools/finance-candidate-env-generator.sh"; install -m 0700 "$preparation_in" "$tools/finance-candidate-env-preparation.sh"; install -m 0600 "$archive_in" "$carrier/archive.tgz"
test "$(hash "$lease")" = "$lease_sha" && test "$(hash "$tools/finance-candidate-env-generator.sh")" = "$generator_sha" && test "$(hash "$tools/finance-candidate-env-preparation.sh")" = "$preparation_sha" && test "$(hash "$carrier/archive.tgz")" = "$archive_sha"
"$tools/finance-candidate-env-preparation.sh" "$lease"
printf 'stageParentTuple=%s\nleaseParentTuple=%s\ncarrierTuple=%s\nleaseSha256=%s\ngeneratorSha256=%s\npreparationSha256=%s\narchiveSha256=%s\n' "$stage_parent_tuple" "$lease_parent_tuple" "$carrier_tuple" "$lease_sha" "$generator_sha" "$preparation_sha" "$archive_sha"
carrier_created=false; stage_created=false; lease_created=false; trap - EXIT
