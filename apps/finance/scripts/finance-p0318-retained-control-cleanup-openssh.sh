#!/usr/bin/env bash
# Single-attempt transport for the P0-318 retained-control cleanup only.
set -euo pipefail
if [[ $# -ne 10 ]]; then exit 64; fi
executor=$1; lease=$2; stdout=$3; stderr=$4; receipt=$5
executor_bytes=$6; executor_sha=$7; lease_bytes=$8; lease_sha=$9; expected_cleanup=${10}
sha(){ /usr/bin/shasum -a 256 -- "$1" | /usr/bin/awk '{print $1}'; }
bytes(){ /usr/bin/wc -c < "$1" | /usr/bin/tr -d ' '; }
absent(){ test ! -e "$1" && test ! -L "$1"; }
for path in "$stdout" "$stderr" "$receipt" "$receipt.pending"; do case "$path" in /tmp/*) ;; *) exit 65;; esac; absent "$path"; done
for path in "$executor" "$lease"; do test -f "$path" && test ! -L "$path"; done
test "$(bytes "$executor")" = "$executor_bytes"; test "$(sha "$executor")" = "$executor_sha"
test "$(bytes "$lease")" = "$lease_bytes"; test "$(sha "$lease")" = "$lease_sha"
test "$(/usr/bin/python3 -c 'import json,sys; print(str(json.load(open(sys.argv[1]))["lease"]["signed"]).lower())' "$lease")" = true
test "$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["lease"]["kind"])' "$lease")" = FINANCE_P0318_RETAINED_CONTROL_CLEANUP_ONLY
executor_b64=$(/usr/bin/base64 < "$executor" | /usr/bin/tr -d '\n')
lease_b64=$(/usr/bin/base64 < "$lease" | /usr/bin/tr -d '\n')
launcher='executor=$(printf "%s" "$1" | base64 -d) || exit 65; shift; exec /usr/bin/python3 -c "$executor" cleanup "$1"'
quote(){ printf "'"; printf '%s' "$1" | /usr/bin/sed "s/'/'\\''/g"; printf "'"; }
remote=exec
for arg in /usr/bin/sudo -n /bin/bash -c "$launcher" finance-p0318-cleanup "$executor_b64" "$lease_b64"; do remote+=" $(quote "$arg")"; done
ssh_rc=0
if /usr/bin/ssh -i /Users/huangjiahao/Downloads/Huang.pem -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/Users/huangjiahao/.ssh/known_hosts -o ConnectTimeout=10 -o ConnectionAttempts=1 ubuntu@43.153.202.237 "$remote" > "$stdout" 2> "$stderr"; then ssh_rc=0; else ssh_rc=$?; fi
valid=false
if [[ "$ssh_rc" = 0 ]] && test ! -s "$stderr" && test "$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["cleanup"])' "$stdout")" = "$expected_cleanup"; then valid=true; else ssh_rc=65; fi
set -C
printf 'transport=FINANCE_P0318_RETAINED_CONTROL_CLEANUP_OPENSSH\nsshExitStatus=%s\nremoteExitStatus=%s\nexecutorBytes=%s\nexecutorSha256=%s\nleaseBytes=%s\nleaseSha256=%s\nstdoutBytes=%s\nstdoutSha256=%s\nterminalReceiptValidated=%s\n' "$ssh_rc" "$ssh_rc" "$executor_bytes" "$executor_sha" "$lease_bytes" "$lease_sha" "$(bytes "$stdout")" "$(sha "$stdout")" "$valid" > "$receipt.pending"
set +C
/opt/homebrew/bin/gmv -T -- "$receipt.pending" "$receipt"
exit "$ssh_rc"
