#!/usr/bin/env bash
# Finance P0-252 request command object: inspect only the exact retained P0-247
# and possible P0-251 objects plus the unchanged Finance runtime identity.
set -euo pipefail

tuple(){ stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
inventory(){
  local root=$1 path kind value
  (
    cd "$root"
    while IFS= read -r -d '' path; do
      kind=$(stat -c '%F' -- "$path")
      printf '%s\0%s\0%s\0' "$path" "$kind" "$(stat -c '%u:%g:%a:%h:%s' -- "$path")"
      case "$kind" in
        regular\ file) value=$(sha "$path");;
        symbolic\ link) value=$(readlink -- "$path");;
        *) value=;;
      esac
      printf '%s\0' "$value"
    done < <(find . -mindepth 1 -print0 | LC_ALL=C sort -z)
  ) | sha256sum | awk '{print $1}'
}
classify(){
  local label=$1 path=$2 kind
  if [[ -L "$path" ]]; then
    printf '%s=SYMLINK|path=%s|tuple=%s|target=%s\n' "$label" "$path" "$(tuple "$path")" "$(readlink -- "$path")"
  elif [[ -f "$path" ]]; then
    printf '%s=FILE|path=%s|tuple=%s|bytes=%s|sha256=%s\n' "$label" "$path" "$(tuple "$path")" "$(bytes "$path")" "$(sha "$path")"
  elif [[ -d "$path" ]]; then
    printf '%s=DIRECTORY|path=%s|tuple=%s|entries=%s|inventorySha256=%s\n' "$label" "$path" "$(tuple "$path")" "$(find "$path" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' ')" "$(inventory "$path")"
  elif [[ ! -e "$path" ]]; then
    printf '%s=ABSENT|path=%s\n' "$label" "$path"
  else
    kind=$(stat -c '%F' -- "$path")
    printf '%s=OTHER|path=%s|tuple=%s|type=%s\n' "$label" "$path" "$(tuple "$path")" "$kind"
  fi
}
children(){
  local label=$1 root=$2
  [[ -d "$root" && ! -L "$root" ]]
  printf '%sTuple=%s\n' "$label" "$(tuple "$root")"
  while IFS= read -r -d '' path; do printf '%sChild=%s\n' "$label" "${path##*/}"; done < <(find "$root" -mindepth 1 -maxdepth 1 -print0 | LC_ALL=C sort -z)
}
http_receipt(){
  local label=$1 url=$2 response status body
  response=$(curl --silent --show-error --max-time 10 --write-out $'\n%{http_code}' "$url")
  status=${response##*$'\n'}
  body=${response%$'\n'*}
  [[ "$status" =~ ^[0-9]{3}$ ]]
  printf '%sStatus=%s\n%sBytes=%s\n%sSha256=%s\n' "$label" "$status" "$label" "$(printf %s "$body" | wc -c | tr -d ' ')" "$label" "$(printf %s "$body" | sha256sum | awk '{print $1}')"
}

id=p0247-finance-phase3-20260823T073800Z
p0251=p0251-finance-p0247-cleanup-20260823T100000Z
deploy=/opt/ynx/leases/finance
stage_parent=/opt/ynx/stage/finance
backup_parent=/var/backups/ynx-finance
release_parent=/opt/ynx/releases/finance
stage="$stage_parent/$id"
backup="$backup_parent/$id"
release_container="$release_parent/$id"

printf 'inspection=FINANCE_P0252_REMOTE_STATE_READONLY\n'
children leasesParent /opt/ynx/leases
children deployParent "$deploy"
children stageParent "$stage_parent"
children backupParent "$backup_parent"
children releaseParent "$release_parent"
classify p0247Executor "$deploy/$id.executor.sh"
classify p0247ExecutorPending "$deploy/$id.executor.sh.pending"
classify p0247Lease "$deploy/$id.json"
classify p0247LeasePending "$deploy/$id.json.pending"
classify p0247ManualRollbackLease "$deploy/$id.manual-rollback.json"
classify p0247Stage "$stage"
classify p0247Backup "$backup"
classify p0247ReleaseContainer "$release_container"
classify p0247Release "$release_container/ynx-finance-7824af677dd0"
classify p0251Executor "$deploy/$p0251.executor.sh"
classify p0251ExecutorPending "$deploy/$p0251.executor.sh.pending"
classify p0251Lease "$deploy/$p0251.json"
classify p0251LeasePending "$deploy/$p0251.json.pending"
classify currentLink /opt/ynx/finance-current
printf 'currentResolved=%s\n' "$(readlink -f -- /opt/ynx/finance-current)"
classify productionEnv /etc/ynx/finance.env
classify unit /etc/systemd/system/ynx-finance.service
classify caddy /etc/caddy/conf.d/ynx-finance.caddy
classify state /var/lib/ynx/finance/state.json
printf 'serviceLoadState=%s\nserviceActiveState=%s\nserviceSubState=%s\nserviceMainPID=%s\nserviceNRestarts=%s\n' \
  "$(systemctl show ynx-finance.service -p LoadState --value)" \
  "$(systemctl show ynx-finance.service -p ActiveState --value)" \
  "$(systemctl show ynx-finance.service -p SubState --value)" \
  "$(systemctl show ynx-finance.service -p MainPID --value)" \
  "$(systemctl show ynx-finance.service -p NRestarts --value)"
http_receipt loopbackHealth http://127.0.0.1:6483/health
http_receipt loopbackVersion http://127.0.0.1:6483/version
http_receipt publicHealth https://finance.ynxweb4.com/health
http_receipt publicVersion https://finance.ynxweb4.com/version
printf 'inspectionComplete=true\nmutationCount=0\n'
