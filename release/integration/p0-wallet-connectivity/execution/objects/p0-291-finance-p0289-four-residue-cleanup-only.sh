#!/usr/bin/env bash
set -euo pipefail

EMPTY_SHA=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
LEASE_PARENT=/opt/ynx/leases/finance
EXECUTOR=$LEASE_PARENT/p0289-finance-phase3-20260824t010000z.executor.sh
SIGNED_LEASE=$LEASE_PARENT/p0289-finance-phase3-20260824t010000z.json
EXECUTOR_PENDING=$EXECUTOR.pending
SIGNED_LEASE_PENDING=$SIGNED_LEASE.pending
STAGE_PARENT=/opt/ynx/stage/finance
STAGE_CONTAINER=$STAGE_PARENT/p0289-finance-phase3-20260824t010000z
STAGE=$STAGE_CONTAINER/stage
BACKUP_PARENT=/var/backups/ynx-finance
BACKUP_CONTAINER=$BACKUP_PARENT/p0289-finance-phase3-20260824t010000z
BACKUP=$BACKUP_CONTAINER/backup

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
canonical_dir(){ [[ -d "$1" && ! -L "$1" && "$(realpath -e -- "$1")" == "$1" ]]; }
canonical_file(){ [[ -f "$1" && ! -L "$1" && "$(realpath -e -- "$1")" == "$1" ]]; }
assert_file(){
  local path=$1 tuple=$2 bytes=$3 sha=$4
  canonical_file "$path"
  [[ "$(tuple_l "$path")" == "$tuple" ]]
  [[ "$(bytes_file "$path")" == "$bytes" ]]
  [[ "$(sha_file "$path")" == "$sha" ]]
}
assert_empty_dir(){
  local path=$1 tuple=$2
  canonical_dir "$path"
  [[ "$(tuple_l "$path")" == "$tuple" ]]
  [[ "$(direct_children "$path")" == 0 ]]
  [[ "$(tree_inventory "$path")" == "$EMPTY_SHA" ]]
}
assert_all_pre(){
  [[ "$(parent_receipt "$LEASE_PARENT")" == '64770:4594822:0:0:750:2:4096:directory|directChildren=2|inventorySha256=ba5ccdf943883fa8433199e5c64843ec7e5b824102cf611fa961f2e04ddac4b4' ]]
  [[ "$(parent_receipt "$STAGE_PARENT")" == '64770:3450041:0:0:750:6:4096:directory|directChildren=4|inventorySha256=c31bb854268d818c88fd8ac2baf121734848e614880f7813d3eddad841fa155f' ]]
  [[ "$(parent_receipt "$BACKUP_PARENT")" == '64770:1481354:0:0:755:12:4096:directory|directChildren=10|inventorySha256=9b15184fc9e0ec23c19390794bc8e2cfaf98b40c54c299ff7f4ebac52d839eaa' ]]
  assert_file "$EXECUTOR" '64770:4620784:0:0:700:1:18432:regular file' 18432 be7435a922b26482c830778ef23753e7de2e02ad307de914fef9aa83a77229c0
  assert_file "$SIGNED_LEASE" '64770:4620785:0:0:600:1:9252:regular file' 9252 b3583c982ac2be861af11e35f7bdfa6a608243d52b44d8200f1171ecfbfa1ce3
  assert_empty_dir "$STAGE_CONTAINER" '64770:4620786:0:0:700:2:4096:directory'
  assert_empty_dir "$BACKUP_CONTAINER" '64770:2663622:0:0:700:2:4096:directory'
  absent "$EXECUTOR_PENDING"; absent "$SIGNED_LEASE_PENDING"; absent "$STAGE"; absent "$BACKUP"
}

assert_all_pre

assert_file "$EXECUTOR" '64770:4620784:0:0:700:1:18432:regular file' 18432 be7435a922b26482c830778ef23753e7de2e02ad307de914fef9aa83a77229c0
[[ "$(parent_receipt "$LEASE_PARENT")" == '64770:4594822:0:0:750:2:4096:directory|directChildren=2|inventorySha256=ba5ccdf943883fa8433199e5c64843ec7e5b824102cf611fa961f2e04ddac4b4' ]]
unlink -- "$EXECUTOR"
absent "$EXECUTOR"

assert_file "$SIGNED_LEASE" '64770:4620785:0:0:600:1:9252:regular file' 9252 b3583c982ac2be861af11e35f7bdfa6a608243d52b44d8200f1171ecfbfa1ce3
[[ "$(tuple_l "$LEASE_PARENT")" == '64770:4594822:0:0:750:2:4096:directory' ]]
[[ "$(direct_children "$LEASE_PARENT")" == 1 ]]
[[ "$(find -P "$LEASE_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" == 'p0289-finance-phase3-20260824t010000z.json' ]]
unlink -- "$SIGNED_LEASE"
absent "$SIGNED_LEASE"

assert_empty_dir "$STAGE_CONTAINER" '64770:4620786:0:0:700:2:4096:directory'
[[ "$(parent_receipt "$STAGE_PARENT")" == '64770:3450041:0:0:750:6:4096:directory|directChildren=4|inventorySha256=c31bb854268d818c88fd8ac2baf121734848e614880f7813d3eddad841fa155f' ]]
rmdir -- "$STAGE_CONTAINER"
absent "$STAGE_CONTAINER"

assert_empty_dir "$BACKUP_CONTAINER" '64770:2663622:0:0:700:2:4096:directory'
[[ "$(parent_receipt "$BACKUP_PARENT")" == '64770:1481354:0:0:755:12:4096:directory|directChildren=10|inventorySha256=9b15184fc9e0ec23c19390794bc8e2cfaf98b40c54c299ff7f4ebac52d839eaa' ]]
rmdir -- "$BACKUP_CONTAINER"
absent "$BACKUP_CONTAINER"

absent "$EXECUTOR"; absent "$SIGNED_LEASE"; absent "$STAGE_CONTAINER"; absent "$BACKUP_CONTAINER"
absent "$EXECUTOR_PENDING"; absent "$SIGNED_LEASE_PENDING"; absent "$STAGE"; absent "$BACKUP"
[[ "$(parent_receipt "$LEASE_PARENT")" == '64770:4594822:0:0:750:2:4096:directory|directChildren=0|inventorySha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' ]]
[[ "$(parent_receipt "$STAGE_PARENT")" == '64770:3450041:0:0:750:5:4096:directory|directChildren=3|inventorySha256=0d11124b36a42c6201f7e0d491fd20279ea47950554f92c6b1cc960aaa0fee91' ]]
[[ "$(parent_receipt "$BACKUP_PARENT")" == '64770:1481354:0:0:755:11:4096:directory|directChildren=9|inventorySha256=a59008acfeccfb0a2f88de5b029871b713b42d0bf43ad1ba87786c962e6659be' ]]

printf 'cleanup=P0289_FOUR_RESIDUES_REMOVED\n'
printf 'executorFinal=absent\n'
printf 'signedLeaseFinal=absent\n'
printf 'stageContainerFinal=absent\n'
printf 'backupContainerFinal=absent\n'
printf 'leaseParentPost=64770:4594822:0:0:750:2:4096:directory|directChildren=0|inventorySha256=%s\n' "$EMPTY_SHA"
printf 'stageParentPost=64770:3450041:0:0:750:5:4096:directory|directChildren=3|inventorySha256=0d11124b36a42c6201f7e0d491fd20279ea47950554f92c6b1cc960aaa0fee91\n'
printf 'backupParentPost=64770:1481354:0:0:755:11:4096:directory|directChildren=9|inventorySha256=a59008acfeccfb0a2f88de5b029871b713b42d0bf43ad1ba87786c962e6659be\n'
printf 'cleanupInvocationCount=1\nremoteExitStatus=0\ncleanupComplete=pending-independent-zero-write-verification\n'
