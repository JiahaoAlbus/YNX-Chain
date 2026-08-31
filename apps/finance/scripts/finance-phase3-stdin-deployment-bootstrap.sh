#!/usr/bin/env bash
# Finance Phase3 transport only. Receive one exact signed deployment lease on
# stdin, atomically place the SHA-bound deploy executor and lease, then invoke
# deploy exactly once. Once deploy begins, the retained pair is the only frozen
# manual rollback command object; this bootstrap never retries deploy/rollback.
set -euo pipefail

if [[ $# -ne 16 ]]; then exit 64; fi
id=$1; carrier=$2; root_tuple=$3; deploy_parent_tuple=$4; carrier_tuple=$5
archive_tuple=$6; archive_sha=$7; archive_bytes=$8
env_tuple=$9; env_sha=${10}; env_bytes=${11}
executor_b64=${12}; executor_bytes=${13}; executor_sha=${14}; lease_bytes=${15}; lease_sha=${16}

case "$id" in
  p0[0-9][0-9][0-9]-finance-phase3-[0-9TtZz-]*|finance-combined-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9TtZz-]*) ;;
  *) exit 65 ;;
esac
case "$id" in *[!A-Za-z0-9-]*|*..*|*/*) exit 65;; esac

dt(){ test -d "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
ft(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$1"; }
sha(){ sha256sum "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
exact(){ test "$(ft "$1")" = "$2" && test "$(sha "$1")" = "$3" && test "$(bytes "$1")" = "$4"; }
identity(){ test -f "$1" && test ! -L "$1" && stat -Lc '%d:%i' "$1"; }

root=/opt/ynx; deploy_parent="$root/leases/finance"
carrier_id=${carrier##*/}
case "$carrier_id" in finance-combined-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9TtZz-]*) ;; *) exit 65;; esac
case "$carrier_id" in *[!A-Za-z0-9-]*|*..*|*/*) exit 65;; esac
test "$carrier" = "$root/stage/finance/$carrier_id"
test "$(realpath -e "$carrier")" = "$carrier"
test "$(dt "$root")" = "$root_tuple"; test "$(dt "$deploy_parent")" = "$deploy_parent_tuple"; test "$(realpath -e "$deploy_parent")" = "$deploy_parent"; test "$(dt "$carrier")" = "$carrier_tuple"
archive="$carrier/candidate.tgz"; candidate_env="$carrier/finance.env"
exact "$archive" "$archive_tuple" "$archive_sha" "$archive_bytes"; exact "$candidate_env" "$env_tuple" "$env_sha" "$env_bytes"
expected_carrier=$(printf '%s\n%s\n' "$archive" "$candidate_env" | LC_ALL=C sort)
observed_carrier=$(find "$carrier" -mindepth 1 -maxdepth 1 -print | LC_ALL=C sort)
test "$observed_carrier" = "$expected_carrier"

executor="$deploy_parent/$id.executor.sh"; executor_pending="$executor.pending"
lease="$deploy_parent/$id.json"; lease_pending="$lease.pending"
for path in "$executor" "$executor_pending" "$lease" "$lease_pending"; do test ! -e "$path" && test ! -L "$path"; done

executor_pending_created=false; executor_created=false; lease_pending_created=false; lease_created=false
cleanup_placement(){
  if [[ "$lease_created" = true ]] && exact "$lease" "$lease_post_tuple" "$lease_sha" "$lease_bytes"; then rm -f -- "$lease"; fi
  if [[ "$lease_pending_created" = true ]] && test "$(identity "$lease_pending")" = "$lease_pending_identity"; then rm -f -- "$lease_pending"; fi
  if [[ "$executor_created" = true ]] && exact "$executor" "$executor_post_tuple" "$executor_sha" "$executor_bytes"; then rm -f -- "$executor"; fi
  if [[ "$executor_pending_created" = true ]] && test "$(identity "$executor_pending")" = "$executor_pending_identity"; then rm -f -- "$executor_pending"; fi
  test "$(dt "$deploy_parent")" = "$deploy_parent_tuple" || exit 65
}
trap cleanup_placement EXIT
umask 077
set -C; exec 3> "$executor_pending"; set +C; executor_pending_created=true; executor_pending_identity=$(identity "$executor_pending")
printf %s "$executor_b64" | base64 -d >&3; exec 3>&-; chmod 0700 "$executor_pending"
test "$(identity "$executor_pending")" = "$executor_pending_identity"; executor_pending_tuple=$(ft "$executor_pending"); exact "$executor_pending" "$executor_pending_tuple" "$executor_sha" "$executor_bytes"
mv -T -- "$executor_pending" "$executor"; executor_pending_created=false; executor_created=true; test "$(identity "$executor")" = "$executor_pending_identity"; executor_post_tuple=$(ft "$executor")
set -C; exec 4> "$lease_pending"; set +C; lease_pending_created=true; lease_pending_identity=$(identity "$lease_pending")
cat >&4; exec 4>&-; chmod 0600 "$lease_pending"
test "$(identity "$lease_pending")" = "$lease_pending_identity"; lease_pending_tuple=$(ft "$lease_pending"); exact "$lease_pending" "$lease_pending_tuple" "$lease_sha" "$lease_bytes"; jq -e . "$lease_pending" >/dev/null
test "$(jq -r '.lease.signed' "$lease_pending")" = true
test "$(jq -r '.lease.kind' "$lease_pending")" = FINANCE_ROLLBACK_FIRST_PRODUCTION_DEPLOYMENT
test "$(jq -r '.lease.id' "$lease_pending")" = "$id"
mv -T -- "$lease_pending" "$lease"; lease_pending_created=false; lease_created=true; test "$(identity "$lease")" = "$lease_pending_identity"; lease_post_tuple=$(ft "$lease")

# From this boundary forward retain the exact pair on every outcome. The deploy
# executor owns first-failure rollback. A later Central-authorized manual
# rollback, if required, can only be: <executor> rollback <lease>.
trap - EXIT
"$executor" deploy "$lease"
printf 'phase=3\ndeployParent=%s\ndeployParentTuple=%s\nexecutor=%s\nexecutorTuple=%s\nexecutorBytes=%s\nexecutorSha256=%s\nlease=%s\nleaseTuple=%s\nleaseBytes=%s\nleaseSha256=%s\nrollbackArgv0=%s\nrollbackArgv1=rollback\nrollbackArgv2=%s\n' \
  "$deploy_parent" "$deploy_parent_tuple" "$executor" "$executor_post_tuple" "$executor_bytes" "$executor_sha" "$lease" "$lease_post_tuple" "$lease_bytes" "$lease_sha" "$executor" "$lease"
