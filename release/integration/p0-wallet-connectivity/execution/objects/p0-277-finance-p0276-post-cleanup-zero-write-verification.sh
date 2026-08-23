#!/usr/bin/env bash
set -euo pipefail

p0272=p0272-finance-phase3-20260823T152627Z
p0276=p0276-finance-p0272-control-cleanup-20260823T160645Z
tuple_l(){ stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha_file(){ sha256sum -- "$1" | awk '{print $1}'; }
bytes_file(){ wc -c < "$1" | tr -d ' '; }
tree_inventory(){
  local root=$1
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
  local label=$1 item=$2 kind count
  if [[ -L "$item" ]]; then
    printf '%s=symlink|%s|targetSha256=%s\n' "$label" "$(tuple_l "$item")" "$(printf %s "$(readlink -- "$item")" | sha256sum | awk '{print $1}')"
  elif [[ -f "$item" ]]; then
    printf '%s=file|%s|bytes=%s|sha256=%s\n' "$label" "$(tuple_l "$item")" "$(bytes_file "$item")" "$(sha_file "$item")"
  elif [[ -d "$item" ]]; then
    count=$(find -P "$item" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' ')
    printf '%s=directory|%s|directChildren=%s|inventorySha256=%s\n' "$label" "$(tuple_l "$item")" "$count" "$(tree_inventory "$item")"
  elif [[ -e "$item" ]]; then
    kind=$(stat -c '%F' -- "$item")
    printf '%s=other:%s|%s\n' "$label" "$kind" "$(tuple_l "$item")"
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

printf 'inspection=FINANCE_P0276_POST_CLEANUP_ZERO_WRITE\n'
for spec in \
  retainedParent:/opt/ynx/leases/finance \
  p0272Executor:/opt/ynx/leases/finance/$p0272.executor.sh \
  p0272SignedLease:/opt/ynx/leases/finance/$p0272.json \
  p0276TempExecutor:/tmp/ynx-finance-$p0276.executor.sh \
  p0276TempLease:/tmp/ynx-finance-$p0276.json \
  stageParent:/opt/ynx/stage/finance \
  stageContainer:/opt/ynx/stage/finance/$p0272 \
  stage:/opt/ynx/stage/finance/$p0272/stage \
  backupParent:/var/backups/ynx-finance \
  backupContainer:/var/backups/ynx-finance/$p0272 \
  backup:/var/backups/ynx-finance/$p0272/backup \
  releaseParent:/opt/ynx/releases/finance \
  releaseContainer:/opt/ynx/releases/finance/$p0272 \
  release:/opt/ynx/releases/finance/$p0272/ynx-finance-7824af677dd0 \
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
for base in loopback:http://127.0.0.1:6483 public:https://finance.ynxweb4.com; do
  label=${base%%:*}; origin=${base#*:}
  http "${label}Index" "$origin/"
  http "${label}Health" "$origin/health"
  http "${label}Version" "$origin/version"
  http "${label}AppJs" "$origin/app.js"
  http "${label}WalletConnect" "$origin/wallet-connect.js"
done
printf 'inspectionComplete=true\nmutationCount=0\n'
