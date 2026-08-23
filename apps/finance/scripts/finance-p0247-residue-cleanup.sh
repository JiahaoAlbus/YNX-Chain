#!/usr/bin/env bash
# Finance-only P0-247 residue cleanup. This command is intentionally unable to
# deploy, roll back, restart a service, or edit a production configuration.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <central-signed-cleanup-lease.json>" >&2
  exit 64
fi

lease=$1
case "$lease" in
  /opt/ynx/leases/finance/*.json) ;;
  *) [[ "${FINANCE_RESIDUE_CLEANUP_TEST_ROOT:-}" = 1 ]] || exit 65 ;;
esac
test -f "$lease" && test ! -L "$lease"
command -v jq >/dev/null || exit 69
get() { jq -er "$1" "$lease"; }
test "$(get '.lease.signed')" = true
test "$(get '.lease.kind')" = FINANCE_P0247_RESIDUE_CLEANUP_ONLY
test "$(get '.lease.p0247.id')" = p0247-finance-phase3-20260823T073800Z

hash() { sha256sum -- "$1" | awk '{print $1}'; }
bytes() { wc -c < "$1" | tr -d ' '; }
tuple() { stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"; }
tuple_without_child_accounting() { stat -Lc '%d:%i:%u:%g:%a:%F' -- "$1"; }
absent() { test ! -e "$1" && test ! -L "$1"; }
safe_name() { case "$1" in ''|.|..|*/*|*'..'*|*$'\n'*|*$'\r'*) return 1 ;; *) return 0 ;; esac; }

expected_path() {
  local kind=$1 path=$2
  if [[ "${FINANCE_RESIDUE_CLEANUP_TEST_ROOT:-}" = 1 ]]; then return 0; fi
  case "$kind:$path" in
    stage:/opt/ynx/stage/finance/p0247-finance-phase3-20260823T073800Z|backup:/var/backups/ynx-finance/p0247-finance-phase3-20260823T073800Z) ;;
    placedExecutor:/opt/ynx/leases/finance/p0247-finance-phase3-20260823T073800Z.executor.sh|placedLease:/opt/ynx/leases/finance/p0247-finance-phase3-20260823T073800Z.json) ;;
    *) return 1 ;;
  esac
}

inventory() {
  # This is intentionally byte-for-byte equivalent in record format to the
  # accepted P0-252 readonly audit inventory. A cleanup lease therefore binds
  # the exact same directory digest that was inspected before authorization.
  local root=$1 path kind value
  (
    cd -- "$root"
    while IFS= read -r -d '' path; do
      kind=$(stat -c '%F' -- "$path")
      printf '%s\0%s\0%s\0' "$path" "$kind" "$(stat -c '%u:%g:%a:%h:%s' -- "$path")"
      case "$kind" in
        regular\ file) value=$(hash "$path") ;;
        symbolic\ link) value=$(readlink -- "$path") ;;
        *) value= ;;
      esac
      printf '%s\0' "$value"
    done < <(find -P . -mindepth 1 -print0 | LC_ALL=C sort -z)
  ) | sha256sum | awk '{print $1}'
}

assert_directory_contents_safe() {
  local path=$1
  # Digest compatibility with P0-252 must not make cleanup permissive: links,
  # devices, sockets and fifos still fail closed before any delete.
  test -z "$(find -P "$path" -mindepth 1 \( -type l -o -type b -o -type c -o -type p -o -type s \) -print -quit)"
}

assert_parent() {
  local name=$1 path expected
  path=$(get ".targets.$name.parent.path")
  expected=$(get ".targets.$name.parent.tuple")
  test -d "$path" && test ! -L "$path"
  test "$(realpath -e -- "$path")" = "$path"
  test "$(tuple "$path")" = "$expected"
}

assert_parent_after_owned_child_removal() {
  local name=$1 path expected shape
  path=$(get ".targets.$name.parent.path")
  expected=$(get ".targets.$name.parent.tuple")
  shape=$(printf '%s' "$expected" | awk -F: '{print $1":"$2":"$3":"$4":"$5":"$8}')
  test -d "$path" && test ! -L "$path"
  test "$(realpath -e -- "$path")" = "$path"
  test "$(tuple_without_child_accounting "$path")" = "$shape"
}

assert_target() {
  local name=$1 parent_mode=${2:-exact} path parent base expected inv kind
  path=$(get ".targets.$name.path")
  parent=$(get ".targets.$name.parent.path")
  base=$(get ".targets.$name.basename")
  expected=$(get ".targets.$name.tuple")
  kind=$(get ".targets.$name.kind")
  safe_name "$base"
  expected_path "$name" "$path"
  test "$path" = "$parent/$base"
  if [[ "$parent_mode" = stable ]]; then
    assert_parent_after_owned_child_removal "$name"
  else
    assert_parent "$name"
  fi
  case "$kind" in
    directory)
      inv=$(get ".targets.$name.inventorySha256")
      test -d "$path" && test ! -L "$path"
      test "$(realpath -e -- "$path")" = "$path"
      test "$(tuple "$path")" = "$expected"
      assert_directory_contents_safe "$path"
      test "$(inventory "$path")" = "$inv"
      ;;
    file)
      test -f "$path" && test ! -L "$path"
      test "$(realpath -e -- "$path")" = "$path"
      test "$(tuple "$path")" = "$expected"
      test "$(bytes "$path")" = "$(get ".targets.$name.bytes")"
      test "$(hash "$path")" = "$(get ".targets.$name.sha256")"
      ;;
    *) exit 65 ;;
  esac
}

http_check() {
  local path=$1 url report status actual_bytes actual_sha
  url=$(get "$path.url")
  # The response is never placed on remote storage. Curl appends a fixed
  # trailer to its stdout body and Perl consumes that one stream, returning
  # only status, byte count, and digest. The last trailer is unambiguous even
  # when a response happens to contain the marker text.
  report=$(curl --silent --show-error --max-time 10 -o - -w $'\n__YNX_FINANCE_HTTP_META__%{http_code}\t%{size_download}\n' "$url" | perl -MDigest::SHA=sha256_hex -e '
local $/; my $data = <STDIN>; my $marker = "\n__YNX_FINANCE_HTTP_META__";
my $at = rindex($data, $marker); exit 65 if $at < 0;
my $body = substr($data, 0, $at); my $meta = substr($data, $at + length($marker));
$meta =~ /\A([0-9]+)\t([0-9]+)\n\z/ or exit 65;
length($body) == $2 or exit 65;
print "$1\t" . length($body) . "\t" . sha256_hex($body) . "\n";
')
  IFS=$'\t' read -r status actual_bytes actual_sha <<<"$report"
  test "$status" = "$(get "$path.status")"
  test "$actual_bytes" = "$(get "$path.bytes")"
  test "$actual_sha" = "$(get "$path.sha256")"
}

verify_unchanged() {
  local current env unit caddy service
  current=$(get '.fresh.current.path')
  env=$(get '.fresh.env.path')
  unit=$(get '.fresh.unit.path')
  caddy=$(get '.fresh.caddy.path')
  service=$(get '.fresh.service.name')
  test "$(readlink -f -- "$current")" = "$(get '.fresh.current.target')"
  test -f "$env" && test ! -L "$env" && test "$(tuple "$env")" = "$(get '.fresh.env.tuple')" && test "$(hash "$env")" = "$(get '.fresh.env.sha256')"
  test -f "$unit" && test ! -L "$unit" && test "$(tuple "$unit")" = "$(get '.fresh.unit.tuple')" && test "$(hash "$unit")" = "$(get '.fresh.unit.sha256')"
  test -f "$caddy" && test ! -L "$caddy" && test "$(tuple "$caddy")" = "$(get '.fresh.caddy.tuple')" && test "$(hash "$caddy")" = "$(get '.fresh.caddy.sha256')"
  systemctl is-active --quiet "$service"
  test "$(systemctl show -p MainPID --value "$service")" = "$(get '.fresh.service.pid')"
  test "$(systemctl show -p NRestarts --value "$service")" = "$(get '.fresh.service.nrestarts')"
  http_check '.fresh.public.health'
  http_check '.fresh.public.version'
}

stage=$(get '.targets.stage.path')
backup=$(get '.targets.backup.path')
placed_executor=$(get '.targets.placedExecutor.path')
placed_lease=$(get '.targets.placedLease.path')
stage_absent=false; backup_absent=false; executor_absent=false; lease_absent=false
absent "$stage" && stage_absent=true
absent "$backup" && backup_absent=true
absent "$placed_executor" && executor_absent=true
absent "$placed_lease" && lease_absent=true
if [[ "$stage_absent" = true && "$backup_absent" = true && "$executor_absent" = true && "$lease_absent" = true ]]; then
  verify_unchanged
  printf 'cleanup=P0247_RESIDUES_ALREADY_ABSENT\n'
  exit 0
fi
if [[ "$stage_absent" = true || "$backup_absent" = true || "$executor_absent" = true || "$lease_absent" = true ]]; then
  echo 'refusing non-idempotent partial absence' >&2
  exit 65
fi

# Recheck both complete inventories and both placed-file identities before the
# first deletion. A lease may only clean these four exact residual objects; any
# drift leaves every still-present path.
assert_target stage
assert_target backup
assert_target placedExecutor
assert_target placedLease
verify_unchanged

remove_target() {
  local name=$1 parent_mode=${2:-exact} path kind
  path=$(get ".targets.$name.path")
  kind=$(get ".targets.$name.kind")
  assert_target "$name" "$parent_mode"
  verify_unchanged
  if [[ "$kind" = directory ]]; then rm -rf --one-file-system -- "$path"; else rm -- "$path"; fi
  absent "$path"
  # Removing a direct child legitimately changes the parent's nlink and byte
  # count. Keep the stable signed identity fields fixed across that transition.
  assert_parent_after_owned_child_removal "$name"
  verify_unchanged
}

remove_target stage
remove_target backup
remove_target placedLease
remove_target placedExecutor stable
verify_unchanged
printf 'cleanup=P0247_RESIDUES_REMOVED\n'
