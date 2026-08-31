#!/bin/bash
set -euo pipefail

repo=/private/tmp/ynx-calendar-control-plane.y8FFQt/repo
owner=/Users/huangjiahao/Desktop/YNX\ Final\ Worktrees/24-finance
bootstrap=$owner/apps/finance/scripts/finance-p0275-cleanup-stdin-bootstrap.sh
carrier=$repo/release/integration/p0-wallet-connectivity/execution/objects/p0-276-finance-p0272-control-cleanup.carrier
id=p0276-finance-p0272-control-cleanup-20260823T160645Z
remote_executor=/tmp/ynx-finance-$id.executor.sh
remote_lease=/tmp/ynx-finance-$id.json
stdout=/tmp/ynx-finance-p0276-control-cleanup.stdout
stderr=/tmp/ynx-finance-p0276-control-cleanup.stderr

test "$(/usr/bin/shasum -a 256 "$bootstrap" | /usr/bin/awk '{print $1}')" = 973c4ab4deeb9de50b4a16679d37cc30f4f188581e5c04ed393e6e15d8bf6462
test "$(/usr/bin/wc -c < "$bootstrap" | /usr/bin/tr -d ' ')" = 3158
test "$(/usr/bin/shasum -a 256 "$carrier" | /usr/bin/awk '{print $1}')" = 64d480e27ff26d420b1ca333337c7e092b09ac5f1bfb1071052f06799a02a801
test ! -e "$stdout" && test ! -L "$stdout"
test ! -e "$stderr" && test ! -L "$stderr"

bootstrap_b64=$(/usr/bin/base64 < "$bootstrap" | /usr/bin/tr -d '\n')
launcher='bootstrap_source=$(printf "%s" "$1" | base64 -d) || exit 65; shift; exec /bin/bash -c "$bootstrap_source" p0276 "$@"'
printf -v remote_command '%q ' /usr/bin/sudo -n /bin/bash -c "$launcher" p0276 "$bootstrap_b64" "$id" "$remote_executor" 2951 35d00626e9e7f6a1e15f832b6cac86772839267c7827949138f690c4be9e0aec "$remote_lease" 1499 285319ee17514dd426e26c3b38f211d5bd5330a2b85702498b83267f6d272660

set +e
/usr/bin/ssh -i /Users/huangjiahao/Downloads/Huang.pem -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/Users/huangjiahao/.ssh/known_hosts -o ConnectTimeout=10 -o ConnectionAttempts=1 ubuntu@43.153.202.237 "$remote_command" < "$carrier" > "$stdout" 2> "$stderr"
rc=$?
set -e
test "$rc" = 0
test "$(/usr/bin/grep -Fxc 'cleanup=P0272_CONTROL_FILES_REMOVED' "$stdout")" = 1
test "$(/usr/bin/grep -c '^parentStableIdentity=' "$stdout")" = 1
test ! -s "$stderr"
