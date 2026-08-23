#!/usr/bin/env bash
set -euo pipefail

parent=/opt/ynx/leases/finance
p0279=p0279-finance-phase3-20260823T164408Z
p0281=p0281-finance-p0279-control-cleanup-20260823T170900Z
tuple_l(){ stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha_file(){ sha256sum -- "$1" | awk '{print $1}'; }
bytes_file(){ wc -c < "$1" | tr -d ' '; }
inspect(){
  local label=$1 path=$2 count
  if [[ -L "$path" ]]; then
    printf '%s=symlink|%s|target=%s\n' "$label" "$(tuple_l "$path")" "$(readlink -- "$path")"
  elif [[ -f "$path" ]]; then
    printf '%s=file|%s|bytes=%s|sha256=%s\n' "$label" "$(tuple_l "$path")" "$(bytes_file "$path")" "$(sha_file "$path")"
  elif [[ -d "$path" ]]; then
    count=$(find -P "$path" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' ')
    printf '%s=directory|%s|directChildren=%s\n' "$label" "$(tuple_l "$path")" "$count"
  elif [[ -e "$path" ]]; then
    printf '%s=other|%s\n' "$label" "$(tuple_l "$path")"
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

printf 'verification=FINANCE_P0281_POST_CLEANUP_ZERO_WRITE\n'
inspect retainedParent "$parent"
printf 'retainedParentStableIdentity=%s\n' "$(stat -Lc '%d:%i:%u:%g:%a:%F' -- "$parent")"
printf 'retainedParentDirectChildren=%s\n' "$(find -P "$parent" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' ')"
inspect p0279Executor "$parent/$p0279.executor.sh"
inspect p0279SignedLease "$parent/$p0279.json"
inspect p0281TemporaryExecutor "/tmp/ynx-finance-$p0281.executor.sh"
inspect p0281TemporaryLease "/tmp/ynx-finance-$p0281.json"
inspect stageContainer "/opt/ynx/stage/finance/$p0279"
inspect stage "/opt/ynx/stage/finance/$p0279/stage"
inspect backupContainer "/var/backups/ynx-finance/$p0279"
inspect backup "/var/backups/ynx-finance/$p0279/backup"
inspect releaseContainer "/opt/ynx/releases/finance/$p0279"
inspect release "/opt/ynx/releases/finance/$p0279/ynx-finance-7824af677dd0"
inspect current /opt/ynx/finance-current
resolved=$(readlink -f /opt/ynx/finance-current)
printf 'currentResolved=%s\n' "$resolved"
inspect currentResolvedObject "$resolved"
inspect productionEnv /etc/ynx/finance.env
inspect state /var/lib/ynx/finance/state.json
inspect unit /etc/systemd/system/ynx-finance.service
inspect caddy /etc/caddy/conf.d/ynx-finance.caddy
for key in LoadState ActiveState SubState MainPID NRestarts FragmentPath ExecStart WorkingDirectory User Group; do
  printf 'service%s=%s\n' "$key" "$(systemctl show ynx-finance.service -p "$key" --value)"
done
for base in loopback:http://127.0.0.1:6483 public:https://finance.ynxweb4.com; do
  label=${base%%:*}; origin=${base#*:}
  http "${label}Root" "$origin/"
  http "${label}Health" "$origin/health"
  http "${label}Version" "$origin/version"
  http "${label}AppJs" "$origin/app.js"
  http "${label}Index" "$origin/index.html"
  http "${label}Connectivity" "$origin/connectivity"
  http "${label}WalletConnect" "$origin/wallet-connect.js"
done
printf 'verificationComplete=true\nmutationCount=0\n'
