#!/usr/bin/env bash
# Receives one deterministic two-object carrier on stdin, atomically installs
# its reviewed cleanup executor and Central-signed lease, invokes the executor
# exactly once, then identity-removes only those newly installed control files.
set -euo pipefail
if [[ $# -ne 8 ]]; then exit 64; fi
id=$1; parent=$2; parent_tuple=$3; executor=$4; lease=$5; executor_sha=$6; lease_sha=$7; carrier_sha=$8
case "$id" in p0264-finance-p0247-cleanup-[0-9TtZz-]*) ;; *) exit 65 ;; esac
case "$id" in *[!A-Za-z0-9-]*|*..*|*/*) exit 65 ;; esac
dt(){ test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
dt_stable(){ test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%F' -- "$1"; }
ft(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
identity(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i' -- "$1"; }
absent(){ test ! -e "$1" && test ! -L "$1"; }
safe_base(){ case "$1" in ''|.|..|*/*|*..*) return 1;; *) return 0;; esac; }
must(){ "$@" || exit 65; }
must test "$parent" = /opt/ynx/leases/finance
must test "$(dt "$parent")" = "$parent_tuple"
parent_stable=$(printf '%s' "$parent_tuple" | awk -F: '{print $1":"$2":"$3":"$4":"$5":"$8}')
executor_base=$(basename -- "$executor"); lease_base=$(basename -- "$lease")
safe_base "$executor_base" || exit 65; safe_base "$lease_base" || exit 65
must test "$executor" = "$parent/$id.executor.sh"
must test "$lease" = "$parent/$id.json"
executor_pending="$executor.pending"; lease_pending="$lease.pending"
for path in "$executor" "$lease" "$executor_pending" "$lease_pending"; do absent "$path" || exit 65; done

executor_bytes=''; lease_bytes=''; executor_identity=''; lease_identity=''
executor_pending_created=false; lease_pending_created=false
executor_created=false; lease_created=false
remove_if_owned(){
  local path=$1 created=$2 expected_identity=$3 expected_sha=$4 expected_bytes=$5
  if [[ "$created" = true ]] && test "$(identity "$path")" = "$expected_identity" && test "$(sha "$path")" = "$expected_sha" && test "$(bytes "$path")" = "$expected_bytes"; then rm -f -- "$path" || exit 65; fi
}
cleanup_controls(){
  remove_if_owned "$lease" "$lease_created" "$lease_identity" "$lease_sha" "$lease_bytes"
  remove_if_owned "$executor" "$executor_created" "$executor_identity" "$executor_sha" "$executor_bytes"
  remove_if_owned "$lease_pending" "$lease_pending_created" "${lease_pending_identity:-}" "$lease_sha" "$lease_bytes"
  remove_if_owned "$executor_pending" "$executor_pending_created" "${executor_pending_identity:-}" "$executor_sha" "$executor_bytes"
}
trap cleanup_controls EXIT

raw=''
IFS= read -r header || exit 65; raw+="$header"$'\n'; must test "$header" = YNX-FINANCE-P0264-CLEANUP-ATOMIC-TRANSPORT-1
IFS= read -r frame || exit 65; raw+="$frame"$'\n'; read -r tag name mode executor_bytes got_executor_sha <<<"$frame" || exit 65
must test "$tag" = FRAME; must test "$name" = executor; must test "$mode" = 0700; must test "$got_executor_sha" = "$executor_sha"
IFS= read -r encoded_executor || exit 65; raw+="$encoded_executor"$'\n'
set -C; if ! exec 3> "$executor_pending"; then exit 65; fi; set +C; executor_pending_created=true; executor_pending_identity=$(identity "$executor_pending")
printf '%s' "$encoded_executor" | base64 -d >&3 || exit 65; exec 3>&- || exit 65; chmod 0700 -- "$executor_pending" || exit 65
must test "$(identity "$executor_pending")" = "$executor_pending_identity"; must test "$(bytes "$executor_pending")" = "$executor_bytes"; must test "$(sha "$executor_pending")" = "$executor_sha"
must test "$(dt_stable "$parent")" = "$parent_stable"
mv -T -- "$executor_pending" "$executor" || exit 65; executor_pending_created=false; executor_created=true; executor_identity=$executor_pending_identity
must test "$(identity "$executor")" = "$executor_identity"; must test "$(stat -Lc '%a' -- "$executor")" = 700; must test "$(bytes "$executor")" = "$executor_bytes"; must test "$(sha "$executor")" = "$executor_sha"

IFS= read -r frame || exit 65; raw+="$frame"$'\n'; read -r tag name mode lease_bytes got_lease_sha <<<"$frame" || exit 65
must test "$tag" = FRAME; must test "$name" = lease; must test "$mode" = 0600; must test "$got_lease_sha" = "$lease_sha"
IFS= read -r encoded_lease || exit 65; raw+="$encoded_lease"$'\n'
set -C; if ! exec 4> "$lease_pending"; then exit 65; fi; set +C; lease_pending_created=true; lease_pending_identity=$(identity "$lease_pending")
printf '%s' "$encoded_lease" | base64 -d >&4 || exit 65; exec 4>&- || exit 65; chmod 0600 -- "$lease_pending" || exit 65
must test "$(identity "$lease_pending")" = "$lease_pending_identity"; must test "$(bytes "$lease_pending")" = "$lease_bytes"; must test "$(sha "$lease_pending")" = "$lease_sha"
must test "$(dt_stable "$parent")" = "$parent_stable"
mv -T -- "$lease_pending" "$lease" || exit 65; lease_pending_created=false; lease_created=true; lease_identity=$lease_pending_identity
must test "$(identity "$lease")" = "$lease_identity"; must test "$(stat -Lc '%a' -- "$lease")" = 600; must test "$(bytes "$lease")" = "$lease_bytes"; must test "$(sha "$lease")" = "$lease_sha"
jq -e . "$lease" >/dev/null || exit 65
must test "$(jq -r '.lease.signed' "$lease")" = true
must test "$(jq -r '.lease.kind' "$lease")" = FINANCE_P0247_RESIDUE_CLEANUP_ONLY
must test "$(jq -r '.lease.id' "$lease")" = "$id"
must test "$(jq -r '.lease.p0247.id' "$lease")" = p0247-finance-phase3-20260823T073800Z
IFS= read -r end || exit 65; raw+="$end"$'\n'; must test "$end" = END
if IFS= read -r extra; then
  must test -z "$extra"
  if IFS= read -r extra; then exit 65; fi
fi
must test "$(printf '%s' "$raw" | sha256sum | awk '{print $1}')" = "$carrier_sha"
must test "$(dt_stable "$parent")" = "$parent_stable"

cleanup_rc=0
if "$executor" "$lease"; then cleanup_rc=0; else cleanup_rc=$?; fi
cleanup_controls
trap - EXIT
for path in "$executor" "$lease" "$executor_pending" "$lease_pending"; do absent "$path" || exit 65; done
must test "$(dt_stable "$parent")" = "$parent_stable"
printf 'transport=P0264_ATOMIC_CONTROL_PLACEMENT\ncleanupInvocationCount=1\ncleanupExitStatus=%s\ncontrolObjectsFinalAbsent=true\ncarrierSha256=%s\n' "$cleanup_rc" "$carrier_sha"
exit "$cleanup_rc"
