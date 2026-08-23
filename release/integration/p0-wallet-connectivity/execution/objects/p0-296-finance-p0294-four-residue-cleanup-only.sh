#!/usr/bin/env bash
set -euo pipefail

executor=/opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.executor.sh
signed_lease=/opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.json
stage_container=/opt/ynx/stage/finance/p0294-finance-phase3-20260824t020000z
backup_container=/var/backups/ynx-finance/p0294-finance-phase3-20260824t020000z
lease_parent=/opt/ynx/leases/finance
stage_parent=/opt/ynx/stage/finance
backup_parent=/var/backups/ynx-finance
release_parent=/opt/ynx/releases/finance

tuple(){ stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
sha(){ sha256sum -- "$1" | awk '{print $1}'; }
inventory(){
  local root=$1 item kind
  (
    cd "$root"
    while IFS= read -r -d '' item; do
      kind=$(stat -c '%F' -- "$item")
      printf '%s\0%s\0%s\0' "$item" "$kind" "$(stat -c '%u:%g:%a:%h:%s' -- "$item")"
      case "$kind" in
        'regular file') sha "$item" | tr '\n' '\0' ;;
        'symbolic link') readlink -- "$item" | tr '\n' '\0' ;;
        *) printf '\0' ;;
      esac
    done < <(find . -mindepth 1 -print0 | LC_ALL=C sort -z)
  ) | sha256sum | awk '{print $1}'
}
children(){ find -P "$1" -mindepth 1 -maxdepth 1 -printf x | wc -c | tr -d ' '; }
assert_parent(){
  local path=$1 tuple_expected=$2 children_expected=$3 inventory_expected=$4
  test -d "$path" && test ! -L "$path"
  test "$(tuple "$path")" = "$tuple_expected"
  test "$(children "$path")" = "$children_expected"
  test "$(inventory "$path")" = "$inventory_expected"
}
assert_file(){
  local path=$1 tuple_expected=$2 sha_expected=$3
  test -f "$path" && test ! -L "$path"
  test "$(tuple "$path")" = "$tuple_expected"
  test "$(sha "$path")" = "$sha_expected"
}
assert_empty_dir(){
  local path=$1 tuple_expected=$2
  test -d "$path" && test ! -L "$path"
  test "$(tuple "$path")" = "$tuple_expected"
  test -z "$(find -P "$path" -mindepth 1 -print -quit)"
}
absent(){ test ! -e "$1" && test ! -L "$1"; }

assert_parent "$lease_parent" '64770:4594822:0:0:750:2:4096:directory' 2 '058c2a80621673376556076f74e49ecb5456126fd00d4af087dc765aaae880c7'
assert_parent "$stage_parent" '64770:3450041:0:0:750:6:4096:directory' 4 'c2962d52adf7648f8986d389b1525655ca58a535a69cbe880562985f826e4ece'
assert_parent "$backup_parent" '64770:1481354:0:0:755:12:4096:directory' 10 '4201a0347c708fc1a721c7f9eb47a3d8fb1d57216c63337ff6cc7a163d0edc2e'
assert_parent "$release_parent" '64770:1607576:0:0:755:7:4096:directory' 5 '3b8985ca358662dc1e43b027b859b043a3ea974482f5b4b347adbe8bd7a01c4c'
assert_file "$executor" '64770:4620810:0:0:700:1:19070:regular file' '4446b9245ee81256bf02b6b46960e70ff83caa83838e91f6f80034b5a1fc5741'
assert_file "$signed_lease" '64770:4620811:0:0:600:1:7409:regular file' '102c4cabac131eef5ccfb16ac76b95509116ba38768924d9f9b9baab798b96fb'
assert_empty_dir "$stage_container" '64770:4620812:0:0:700:2:4096:directory'
assert_empty_dir "$backup_container" '64770:2663622:0:0:700:2:4096:directory'

absent /opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.executor.sh.pending
absent /opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.json.pending
absent /opt/ynx/leases/finance/p0294-finance-phase3-20260824t020000z.manual-rollback.json
absent /opt/ynx/stage/finance/p0294-finance-phase3-20260824t020000z/stage
absent /var/backups/ynx-finance/p0294-finance-phase3-20260824t020000z/backup
absent /opt/ynx/releases/finance/p0294-finance-phase3-20260824t020000z
absent /opt/ynx/finance-current.next
absent /opt/ynx/finance-current.rollback
test "$(readlink -f /opt/ynx/finance-current)" = /opt/ynx/releases/finance/ynx-finance-3b2383f5c18a
test "$(sha /opt/ynx/finance-current/ynx-finance)" = 0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f
test "$(sha /etc/ynx/finance.env)" = 854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252
test "$(sha /etc/systemd/system/ynx-finance.service)" = 2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b
test "$(sha /etc/caddy/conf.d/ynx-finance.caddy)" = dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282
test ! -e /var/lib/ynx/finance/state.json && test ! -L /var/lib/ynx/finance/state.json
test "$(systemctl show -p MainPID --value ynx-finance.service)" = 2241003
test "$(systemctl show -p NRestarts --value ynx-finance.service)" = 0

assert_file "$executor" '64770:4620810:0:0:700:1:19070:regular file' '4446b9245ee81256bf02b6b46960e70ff83caa83838e91f6f80034b5a1fc5741'
rm -- "$executor"
assert_file "$signed_lease" '64770:4620811:0:0:600:1:7409:regular file' '102c4cabac131eef5ccfb16ac76b95509116ba38768924d9f9b9baab798b96fb'
rm -- "$signed_lease"
assert_empty_dir "$stage_container" '64770:4620812:0:0:700:2:4096:directory'
rmdir -- "$stage_container"
assert_empty_dir "$backup_container" '64770:2663622:0:0:700:2:4096:directory'
rmdir -- "$backup_container"

absent "$executor"; absent "$signed_lease"; absent "$stage_container"; absent "$backup_container"
assert_parent "$lease_parent" '64770:4594822:0:0:750:2:4096:directory' 0 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
assert_parent "$stage_parent" '64770:3450041:0:0:750:5:4096:directory' 3 '0d11124b36a42c6201f7e0d491fd20279ea47950554f92c6b1cc960aaa0fee91'
assert_parent "$backup_parent" '64770:1481354:0:0:755:11:4096:directory' 9 'a59008acfeccfb0a2f88de5b029871b713b42d0bf43ad1ba87786c962e6659be'
assert_parent "$release_parent" '64770:1607576:0:0:755:7:4096:directory' 5 '3b8985ca358662dc1e43b027b859b043a3ea974482f5b4b347adbe8bd7a01c4c'
test "$(readlink -f /opt/ynx/finance-current)" = /opt/ynx/releases/finance/ynx-finance-3b2383f5c18a
test "$(systemctl show -p MainPID --value ynx-finance.service)" = 2241003
test "$(systemctl show -p NRestarts --value ynx-finance.service)" = 0

printf 'cleanup=P0294_FOUR_RESIDUES_REMOVED\nexecutorFinal=absent\nsignedLeaseFinal=absent\nstageContainerFinal=absent\nbackupContainerFinal=absent\nleaseParentStable=true\nstageParentRestored=true\nbackupParentRestored=true\ncleanupInvocationCount=1\nremoteExitStatus=0\ncleanupComplete=pending-independent-zero-write-verification\n'
