#!/bin/bash
set -euo pipefail

repo=/private/tmp/ynx-calendar-control-plane.y8FFQt/repo
objects=$repo/release/integration/p0-wallet-connectivity/execution/objects
bootstrap=$objects/p0-281-finance-p0279-control-cleanup-stdin-bootstrap.sh
carrier=$objects/p0-281-finance-p0279-control-cleanup.carrier
id=p0281-finance-p0279-control-cleanup-20260823T170900Z
remote_executor=/tmp/ynx-finance-$id.executor.sh
remote_lease=/tmp/ynx-finance-$id.json
stdout=/tmp/ynx-finance-p0281-control-cleanup.stdout
stderr=/tmp/ynx-finance-p0281-control-cleanup.stderr

test "$(/usr/bin/shasum -a 256 "$bootstrap" | /usr/bin/awk '{print $1}')" = c52b95cd24da3846e4311830e8324cac406b92775e6f0739fe570b202b090304
test "$(/usr/bin/wc -c < "$bootstrap" | /usr/bin/tr -d ' ')" = 3509
test "$(/usr/bin/shasum -a 256 "$carrier" | /usr/bin/awk '{print $1}')" = e9edb38568549e41e56144d00884aaf0d78f39ec791ac66a4da7c413c45ecb22
test "$(/usr/bin/wc -c < "$carrier" | /usr/bin/tr -d ' ')" = 6327
test ! -e "$stdout" && test ! -L "$stdout"
test ! -e "$stderr" && test ! -L "$stderr"

bootstrap_b64=$(/usr/bin/base64 < "$bootstrap" | /usr/bin/tr -d '\n')
launcher='bootstrap_source=$(printf "%s" "$1" | base64 -d) || exit 65; shift; exec /bin/bash -c "$bootstrap_source" p0281 "$@"'
printf -v remote_command '%q ' /usr/bin/sudo -n /bin/bash -c "$launcher" p0281 "$bootstrap_b64" "$id" "$remote_executor" 2441 b33ebfe0b4a4da027f7db3d64672d8b73b6e7e714bcb0def304f4fed9fa5403b "$remote_lease" 2172 11c0ec664f5601919d016555a57cb815dac09ba69f8d67a54ef8727ca949f93f

set +e
/usr/bin/ssh -i /Users/huangjiahao/Downloads/Huang.pem -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/Users/huangjiahao/.ssh/known_hosts -o ConnectTimeout=10 -o ConnectionAttempts=1 ubuntu@43.153.202.237 "$remote_command" < "$carrier" > "$stdout" 2> "$stderr"
rc=$?
set -e
test "$rc" = 0
test "$(/usr/bin/grep -Fxc 'cleanup=P0279_CONTROL_FILES_REMOVED' "$stdout")" = 1
test "$(/usr/bin/grep -Fxc 'parentStableIdentity=64770:4594822:0:0:750:directory' "$stdout")" = 1
test "$(/usr/bin/grep -Fxc 'remoteExitStatus=0' "$stdout")" = 1
test "$(/usr/bin/grep -Fxc 'temporaryControlsFinalAbsent=true' "$stdout")" = 1
test ! -s "$stderr"
