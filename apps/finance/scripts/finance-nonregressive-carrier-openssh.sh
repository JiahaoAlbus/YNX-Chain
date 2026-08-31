#!/usr/bin/env bash
# Single-attempt local transport for the signed carrier-preparation lease.
set -euo pipefail
if [[ $# -ne 12 ]]; then exit 64; fi
archive=$1; lease=$2; stdout=$3; stderr=$4; receipt=$5; bootstrap=$6; bootstrap_bytes=$7; bootstrap_sha=$8; archive_bytes=$9; archive_sha=${10}; lease_bytes=${11}; lease_sha=${12}
sha(){ /usr/bin/shasum -a 256 -- "$1" | /usr/bin/awk '{print $1}'; }
bytes(){ /usr/bin/wc -c < "$1" | /usr/bin/tr -d ' '; }
absent(){ test ! -e "$1" && test ! -L "$1"; }
for path in "$stdout" "$stderr" "$receipt" "$receipt.pending"; do case "$path" in /tmp/*) ;; *) exit 65;; esac; absent "$path"; done
for path in "$archive" "$lease" "$bootstrap"; do test -f "$path" && test ! -L "$path"; done
test "$(bytes "$archive")" = "$archive_bytes"; test "$(sha "$archive")" = "$archive_sha"
test "$(bytes "$bootstrap")" = "$bootstrap_bytes"; test "$(sha "$bootstrap")" = "$bootstrap_sha"
test "$(bytes "$lease")" = "$lease_bytes"; test "$(sha "$lease")" = "$lease_sha"
test "$(jq -r '.lease.signed' "$lease")" = true; test "$(jq -r '.lease.kind' "$lease")" = FINANCE_NONREGRESSIVE_CARRIER_PREPARATION
bootstrap_b64=$(/usr/bin/base64 < "$bootstrap" | /usr/bin/tr -d '\n')
lease_b64=$(/usr/bin/base64 < "$lease" | /usr/bin/tr -d '\n')
launcher='bootstrap=$(printf "%s" "$1" | base64 -d) || exit 65; shift; exec /bin/bash -c "$bootstrap" finance-carrier "$@"'
quote(){ printf "'"; printf '%s' "$1" | /usr/bin/sed "s/'/'\\''/g"; printf "'"; }
remote=exec
for arg in /usr/bin/sudo -n /bin/bash -c "$launcher" finance-carrier "$bootstrap_b64" "$lease_b64"; do remote+=" $(quote "$arg")"; done
ssh_rc=0
if /usr/bin/ssh -i /Users/huangjiahao/Downloads/Huang.pem -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/Users/huangjiahao/.ssh/known_hosts -o ConnectTimeout=10 -o ConnectionAttempts=1 ubuntu@43.153.202.237 "$remote" < "$archive" > "$stdout" 2> "$stderr"; then ssh_rc=0; else ssh_rc=$?; fi
valid=false
if [[ "$ssh_rc" = 0 ]] && test -s "$stdout" && test ! -s "$stderr" && test "$(/usr/bin/grep -Fxc 'phase=carrier-preparation' "$stdout")" = 1; then valid=true; else ssh_rc=65; fi
set -C
printf 'transport=FINANCE_NONREGRESSIVE_CARRIER_OPENSSH\nsshExitStatus=%s\nremoteExitStatus=%s\nleaseBytes=%s\nleaseSha256=%s\nstdoutBytes=%s\nstdoutSha256=%s\nterminalReceiptValidated=%s\n' "$ssh_rc" "$ssh_rc" "$lease_bytes" "$lease_sha" "$(bytes "$stdout")" "$(sha "$stdout")" "$valid" > "$receipt.pending"
set +C
/opt/homebrew/bin/gmv -T -- "$receipt.pending" "$receipt"
exit "$ssh_rc"
