#!/usr/bin/env bash
set -euo pipefail

EMPTY_SHA=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
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
direct_children(){ find -P "$1" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' '; }
parent_receipt(){ printf '%s|directChildren=%s|inventorySha256=%s' "$(tuple_l "$1")" "$(direct_children "$1")" "$(tree_inventory "$1")"; }
absent(){ [[ ! -e "$1" && ! -L "$1" ]]; }
assert_file(){ local path=$1 tuple=$2 bytes=$3 sha=$4; [[ -f "$path" && ! -L "$path" && "$(realpath -e -- "$path")" == "$path" && "$(tuple_l "$path")" == "$tuple" && "$(bytes_file "$path")" == "$bytes" && "$(sha_file "$path")" == "$sha" ]]; }
http_exact(){
  local label=$1 url=$2 expected=$3 actual
  actual=$({ curl --silent --show-error --max-time 15 -o - -w $'\n__META__%{http_code}\t%{size_download}\t%{content_type}\n' "$url"; } | perl -MDigest::SHA=sha256_hex -e 'local $/;my$d=<STDIN>;my$m="\n__META__";my$a=rindex($d,$m);die "transport-no-meta\n" if $a<0;my$b=substr($d,0,$a);my$x=substr($d,$a+length($m));die "invalid-meta\n" unless $x=~/\A([0-9]+)\t([0-9]+)\t([^\n]*)\n\z/;print "$1:".length($b).":".sha256_hex($b).":".$3')
  [[ "$actual" == "$expected" ]]
  printf '%s=%s|%s\n' "$label" "$url" "$actual"
}

printf 'verification=FINANCE_P0289_FOUR_RESIDUE_POST_CLEANUP_ZERO_WRITE\n'

for path in \
  /opt/ynx/leases/finance/p0289-finance-phase3-20260824t010000z.executor.sh.pending \
  /opt/ynx/leases/finance/p0289-finance-phase3-20260824t010000z.executor.sh \
  /opt/ynx/leases/finance/p0289-finance-phase3-20260824t010000z.json.pending \
  /opt/ynx/leases/finance/p0289-finance-phase3-20260824t010000z.json \
  /opt/ynx/stage/finance/p0289-finance-phase3-20260824t010000z \
  /opt/ynx/stage/finance/p0289-finance-phase3-20260824t010000z/stage \
  /var/backups/ynx-finance/p0289-finance-phase3-20260824t010000z \
  /var/backups/ynx-finance/p0289-finance-phase3-20260824t010000z/backup \
  /opt/ynx/releases/finance/p0289-finance-phase3-20260824t010000z \
  /opt/ynx/releases/finance/p0289-finance-phase3-20260824t010000z/ynx-finance-7824af677dd0 \
  /opt/ynx/finance-current.next \
  /opt/ynx/finance-current.rollback
do
  absent "$path"
done
printf 'p0289Executor=absent\np0289SignedLease=absent\np0289StageContainer=absent\np0289BackupContainer=absent\n'

LEASE_PARENT=$(parent_receipt /opt/ynx/leases/finance)
STAGE_PARENT=$(parent_receipt /opt/ynx/stage/finance)
BACKUP_PARENT=$(parent_receipt /var/backups/ynx-finance)
[[ "$LEASE_PARENT" == '64770:4594822:0:0:750:2:4096:directory|directChildren=0|inventorySha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' ]]
[[ "$STAGE_PARENT" == '64770:3450041:0:0:750:5:4096:directory|directChildren=3|inventorySha256=0d11124b36a42c6201f7e0d491fd20279ea47950554f92c6b1cc960aaa0fee91' ]]
[[ "$BACKUP_PARENT" == '64770:1481354:0:0:755:11:4096:directory|directChildren=9|inventorySha256=a59008acfeccfb0a2f88de5b029871b713b42d0bf43ad1ba87786c962e6659be' ]]
printf 'leaseParent=%s\nstageParent=%s\nbackupParent=%s\n' "$LEASE_PARENT" "$STAGE_PARENT" "$BACKUP_PARENT"

CURRENT=/opt/ynx/finance-current
[[ -L "$CURRENT" ]]
[[ "$(tuple_l "$CURRENT")" == '64770:1312291:0:0:777:1:50:symbolic link' ]]
[[ "$(readlink -- "$CURRENT")" == '/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a' ]]
[[ "$(realpath -e -- "$CURRENT")" == '/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a' ]]
assert_file /opt/ynx/finance-current/ynx-finance '64770:1860512:0:0:755:1:8573112:regular file' 8573112 0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f
assert_file /etc/ynx/finance.env '64770:1324724:0:986:640:1:1545:regular file' 1545 854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252
assert_file /etc/systemd/system/ynx-finance.service '64770:161304:0:0:644:1:515:regular file' 515 2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b
assert_file /etc/caddy/conf.d/ynx-finance.caddy '64770:1051759:0:0:644:1:255:regular file' 255 dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282
absent /var/lib/ynx/finance/state.json
printf 'currentTarget=/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a\noldBinarySha256=0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f\nenvSha256=854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252\nunitSha256=2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b\ncaddySha256=dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282\nstate=absent\n'

[[ "$(systemctl show ynx-finance.service -p LoadState --value)" == loaded ]]
[[ "$(systemctl show ynx-finance.service -p ActiveState --value)" == active ]]
[[ "$(systemctl show ynx-finance.service -p SubState --value)" == running ]]
[[ "$(systemctl show ynx-finance.service -p MainPID --value)" == 2241003 ]]
[[ "$(systemctl show ynx-finance.service -p NRestarts --value)" == 0 ]]
[[ "$(systemctl show ynx-finance.service -p WorkingDirectory --value)" == /opt/ynx/finance-current ]]
[[ "$(systemctl show ynx-finance.service -p User --value)" == ynx ]]
[[ "$(systemctl show ynx-finance.service -p Group --value)" == ynx ]]
printf 'serviceLoadState=loaded\nserviceActiveState=active\nserviceSubState=running\nserviceMainPID=2241003\nserviceNRestarts=0\nserviceWorkingDirectory=/opt/ynx/finance-current\nserviceUser=ynx\nserviceGroup=ynx\n'

ROOT='200:11427:c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53:text/html; charset=utf-8'
HEALTH='200:485:d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1:application/json; charset=utf-8'
VERSION='200:130:39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226:application/json; charset=utf-8'
http_exact loopbackRoot http://127.0.0.1:6483/ "$ROOT"
http_exact loopbackHealth http://127.0.0.1:6483/health "$HEALTH"
http_exact loopbackVersion http://127.0.0.1:6483/version "$VERSION"
http_exact publicRoot https://finance.ynxweb4.com/ "$ROOT"
http_exact publicHealth https://finance.ynxweb4.com/health "$HEALTH"
http_exact publicVersion https://finance.ynxweb4.com/version "$VERSION"

printf 'remoteExitStatus=0\nverificationComplete=true\ncleanupComplete=true\nmutationCount=0\n'
