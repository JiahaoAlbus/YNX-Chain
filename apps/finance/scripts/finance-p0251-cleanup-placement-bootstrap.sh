#!/usr/bin/env bash
# P0-251 transport and execution only. It receives exactly two framed objects
# on stdin, places them into the signed lease parent, and calls the cleanup
# executor once. Any placement failure removes only matching created objects.
set -euo pipefail
if [[ $# -ne 8 ]]; then exit 64; fi
id=$1; parent=$2; parent_tuple=$3; executor=$4; lease=$5; executor_sha=$6; lease_sha=$7; carrier_sha=$8
case "$id" in p0251-finance-p0247-cleanup-[0-9TtZz-]*) ;; *) exit 65 ;; esac
case "$id" in *[!A-Za-z0-9-]*|*..*|*/*) exit 65 ;; esac
dt(){ test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
dt_stable(){ test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%F' -- "$1"; }
ft(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
identity(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i' -- "$1"; }
safe_base(){ case "$1" in ''|.|..|*/*|*..*) return 1;; *) return 0;; esac; }
test "$parent" = /opt/ynx/leases/finance
test "$(dt "$parent")" = "$parent_tuple"
parent_stable=$(printf '%s' "$parent_tuple" | awk -F: '{print $1":"$2":"$3":"$4":"$5":"$8}')
executor_base=$(basename -- "$executor"); lease_base=$(basename -- "$lease")
safe_base "$executor_base"; safe_base "$lease_base"
test "$executor" = "$parent/$executor_base" && test "$lease" = "$parent/$lease_base"
test "$executor" = "$parent/$id.executor.sh" && test "$lease" = "$parent/$id.json"
for path in "$executor" "$lease"; do test ! -e "$path" && test ! -L "$path"; done

executor_created=false; lease_created=false
cleanup_placement(){
  if [[ "$lease_created" = true ]] && test "$(identity "$lease")" = "${lease_identity:-}" && test "$(sha "$lease")" = "$lease_sha" && test "$(bytes "$lease")" = "$lease_bytes"; then rm -f -- "$lease"; fi
  if [[ "$executor_created" = true ]] && test "$(identity "$executor")" = "${executor_identity:-}" && test "$(sha "$executor")" = "$executor_sha" && test "$(bytes "$executor")" = "$executor_bytes"; then rm -f -- "$executor"; fi
}
trap cleanup_placement EXIT

raw=''
IFS= read -r header; raw+="$header"$'\n'; test "$header" = YNX-FINANCE-P0251-CLEANUP-PLACEMENT-1
IFS= read -r frame; raw+="$frame"$'\n'; read -r tag name mode executor_bytes got_executor_sha <<<"$frame"
test "$tag" = FRAME && test "$name" = executor && test "$mode" = 0700 && test "$got_executor_sha" = "$executor_sha"
IFS= read -r encoded_executor; raw+="$encoded_executor"$'\n'
set -C; exec 3> "$executor"; set +C; executor_created=true; executor_identity=$(identity "$executor")
printf %s "$encoded_executor" | base64 -d >&3; exec 3>&-; chmod 0700 -- "$executor"
test "$(identity "$executor")" = "$executor_identity" && test "$(bytes "$executor")" = "$executor_bytes" && test "$(sha "$executor")" = "$executor_sha"

IFS= read -r frame; raw+="$frame"$'\n'; read -r tag name mode lease_bytes got_lease_sha <<<"$frame"
test "$tag" = FRAME && test "$name" = lease && test "$mode" = 0600 && test "$got_lease_sha" = "$lease_sha"
IFS= read -r encoded_lease; raw+="$encoded_lease"$'\n'
set -C; exec 4> "$lease"; set +C; lease_created=true; lease_identity=$(identity "$lease")
printf %s "$encoded_lease" | base64 -d >&4; exec 4>&-; chmod 0600 -- "$lease"
test "$(identity "$lease")" = "$lease_identity" && test "$(bytes "$lease")" = "$lease_bytes" && test "$(sha "$lease")" = "$lease_sha"
jq -e . "$lease" >/dev/null
test "$(jq -r '.lease.signed' "$lease")" = true
test "$(jq -r '.lease.kind' "$lease")" = FINANCE_P0247_RESIDUE_CLEANUP_ONLY
test "$(jq -r '.lease.id' "$lease")" = "$id"
IFS= read -r end; raw+="$end"$'\n'; test "$end" = END
if IFS= read -r extra; then test -z "$extra" && ! IFS= read -r extra; fi
test "$(printf %s "$raw" | sha256sum | awk '{print $1}')" = "$carrier_sha"
test "$(dt_stable "$parent")" = "$parent_stable"

# Placement succeeded. Retain the exact pair for the single authorized cleanup
# invocation and its Central-visible receipt; no retry or automatic cleanup is
# permitted after the executor starts.
trap - EXIT
"$executor" "$lease"
printf 'placementParent=%s\nplacementParentTuple=%s\nexecutor=%s\nexecutorTuple=%s\nexecutorBytes=%s\nexecutorSha256=%s\nlease=%s\nleaseTuple=%s\nleaseBytes=%s\nleaseSha256=%s\ncleanupArgv0=%s\ncleanupArgv1=%s\ncarrierSha256=%s\n' \
  "$parent" "$parent_tuple" "$executor" "$(ft "$executor")" "$executor_bytes" "$executor_sha" "$lease" "$(ft "$lease")" "$lease_bytes" "$lease_sha" "$executor" "$lease" "$carrier_sha"
