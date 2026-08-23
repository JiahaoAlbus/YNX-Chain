#!/usr/bin/env bash
# P0-303: read-only terminal-state inspection for the single P0-302 attempt.
# This object performs no cleanup, deployment, service lifecycle, or writes.
set -euo pipefail

tuple(){ stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
http_tmp_files=()
cleanup_http_tmp(){
  local tmp
  for tmp in "${http_tmp_files[@]}"; do command rm -f -- "$tmp"; done
}
trap cleanup_http_tmp EXIT
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
    printf '%s=DIRECTORY|path=%s|tuple=%s|directChildren=%s|inventorySha256=%s\n' "$label" "$path" "$(tuple "$path")" "$(find "$path" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' ')" "$(inventory "$path")"
  elif [[ ! -e "$path" ]]; then
    printf '%s=ABSENT|path=%s\n' "$label" "$path"
  else
    kind=$(stat -c '%F' -- "$path")
    printf '%s=OTHER|path=%s|tuple=%s|type=%s\n' "$label" "$path" "$(tuple "$path")" "$kind"
  fi
}
parent_tuple(){
  local label=$1 path=$2
  [[ -d "$path" && ! -L "$path" ]]
  printf '%s=%s\n' "$label" "$(tuple "$path")"
}
http_receipt(){
  local label=$1 url=$2 tmp status
  tmp=$(mktemp); http_tmp_files+=("$tmp")
  status=$(curl --silent --show-error --max-time 10 --output "$tmp" --write-out '%{http_code}' "$url")
  [[ "$status" =~ ^[0-9]{3}$ ]]
  printf '%sUrl=%s\n%sStatus=%s\n%sBytes=%s\n%sSha256=%s\n' "$label" "$url" "$label" "$status" "$label" "$(bytes "$tmp")" "$label" "$(sha "$tmp")"
  command rm -f -- "$tmp"
  http_tmp_files=("${http_tmp_files[@]/$tmp}")
}

id=p0302-finance-phase3-20260823t211500z
control_parent=/opt/ynx/leases/finance
stage_parent=/opt/ynx/stage/finance
backup_parent=/var/backups/ynx-finance
release_parent=/opt/ynx/releases/finance
stage_container="$stage_parent/$id"
backup_container="$backup_parent/$id"
release_container="$release_parent/$id"

printf 'inspection=FINANCE_P0303_P0302_REMOTE_STATE_ZERO_WRITE\n'
parent_tuple controlParentTuple "$control_parent"
parent_tuple stageParentTuple "$stage_parent"
parent_tuple backupParentTuple "$backup_parent"
parent_tuple releaseParentTuple "$release_parent"
classify p0302ExecutorPending "$control_parent/$id.executor.sh.pending"
classify p0302Executor "$control_parent/$id.executor.sh"
classify p0302LeasePending "$control_parent/$id.json.pending"
classify p0302Lease "$control_parent/$id.json"
classify p0302ManualRollbackLease "$control_parent/$id.manual-rollback.json"
classify p0302StageContainer "$stage_container"
classify p0302Stage "$stage_container/stage"
classify p0302BackupContainer "$backup_container"
classify p0302Backup "$backup_container/backup"
classify p0302ReleaseContainer "$release_container"
classify p0302Release "$release_container/ynx-finance-7824af677dd0"
classify currentLink /opt/ynx/finance-current
printf 'currentResolved=%s\n' "$(readlink -f -- /opt/ynx/finance-current)"
classify currentNext /opt/ynx/finance-current.next
classify currentRollback /opt/ynx/finance-current.rollback
classify productionEnv /etc/ynx/finance.env
classify unit /etc/systemd/system/ynx-finance.service
classify caddy /etc/caddy/conf.d/ynx-finance.caddy
classify state /var/lib/ynx/finance/state.json
printf 'serviceLoadState=%s\nserviceActiveState=%s\nserviceSubState=%s\nserviceMainPID=%s\nserviceNRestarts=%s\nserviceExecStartSha256=%s\nserviceWorkingDirectory=%s\nserviceUser=%s\nserviceGroup=%s\n' \
  "$(systemctl show ynx-finance.service -p LoadState --value)" \
  "$(systemctl show ynx-finance.service -p ActiveState --value)" \
  "$(systemctl show ynx-finance.service -p SubState --value)" \
  "$(systemctl show ynx-finance.service -p MainPID --value)" \
  "$(systemctl show ynx-finance.service -p NRestarts --value)" \
  "$(systemctl show ynx-finance.service -p ExecStart --value | sha256sum | awk '{print $1}')" \
  "$(systemctl show ynx-finance.service -p WorkingDirectory --value)" \
  "$(systemctl show ynx-finance.service -p User --value)" \
  "$(systemctl show ynx-finance.service -p Group --value)"
http_receipt loopbackRoot http://127.0.0.1:6483/
http_receipt loopbackHealth http://127.0.0.1:6483/health
http_receipt loopbackVersion http://127.0.0.1:6483/version
http_receipt publicRoot https://finance.ynxweb4.com/
http_receipt publicHealth https://finance.ynxweb4.com/health
http_receipt publicVersion https://finance.ynxweb4.com/version
printf 'inspectionComplete=true\nmutationCount=0\n'
