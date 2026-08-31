#!/usr/bin/env bash
# Phase 2 only: stage one signed archive and derive a secret-safe candidate env.
set -euo pipefail
if [[ $# -ne 1 ]]; then echo 'usage: preparation <central-signed-phase2-lease.json>' >&2; exit 64; fi
lease=$1
command -v jq >/dev/null || exit 69
get(){ jq -er "$1" "$lease"; }
dir_tuple(){ if ! test -d "$1" || test -L "$1"; then return 1; fi; stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
file_tuple(){ if ! test -f "$1" || test -L "$1"; then return 1; fi; stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
sha(){ sha256sum "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
exact_file(){ test "$1" = "$2"; test "$(file_tuple "$1")" = "$3"; test "$(sha "$1")" = "$4"; test "$(bytes "$1")" = "$5"; }
remove_exact(){ test "$(file_tuple "$1")" = "$2"; test "$(sha "$1")" = "$3"; rm -f -- "$1"; }

test -f "$lease" && test ! -L "$lease"
test "$(get '.lease.signed')" = true
test "$(get '.lease.kind')" = FINANCE_PHASE2_CANDIDATE_ENV_PREPARATION
id=$(get '.lease.id'); case "$id" in ''|*/*|.|..|*..*) exit 65;; esac
root=/opt/ynx; stage_parent="$root/stage"; stage="$stage_parent/finance"; leases_parent="$root/leases"; lease_parent="$leases_parent/finance-preparation"; carrier="$stage/$id"
test "$lease" = "$lease_parent/$id.json"
test "$(dir_tuple "$root")" = "$(get '.phase1.rootTuple')"
test "$(dir_tuple "$stage_parent")" = "$(get '.phase1.stageParentTuple')"
test "$(dir_tuple "$stage")" = "$(get '.phase1.stageTuple')"
test "$(dir_tuple "$leases_parent")" = "$(get '.phase1.leasesParentTuple')"
test "$(dir_tuple "$lease_parent")" = "$(get '.phase1.leaseParentTuple')"
test "$carrier" = "$(get '.phase1.carrier.path')"
test "$(dir_tuple "$carrier")" = "$(get '.phase1.carrier.tuple')"
test -z "$(find "$carrier" -mindepth 1 -print -quit)"

archive_input="$lease_parent/$id.archive.tgz"
generator="$lease_parent/$id.generator.sh"
executor="$lease_parent/$id.phase2b.sh"
archive="$carrier/candidate.tgz"
candidate="$carrier/finance.env"
exact_file "$archive_input" "$(get '.objects.archive.path')" "$(get '.objects.archive.tuple')" "$(get '.objects.archive.sha256')" "$(get '.objects.archive.bytes')"
exact_file "$generator" "$(get '.objects.generator.path')" "$(get '.objects.generator.tuple')" "$(get '.objects.generator.sha256')" "$(get '.objects.generator.bytes')"
exact_file "$executor" "$(get '.objects.executor.path')" "$(get '.objects.executor.tuple')" "$(get '.objects.executor.sha256')" "$(get '.objects.executor.bytes')"
env=/etc/ynx/finance.env
test -f "$env" && test ! -L "$env"
test "$(sha "$env")" = "$(get '.fresh.env.sha256')"
test "$(bytes "$env")" = "$(get '.fresh.env.bytes')"
for key in $(get '.requiredEnvKeys[]'); do case "$key" in *[!A-Z0-9_]*|'') exit 65;; esac; test "$(grep -c "^$key=" "$env")" = 1; done
release_web=$(get '.candidate.releaseWebDir')
case "$release_web" in /opt/ynx/releases/finance/ynx-finance-*/web|/opt/ynx/releases/finance/*/ynx-finance-*/web) ;; *) exit 65;; esac
case "$release_web" in *..*|*//*) exit 65;; esac
test ! -e "$archive" && test ! -L "$archive" && test ! -e "$candidate" && test ! -L "$candidate"

archive_created=false; candidate_created=false
cleanup(){ if [[ "$candidate_created" = true ]]; then remove_exact "$candidate" "$candidate_tuple" "$candidate_sha"; fi; if [[ "$archive_created" = true ]]; then remove_exact "$archive" "$archive_tuple" "$archive_sha"; fi; }
trap cleanup EXIT
cp -- "$archive_input" "$archive"
archive_created=true; archive_tuple=$(file_tuple "$archive"); archive_sha=$(sha "$archive")
test "$archive_sha" = "$(get '.objects.archive.sha256')"; test "$(bytes "$archive")" = "$(get '.objects.archive.bytes')"
"$generator" "$env" "$candidate" "$release_web" >/dev/null
candidate_created=true; candidate_tuple=$(file_tuple "$candidate"); candidate_sha=$(sha "$candidate"); candidate_bytes=$(bytes "$candidate")
for key in $(get '.requiredEnvKeys[]'); do test "$(grep -c "^$key=" "$candidate")" = 1; done
printf 'phase=2\ncarrier=%s\ncarrierTuple=%s\narchive=%s\narchiveTuple=%s\narchiveBytes=%s\narchiveSha256=%s\ncandidateEnv=%s\ncandidateEnvTuple=%s\ncandidateEnvBytes=%s\ncandidateEnvSha256=%s\n' "$carrier" "$(dir_tuple "$carrier")" "$archive" "$archive_tuple" "$(bytes "$archive")" "$archive_sha" "$candidate" "$candidate_tuple" "$candidate_bytes" "$candidate_sha"
archive_created=false; candidate_created=false; trap - EXIT
