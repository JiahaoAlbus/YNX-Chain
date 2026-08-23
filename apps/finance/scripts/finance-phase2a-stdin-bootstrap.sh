#!/usr/bin/env bash
# Receives one deterministic textual carrier on stdin; never reads local paths.
set -euo pipefail
if [[ $# -ne 8 ]]; then exit 64; fi
id=$1; carrier=$2; root_tuple=$3; stage_parent_tuple=$4; stage_tuple=$5; leases_parent_tuple=$6; lease_parent_tuple=$7; carrier_tuple=$8
lease_parent=/opt/ynx/leases/finance-preparation; case "$id" in p0228-finance-phase1-20260822T234100Z) ;; *) exit 65;; esac
dt(){ if ! test -d "$1" || test -L "$1"; then return 1; fi; stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
root=/opt/ynx; stage_parent="$root/stage"; stage="$stage_parent/finance"; leases_parent="$root/leases"
test "$carrier" = "$stage/$id"; test "$(dt "$root")" = "$root_tuple"; test "$(dt "$stage_parent")" = "$stage_parent_tuple"; test "$(dt "$stage")" = "$stage_tuple"; test "$(dt "$leases_parent")" = "$leases_parent_tuple"; test "$(dt "$lease_parent")" = "$lease_parent_tuple"; test "$(dt "$carrier")" = "$carrier_tuple"; test -z "$(find "$carrier" -mindepth 1 -print -quit)"
read -r magic; test "$magic" = YNX-FINANCE-P2A-1
names=(archive.tgz generator.sh phase2b.sh); modes=(0600 0700 0700); created=()
cleanup(){ for p in "${created[@]}"; do test -f "$p" && test ! -L "$p" && rm -f -- "$p"; done; }; trap cleanup EXIT
for i in 0 1 2; do read -r tag name mode size hash; [[ "$tag" = FRAME && "$name" = "${names[$i]}" && "$mode" = "${modes[$i]}" && "$size" = "${size//[!0-9]/}" && "$hash" = "${hash//[!0-9a-f]/}" ]] || exit 65; read -r data; target="$lease_parent/$id.$name"; [[ ! -e "$target" && ! -L "$target" ]] || exit 65; printf %s "$data" | base64 -d > "$target"; chmod "$mode" "$target"; [[ "$(wc -c < "$target" | tr -d ' ')" = "$size" && "$(sha256sum "$target" | awk '{print $1}')" = "$hash" ]] || exit 65; created+=("$target"); done
read -r end; test "$end" = END; test -z "$(cat)"; for p in "${created[@]}"; do stat -Lc '%n:%d:%i:%u:%g:%a:%h:%s:%F' "$p"; sha256sum "$p"; done; created=(); trap - EXIT
