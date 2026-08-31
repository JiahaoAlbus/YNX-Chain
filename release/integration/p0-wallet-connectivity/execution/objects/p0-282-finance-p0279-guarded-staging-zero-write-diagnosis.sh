#!/bin/bash
set -euo pipefail

id='p0279-finance-phase3-20260823T164408Z'
executor="/opt/ynx/leases/finance/$id.executor.sh"
signed_lease="/opt/ynx/leases/finance/$id.json"
carrier='/opt/ynx/stage/finance/p0228-finance-phase1-20260822T234100Z'
archive="$carrier/candidate.tgz"
candidate_env="$carrier/finance.env"
stage_container="/opt/ynx/stage/finance/$id"
stage="$stage_container/stage"
backup_container="/var/backups/ynx-finance/$id"
backup="$backup_container/backup"
release_container="/opt/ynx/releases/finance/$id"
release="$release_container/ynx-finance-7824af677dd0"

tuple_l() { stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha_file() { sha256sum -- "$1" | awk '{print $1}'; }
direct_children() { find -P "$1" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' '; }
object_tuple_sha() {
  local path=$1
  if [[ -f "$path" && ! -L "$path" ]]; then
    printf '%s|sha256=%s' "$(tuple_l "$path")" "$(sha_file "$path")"
  elif [[ ! -e "$path" && ! -L "$path" ]]; then
    printf absent
  else
    printf unexpected-object
  fi
}
journal_digest() {
  journalctl --unit ynx-finance.service --since '2026-08-23 16:46:00 UTC' --until '2026-08-23 16:53:30 UTC' --output=cat --no-pager
}
http_meta() {
  local url=$1
  { curl --silent --show-error --max-time 15 -o - -w $'\n__META__%{http_code}\t%{size_download}\n' "$url" || true; } |
    perl -MDigest::SHA=sha256_hex -e 'local $/;my$d=<STDIN>;my$m="\n__META__";my$a=rindex($d,$m);if($a<0){print "transport-no-meta";exit 0}my$b=substr($d,0,$a);my$x=substr($d,$a+length($m));if($x!~/\A([0-9]+)\t([0-9]+)\n\z/){print "invalid-meta";exit 0}print "$1:".length($b).":".sha256_hex($b)'
}

phase='UNAVAILABLE'
failure='UNPROVEN'
record_failure() {
  if [[ "$failure" == UNPROVEN ]]; then phase=$1; failure=$2; fi
}
require_dir_tuple() {
  local name=$1 path=$2 expected=$3
  if [[ ! -d "$path" || -L "$path" || "$(tuple_l "$path")" != "$expected" ]]; then
    record_failure "$name" CURRENT_PREWRITE_INVARIANT_MISMATCH
  fi
}
require_file_sha() {
  local name=$1 path=$2 expected_tuple=$3 expected_sha=$4
  if [[ ! -f "$path" || -L "$path" || "$(tuple_l "$path")" != "$expected_tuple" || "$(sha_file "$path")" != "$expected_sha" ]]; then
    record_failure "$name" CURRENT_PREWRITE_INVARIANT_MISMATCH
  fi
}
require_absent() {
  local name=$1 path=$2
  if [[ -e "$path" || -L "$path" ]]; then record_failure "$name" CURRENT_PREWRITE_INVARIANT_MISMATCH; fi
}

require_dir_tuple ROOT_PARENT /opt/ynx '64770:1312502:0:0:755:49:4096:directory'
require_dir_tuple LEASE_PARENT /opt/ynx/leases/finance '64770:4594822:0:0:750:2:4096:directory'
require_dir_tuple STAGE_PARENT /opt/ynx/stage/finance '64770:3450041:0:0:750:4:4096:directory'
require_dir_tuple BACKUP_PARENT /var/backups/ynx-finance '64770:1481354:0:0:755:10:4096:directory'
require_dir_tuple RELEASE_PARENT /opt/ynx/releases/finance '64770:1607576:0:0:755:7:4096:directory'
require_dir_tuple CARRIER "$carrier" '64770:4594821:0:0:700:2:4096:directory'
require_file_sha ARCHIVE "$archive" '64770:4620871:0:0:600:1:3937491:regular file' 'd8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d'
require_file_sha CANDIDATE_ENV "$candidate_env" '64770:4620873:0:986:640:1:1545:regular file' 'ceec9fba17116e087d6e2a9cb160808b39e027e687a7ad561174a40daf58b71a'
if [[ ! -L /opt/ynx/finance-current || "$(tuple_l /opt/ynx/finance-current)" != '64770:1312291:0:0:777:1:50:symbolic link' || "$(readlink -f /opt/ynx/finance-current)" != '/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a' ]]; then
  record_failure CURRENT CURRENT_PREWRITE_INVARIANT_MISMATCH
fi
require_file_sha PRODUCTION_ENV /etc/ynx/finance.env '64770:1324724:0:986:640:1:1545:regular file' '854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252'
require_file_sha UNIT /etc/systemd/system/ynx-finance.service '64770:161304:0:0:644:1:515:regular file' '2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b'
require_file_sha CADDY /etc/caddy/conf.d/ynx-finance.caddy '64770:1051759:0:0:644:1:255:regular file' 'dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282'
require_absent STATE /var/lib/ynx/finance/state.json
require_absent STAGE "$stage"
require_absent BACKUP "$backup"
require_absent RELEASE_CONTAINER "$release_container"
require_absent RELEASE "$release"

stage_truth=unexpected
if [[ -d "$stage_container" && ! -L "$stage_container" && "$(direct_children "$stage_container")" == 0 && -d "$backup_container" && ! -L "$backup_container" && "$(direct_children "$backup_container")" == 0 && ! -e "$stage" && ! -L "$stage" && ! -e "$backup" && ! -L "$backup" && ! -e "$release_container" && ! -L "$release_container" && ! -e "$release" && ! -L "$release" ]]; then
  stage_truth='stageContainer=empty,stage=absent,backupContainer=empty,backup=absent,releaseContainer=absent,release=absent'
else
  record_failure GUARDED_STAGING_RESIDUE CURRENT_PREWRITE_INVARIANT_MISMATCH
fi

service_pid=$(systemctl show ynx-finance.service -p MainPID --value)
service_restarts=$(systemctl show ynx-finance.service -p NRestarts --value)
if [[ "$(systemctl show ynx-finance.service -p ActiveState --value)" != active || "$(systemctl show ynx-finance.service -p SubState --value)" != running || "$service_pid" != 2241003 || "$service_restarts" != 0 ]]; then
  record_failure SERVICE CURRENT_PREWRITE_INVARIANT_MISMATCH
fi

loop_health=$(http_meta 'http://127.0.0.1:6483/health')
loop_version=$(http_meta 'http://127.0.0.1:6483/version')
public_health=$(http_meta 'https://finance.ynxweb4.com/health')
public_version=$(http_meta 'https://finance.ynxweb4.com/version')
expected_health='200:485:d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1'
expected_version='200:130:39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226'
if [[ "$loop_health" != "$expected_health" || "$public_health" != "$expected_health" || "$loop_version" != "$expected_version" || "$public_version" != "$expected_version" ]]; then
  record_failure OLD_RUNTIME_HTTP CURRENT_PREWRITE_INVARIANT_MISMATCH
fi

journal_bytes=$(journal_digest | wc -c | tr -d ' ')
journal_sha=$(journal_digest | sha256sum | awk '{print $1}')
journal_class=OTHER_OR_EMPTY
if journal_digest | grep -Eqi 'started|listening|active'; then journal_class=START_OR_ACTIVE_SIGNAL; fi
if journal_digest | grep -Eqi 'failed|failure|exit-code|status=[1-9]'; then journal_class=SERVICE_OR_EXECUTOR_FAILURE; fi
if journal_digest | grep -Eqi 'permission denied|working directory|chdir'; then journal_class=PERMISSION_OR_WORKING_DIRECTORY; fi

printf 'inspection=FINANCE_P0279_GUARDED_STAGING_ZERO_WRITE_DIAGNOSIS\n'
printf 'remoteExitStatus=0\n'
printf 'executorTupleSha256=%s\n' "$(object_tuple_sha "$executor")"
printf 'signedLeaseTupleSha256=%s\n' "$(object_tuple_sha "$signed_lease")"
printf 'guardedStagingPhase=%s\n' "$phase"
printf 'firstFailureClass=%s\n' "$failure"
printf 'normalizedJournalClass=%s\n' "$journal_class"
printf 'journalBytes=%s\n' "$journal_bytes"
printf 'journalSha256=%s\n' "$journal_sha"
printf 'stageBackupReleaseTruth=%s\n' "$stage_truth"
printf 'servicePid=%s\n' "$service_pid"
printf 'serviceNRestarts=%s\n' "$service_restarts"
printf 'oldRuntimeHttpMetadata=loopbackHealth:%s,loopbackVersion:%s,publicHealth:%s,publicVersion:%s\n' "$loop_health" "$loop_version" "$public_health" "$public_version"
printf 'mutationCount=0\n'
