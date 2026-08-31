#!/usr/bin/env bash
set -euo pipefail

tuple_l(){ stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha_file(){ sha256sum -- "$1" | awk '{print $1}'; }
bytes_file(){ wc -c < "$1" | tr -d ' '; }
tree_inventory(){
  local root=$1 item kind
  (
    cd "$root"
    while IFS= read -r -d '' item; do
      kind=$(stat -c '%F' -- "$item")
      printf '%s\0%s\0%s\0' "$item" "$kind" "$(stat -c '%u:%g:%a:%h:%s' -- "$item")"
      case "$kind" in
        'regular file') sha_file "$item" | tr '\n' '\0' ;;
        'symbolic link') readlink -- "$item" | tr '\n' '\0' ;;
        *) printf '\0' ;;
      esac
    done < <(find . -mindepth 1 -print0 | LC_ALL=C sort -z)
  ) | sha256sum | awk '{print $1}'
}
inspect(){
  local label=$1 path=$2 kind count target
  if [[ -L "$path" ]]; then
    target=$(readlink -- "$path")
    printf '%s=symlink|%s|target=%s|targetSha256=%s\n' "$label" "$(tuple_l "$path")" "$target" "$(printf %s "$target" | sha256sum | awk '{print $1}')"
  elif [[ -f "$path" ]]; then
    printf '%s=file|%s|bytes=%s|sha256=%s\n' "$label" "$(tuple_l "$path")" "$(bytes_file "$path")" "$(sha_file "$path")"
  elif [[ -d "$path" ]]; then
    count=$(find -P "$path" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' ')
    printf '%s=directory|%s|directChildren=%s|inventorySha256=%s\n' "$label" "$(tuple_l "$path")" "$count" "$(tree_inventory "$path")"
  elif [[ -e "$path" ]]; then
    kind=$(stat -c '%F' -- "$path")
    printf '%s=other:%s|%s\n' "$label" "$kind" "$(tuple_l "$path")"
  else
    printf '%s=absent\n' "$label"
  fi
}
http(){
  local label=$1 url=$2
  {
    curl --silent --show-error --max-time 15 -o - -w $'\n__META__%{http_code}\t%{size_download}\t%{content_type}\n' "$url" || true
  } | perl -MDigest::SHA=sha256_hex -e 'local $/;my$d=<STDIN>;my$m="\n__META__";my$a=rindex($d,$m);if($a<0){print "$ARGV[0]=$ARGV[1]|transport-no-meta\n";exit 0}my$b=substr($d,0,$a);my$x=substr($d,$a+length($m));if($x!~/\A([0-9]+)\t([0-9]+)\t([^\n]*)\n\z/){print "$ARGV[0]=$ARGV[1]|invalid-meta\n";exit 0}print "$ARGV[0]=$ARGV[1]|$1:".length($b).":".sha256_hex($b).":".$3."\n"' "$label" "$url"
}
journal_summary(){
  local body class
  body=$(journalctl --unit ynx-finance.service --since '2026-08-23 20:14:00 UTC' --until '2026-08-23 20:22:00 UTC' --output=cat --no-pager 2>/dev/null || true)
  class=OTHER_OR_EMPTY
  if grep -Eqi 'permission denied|working directory|chdir|status=200/CHDIR' <<<"$body"; then class=PERMISSION_OR_WORKING_DIRECTORY
  elif grep -Eqi 'failed|error|exit-code|status=[1-9]' <<<"$body"; then class=SERVICE_OR_EXECUTOR_FAILURE
  fi
  printf 'journalClass=%s\njournalBytes=%s\njournalSha256=%s\n' "$class" "$(printf %s "$body" | wc -c | tr -d ' ')" "$(printf %s "$body" | sha256sum | awk '{print $1}')"
}

printf 'inspection=FINANCE_P0300_REMOTE_STATE_ZERO_WRITE\n'
for spec in \
  leaseParent:/opt/ynx/leases/finance \
  executorPending:/opt/ynx/leases/finance/p0300-finance-phase3-20260824t210000z.executor.sh.pending \
  executor:/opt/ynx/leases/finance/p0300-finance-phase3-20260824t210000z.executor.sh \
  signedLeasePending:/opt/ynx/leases/finance/p0300-finance-phase3-20260824t210000z.json.pending \
  signedLease:/opt/ynx/leases/finance/p0300-finance-phase3-20260824t210000z.json \
  manualRollbackPending:/opt/ynx/leases/finance/p0300-finance-phase3-20260824t210000z.manual-rollback.json.pending \
  manualRollbackLease:/opt/ynx/leases/finance/p0300-finance-phase3-20260824t210000z.manual-rollback.json \
  stageParent:/opt/ynx/stage/finance \
  stageContainer:/opt/ynx/stage/finance/p0300-finance-phase3-20260824t210000z \
  stage:/opt/ynx/stage/finance/p0300-finance-phase3-20260824t210000z/stage \
  backupParent:/var/backups/ynx-finance \
  backupContainer:/var/backups/ynx-finance/p0300-finance-phase3-20260824t210000z \
  backup:/var/backups/ynx-finance/p0300-finance-phase3-20260824t210000z/backup \
  releaseParent:/opt/ynx/releases/finance \
  releaseContainer:/opt/ynx/releases/finance/p0300-finance-phase3-20260824t210000z \
  release:/opt/ynx/releases/finance/p0300-finance-phase3-20260824t210000z/ynx-finance-7824af677dd0 \
  current:/opt/ynx/finance-current \
  currentNext:/opt/ynx/finance-current.next \
  currentRollback:/opt/ynx/finance-current.rollback \
  currentBinary:/opt/ynx/finance-current/ynx-finance \
  env:/etc/ynx/finance.env \
  state:/var/lib/ynx/finance/state.json \
  unit:/etc/systemd/system/ynx-finance.service \
  caddy:/etc/caddy/conf.d/ynx-finance.caddy
do
  inspect "${spec%%:*}" "${spec#*:}"
done
systemctl show ynx-finance.service -p LoadState -p ActiveState -p SubState -p MainPID -p NRestarts -p ExecStart -p WorkingDirectory -p User -p Group --no-pager
http loopbackRoot http://127.0.0.1:6483/
http loopbackHealth http://127.0.0.1:6483/health
http loopbackVersion http://127.0.0.1:6483/version
http publicRoot https://finance.ynxweb4.com/
http publicHealth https://finance.ynxweb4.com/health
http publicVersion https://finance.ynxweb4.com/version
journal_summary
printf 'remoteExitStatus=0\ninspectionComplete=true\nmutationCount=0\n'
