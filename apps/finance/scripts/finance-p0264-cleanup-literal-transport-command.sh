#!/usr/bin/env bash
# Local, literal one-attempt transport command. Central must freeze every argv
# value, the exact carrier/bootstrap bytes, and the three local receipt paths.
set -euo pipefail
if [[ $# -ne 11 ]]; then exit 64; fi
carrier=$1; bootstrap=$2; bootstrap_bytes=$3; bootstrap_sha=$4; id=$5
parent_tuple=$6; executor_sha=$7; lease_sha=$8; carrier_sha=$9
stdout_path=${10}; stderr_path=${11}; transport_status_path="$stdout_path.status"
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
must(){ "$@" || exit 65; }
absent(){ test ! -e "$1" && test ! -L "$1"; }
must test -f "$carrier"; must test ! -L "$carrier"; must test "$(sha "$carrier")" = "$carrier_sha"
must test -f "$bootstrap"; must test ! -L "$bootstrap"; must test "$(bytes "$bootstrap")" = "$bootstrap_bytes"; must test "$(sha "$bootstrap")" = "$bootstrap_sha"
for path in "$stdout_path" "$stderr_path" "$transport_status_path"; do absent "$path" || exit 65; done
case "$id" in p0264-finance-p0247-cleanup-[0-9TtZz-]*) ;; *) exit 65 ;; esac
parent=/opt/ynx/leases/finance
if [[ "${FINANCE_P0264_TRANSPORT_TEST_ROOT:-}" = 1 ]]; then parent=${FINANCE_P0264_REMOTE_PARENT:?}; fi
executor="$parent/$id.executor.sh"; lease="$parent/$id.json"
bootstrap_b64=$(base64 < "$bootstrap" | tr -d '\n') || exit 65
remote_launcher='bootstrap_source=$(printf "%s" "$1" | base64 -d) || exit 65; shift; exec /bin/bash -c "$bootstrap_source" finance-p0264 "$@"'
ssh_bin=/usr/bin/ssh
sudo_bin=/usr/bin/sudo
if [[ "${FINANCE_P0264_TRANSPORT_TEST_ROOT:-}" = 1 ]]; then
  ssh_bin=${FINANCE_P0264_SSH_BIN:?}
  sudo_bin=${FINANCE_P0264_SUDO_BIN:?}
fi
# ssh joins remote argv into one shell command. Quote every token ourselves so
# the remote login shell cannot split the launcher at its semicolons or expand
# its positional parameters before /bin/bash receives them.
remote_quote(){
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}
remote_command=exec
for remote_arg in "$sudo_bin" -n /bin/bash -c "$remote_launcher" finance-p0264 "$bootstrap_b64" "$id" "$parent" "$parent_tuple" "$executor" "$lease" "$executor_sha" "$lease_sha" "$carrier_sha"; do
  remote_command+=" $(remote_quote "$remote_arg")"
done
transport_rc=0
set -C
if "$ssh_bin" -i /Users/huangjiahao/Downloads/Huang.pem -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/Users/huangjiahao/.ssh/known_hosts -o ConnectTimeout=10 -o ConnectionAttempts=1 ubuntu@43.153.202.237 "$remote_command" < "$carrier" > "$stdout_path" 2> "$stderr_path"; then
  transport_rc=0
else
  transport_rc=$?
fi
terminal_receipt_valid(){
  test -s "$stdout_path" && test ! -s "$stderr_path"
  test "$(wc -l < "$stdout_path" | tr -d ' ')" = 6
  test "$(grep -Fxc 'cleanup=P0247_RESIDUES_REMOVED' "$stdout_path")" = 1
  test "$(grep -Fxc 'transport=P0264_ATOMIC_CONTROL_PLACEMENT' "$stdout_path")" = 1
  test "$(grep -Fxc 'cleanupInvocationCount=1' "$stdout_path")" = 1
  test "$(grep -Fxc 'cleanupExitStatus=0' "$stdout_path")" = 1
  test "$(grep -Fxc 'controlObjectsFinalAbsent=true' "$stdout_path")" = 1
  test "$(grep -Fxc "carrierSha256=$carrier_sha" "$stdout_path")" = 1
}
if [[ "$transport_rc" = 0 ]] && ! terminal_receipt_valid; then transport_rc=65; fi
if ! printf '%s\n' "$transport_rc" > "$transport_status_path"; then exit 65; fi
set +C
exit "$transport_rc"
