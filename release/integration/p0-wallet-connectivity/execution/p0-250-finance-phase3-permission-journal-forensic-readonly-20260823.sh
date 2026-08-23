#!/usr/bin/env bash
# P0-250: zero-write, secret-safe permission and fixed-window journal forensics.
set -euo pipefail

service=ynx-finance.service
since='2026-08-23 07:38:00 UTC'
until='2026-08-23 07:47:00 UTC'
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
tuple(){ stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
journal(){ journalctl --utc --since "$since" --until "$until" -u "$service" -o cat --no-pager; }
access_check(){
  local label=$1 flag=$2 path=$3
  if runuser -u ynx -- test "$flag" "$path"; then printf '%s=PASS\n' "$label"; else printf '%s=FAIL\n' "$label"; fi
}

[[ -L /opt/ynx/finance-current ]]
[[ "$(readlink -- /opt/ynx/finance-current)" == '/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a' ]]
[[ "$(sha /etc/ynx/finance.env)" == '854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252' ]]
[[ "$(systemctl show "$service" -p ActiveState --value)" == active ]]
[[ "$(systemctl show "$service" -p MainPID --value)" == 2241003 ]]
[[ "$(systemctl show "$service" -p NRestarts --value)" == 0 ]]
[[ ! -e /opt/ynx/releases/finance/p0247-finance-phase3-20260823T073800Z && ! -L /opt/ynx/releases/finance/p0247-finance-phase3-20260823T073800Z ]]

unit_user=$(systemctl show "$service" -p User --value)
unit_group=$(systemctl show "$service" -p Group --value)
unit_working=$(systemctl show "$service" -p WorkingDirectory --value)
unit_exec=$(systemctl show "$service" -p ExecStart --value)
ynx_uid=$(id -u ynx)
ynx_gid=$(id -g ynx)
ynx_groups=$(id -G ynx)
normalized_journal_sha=$(journal | sed -E 's/[0-9]+/<N>/g; s/[[:space:]]+/ /g; s/^ //; s/ $//' | LC_ALL=C sort | sha256sum | awk '{print $1}')
journal_lines=$(journal | wc -l | tr -d ' ')
if journal | grep -Eiq 'permission denied|status=[0-9]+/CHDIR|changing to the requested working directory|Failed at step CHDIR'; then
  failure_class=PERMISSION_OR_WORKING_DIRECTORY_TRAVERSE
elif journal | grep -Eiq 'status=[0-9]+/EXEC|Failed at step EXEC|exec.*failed'; then
  failure_class=EXEC_FAILURE
elif journal | grep -Eiq 'address already in use|bind.*failed|listen.*failed'; then
  failure_class=LISTENER_BIND_FAILURE
elif journal | grep -Eiq 'failed|fatal|error'; then
  failure_class=OTHER_NORMALIZED_RUNTIME_FAILURE
elif [[ "$journal_lines" == 0 ]]; then
  failure_class=NO_JOURNAL_LINES_IN_FIXED_WINDOW
else
  failure_class=NO_MATCHED_FAILURE_CLASS
fi

printf 'inspection=P0-250\n'
printf 'journalSince=%s\njournalUntil=%s\njournalLineCount=%s\n' "$since" "$until" "$journal_lines"
printf 'journalNormalizedFailureClass=%s\n' "$failure_class"
printf 'journalNormalizedMessageSha256=%s\n' "$normalized_journal_sha"
printf 'unitUser=%s\nunitGroup=%s\nunitWorkingDirectory=%s\n' "$unit_user" "$unit_group" "$unit_working"
printf 'unitExecStartSha256=%s\n' "$(printf '%s\n' "$unit_exec" | sha256sum | awk '{print $1}')"
printf 'unitExecStartNormalized=%s\n' "$(printf '%s' "$unit_exec" | sed -E 's/[[:space:]]+/ /g')"
printf 'ynxUid=%s\nynxGid=%s\nynxGroups=%s\n' "$ynx_uid" "$ynx_gid" "$ynx_groups"
printf 'signedFormerReleaseContainerOwner=0:0\n'
printf 'signedFormerReleaseContainerMode=750\n'
case " $ynx_groups " in
  *' 0 '*) printf 'signedFormerReleaseContainerTraverseForYnx=GROUP_EXECUTE_ALLOWED\n';;
  *) if [[ "$ynx_uid" == 0 ]]; then printf 'signedFormerReleaseContainerTraverseForYnx=OWNER_EXECUTE_ALLOWED\n'; else printf 'signedFormerReleaseContainerTraverseForYnx=DENIED_BY_ROOT_ROOT_0750\n'; fi;;
esac
printf 'currentPathNameiBegin\n'
namei -om /opt/ynx/finance-current/ynx-finance
printf 'currentPathNameiEnd\n'
printf 'formerPathNameiBegin\n'
namei -om /opt/ynx/releases/finance/p0247-finance-phase3-20260823T073800Z/ynx-finance-7824af677dd0/ynx-finance || true
printf 'formerPathNameiEnd\n'
access_check ynxCanTraverseOpt -x /opt
access_check ynxCanTraverseYnx -x /opt/ynx
access_check ynxCanTraverseReleases -x /opt/ynx/releases
access_check ynxCanTraverseFinanceReleases -x /opt/ynx/releases/finance
access_check ynxCanTraverseCurrentRelease -x /opt/ynx/releases/finance/ynx-finance-3b2383f5c18a
access_check ynxCanExecuteCurrentBinary -x /opt/ynx/releases/finance/ynx-finance-3b2383f5c18a/ynx-finance
printf 'currentLinkTuple=%s\ncurrentTarget=%s\n' "$(stat -c '%d:%i:%u:%g:%a:%h:%s:%F' /opt/ynx/finance-current)" "$(readlink -- /opt/ynx/finance-current)"
printf 'currentReleaseTuple=%s\n' "$(tuple /opt/ynx/finance-current)"
printf 'productionEnvTuple=%s\nproductionEnvSha256=%s\n' "$(tuple /etc/ynx/finance.env)" "$(sha /etc/ynx/finance.env)"
printf 'serviceActiveState=%s\nserviceSubState=%s\nservicePid=%s\nserviceNRestarts=%s\n' "$(systemctl show "$service" -p ActiveState --value)" "$(systemctl show "$service" -p SubState --value)" "$(systemctl show "$service" -p MainPID --value)" "$(systemctl show "$service" -p NRestarts --value)"
printf 'inspectionComplete=true\n'
