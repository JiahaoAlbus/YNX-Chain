#!/usr/bin/env bash
# P0-248: one remote, stdin-only, zero-write Finance incident inspection.
set -euo pipefail

id=p0247-finance-phase3-20260823T073800Z
tuple_follow(){ stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
tuple_link(){ stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
tree_inventory(){
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
emit_path(){
  local label=$1 path=$2 kind
  if [[ -L "$path" ]]; then
    printf '%s=SYMLINK|tuple=%s|target=%s\n' "$label" "$(tuple_link "$path")" "$(readlink -- "$path")"
  elif [[ -e "$path" ]]; then
    kind=$(stat -c '%F' -- "$path")
    printf '%s=PRESENT|tuple=%s' "$label" "$(tuple_follow "$path")"
    if [[ "$kind" == 'regular file' ]]; then printf '|sha256=%s' "$(sha "$path")"; fi
    printf '\n'
  else
    printf '%s=ABSENT\n' "$label"
  fi
}
emit_tree(){
  local label=$1 path=$2
  if [[ -d "$path" && ! -L "$path" ]]; then
    printf '%s=PRESENT|tuple=%s|entries=%s|inventorySha256=%s\n' "$label" "$(tuple_follow "$path")" "$(find "$path" -mindepth 1 -printf . | wc -c | tr -d ' ')" "$(tree_inventory "$path")"
  else
    emit_path "$label" "$path"
  fi
}
probe(){
  local label=$1 url=$2
  printf '%sStatus=%s\n' "$label" "$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' "$url")"
  printf '%sBytes=%s\n' "$label" "$(curl --silent --show-error --max-time 10 "$url" | wc -c | tr -d ' ')"
  printf '%sSha256=%s\n' "$label" "$(curl --silent --show-error --max-time 10 "$url" | sha256sum | awk '{print $1}')"
}

printf 'inspection=P0-248\n'
printf 'host=%s\narchitecture=%s\n' "$(hostname)" "$(uname -m)"
emit_path root /opt/ynx
emit_path leasesParent /opt/ynx/leases
emit_tree deployParent /opt/ynx/leases/finance
emit_path placedExecutor "/opt/ynx/leases/finance/$id.executor.sh"
emit_path placedExecutorPending "/opt/ynx/leases/finance/$id.executor.sh.pending"
emit_path placedLease "/opt/ynx/leases/finance/$id.json"
emit_path placedLeasePending "/opt/ynx/leases/finance/$id.json.pending"
emit_path manualRollbackLease "/opt/ynx/leases/finance/$id.manual-rollback.json"
emit_path manualRollbackPending "/opt/ynx/leases/finance/$id.manual-rollback.json.pending"
emit_tree stageContainer "/opt/ynx/stage/finance/$id"
emit_tree backupContainer "/var/backups/ynx-finance/$id"
emit_tree releaseContainer "/opt/ynx/releases/finance/$id"
emit_path release "/opt/ynx/releases/finance/$id/ynx-finance-7824af677dd0"
emit_path currentLink /opt/ynx/finance-current
if [[ -L /opt/ynx/finance-current ]]; then
  printf 'currentResolved=%s\n' "$(readlink -f /opt/ynx/finance-current)"
fi
emit_path productionEnv /etc/ynx/finance.env
printf 'productionEnvWebDirKeyCount=%s\n' "$(awk -F= '$1=="YNX_FINANCE_WEB_DIR"{n++} END{print n+0}' /etc/ynx/finance.env)"
emit_path state /var/lib/ynx/finance/state.json
emit_path unit /etc/systemd/system/ynx-finance.service
emit_path caddy /etc/caddy/conf.d/ynx-finance.caddy
systemctl show ynx-finance.service -p LoadState -p ActiveState -p SubState -p MainPID -p NRestarts -p FragmentPath --no-pager
printf 'listener6483=%s\n' "$(ss -ltnp | awk '$4=="127.0.0.1:6483"{print $0}')"
probe loopbackHealth http://127.0.0.1:6483/health
probe loopbackVersion http://127.0.0.1:6483/version
probe publicHealth https://finance.ynxweb4.com/health
probe publicVersion https://finance.ynxweb4.com/version
printf 'inspectionComplete=true\n'
