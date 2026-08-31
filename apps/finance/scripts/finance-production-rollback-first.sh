#!/usr/bin/env bash
# Finance-only production executor. It accepts only a Central-signed lease
# carrier and rechecks every signed fresh baseline before the first write.
set -euo pipefail
if [[ $# -ne 2 || ( "$1" != deploy && "$1" != rollback ) ]]; then
  echo "usage: $0 <deploy|rollback> <central-signed-finance-lease.json>" >&2; exit 64
fi
mode=$1; lease=$2
prewrite_phase=LEASE_PATH
prewrite_open=false
emit_prewrite_failure(){
  local rc=$?
  if [[ "$mode" = deploy && "$prewrite_open" = true && "$rc" -ne 0 ]]; then
    printf 'phase=prewrite\nfailureClass=PREWRITE_%s\nfailureExitStatus=%s\n' "$prewrite_phase" "$rc"
  fi
  trap - EXIT
  exit "$rc"
}
if [[ "$mode" = deploy ]]; then prewrite_open=true; trap emit_prewrite_failure EXIT; fi
case "$lease" in /opt/ynx/leases/finance/*.json) ;; *) exit 65;; esac
test -f "$lease" && test ! -L "$lease"
command -v jq >/dev/null || { echo 'jq required for signed lease object' >&2; exit 69; }
signed=$(jq -er '.lease.signed' "$lease"); test "$signed" = true
get(){ jq -r "$1" "$lease"; }
LEASE_ID=$(get '.lease.id')
lease_kind=$(get '.lease.kind')
prewrite_phase=LEASE_SCHEMA
if [[ "$mode" == deploy ]]; then test "$lease_kind" = FINANCE_ROLLBACK_FIRST_PRODUCTION_DEPLOYMENT; else test "$lease_kind" = FINANCE_ROLLBACK_FIRST_PRODUCTION_MANUAL_ROLLBACK; fi
hash(){ sha256sum "$1" | awk '{print $1}'; }
bytes(){ wc -c < "$1" | tr -d ' '; }
http_check(){ local path=$1 tmp status url; url=$(get "$path.url"); tmp=$(mktemp); status=$(curl --silent --show-error --max-time 10 -o "$tmp" -w '%{http_code}' "$url"); test "$status" = "$(get "$path.status")"; test "$(bytes "$tmp")" = "$(get "$path.bytes")"; test "$(hash "$tmp")" = "$(get "$path.sha256")"; rm -f "$tmp"; }
absent(){ test ! -e "$1" && test ! -L "$1"; }
archive=$(get '.candidate.archive.path'); archive_sha=$(get '.candidate.archive.sha256'); archive_bytes=$(get '.candidate.archive.bytes')
binary_bytes=$(get '.candidate.binary.bytes')
binary_sha=$(get '.candidate.binary.sha256'); current=$(get '.fresh.currentLink'); old=$(get '.fresh.activeRelease'); old_binary=$(get '.fresh.binary.path'); old_binary_sha=$(get '.fresh.binary.sha256')
candidate_source=$(get '.candidate.sourceCommit')
printf '%s\n' "$candidate_source" | grep -Eq '^[0-9a-f]{40}$'
env=$(get '.fresh.env.path'); env_sha=$(get '.fresh.env.sha256'); unit=$(get '.fresh.unit.path'); unit_sha=$(get '.fresh.unit.sha256'); caddy=$(get '.fresh.caddy.path'); caddy_sha=$(get '.fresh.caddy.sha256'); service=$(get '.fresh.service.name')
stage=$(get '.paths.stage'); backup=$(get '.paths.backup'); release=$(get '.paths.release')
stage_container=$(get '.paths.stageContainer.path'); stage_container_uid=$(get '.paths.stageContainer.uid'); stage_container_gid=$(get '.paths.stageContainer.gid'); stage_container_mode=$(get '.paths.stageContainer.mode')
backup_container=$(get '.paths.backupContainer.path'); backup_container_uid=$(get '.paths.backupContainer.uid'); backup_container_gid=$(get '.paths.backupContainer.gid'); backup_container_mode=$(get '.paths.backupContainer.mode')
release_container=$(get '.paths.releaseContainer.path'); release_container_uid=$(get '.paths.releaseContainer.uid'); release_container_gid=$(get '.paths.releaseContainer.gid'); release_container_mode=$(get '.paths.releaseContainer.mode'); new_env=$(get '.candidate.env.path'); new_env_sha=$(get '.candidate.env.sha256'); state=$(get '.fresh.state.path'); state_absent=$(get '.fresh.state.absent')
service_user=$(get '.fresh.service.user'); service_gid=$(get '.fresh.service.gid')
carrier=$(get '.candidate.carrier.path'); carrier_id=$(get '.candidate.carrier.id'); carrier_tuple=$(get '.candidate.carrier.tuple')
prewrite_phase=CARRIER_ASSERTION
case "$carrier_id" in ''|*/*|.|..|*..*) exit 65;; esac
case "$carrier_id" in finance-combined-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9TtZz-]*) ;; *) exit 65;; esac
test "$carrier" = "/opt/ynx/stage/finance/$carrier_id"
test -d "$carrier" && test ! -L "$carrier" && test "$(realpath -e "$carrier")" = "$carrier"
test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$carrier")" = "$carrier_tuple"
assert_carrier_child(){
  local name=$1 value=$2 base
  base=$(get ".paths.basenames.$name")
  case "$base" in ''|*/*|.|..|*..*) exit 65;; esac
  test "$value" = "$carrier/$base"
  test -f "$value" && test ! -L "$value"
}
assert_lease_child_path(){
  local name=$1 value=$2 parent tuple base
  parent=$(get ".paths.parents.$name.path"); if [[ "$mode" == deploy ]]; then tuple=$(get ".paths.parents.$name.tuple"); else tuple=$(get ".success.parents.$name.tuple"); fi; base=$(get ".paths.basenames.$name")
  case "$base" in ''|*/*|.|..|*..*) exit 65;; esac
  test "$value" = "$parent/$LEASE_ID/$base"
  test -d "$parent" && test ! -L "$parent" && test "$(realpath -e "$parent")" = "$parent"
  test "$(stat -Lc '%u:%g:%a:%h' "$parent")" = "$tuple"
}
assert_carrier_child archive "$archive"; assert_carrier_child newEnv "$new_env"
prewrite_phase=LEASE_PATH_ASSERTION
assert_lease_child_path stage "$stage"; assert_lease_child_path backup "$backup"; assert_lease_child_path release "$release"
stage_parent=$(get '.paths.parents.stage.path'); backup_parent=$(get '.paths.parents.backup.path')
release_parent=$(get '.paths.parents.release.path')
test "$stage_container" = "$stage_parent/$LEASE_ID"; test "$(dirname "$stage")" = "$stage_container"
test "$backup_container" = "$backup_parent/$LEASE_ID"; test "$(dirname "$backup")" = "$backup_container"
test "$release_container" = "$release_parent/$LEASE_ID"; test "$(dirname "$release")" = "$release_container"
case "$stage_container_uid:$stage_container_gid:$stage_container_mode" in *[!0-9:]*|*:*:*:*) exit 65;; esac
case "$backup_container_uid:$backup_container_gid:$backup_container_mode" in *[!0-9:]*|*:*:*:*) exit 65;; esac
case "$release_container_uid:$release_container_gid:$release_container_mode" in *[!0-9:]*|*:*:*:*) exit 65;; esac
stage_container_created=false; backup_container_created=false; release_container_created=false; stage_created=false; backup_created=false
cleanup_empty_container(){
  local path=$1 created=$2 identity=$3
  [[ "$created" = true ]] || return 0
  test -d "$path" && test ! -L "$path" || return 74
  test "$(identity_tuple "$path")" = "$identity" || return 74
  test -z "$(find "$path" -mindepth 1 -print -quit)" || return 74
  rmdir -- "$path"
}
cleanup_release_container(){
  cleanup_empty_container "$release_container" "$release_container_created" "${release_container_identity_tuple:-}"
}
verify_old_live(){ http_check '.fresh.verifier.loopbackHealth'; http_check '.fresh.verifier.loopbackVersion'; http_check '.fresh.verifier.publicHealth'; http_check '.fresh.verifier.publicVersion'; }
asset_path(){
  local root=$1 rel=$2 path
  case "$rel" in ''|/*|.|..|*/../*|../*|*//*) exit 65;; esac
  path="$root/$rel"
  case "$path" in "$root"/*) ;; *) exit 65;; esac
  printf '%s\n' "$path"
}
verify_local_assets(){
  local root=$1 n rel asset
  jq -e '.candidate.assets|length>0' "$lease" >/dev/null
  jq -re '.candidate.assets[]|.url,.status,.bytes,.sha256,.relativePath' "$lease" >/dev/null
  while IFS= read -r n; do
    test -n "$n"; rel=$(get ".candidate.assets[$n].relativePath"); asset=$(asset_path "$root" "$rel")
    test -f "$asset" && test ! -L "$asset" && test "$(realpath -e "$asset")" = "$asset"
    test "$(bytes "$asset")" = "$(get ".candidate.assets[$n].bytes")"
    test "$(hash "$asset")" = "$(get ".candidate.assets[$n].sha256")"
  done < <(jq -r '.candidate.assets|keys[]' "$lease")
}
verify_build_identity(){
  local root=$1 identity
  identity="$root/web/build-identity.json"
  jq -e '.candidate.buildIdentity' "$lease" >/dev/null || return 0
  local candidate_release candidate_build_time candidate_frontend_source
  candidate_release=$(get '.candidate.buildIdentity.release'); candidate_build_time=$(get '.candidate.buildIdentity.buildTime'); candidate_frontend_source=$(get '.candidate.buildIdentity.frontendSourceCommit')
  printf '%s\n' "$candidate_frontend_source" | grep -Eq '^[0-9a-f]{40}$'
  test -f "$identity" && test ! -L "$identity"
  jq -e --arg source "$candidate_source" --arg release "$candidate_release" --arg buildTime "$candidate_build_time" --arg frontend "$candidate_frontend_source" '.sourceCommit==$source and .release==$release and .buildTime==$buildTime and .frontendSourceCommit==$frontend' "$identity" >/dev/null
  jq -e 'keys|length==4' "$identity" >/dev/null
}
tree_inventory(){
  local root=$1 path kind value
  (
    cd "$root"
    while IFS= read -r -d '' path; do
      kind=$(stat -c '%F' -- "$path")
      printf '%s\0%s\0%s\0' "$path" "$kind" "$(stat -c '%u:%g:%a:%h:%s' -- "$path")"
      case "$kind" in regular\ file) value=$(hash "$path");; symbolic\ link) value=$(readlink -- "$path");; *) value=;; esac
      printf '%s\0' "$value"
    done < <(find . -mindepth 1 -print0 | LC_ALL=C sort -z)
  ) | sha256sum | awk '{print $1}'
}
identity_tuple(){ stat -Lc '%d:%i:%u:%g:%a' "$1"; }
container_identity_tuple(){ stat -Lc '%d:%i:%h:%F' "$1"; }
cleanup_owned_tree(){
  local path=$1 identity=$2 inventory=$3
  test -n "$identity" && test -d "$path" && test ! -L "$path" && test "$(identity_tuple "$path")" = "$identity" || return 74
  if test -z "$(find "$path" -mindepth 1 -print -quit)"; then rmdir -- "$path"; return 0; fi
  test -n "$inventory" && test "$(tree_inventory "$path")" = "$inventory" || return 74
  rm -rf -- "$path"
}
cleanup_staging_residues(){
  local rc=0
  cleanup_release_container || rc=74
  if [[ "$stage_created" = true ]]; then cleanup_owned_tree "$stage" "${stage_identity_tuple:-}" "${stage_inventory:-}" || rc=74; fi
  if [[ "$backup_created" = true ]]; then cleanup_owned_tree "$backup" "${backup_identity_tuple:-}" "${backup_inventory:-}" || rc=74; fi
  cleanup_empty_container "$stage_container" "$stage_container_created" "${stage_container_identity_tuple:-}" || rc=74
  cleanup_empty_container "$backup_container" "$backup_container_created" "${backup_container_identity_tuple:-}" || rc=74
  return "$rc"
}
pre_switch_cleanup(){ cleanup_staging_residues; }
post_move_pre_switch_cleanup(){
  if [[ "${release_created:-false}" = true ]] && test -d "$release" && test ! -L "$release" && test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$release")" = "${release_tuple:-}" && test "$(tree_inventory "$release")" = "${release_inventory:-}"; then rm -rf -- "$release"; fi
  cleanup_staging_residues
}
assert_service_user_candidate_access(){
  test "$release_container_uid" = "$(get '.fresh.service.releaseContainerOwnerUid')"
  test "$release_container_gid" = "$service_gid"
  test "$release_container_mode" = 750
  runuser -u "$service_user" -- test -x "$release_container"
  runuser -u "$service_user" -- test -x "$release"
  runuser -u "$service_user" -- test -x "$release/ynx-finance"
  while IFS= read -r n; do test -n "$n"; runuser -u "$service_user" -- test -r "$(asset_path "$release" "$(get ".candidate.assets[$n].relativePath")")"; done < <(jq -r '.candidate.assets|keys[]' "$lease")
}
verify_candidate_live(){
  local newpid n
  systemctl is-active --quiet "$service"; newpid=$(systemctl show -p MainPID --value "$service")
  test "$newpid" -gt 0 && test "$newpid" != "$(get '.fresh.service.pid')"
  test "$(systemctl show -p NRestarts --value "$service")" = "$(get '.fresh.service.nrestarts')"
  verify_local_assets "$release"; verify_build_identity "$release"
  http_check '.candidate.verifier.loopbackHealth'; http_check '.candidate.verifier.loopbackVersion'; http_check '.candidate.verifier.publicHealth'; http_check '.candidate.verifier.publicVersion'
  while IFS= read -r n; do test -n "$n"; http_check ".candidate.assets[$n]"; done < <(jq -r '.candidate.assets|keys[]' "$lease")
}
assert_fresh(){
  test "$(readlink -f "$current")" = "$old"; test "$(hash "$old_binary")" = "$old_binary_sha"; file "$old_binary" | grep -q 'ELF 64-bit.*x86-64'
  test "$(hash "$env")" = "$env_sha"; test "$(hash "$unit")" = "$unit_sha"; test "$(hash "$caddy")" = "$caddy_sha"; systemctl is-active --quiet "$service"; test "$(systemctl show -p MainPID --value "$service")" = "$(get '.fresh.service.pid')"; test "$(systemctl show -p NRestarts --value "$service")" = "$(get '.fresh.service.nrestarts')"
  if [[ "$state_absent" = true ]]; then test ! -e "$state" && test ! -L "$state"; else test -f "$state" && test ! -L "$state"; test "$(stat -Lc '%d:%i:%u:%g:%a:%h' "$state")" = "$(get '.fresh.state.tuple')"; test "$(bytes "$state")" = "$(get '.fresh.state.bytes')"; test "$(hash "$state")" = "$(get '.fresh.state.sha256')"; fi
  jq -e '.fresh.verifier.loopbackHealth and .fresh.verifier.loopbackVersion and .fresh.verifier.publicHealth and .fresh.verifier.publicVersion' "$lease" >/dev/null; verify_old_live
}
verify_restored(){
  test "$(hash "$env")" = "$env_sha"; test "$(readlink -f "$current")" = "$old"; test "$(hash "$unit")" = "$unit_sha"; test "$(hash "$caddy")" = "$caddy_sha"; systemctl is-active --quiet "$service"
  if [[ "$state_absent" = true ]]; then test ! -e "$state" && test ! -L "$state"; else test -f "$state" && test ! -L "$state"; test "$(stat -Lc '%u:%g:%a:%h' "$state")" = "$(get '.fresh.state.restoredTuple')"; test "$(bytes "$state")" = "$(get '.fresh.state.bytes')"; test "$(hash "$state")" = "$(get '.fresh.state.sha256')"; fi
  verify_old_live
}
restore(){
  local candidate_state_tuple candidate_state_hash
  systemctl stop "$service" || true; test "$(hash "$backup/env")" = "$env_sha"; tmp=$(mktemp "$(dirname "$env")/.finance.env.restore.XXXXXX"); cp --preserve=mode,ownership "$backup/env" "$tmp"; mv -Tf "$tmp" "$env"; if [[ "$state_absent" = true ]]; then test -f "$backup/state-absent"; if test -e "$state"; then test -f "$state" && test ! -L "$state"; candidate_state_tuple=$(stat -Lc '%d:%i:%u:%g:%a:%h:%s' "$state"); candidate_state_hash=$(hash "$state"); printf '%s\n' "$candidate_state_tuple" >"$backup/candidate-state-stat"; printf '%s\n' "$candidate_state_hash" >"$backup/candidate-state-sha256"; test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s' "$state")" = "$candidate_state_tuple"; test "$(hash "$state")" = "$candidate_state_hash"; rm -- "$state"; fi; test ! -e "$state" && test ! -L "$state"; else test "$(hash "$backup/state")" = "$(get '.fresh.state.sha256')"; if test -e "$state"; then test -f "$state" && test ! -L "$state"; candidate_state_tuple=$(stat -Lc '%d:%i:%u:%g:%a:%h:%s' "$state"); candidate_state_hash=$(hash "$state"); printf '%s\n' "$candidate_state_tuple" >"$backup/candidate-state-stat"; printf '%s\n' "$candidate_state_hash" >"$backup/candidate-state-sha256"; test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s' "$state")" = "$candidate_state_tuple"; test "$(hash "$state")" = "$candidate_state_hash"; rm -- "$state"; fi; stmp=$(mktemp "$(dirname "$state")/.finance.state.restore.XXXXXX"); cp --preserve=mode,ownership "$backup/state" "$stmp"; mv -Tf "$stmp" "$state"; test "$(stat -Lc '%u:%g:%a:%h' "$state")" = "$(get '.fresh.state.restoredTuple')"; test "$(bytes "$state")" = "$(get '.fresh.state.bytes')"; test "$(hash "$state")" = "$(get '.fresh.state.sha256')"; fi
  link="$current.rollback"; absent "$link"; ln -s "$old" "$link"; mv -Tf "$link" "$current"; systemctl start "$service"; verify_restored
  if [[ "${release_created:-false}" = true ]]; then
    if ! test -d "$release" || test -L "$release" || [[ "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$release")" != "$release_tuple" ]] || [[ "$(tree_inventory "$release")" != "$release_inventory" ]]; then cleanup_release_container; return 74; fi
    rm -rf -- "$release"; absent "$release"
  fi
  if [[ "$backup_created" = true ]]; then backup_inventory=$(tree_inventory "$backup"); fi
  cleanup_staging_residues
}
phase_failure_phase=
phase_failure_cleanup=
emit_owned_phase_failure(){
  local original_rc=$? cleanup_rc=0 terminal_rc
  trap - EXIT
  set +e
  case "$phase_failure_cleanup" in
    pre_switch_cleanup|post_move_pre_switch_cleanup|restore) "$phase_failure_cleanup" >/dev/null 2>&1 || cleanup_rc=$? ;;
    *) cleanup_rc=74 ;;
  esac
  set -e
  terminal_rc=$original_rc
  [[ "$cleanup_rc" = 0 ]] || terminal_rc=74
  printf 'phase=%s\nfailureClass=POSTWRITE_%s\nfailureExitStatus=%s\n' "$phase_failure_phase" "$phase_failure_phase" "$terminal_rc"
  exit "$terminal_rc"
}
arm_owned_phase_failure(){
  phase_failure_phase=$1
  phase_failure_cleanup=$2
  trap emit_owned_phase_failure EXIT
}
if [[ "$mode" == rollback ]]; then
  release_container_tuple=$(get '.success.releaseContainer.tuple'); release_container_empty_tuple=$(get '.success.releaseContainer.emptyTuple'); release_container_identity_tuple=$(get '.success.releaseContainer.identityTuple'); release_tuple=$(get '.success.release.tuple'); release_inventory=$(get '.success.release.inventorySha256')
  success_backup_container_tuple=$(get '.success.backupContainer.tuple'); backup_container_identity_tuple=$(get '.success.backupContainer.identityTuple'); success_backup_container_inventory=$(get '.success.backupContainer.inventorySha256')
  success_backup_tuple=$(get '.success.backup.tuple'); backup_identity_tuple=$(get '.success.backup.identityTuple'); backup_inventory=$(get '.success.backup.inventorySha256'); success_pid=$(get '.success.service.pid'); success_restarts=$(get '.success.service.nrestarts')
  rollback_guard(){ "$@" || exit 74; }
  rollback_guard absent "$stage"
  rollback_guard absent "$stage_container"
  rollback_guard test -d "$release_container"
  rollback_guard test ! -L "$release_container"
  rollback_guard test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$release_container")" = "$release_container_tuple"
  rollback_guard test -d "$release"
  rollback_guard test ! -L "$release"
  rollback_guard test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$release")" = "$release_tuple"
  rollback_guard test "$(tree_inventory "$release")" = "$release_inventory"
  rollback_guard test -d "$backup_container"
  rollback_guard test ! -L "$backup_container"
  rollback_guard test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$backup_container")" = "$success_backup_container_tuple"
  rollback_guard test "$(identity_tuple "$backup_container")" = "$backup_container_identity_tuple"
  rollback_guard test "$(tree_inventory "$backup_container")" = "$success_backup_container_inventory"
  rollback_guard test -d "$backup"
  rollback_guard test ! -L "$backup"
  rollback_guard test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$backup")" = "$success_backup_tuple"
  rollback_guard test "$(identity_tuple "$backup")" = "$backup_identity_tuple"
  rollback_guard test "$(tree_inventory "$backup")" = "$backup_inventory"
  rollback_guard test -f "$backup/env"
  rollback_guard test ! -L "$backup/env"
  rollback_guard test "$(hash "$backup/env")" = "$env_sha"
  if [[ "$state_absent" = true ]]; then
    rollback_guard test -f "$backup/state-absent"
    rollback_guard test ! -L "$backup/state-absent"
  else
    rollback_guard test -f "$backup/state"
    rollback_guard test ! -L "$backup/state"
    rollback_guard test "$(hash "$backup/state")" = "$(get '.fresh.state.sha256')"
  fi
  rollback_guard test "$(readlink -f "$current")" = "$release"
  rollback_guard test "$(hash "$env")" = "$new_env_sha"
  rollback_guard test "$(hash "$unit")" = "$unit_sha"
  rollback_guard test "$(hash "$caddy")" = "$caddy_sha"
  rollback_guard systemctl is-active --quiet "$service"
  rollback_guard test "$(systemctl show -p MainPID --value "$service")" = "$success_pid"
  rollback_guard test "$(systemctl show -p NRestarts --value "$service")" = "$success_restarts"
  release_created=true; release_container_created=true; backup_created=true; backup_container_created=true; restore; exit 0
fi
prewrite_phase=CURRENT_PREWRITE_INVARIANT
absent "$stage"; absent "$stage_container"; absent "$backup"; absent "$backup_container"; absent "$release"; absent "$release_container"
prewrite_phase=FRESH_BASELINE
assert_fresh
prewrite_phase=CANDIDATE_INTEGRITY
test "$(bytes "$archive")" = "$archive_bytes"; test "$(hash "$archive")" = "$archive_sha"; test "$(hash "$new_env")" = "$new_env_sha"
prewrite_open=false
arm_owned_phase_failure STAGING_BACKUP pre_switch_cleanup
mkdir -m "$stage_container_mode" -- "$stage_container"; stage_container_created=true; stage_container_preownership_identity=$(container_identity_tuple "$stage_container")
if ! test -d "$stage_container" || test -L "$stage_container" || [[ "$(realpath -e "$stage_container")" != "$stage_container" ]] || [[ -n "$(find "$stage_container" -mindepth 1 -print -quit)" ]]; then exit 74; fi
chown "$stage_container_uid:$stage_container_gid" "$stage_container"; chmod "$stage_container_mode" "$stage_container"
if ! test -d "$stage_container" || test -L "$stage_container" || [[ "$(realpath -e "$stage_container")" != "$stage_container" ]] || [[ -n "$(find "$stage_container" -mindepth 1 -print -quit)" ]]; then exit 74; fi
if [[ "$(container_identity_tuple "$stage_container")" != "$stage_container_preownership_identity" ]] || [[ "$(stat -Lc '%u:%g:%a' "$stage_container")" != "$stage_container_uid:$stage_container_gid:$stage_container_mode" ]]; then exit 74; fi
stage_container_identity_tuple=$(identity_tuple "$stage_container")
mkdir -m 0700 -- "$stage"; stage_created=true; stage_identity_tuple=$(identity_tuple "$stage")
mkdir -m "$backup_container_mode" -- "$backup_container"; backup_container_created=true; backup_container_preownership_identity=$(container_identity_tuple "$backup_container")
if ! test -d "$backup_container" || test -L "$backup_container" || [[ "$(realpath -e "$backup_container")" != "$backup_container" ]] || [[ -n "$(find "$backup_container" -mindepth 1 -print -quit)" ]]; then exit 74; fi
chown "$backup_container_uid:$backup_container_gid" "$backup_container"; chmod "$backup_container_mode" "$backup_container"
if ! test -d "$backup_container" || test -L "$backup_container" || [[ "$(realpath -e "$backup_container")" != "$backup_container" ]] || [[ -n "$(find "$backup_container" -mindepth 1 -print -quit)" ]]; then exit 74; fi
if [[ "$(container_identity_tuple "$backup_container")" != "$backup_container_preownership_identity" ]] || [[ "$(stat -Lc '%u:%g:%a' "$backup_container")" != "$backup_container_uid:$backup_container_gid:$backup_container_mode" ]]; then exit 74; fi
backup_container_identity_tuple=$(identity_tuple "$backup_container")
mkdir -m 0700 -- "$backup"; backup_created=true; backup_identity_tuple=$(identity_tuple "$backup")
cp --preserve=mode,ownership "$env" "$backup/env"; if [[ "$state_absent" = true ]]; then test ! -e "$state" && test ! -L "$state"; : >"$backup/state-absent"; else cp --preserve=mode,ownership "$state" "$backup/state"; fi; backup_inventory=$(tree_inventory "$backup")
arm_owned_phase_failure ARCHIVE_EXTRACT pre_switch_cleanup
tar --warning=no-unknown-keyword -xzf "$archive" -C "$stage"
arm_owned_phase_failure CANDIDATE_VERIFY pre_switch_cleanup
candidate="$stage/$(basename "$release")"; test -x "$candidate/ynx-finance"; test "$(hash "$candidate/ynx-finance")" = "$binary_sha"; test "$(bytes "$candidate/ynx-finance")" = "$binary_bytes"; file "$candidate/ynx-finance" | grep -q 'ELF 64-bit.*x86-64'
verify_local_assets "$candidate"; verify_build_identity "$candidate"; stage_inventory=$(tree_inventory "$stage")
arm_owned_phase_failure RELEASE_MATERIALIZE pre_switch_cleanup
mkdir -m "$release_container_mode" -- "$release_container"; release_container_created=true; release_container_preownership_identity=$(container_identity_tuple "$release_container")
if ! test -d "$release_container" || test -L "$release_container" || [[ "$(realpath -e "$release_container")" != "$release_container" ]] || [[ -n "$(find "$release_container" -mindepth 1 -print -quit)" ]]; then exit 74; fi
chown "$release_container_uid:$release_container_gid" "$release_container"; chmod "$release_container_mode" "$release_container"
if ! test -d "$release_container" || test -L "$release_container" || [[ "$(realpath -e "$release_container")" != "$release_container" ]] || [[ -n "$(find "$release_container" -mindepth 1 -print -quit)" ]]; then exit 74; fi
release_container_empty_tuple=$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$release_container")
test "$(container_identity_tuple "$release_container")" = "$release_container_preownership_identity"
test "$(stat -Lc '%u:%g:%a' "$release_container")" = "$release_container_uid:$release_container_gid:$release_container_mode"
release_container_identity_tuple=$(identity_tuple "$release_container")
release_tuple=$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$candidate"); release_inventory=$(tree_inventory "$candidate"); release_created=false
mv "$candidate" "$release"; release_created=true
test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$release")" = "$release_tuple"; test "$(tree_inventory "$release")" = "$release_inventory"
release_container_tuple=$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$release_container")
stage_inventory=$(tree_inventory "$stage"); cleanup_owned_tree "$stage" "$stage_identity_tuple" "$stage_inventory"; stage_created=false
cleanup_empty_container "$stage_container" "$stage_container_created" "$stage_container_identity_tuple"; stage_container_created=false
arm_owned_phase_failure SERVICE_USER_ACCESS post_move_pre_switch_cleanup
assert_service_user_candidate_access
arm_owned_phase_failure PRE_SWITCH restore
tmp=$(mktemp "$(dirname "$env")/.finance.env.next.XXXXXX"); cp --preserve=mode,ownership "$new_env" "$tmp"; mv -Tf "$tmp" "$env"
link="$current.next"; absent "$link"; ln -s "$release" "$link"; mv -Tf "$link" "$current"; systemctl restart "$service"
arm_owned_phase_failure CANDIDATE_VERIFY restore
verify_candidate_live
backup_tuple=$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$backup")
backup_identity_tuple=$(identity_tuple "$backup"); backup_inventory=$(tree_inventory "$backup")
backup_container_tuple=$(stat -Lc '%d:%i:%u:%g:%a:%h:%s:%F' "$backup_container"); backup_container_inventory=$(tree_inventory "$backup_container")
candidate_service_pid=$(systemctl show -p MainPID --value "$service")
candidate_service_restarts=$(systemctl show -p NRestarts --value "$service")
trap - EXIT
printf 'releaseContainer=%s\nreleaseContainerIdentityTuple=%s\nreleaseContainerEmptyTuple=%s\nreleaseContainerTuple=%s\nrelease=%s\nreleaseTuple=%s\nreleaseInventorySha256=%s\nstageParentTuple=%s\nbackupParentTuple=%s\nreleaseParentTuple=%s\nbackupContainer=%s\nbackupContainerIdentityTuple=%s\nbackupContainerTuple=%s\nbackupContainerInventorySha256=%s\nbackupTuple=%s\nbackupIdentityTuple=%s\nbackupInventorySha256=%s\ncandidateServicePid=%s\ncandidateServiceNRestarts=%s\n' "$release_container" "$release_container_identity_tuple" "$release_container_empty_tuple" "$release_container_tuple" "$release" "$release_tuple" "$release_inventory" "$(stat -Lc '%u:%g:%a:%h' "$(get '.paths.parents.stage.path')")" "$(stat -Lc '%u:%g:%a:%h' "$(get '.paths.parents.backup.path')")" "$(stat -Lc '%u:%g:%a:%h' "$(get '.paths.parents.release.path')")" "$backup_container" "$backup_container_identity_tuple" "$backup_container_tuple" "$backup_container_inventory" "$backup_tuple" "$backup_identity_tuple" "$backup_inventory" "$candidate_service_pid" "$candidate_service_restarts"
