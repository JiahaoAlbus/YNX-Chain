#!/usr/bin/env bash
set -euo pipefail

id=p0272-finance-phase3-20260823T152627Z
tuple_l(){ stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
tuple_d(){ stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha_file(){ sha256sum -- "$1" | awk '{print $1}'; }
bytes_file(){ wc -c < "$1" | tr -d ' '; }
tree_inventory(){
  local root=$1
  (
    cd "$root"
    while IFS= read -r -d '' path; do
      kind=$(stat -c '%F' -- "$path")
      printf '%s\0%s\0%s\0' "$path" "$kind" "$(stat -c '%u:%g:%a:%h:%s' -- "$path")"
      case "$kind" in
        'regular file') sha_file "$path" | tr '\n' '\0' ;;
        'symbolic link') readlink -- "$path" | tr '\n' '\0' ;;
        *) printf '\0' ;;
      esac
    done < <(find . -mindepth 1 -print0 | LC_ALL=C sort -z)
  ) | sha256sum | awk '{print $1}'
}
inspect(){
  local label=$1 path=$2 kind count
  if [[ -L "$path" ]]; then
    printf '%s=symlink|%s|targetSha256=%s\n' "$label" "$(tuple_l "$path")" "$(printf %s "$(readlink -- "$path")" | sha256sum | awk '{print $1}')"
  elif [[ -f "$path" ]]; then
    printf '%s=file|%s|bytes=%s|sha256=%s\n' "$label" "$(tuple_l "$path")" "$(bytes_file "$path")" "$(sha_file "$path")"
  elif [[ -d "$path" ]]; then
    count=$(find "$path" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' ')
    printf '%s=directory|%s|directChildren=%s|inventorySha256=%s\n' "$label" "$(tuple_l "$path")" "$count" "$(tree_inventory "$path")"
  elif [[ -e "$path" ]]; then
    kind=$(stat -c '%F' -- "$path")
    printf '%s=other:%s|%s\n' "$label" "$kind" "$(tuple_l "$path")"
  else
    printf '%s=absent\n' "$label"
  fi
}
http(){
  local label=$1 url=$2 report
  report=$(
    { curl --silent --show-error --max-time 15 -o - -w $'\n__META__%{http_code}\t%{size_download}\t%{content_type}\n' "$url" || true; } |
      perl -MDigest::SHA=sha256_hex -e 'local $/;my$d=<STDIN>;my$m="\n__META__";my$a=rindex($d,$m);if($a<0){print "transport-no-meta";exit 0}my$b=substr($d,0,$a);my$x=substr($d,$a+length($m));if($x!~/\A([0-9]+)\t([0-9]+)\t([^\n]*)\n\z/){print "invalid-meta";exit 0}print "$1:".length($b).":".sha256_hex($b).":".$3'
  )
  printf '%s=%s\n' "$label" "$report"
}
journal_digest(){
  journalctl --unit ynx-finance.service --since '2026-08-23 15:29:00 UTC' --until '2026-08-23 15:36:30 UTC' --output=cat --no-pager
}

printf 'inspection=FINANCE_P0272_REMOTE_STATE_ZERO_WRITE\n'
for spec in \
  deployParent:/opt/ynx/leases/finance \
  stageParent:/opt/ynx/stage/finance \
  backupParent:/var/backups/ynx-finance \
  releaseParent:/opt/ynx/releases/finance \
  executor:/opt/ynx/leases/finance/$id.executor.sh \
  executorPending:/opt/ynx/leases/finance/$id.executor.sh.pending \
  signedLease:/opt/ynx/leases/finance/$id.json \
  signedLeasePending:/opt/ynx/leases/finance/$id.json.pending \
  manualRollbackLease:/opt/ynx/leases/finance/$id.manual-rollback.json \
  stageContainer:/opt/ynx/stage/finance/$id \
  stage:/opt/ynx/stage/finance/$id/stage \
  backupContainer:/var/backups/ynx-finance/$id \
  backup:/var/backups/ynx-finance/$id/backup \
  releaseContainer:/opt/ynx/releases/finance/$id \
  release:/opt/ynx/releases/finance/$id/ynx-finance-7824af677dd0 \
  current:/opt/ynx/finance-current \
  currentNext:/opt/ynx/finance-current.next \
  currentRollback:/opt/ynx/finance-current.rollback \
  productionEnv:/etc/ynx/finance.env \
  state:/var/lib/ynx/finance/state.json \
  unit:/etc/systemd/system/ynx-finance.service \
  caddy:/etc/caddy/conf.d/ynx-finance.caddy; do
  inspect "${spec%%:*}" "${spec#*:}"
done

resolved=$(readlink -f /opt/ynx/finance-current 2>/dev/null || true)
printf 'currentResolved=%s\n' "$resolved"
if [[ -n "$resolved" ]]; then inspect currentResolvedObject "$resolved"; fi
printf 'envNextCount=%s\n' "$(find /etc/ynx -maxdepth 1 -name '.finance.env.next.*' -printf x | wc -c | tr -d ' ')"
printf 'envRestoreCount=%s\n' "$(find /etc/ynx -maxdepth 1 -name '.finance.env.restore.*' -printf x | wc -c | tr -d ' ')"
printf 'stateRestoreCount=%s\n' "$(find /var/lib/ynx/finance -maxdepth 1 -name '.finance.state.restore.*' -printf x 2>/dev/null | wc -c | tr -d ' ')"

for key in LoadState ActiveState SubState MainPID NRestarts FragmentPath ExecStart WorkingDirectory User Group; do
  printf 'service%s=%s\n' "$key" "$(systemctl show ynx-finance.service -p "$key" --value)"
done
jbytes=$(journal_digest | wc -c | tr -d ' ')
jsha=$(journal_digest | sha256sum | awk '{print $1}')
jclass=OTHER_OR_EMPTY
if journal_digest | grep -Eqi 'started|listening|active'; then jclass=START_OR_ACTIVE_SIGNAL; fi
if journal_digest | grep -Eqi 'failed|failure|exit-code|status=[1-9]'; then jclass=SERVICE_OR_EXECUTOR_FAILURE; fi
if journal_digest | grep -Eqi 'permission denied|working directory|chdir'; then jclass=PERMISSION_OR_WORKING_DIRECTORY; fi
printf 'journalWindow=2026-08-23T15:29:00Z..2026-08-23T15:36:30Z\n'
printf 'journalBytes=%s\njournalSha256=%s\njournalNormalizedClass=%s\n' "$jbytes" "$jsha" "$jclass"

for base in loopback:http://127.0.0.1:6483 public:https://finance.ynxweb4.com; do
  label=${base%%:*}; origin=${base#*:}
  http "${label}Index" "$origin/"
  http "${label}Health" "$origin/health"
  http "${label}Version" "$origin/version"
  http "${label}AppJs" "$origin/app.js"
  http "${label}ReadSources" "$origin/read-sources.js"
  http "${label}Styles" "$origin/styles.css"
  http "${label}Manifest" "$origin/manifest.webmanifest"
  http "${label}Logo" "$origin/ynx-logo.png"
  http "${label}WalletConnect" "$origin/wallet-connect.js"
done
printf 'inspectionComplete=true\nmutationCount=0\n'
