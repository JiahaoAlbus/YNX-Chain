#!/usr/bin/env bash
set -Eeuo pipefail

action=${1:-}
case "$action" in takeover|restore-legacy) ;;
  *) echo "usage: video-runtime-controlled-takeover.sh takeover|restore-legacy" >&2; exit 64 ;;
esac

mode=${YNX_VIDEO_EXECUTION_MODE:-}
control=${YNX_VIDEO_FIXTURE_CONTROL:-}
legacy_unit=${YNX_VIDEO_LEGACY_UNIT:-}
dedicated_unit=${YNX_VIDEO_VIEWER_UNIT:-}
legacy_snapshot_expected=${YNX_VIDEO_LEGACY_SNAPSHOT_EXPECTED:-}
legacy_unit_path=${YNX_VIDEO_LEGACY_UNIT_PATH:-}
shared_current=${YNX_VIDEO_SHARED_CURRENT:-}
viewer_expected=${YNX_VIDEO_LEGACY_VIEWER_SHA256:-}
viewer_expected_bytes=${YNX_VIDEO_LEGACY_VIEWER_BYTES:-}
caddy_expected=${YNX_VIDEO_CADDY_SHA256:-}
receipt=${YNX_VIDEO_TAKEOVER_RECEIPT:-}
receipt_parent=${YNX_VIDEO_RECEIPT_PARENT:-}
receipt_container=${YNX_VIDEO_RECEIPT_CONTAINER:-}
receipt_container_expected=${YNX_VIDEO_RECEIPT_CONTAINER_EXPECTED:-}
receipt_uid=${YNX_VIDEO_RECEIPT_UID:-}
receipt_gid=${YNX_VIDEO_RECEIPT_GID:-}
receipt_mode=${YNX_VIDEO_RECEIPT_MODE:-}
bootstrap=${YNX_VIDEO_BOOTSTRAP_SCRIPT:-}
bootstrap_receipt=${YNX_VIDEO_BOOTSTRAP_RECEIPT:-}
dedicated_root=${YNX_VIDEO_VIEWER_ROOT:-}
dedicated_unit_path=${YNX_VIDEO_VIEWER_UNIT_PATH:-}
lock_path=${YNX_VIDEO_TAKEOVER_LOCK:-/run/lock/ynx-video-viewer-wallet-takeover.lock}
retained_parent=${YNX_VIDEO_RETAINED_EVIDENCE_PARENT:-}
retained_identity=${YNX_VIDEO_RETAINED_EVIDENCE_IDENTITY:-}
retained_inventory=${YNX_VIDEO_RETAINED_EVIDENCE_INVENTORY:-}
retained_inventory_sha=${YNX_VIDEO_RETAINED_EVIDENCE_INVENTORY_SHA256:-}
retained_guard=${YNX_VIDEO_RETAINED_EVIDENCE_GUARD:-}
retained_guard_sha=${YNX_VIDEO_RETAINED_EVIDENCE_GUARD_SHA256:-}

[[ "$mode" == fixture || "$mode" == production ]] || { echo "execution mode must be fixture or production" >&2; exit 65; }
[[ "$legacy_unit" == ynx-video-viewer.service ]] || { echo "legacy unit mismatch" >&2; exit 65; }
[[ "$dedicated_unit" == ynx-video-viewer-wallet.service ]] || { echo "dedicated unit mismatch" >&2; exit 65; }
[[ "$legacy_unit_path" == /etc/systemd/system/ynx-video-viewer.service || "$mode" == fixture ]] || { echo "legacy unit path mismatch" >&2; exit 65; }
[[ "$shared_current" == /opt/ynx-video/current || "$mode" == fixture ]] || { echo "shared current mismatch" >&2; exit 65; }
[[ -n "$legacy_snapshot_expected" && -f "$legacy_snapshot_expected" && -n "$viewer_expected" && -n "$viewer_expected_bytes" && -n "$caddy_expected" && -n "$receipt" && -x "$bootstrap" && -n "$bootstrap_receipt" && -n "$dedicated_root" && -n "$dedicated_unit_path" && -n "$receipt_parent" && -n "$receipt_container" && -n "$receipt_container_expected" && -n "$receipt_uid" && -n "$receipt_gid" && -n "$receipt_mode" && -n "$retained_parent" && -n "$retained_identity" && -f "$retained_inventory" && -n "$retained_inventory_sha" && -f "$retained_guard" && -n "$retained_guard_sha" ]] || { echo "controlled takeover binding missing" >&2; exit 65; }
[[ "$(dirname "$receipt")" == "$receipt_parent" && "$(dirname "$bootstrap_receipt")" == "$receipt_parent" ]] || { echo "receipt parent mismatch" >&2; exit 65; }
for binding in API_ROOT API_HEALTH API_VERSION CREATOR_ROOT CREATOR_MANIFEST CREATOR_CATALOG; do
  eval "binding_sha=\${YNX_VIDEO_${binding}_SHA256:-}"
  eval "binding_bytes=\${YNX_VIDEO_${binding}_BYTES:-}"
  [[ -n "$binding_sha" && -n "$binding_bytes" ]] || { echo "missing ${binding} binding" >&2; exit 65; }
done
if [[ "$action" == takeover ]]; then
  [[ ! -e "$receipt" ]] || { echo "takeover receipt must be absent" >&2; exit 73; }
fi

if [[ "$mode" == production ]]; then
  [[ "${YNX_VIDEO_LEASE_AUTHORIZED:-}" == P0_VIDEO_CONTROLLED_TAKEOVER_SINGLE_USE ]] || { echo "production takeover lease missing" >&2; exit 77; }
  [[ "$receipt_parent" == /var/lib/ynx-video-viewer-wallet-evidence-560c467d && "$receipt_container" == /var/lib && "$receipt_uid" == 0 && "$receipt_gid" == 0 && "$receipt_mode" == 755 ]] || { echo "production receipt directory binding mismatch" >&2; exit 77; }
  [[ "$retained_parent" == /var/lib/ynx-video-viewer-wallet-evidence && "$retained_identity" == /var/lib/ynx-video-viewer-wallet-evidence.identity ]] || { echo "production retained evidence binding mismatch" >&2; exit 77; }
else
  [[ -n "$control" && -x "$control/systemctl" && -x "$control/legacy-snapshot" && -x "$control/curl" && -x "$control/caddy-snapshot" && -x "$control/port-6494-free" ]] || { echo "fixture control missing" >&2; exit 65; }
fi

sha_stream() { shasum -a 256 | awk '{print $1}'; }
sha_file() { shasum -a 256 "$1" | awk '{print $1}'; }
assert_retained_evidence() {
  [[ "$(sha_file "$retained_inventory")" == "$retained_inventory_sha" ]] || { echo "retained inventory source mismatch" >&2; return 76; }
  [[ "$(sha_file "$retained_guard")" == "$retained_guard_sha" ]] || { echo "retained guard source mismatch" >&2; return 76; }
  if [[ "$mode" == fixture ]]; then
    node "$retained_guard" "$retained_inventory" --fixture-paths >/dev/null
  else
    node "$retained_guard" "$retained_inventory" >/dev/null
  fi
}
stat_tuple() {
  if stat -c '%d:%i:%u:%g:%a:%h' "$1" >/dev/null 2>&1; then stat -c '%d:%i:%u:%g:%a:%h' "$1"; else stat -f '%d:%i:%u:%g:%Lp:%l' "$1"; fi
}
systemctl_exact() { if [[ "$mode" == fixture ]]; then "$control/systemctl" "$@"; else systemctl "$@"; fi; }
probe() {
  local role=$1
  local url
  case "$role" in
    viewer) url=http://127.0.0.1:6494/ ;;
    api-root) url=http://127.0.0.1:6493/ ;;
    api-health) url=http://127.0.0.1:6493/health ;;
    api-version) url=http://127.0.0.1:6493/version ;;
    creator-root) url=http://127.0.0.1:6495/ ;;
    creator-manifest) url=http://127.0.0.1:6495/creator-studio.manifest.json ;;
    creator-catalog) url=http://127.0.0.1:6495/i18n/catalog.json ;;
    *) return 64 ;;
  esac
  if [[ "$mode" == fixture ]]; then
    "$control/curl" "$url"
  elif [[ "$role" == api-root ]]; then
    curl --silent --show-error --max-time 5 "$url"
  else
    curl --fail --silent --show-error --max-time 5 "$url"
  fi
}
legacy_snapshot() {
  if [[ "$mode" == fixture ]]; then "$control/legacy-snapshot"; else
    local pid
    pid=$(systemctl show "$legacy_unit" --property MainPID --value)
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
    printf 'load_state=%s\n' "$(systemctl show "$legacy_unit" --property LoadState --value)"
    printf 'active_state=%s\n' "$(systemctl show "$legacy_unit" --property ActiveState --value)"
    printf 'sub_state=%s\n' "$(systemctl show "$legacy_unit" --property SubState --value)"
    printf 'fragment_path=%s\n' "$(systemctl show "$legacy_unit" --property FragmentPath --value)"
    printf 'exec_start=%s\n' "$(awk -F= '$1=="ExecStart"{print substr($0,index($0,"=")+1); exit}' "$legacy_unit_path")"
    printf 'main_pid=%s\n' "$pid"
    printf 'nrestarts=%s\n' "$(systemctl show "$legacy_unit" --property NRestarts --value)"
    printf 'unit_file_state=%s\n' "$(systemctl show "$legacy_unit" --property UnitFileState --value)"
    printf 'pid_exe=%s\n' "$(readlink -f "/proc/$pid/exe")"
    printf 'pid_cwd=%s\n' "$(readlink -f "/proc/$pid/cwd")"
    printf 'pid_cmdline_sha256=%s\n' "$(tr '\0' '\n' < "/proc/$pid/cmdline" | sha_stream)"
    printf 'pid_starttime=%s\n' "$(awk '{print $22}' "/proc/$pid/stat")"
    printf 'legacy_unit_tuple=%s\n' "$(stat -c '%d:%i:%u:%g:%a:%h:%s:%F' "$legacy_unit_path")"
    printf 'legacy_unit_sha256=%s\n' "$(sha_file "$legacy_unit_path")"
    printf 'shared_current_target=%s\n' "$(readlink "$shared_current")"
    printf 'shared_current_lstat=%s\n' "$(stat -c '%d:%i:%u:%g:%a:%h:%s:%F' "$shared_current")"
  fi
}
caddy_snapshot() {
  if [[ "$mode" == fixture ]]; then "$control/caddy-snapshot"; else
    [[ -n "${YNX_VIDEO_CADDY_FILE:-}" && -f "${YNX_VIDEO_CADDY_FILE:-}" ]] || return 1
    sha_file "$YNX_VIDEO_CADDY_FILE"
  fi
}
port_free() {
  if [[ "$mode" == fixture ]]; then "$control/port-6494-free"; else ! ss -H -ltn 'sport = :6494' | grep -q .; fi
}
assert_hashes() {
  local expected_viewer=$1
  [[ "$(probe viewer | tee "${receipt}.viewer.tmp" | wc -c | tr -d ' ')" == "$viewer_expected_bytes" ]] || return 1
  [[ "$(sha_file "${receipt}.viewer.tmp")" == "$expected_viewer" ]] || return 1
  rm -f -- "${receipt}.viewer.tmp"
  local role upper expected_sha expected_bytes body
  for role in api-root api-health api-version creator-root creator-manifest creator-catalog; do
    upper=$(printf '%s' "$role" | tr '[:lower:]-' '[:upper:]_')
    eval "expected_sha=\${YNX_VIDEO_${upper}_SHA256}"
    eval "expected_bytes=\${YNX_VIDEO_${upper}_BYTES}"
    body="${receipt}.${role}.tmp"
    probe "$role" > "$body"
    [[ "$(wc -c < "$body" | tr -d ' ')" == "$expected_bytes" && "$(sha_file "$body")" == "$expected_sha" ]] || return 1
    rm -f -- "$body"
  done
  [[ "$(caddy_snapshot)" == "$caddy_expected" ]] || return 1
}
assert_legacy_exact() {
  cmp -s "$legacy_snapshot_expected" <(legacy_snapshot) || { echo "legacy runtime identity mismatch" >&2; return 1; }
}
assert_legacy_successor() {
  local actual=${receipt}.legacy.successor
  legacy_snapshot > "$actual"
  # A restarted process must have a new PID/start time; every durable identity line must remain exact.
  grep -vE '^(main_pid|pid_starttime|nrestarts)=' "$legacy_snapshot_expected" > "${actual}.expected"
  grep -vE '^(main_pid|pid_starttime|nrestarts)=' "$actual" > "${actual}.stable"
  cmp -s "${actual}.expected" "${actual}.stable" || { echo "legacy successor identity mismatch" >&2; return 1; }
  old_pid=$(awk -F= '$1=="main_pid"{print $2}' "$legacy_snapshot_expected")
  new_pid=$(awk -F= '$1=="main_pid"{print $2}' "$actual")
  [[ "$new_pid" =~ ^[1-9][0-9]*$ && "$new_pid" != "$old_pid" ]] || { echo "legacy successor PID was not replaced" >&2; return 1; }
  rm -f -- "$actual" "${actual}.expected" "${actual}.stable"
  assert_hashes "$viewer_expected"
}

parent_identity_file="${receipt_parent}.identity"
receipt_parent_identity=""
parent_created=false
assert_receipt_container() { [[ "$(stat_tuple "$receipt_container")" == "$receipt_container_expected" ]]; }
create_receipt_parent() {
  assert_receipt_container || { echo "receipt container identity mismatch" >&2; return 76; }
  [[ ! -e "$receipt_parent" && ! -L "$receipt_parent" && ! -e "$parent_identity_file" && ! -L "$parent_identity_file" ]] || { echo "receipt parent must be absent" >&2; return 73; }
  mkdir "$receipt_parent"
  parent_created=true
  chmod "$receipt_mode" "$receipt_parent"
  if [[ "$mode" == production ]]; then chown "$receipt_uid:$receipt_gid" "$receipt_parent"; fi
  receipt_parent_identity=$(stat_tuple "$receipt_parent")
  [[ "$(printf '%s' "$receipt_parent_identity" | awk -F: '{print $3":"$4":"$5":"$6}')" == "$receipt_uid:$receipt_gid:$receipt_mode:2" ]] || { echo "created receipt parent metadata mismatch" >&2; return 76; }
  printf '%s\n' "$receipt_parent_identity" > "$parent_identity_file"
  if [[ "$mode" == production ]]; then chown "$receipt_uid:$receipt_gid" "$parent_identity_file"; fi
  chmod 0600 "$parent_identity_file"
}
load_receipt_parent() {
  [[ -d "$receipt_parent" && ! -L "$receipt_parent" && -f "$parent_identity_file" && ! -L "$parent_identity_file" ]] || return 76
  receipt_parent_identity=$(cat "$parent_identity_file")
  [[ "$(stat_tuple "$receipt_parent" | cut -d: -f1-5)" == "$(printf '%s' "$receipt_parent_identity" | cut -d: -f1-5)" ]] || return 76
  parent_created=true
}
cleanup_receipt_parent() {
  [[ "$parent_created" == true ]] || return 0
  [[ -d "$receipt_parent" && ! -L "$receipt_parent" && "$(stat_tuple "$receipt_parent" | cut -d: -f1-5)" == "$(printf '%s' "$receipt_parent_identity" | cut -d: -f1-5)" ]] || { echo "receipt parent substituted; refusing cleanup" >&2; return 76; }
  local entry tuple
  local -a entries=()
  while IFS= read -r entry; do
    case "$entry" in
      "$receipt"|"${receipt}.complete"|"${receipt}.legacy.actual"|"${receipt}.legacy.successor"|"${receipt}.legacy.successor.expected"|"${receipt}.legacy.successor.stable"|"${receipt}.viewer.tmp"|"${receipt}.api-root.tmp"|"${receipt}.api-health.tmp"|"${receipt}.api-version.tmp"|"${receipt}.creator-root.tmp"|"${receipt}.creator-manifest.tmp"|"${receipt}.creator-catalog.tmp"|"$bootstrap_receipt") ;;
      *) echo "unexpected receipt sibling; refusing cleanup" >&2; return 76 ;;
    esac
    [[ -f "$entry" && ! -L "$entry" ]] || { echo "receipt entry type mismatch" >&2; return 76; }
    tuple=$(stat_tuple "$entry")
    [[ "$(printf '%s' "$tuple" | awk -F: '{print $3":"$4":"$6}')" == "$receipt_uid:$receipt_gid:1" ]] || { echo "receipt entry identity mismatch" >&2; return 76; }
    entries+=("$entry")
  done < <(find "$receipt_parent" -mindepth 1 -maxdepth 1 -print)
  if ((${#entries[@]})); then rm -f -- "${entries[@]}"; fi
  [[ -z "$(find "$receipt_parent" -mindepth 1 -maxdepth 1 -print -quit)" ]] || return 76
  [[ "$(stat_tuple "$receipt_parent")" == "$receipt_parent_identity" ]] || { echo "empty receipt parent identity mismatch" >&2; return 76; }
  rmdir "$receipt_parent"
  [[ ! -e "$receipt_parent" && ! -L "$receipt_parent" ]] || return 76
  if [[ -e "$parent_identity_file" || -L "$parent_identity_file" ]]; then
    [[ -f "$parent_identity_file" && ! -L "$parent_identity_file" ]] || return 76
    rm -f -- "$parent_identity_file"
  fi
  assert_receipt_container
  parent_created=false
}

mkdir -p "$(dirname "$lock_path")"
lock_dir="${lock_path}.d"
mkdir "$lock_dir" 2>/dev/null || { echo "controlled takeover already in progress" >&2; exit 75; }
release_lock() { rmdir "$lock_dir" 2>/dev/null || true; }
trap release_lock EXIT

restore_legacy() {
  set +e
  if [[ -f "$bootstrap_receipt" ]]; then
    env YNX_VIDEO_LEASE_AUTHORIZED=P0_VIDEO_BOOTSTRAP_SINGLE_USE "$bootstrap" rollback-bootstrap
    bootstrap_code=$?
  elif [[ ! -e "$dedicated_root" && ! -L "$dedicated_root" && ! -e "$dedicated_unit_path" && ! -L "$dedicated_unit_path" ]]; then
    bootstrap_code=0
  else
    bootstrap_code=76
  fi
  systemctl_exact start "$legacy_unit"
  start_code=$?
  set -e
  [[ "$bootstrap_code" == 0 && "$start_code" == 0 ]] || return 1
  assert_legacy_successor
}

if [[ "$action" == restore-legacy ]]; then
  assert_retained_evidence
  load_receipt_parent || { echo "receipt parent identity unavailable" >&2; exit 76; }
  [[ -f "${receipt}.complete" ]] || { echo "completed takeover receipt missing" >&2; exit 66; }
  restore_legacy
  assert_retained_evidence
  printf 'restored_legacy=true\n' >> "${receipt}.complete"
  cleanup_receipt_parent
  exit 0
fi

legacy_stopped=false
takeover_failed() {
  local code=$?
  trap - ERR INT TERM
  if [[ "$legacy_stopped" == true ]]; then
    restore_legacy || { echo "FATAL: legacy recovery verification failed" >&2; exit 78; }
    printf 'failure_recovered_legacy=true\nfailure_code=%s\n' "$code" >> "$receipt"
  fi
  cleanup_receipt_parent || { echo "FATAL: receipt parent cleanup refused" >&2; exit 78; }
  exit "$code"
}
trap takeover_failed ERR INT TERM

assert_legacy_exact
assert_retained_evidence
if [[ "$mode" == fixture && -n "${YNX_VIDEO_FIXTURE_POST_RETAINED_VALIDATION_HOOK:-}" ]]; then
  "${YNX_VIDEO_FIXTURE_POST_RETAINED_VALIDATION_HOOK}"
fi
assert_retained_evidence
create_receipt_parent
assert_hashes "$viewer_expected"
[[ ! -e "$receipt" ]] || exit 73
cp "$legacy_snapshot_expected" "$receipt"
if [[ "$mode" == production ]]; then chown "$receipt_uid:$receipt_gid" "$receipt"; fi
chmod 0600 "$receipt"
printf 'receipt_parent_identity=%s\nviewer_sha256=%s\nviewer_bytes=%s\ncaddy_sha256=%s\nlegacy_stop_started=false\n' \
  "$receipt_parent_identity" "$viewer_expected" "$viewer_expected_bytes" "$caddy_expected" >> "$receipt"

assert_retained_evidence
systemctl_exact stop "$legacy_unit"
legacy_stopped=true
printf 'legacy_stop_started=true\n' >> "$receipt"
if systemctl_exact is-active --quiet "$legacy_unit"; then
  echo "legacy unit remained active" >&2
  false
fi
if ! port_free; then
  echo "6494 remained occupied after legacy stop" >&2
  false
fi

env YNX_VIDEO_LEASE_AUTHORIZED=P0_VIDEO_BOOTSTRAP_SINGLE_USE "$bootstrap" bootstrap
assert_hashes "$viewer_expected"
systemctl_exact is-active --quiet "$dedicated_unit"
cp "$receipt" "${receipt}.complete"
printf 'controlled_takeover_complete=true\n' >> "${receipt}.complete"
assert_retained_evidence
trap - ERR INT TERM
