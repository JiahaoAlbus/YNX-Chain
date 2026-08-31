#!/usr/bin/env bash
# One exact OpenSSH deployment transport. The remote login shell receives one
# fully quoted command, while stdin remains exactly the signed deployment JSON.
set -euo pipefail
if [[ $# -ne 25 ]]; then exit 64; fi
stdin=$1; stdout=$2; stderr=$3; receipt=$4; bootstrap=$5; bootstrap_bytes=$6; bootstrap_sha=$7; executor_b64_path=$8; executor_b64_bytes=$9; executor_b64_sha=${10}; shift 10
id=$1; shift
bootstrap_args=("$@")
sha(){ /usr/bin/shasum -a 256 -- "$1" | /usr/bin/awk '{print $1}'; }
bytes(){ /usr/bin/wc -c < "$1" | /usr/bin/tr -d ' '; }
absent(){ test ! -e "$1" && test ! -L "$1"; }
must(){ "$@" || exit 65; }
for path in "$stdin" "$stdout" "$stderr" "$receipt" "$receipt.pending"; do case "$path" in /tmp/*) ;; *) exit 65;; esac; done
must test -f "$stdin"; must test ! -L "$stdin"
must test -f "$bootstrap"; must test ! -L "$bootstrap"; must test "$(bytes "$bootstrap")" = "$bootstrap_bytes"; must test "$(sha "$bootstrap")" = "$bootstrap_sha"
case "$executor_b64_path" in */apps/finance/evidence/finance-nonregressive-phase3-executor.base64) ;; *) exit 65;; esac
must test -f "$executor_b64_path"; must test ! -L "$executor_b64_path"; must test "$(bytes "$executor_b64_path")" = "$executor_b64_bytes"; must test "$(sha "$executor_b64_path")" = "$executor_b64_sha"
for path in "$stdout" "$stderr" "$receipt" "$receipt.pending"; do absent "$path" || exit 65; done
case "$id" in p0[0-9][0-9][0-9]-finance-phase3-[0-9TtZz-]*|finance-combined-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9TtZz-]*) ;; *) exit 65;; esac
test "${#bootstrap_args[@]}" = 14
executor_b64=$(/usr/bin/tr -d '\n' < "$executor_b64_path") || exit 65
bootstrap_args=("${bootstrap_args[@]:0:10}" "$executor_b64" "${bootstrap_args[@]:10}")
test "${#bootstrap_args[@]}" = 15
bootstrap_b64=$(/usr/bin/base64 < "$bootstrap" | /usr/bin/tr -d '\n') || exit 65
remote_launcher='bootstrap_source=$(printf "%s" "$1" | /usr/bin/base64 -d) || exit 65; shift; exec /bin/bash -c "$bootstrap_source" finance-phase3 "$@"'
ssh_bin=/usr/bin/ssh; sudo_bin=/usr/bin/sudo; mv_bin=/opt/homebrew/bin/gmv
remote_quote(){ printf "'"; printf '%s' "$1" | /usr/bin/sed "s/'/'\\\\''/g"; printf "'"; }
remote_command=exec
for remote_arg in "$sudo_bin" -n /bin/bash -c "$remote_launcher" finance-phase3 "$bootstrap_b64" "$id" "${bootstrap_args[@]}"; do remote_command+=" $(remote_quote "$remote_arg")"; done
ssh_rc=0
if "$ssh_bin" -i /Users/huangjiahao/Downloads/Huang.pem -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/Users/huangjiahao/.ssh/known_hosts -o ConnectTimeout=10 -o ConnectionAttempts=1 ubuntu@43.153.202.237 "$remote_command" < "$stdin" > "$stdout" 2> "$stderr"; then ssh_rc=0; else ssh_rc=$?; fi
terminal_receipt_valid(){
  test -s "$stdout" && test ! -s "$stderr"
  test "$(/usr/bin/grep -Fxc 'phase=3' "$stdout")" = 1
  for key in deployParent deployParentTuple executor executorTuple executorBytes executorSha256 lease leaseTuple leaseBytes leaseSha256 rollbackArgv0 rollbackArgv1 rollbackArgv2; do test "$(/usr/bin/grep -c "^${key}=" "$stdout")" = 1; done
}
if [[ "$ssh_rc" = 0 ]] && ! terminal_receipt_valid; then ssh_rc=65; fi
set -C
printf 'transport=FINANCE_PHASE3_OPENSSH_SERIALIZED\nsshExitStatus=%s\nremoteExitStatus=%s\nstdoutBytes=%s\nstdoutSha256=%s\nterminalReceiptValidated=%s\n' "$ssh_rc" "$ssh_rc" "$(bytes "$stdout")" "$(sha "$stdout")" "$([[ "$ssh_rc" = 0 ]] && printf true || printf false)" > "$receipt.pending"
set +C
"$mv_bin" -T -- "$receipt.pending" "$receipt"
exit "$ssh_rc"
