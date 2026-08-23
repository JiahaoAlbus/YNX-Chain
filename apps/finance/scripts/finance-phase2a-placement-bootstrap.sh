#!/usr/bin/env bash
# Phase 2A only: place frozen objects; never read env or execute them.
set -euo pipefail
if [[ $# -ne 16 ]]; then echo 'usage: phase2a <id> <7-tuples> <archive> <bytes> <sha> <generator> <bytes> <sha> <executor> <bytes> <sha>' >&2; exit 64; fi
id=$1; shift
case "$id" in p0228-finance-phase1-20260822T234100Z) ;; *) exit 65;; esac
root_tuple=$1; stage_parent_tuple=$2; stage_tuple=$3; leases_parent_tuple=$4; lease_parent_tuple=$5; carrier_tuple=$6; shift 6
archive_source=$1; archive_bytes=$2; archive_sha=$3; generator_source=$4; generator_bytes=$5; generator_sha=$6; executor_source=$7; executor_bytes=$8; executor_sha=$9
root=/opt/ynx; stage_parent="$root/stage"; stage="$stage_parent/finance"; leases_parent="$root/leases"; lease_parent="$leases_parent/finance-preparation"; carrier="$stage/$id"
dt(){ if ! test -d "$1" || test -L "$1"; then return 1; fi; stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
ft(){ if ! test -f "$1" || test -L "$1"; then return 1; fi; stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
sha(){ sha256sum "$1" | awk '{print $1}'; }; bytes(){ wc -c < "$1" | tr -d ' '; }
source_ok(){ test "$(ft "$1")" && test "$(bytes "$1")" = "$2" && test "$(sha "$1")" = "$3"; }
test "$(dt "$root")" = "$root_tuple"; test "$(dt "$stage_parent")" = "$stage_parent_tuple"; test "$(dt "$stage")" = "$stage_tuple"; test "$(dt "$leases_parent")" = "$leases_parent_tuple"; test "$(dt "$lease_parent")" = "$lease_parent_tuple"; test "$(dt "$carrier")" = "$carrier_tuple"; test -z "$(find "$carrier" -mindepth 1 -print -quit)"
archive="$lease_parent/$id.archive.tgz"; generator="$lease_parent/$id.generator.sh"; executor="$lease_parent/$id.phase2b.sh"
for target in "$archive" "$generator" "$executor"; do test ! -e "$target" && test ! -L "$target"; done
created=()
cleanup(){ local i; for ((i=${#created[@]}-1;i>=0;i--)); do IFS='|' read -r p t h <<<"${created[$i]}"; test "$(ft "$p")" = "$t" && test "$(sha "$p")" = "$h" && rm -f -- "$p"; done; }
trap cleanup EXIT
source_ok "$archive_source" "$archive_bytes" "$archive_sha"; cp -- "$archive_source" "$archive"; chmod 0600 "$archive"; created+=("$archive|$(ft "$archive")|$(sha "$archive")")
source_ok "$generator_source" "$generator_bytes" "$generator_sha"; cp -- "$generator_source" "$generator"; chmod 0700 "$generator"; created+=("$generator|$(ft "$generator")|$(sha "$generator")")
source_ok "$executor_source" "$executor_bytes" "$executor_sha"; cp -- "$executor_source" "$executor"; chmod 0700 "$executor"; created+=("$executor|$(ft "$executor")|$(sha "$executor")")
printf 'phase=2a\narchive=%s\narchiveTuple=%s\narchiveSha256=%s\ngenerator=%s\ngeneratorTuple=%s\ngeneratorSha256=%s\nexecutor=%s\nexecutorTuple=%s\nexecutorSha256=%s\n' "$archive" "$(ft "$archive")" "$(sha "$archive")" "$generator" "$(ft "$generator")" "$(sha "$generator")" "$executor" "$(ft "$executor")" "$(sha "$executor")"
created=(); trap - EXIT
