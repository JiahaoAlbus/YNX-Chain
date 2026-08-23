#!/usr/bin/env bash
# P0-249: one zero-write detailed inventory of P0-247 retained objects.
set -euo pipefail

id=p0247-finance-phase3-20260823T073800Z
deploy=/opt/ynx/leases/finance
stage=/opt/ynx/stage/finance/$id
backup=/var/backups/ynx-finance/$id
tuple(){ stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
tree_inventory(){
  local root=$1 path kind value
  (
    cd "$root"
    while IFS= read -r -d '' path; do
      kind=$(stat -c '%F' -- "$path")
      printf '%s\0%s\0%s\0' "$path" "$kind" "$(stat -c '%u:%g:%a:%h:%s' -- "$path")"
      case "$kind" in regular\ file) value=$(sha "$path");; symbolic\ link) value=$(readlink -- "$path");; *) value=;; esac
      printf '%s\0' "$value"
    done < <(find . -mindepth 1 -print0 | LC_ALL=C sort -z)
  ) | sha256sum | awk '{print $1}'
}
require_tree(){
  local root=$1 expected_tuple=$2 expected_inventory=$3
  [[ -d "$root" && ! -L "$root" ]]
  [[ "$(tuple "$root")" == "$expected_tuple" ]]
  [[ "$(tree_inventory "$root")" == "$expected_inventory" ]]
}
detail(){
  local label=$1 root=$2 path rel kind value
  printf '%sRootTuple=%s\n' "$label" "$(tuple "$root")"
  printf '%sInventorySha256=%s\n' "$label" "$(tree_inventory "$root")"
  while IFS= read -r -d '' path; do
    rel=${path#"$root"/}; kind=$(stat -c '%F' -- "$path")
    printf '%sEntry=%s|type=%s|tuple=%s' "$label" "$rel" "$kind" "$(stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$path")"
    case "$kind" in
      regular\ file) printf '|sha256=%s' "$(sha "$path")";;
      symbolic\ link) printf '|target=%s' "$(readlink -- "$path")";;
    esac
    printf '\n'
  done < <(find "$root" -mindepth 1 -print0 | LC_ALL=C sort -z)
}

require_tree "$deploy" '64770:4594822:0:0:750:2:4096:directory' '55234705279df9c204fa85fb1488a0e8743fcfb99402c97936257edbb3744d36'
require_tree "$stage" '64770:4620782:0:0:700:3:4096:directory' '61181f33dcf9b11282732fe26f02ad9e3b0f5135dead72ca690606c722d9bf62'
require_tree "$backup" '64770:2663604:0:0:700:3:4096:directory' 'e78ba1c645bfeeffa9d1f373fd2c773326a358c23caca7ad9fd48834b71a3e19'
[[ -L /opt/ynx/finance-current ]]
[[ "$(readlink -- /opt/ynx/finance-current)" == '/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a' ]]
[[ "$(sha /etc/ynx/finance.env)" == '854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252' ]]
[[ "$(systemctl show ynx-finance.service -p ActiveState --value)" == active ]]
[[ "$(systemctl show ynx-finance.service -p MainPID --value)" == 2241003 ]]
[[ "$(systemctl show ynx-finance.service -p NRestarts --value)" == 0 ]]
[[ ! -e "/opt/ynx/releases/finance/$id" && ! -L "/opt/ynx/releases/finance/$id" ]]
[[ ! -e "$deploy/$id.manual-rollback.json" && ! -L "$deploy/$id.manual-rollback.json" ]]

printf 'inspection=P0-249\n'
detail deploy "$deploy"
detail stage "$stage"
detail backup "$backup"
printf 'currentTarget=%s\n' "$(readlink -- /opt/ynx/finance-current)"
printf 'productionEnvSha256=%s\n' "$(sha /etc/ynx/finance.env)"
printf 'servicePid=%s\n' "$(systemctl show ynx-finance.service -p MainPID --value)"
printf 'serviceNRestarts=%s\n' "$(systemctl show ynx-finance.service -p NRestarts --value)"
printf 'releaseContainer=ABSENT\nmanualRollbackLease=ABSENT\ninspectionComplete=true\n'
