#!/usr/bin/env bash
set -euo pipefail

action=${1:-}
case "$action" in forward|rollback) ;;
  *) echo "usage: browser-preinstall-executor.sh forward|rollback" >&2; exit 64 ;;
esac

mode=${YNX_BROWSER_EXECUTION_MODE:-}
carrier=${YNX_BROWSER_CARRIER:-}
carrier_sha=${YNX_BROWSER_CARRIER_SHA256:-}
target=${YNX_BROWSER_ISOLATED_TARGET:-}
isolated_root=${YNX_BROWSER_ISOLATED_ROOT:-}
isolated_root_prewrite=${YNX_BROWSER_ISOLATED_ROOT_PREWRITE:-}
isolated_root_parent=${YNX_BROWSER_ISOLATED_ROOT_PARENT:-}
isolated_root_parent_dev_inode=${YNX_BROWSER_ISOLATED_ROOT_PARENT_DEV_INODE:-}
isolated_root_parent_uid=${YNX_BROWSER_ISOLATED_ROOT_PARENT_UID:-}
isolated_root_parent_gid=${YNX_BROWSER_ISOLATED_ROOT_PARENT_GID:-}
isolated_root_parent_mode=${YNX_BROWSER_ISOLATED_ROOT_PARENT_MODE:-}
isolated_root_parent_nlink=${YNX_BROWSER_ISOLATED_ROOT_PARENT_NLINK:-}
isolated_root_uid=${YNX_BROWSER_ISOLATED_ROOT_UID:-}
isolated_root_gid=${YNX_BROWSER_ISOLATED_ROOT_GID:-}
isolated_root_mode=${YNX_BROWSER_ISOLATED_ROOT_MODE:-}
isolated_root_nlink=${YNX_BROWSER_ISOLATED_ROOT_NLINK:-}
candidate_binary_sha=${YNX_BROWSER_CANDIDATE_BINARY_SHA256:-}
old_handler=${YNX_BROWSER_OLD_HANDLER:-}
old_handler_dev_inode=${YNX_BROWSER_OLD_HANDLER_DEV_INODE:-}
old_binary_sha=${YNX_BROWSER_OLD_BINARY_SHA256:-}
receipt=${YNX_BROWSER_RECEIPT:-}
diagnostic_journal=${YNX_BROWSER_DIAGNOSTIC_JOURNAL:-}
diagnostic_journal_temp=${YNX_BROWSER_DIAGNOSTIC_JOURNAL_TEMP:-}
app_name="YNX Browser Testnet Preview.app"
binary_relative="Contents/MacOS/YNXBrowserNative"
scheme_probe="ynxbrowser://com.ynxweb4.browser.macos/preinstall-resolution"

[[ "$mode" == "fixture" || "$mode" == "production" ]] || { echo "execution mode must be fixture or production" >&2; exit 65; }
[[ -n "$carrier" && -n "$carrier_sha" && -n "$target" && -n "$isolated_root" && -n "$isolated_root_parent" && -n "$isolated_root_parent_dev_inode" && -n "$isolated_root_parent_uid" && -n "$isolated_root_parent_gid" && -n "$isolated_root_parent_mode" && -n "$isolated_root_parent_nlink" && -n "$isolated_root_uid" && -n "$isolated_root_gid" && -n "$isolated_root_mode" && -n "$isolated_root_nlink" && -n "$candidate_binary_sha" && -n "$old_handler" && -n "$old_handler_dev_inode" && -n "$old_binary_sha" && -n "$receipt" && -n "$diagnostic_journal" && -n "$diagnostic_journal_temp" ]] || { echo "exact preinstall binding missing" >&2; exit 65; }
[[ "$carrier_sha" =~ ^[0-9a-f]{64}$ && "$candidate_binary_sha" =~ ^[0-9a-f]{64}$ && "$old_binary_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid SHA binding" >&2; exit 65; }
[[ "$isolated_root_prewrite" == "ABSENT_CREATE_ONE_DIRECTORY" ]] || { echo "isolated root creation authorization missing" >&2; exit 65; }
[[ "$(dirname "$target")" == "$isolated_root" ]] || { echo "candidate target is not a direct child of isolated root" >&2; exit 66; }
[[ "$(dirname "$isolated_root")" == "$isolated_root_parent" ]] || { echo "isolated root parent mismatch" >&2; exit 66; }

if [[ "$mode" == "production" ]]; then
  [[ "${YNX_BROWSER_LEASE_AUTHORIZED:-}" == "P0_BROWSER_SINGLE_USE" ]] || { echo "production lease authorization missing" >&2; exit 77; }
  case "$target" in
    "$HOME/Applications/YNX Browser Isolated/"*.app) ;;
    *) echo "isolated target is outside the frozen root" >&2; exit 66 ;;
  esac
  [[ "$old_handler" != "$target" ]] || { echo "old handler cannot be the candidate" >&2; exit 66; }
  case "$diagnostic_journal" in /private/tmp/ynx-browser-preinstall-*.diagnostic) ;; *) echo "diagnostic journal outside frozen root" >&2; exit 66 ;; esac
  [[ "$diagnostic_journal_temp" == "$diagnostic_journal.tmp" ]] || { echo "diagnostic journal temp mismatch" >&2; exit 66; }
fi

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
dev_inode() {
  if stat -f '%d:%i' "$1" >/dev/null 2>&1; then stat -f '%d:%i' "$1"; else stat -c '%d:%i' "$1"; fi
}
stat_uid() { if stat -f '%u' "$1" >/dev/null 2>&1; then stat -f '%u' "$1"; else stat -c '%u' "$1"; fi; }
stat_gid() { if stat -f '%g' "$1" >/dev/null 2>&1; then stat -f '%g' "$1"; else stat -c '%g' "$1"; fi; }
stat_mode() { if stat -f '%Lp' "$1" >/dev/null 2>&1; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi; }
stat_nlink() { if stat -f '%l' "$1" >/dev/null 2>&1; then stat -f '%l' "$1"; else stat -c '%h' "$1"; fi; }
stat_size() { if stat -f '%z' "$1" >/dev/null 2>&1; then stat -f '%z' "$1"; else stat -c '%s' "$1"; fi; }
stat_type() { if stat -f '%HT' "$1" >/dev/null 2>&1; then stat -f '%HT' "$1"; else stat -c '%F' "$1"; fi; }
stat_tuple_or_absent() {
  local path=$1
  if [[ -e "$path" ]]; then printf '%s:%s:%s:%s:%s:%s:%s' "$(dev_inode "$path")" "$(stat_uid "$path")" "$(stat_gid "$path")" "$(stat_mode "$path")" "$(stat_nlink "$path")" "$(stat_size "$path")" "$(stat_type "$path")";
  else printf 'ABSENT'; fi
}
journal_write() {
  local stage=$1 status=$2 exit_code=$3 failure_stage=$4 cleanup_status=$5
  umask 077
  printf 'schema=ynx-browser-preinstall-diagnostic/1\naction=forward\nstage=%s\nstatus=%s\nexit_code=%s\nfailure_stage=%s\ncleanup_status=%s\napplications_parent_tuple=%s\nisolated_root_tuple=%s\ncandidate_target_tuple=%s\nold_handler_tuple=%s\nresolved_handler=%s\nregistered=%s\nregistration_attempted=%s\nroot_created=%s\ncopied=%s\n' \
    "$stage" "$status" "$exit_code" "$failure_stage" "$cleanup_status" "$(stat_tuple_or_absent "$isolated_root_parent")" "$(stat_tuple_or_absent "$isolated_root")" "$(stat_tuple_or_absent "$target")" "$(stat_tuple_or_absent "$old_handler")" "${resolved_handler:-}" "${registered:-false}" "${registration_attempted:-false}" "${root_created:-false}" "${copied:-false}" > "$diagnostic_journal_temp"
  /bin/mv -f -- "$diagnostic_journal_temp" "$diagnostic_journal"
}
journal_checkpoint() {
  current_stage=$1
  journal_write "$current_stage" "RUNNING" 0 "" "NOT_STARTED"
  if [[ "$mode" == "fixture" && "${YNX_BROWSER_FIXTURE_FAIL_STAGE:-}" == "$current_stage" ]]; then
    echo "fixture failure at $current_stage" >&2
    return 97
  fi
}
verify_stat_tuple() {
  local path=$1 expected_dev_inode=$2 expected_uid=$3 expected_gid=$4 expected_mode=$5 expected_nlink=$6 label=$7
  [[ -d "$path" ]] || { echo "$label missing" >&2; return 1; }
  [[ "$(dev_inode "$path")" == "$expected_dev_inode" ]] || { echo "$label device/inode changed" >&2; return 1; }
  [[ "$(stat_uid "$path")" == "$expected_uid" ]] || { echo "$label owner changed" >&2; return 1; }
  [[ "$(stat_gid "$path")" == "$expected_gid" ]] || { echo "$label group changed" >&2; return 1; }
  [[ "$(stat_mode "$path")" == "$expected_mode" ]] || { echo "$label mode changed" >&2; return 1; }
  [[ "$(stat_nlink "$path")" == "$expected_nlink" ]] || { echo "$label link count changed" >&2; return 1; }
}
isolated_root_has_only_target() {
  [[ -d "$isolated_root" && -d "$target" ]] || return 1
  local entry count=0
  while IFS= read -r entry; do
    count=$((count + 1))
    [[ "$entry" == "$target" ]] || return 1
  done < <(/usr/bin/find "$isolated_root" -mindepth 1 -maxdepth 1 -print)
  [[ "$count" == "1" ]]
}
delete_isolated_root_if_exact_and_empty() {
  local expected_dev_inode=$1
  [[ -d "$isolated_root" ]] || return 0
  [[ "$(dev_inode "$isolated_root")" == "$expected_dev_inode" ]] || { echo "isolated root identity changed; refusing deletion" >&2; return 1; }
  [[ -z "$(/usr/bin/find "$isolated_root" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "isolated root is not empty; refusing deletion" >&2; return 1; }
  verify_stat_tuple "$isolated_root" "$expected_dev_inode" "$isolated_root_uid" "$isolated_root_gid" "$isolated_root_mode" "$isolated_root_nlink" "isolated root"
  /bin/rmdir -- "$isolated_root"
}
register_app() {
  local app=$1
  if [[ "$mode" == "fixture" ]]; then "$YNX_BROWSER_FIXTURE_ROOT/lsregister" -f "$app";
  else /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"; fi
}
set_default_handler() {
  local app=$1
  if [[ "$mode" == "fixture" ]]; then "$YNX_BROWSER_FIXTURE_ROOT/set-default-handler" "$app" "ynxbrowser";
  else swift "$(dirname "$0")/set-macos-default-handler.swift" set "$app" "ynxbrowser"; fi
}
unregister_candidate() {
  if [[ "$mode" == "fixture" ]]; then "$YNX_BROWSER_FIXTURE_ROOT/lsregister" -u "$target";
  else /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$target"; fi
}
resolve_handler() {
  if [[ "$mode" == "fixture" ]]; then "$YNX_BROWSER_FIXTURE_ROOT/resolve-handler" "$scheme_probe";
  else swift "$(dirname "$0")/resolve-macos-handler.swift" "$scheme_probe"; fi
}
candidate_process_absent() {
  local binary="$target/$binary_relative"
  if [[ "$mode" == "fixture" ]]; then "$YNX_BROWSER_FIXTURE_ROOT/process-absent" "$binary";
  else ! pgrep -f -x "$binary" >/dev/null 2>&1; fi
}
verify_old_handler() {
  [[ -d "$old_handler" ]] || { echo "old handler missing" >&2; return 1; }
  [[ "$(dev_inode "$old_handler")" == "$old_handler_dev_inode" ]] || { echo "old handler inode changed" >&2; return 1; }
  [[ "$(sha256_file "$old_handler/$binary_relative")" == "$old_binary_sha" ]] || { echo "old handler binary changed" >&2; return 1; }
}
delete_candidate_if_exact() {
  local expected_inode=$1
  [[ -d "$target" ]] || return 0
  [[ "$(dev_inode "$target")" == "$expected_inode" ]] || { echo "candidate inode changed; refusing deletion" >&2; return 1; }
  [[ "$(sha256_file "$target/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "candidate binary changed; refusing deletion" >&2; return 1; }
  candidate_process_absent || { echo "candidate process exists; refusing deletion" >&2; return 1; }
  /bin/rm -rf -- "$target"
}

if [[ "$action" == "forward" ]]; then
  [[ ! -e "$diagnostic_journal" && ! -e "$diagnostic_journal_temp" ]] || { echo "diagnostic journal paths must be absent" >&2; exit 73; }
  temp=""
  registered=false
  registration_attempted=false
  copied=false
  root_created=false
  isolated_root_dev_inode=""
  candidate_inode=""
  resolved_handler=""
  current_stage="START"
  fail_closed_forward() {
    local code=$?
    local failed_stage=$current_stage cleanup_status="COMPLETE" cleanup_resolved=""
    trap - ERR
    if [[ "$registration_attempted" == "true" ]]; then
      unregister_candidate || cleanup_status="INCOMPLETE"
      register_app "$old_handler" || cleanup_status="INCOMPLETE"
      set_default_handler "$old_handler" >/dev/null || cleanup_status="INCOMPLETE"
    fi
    if [[ "$copied" == "true" && -n "$candidate_inode" ]]; then delete_candidate_if_exact "$candidate_inode" || cleanup_status="INCOMPLETE"; fi
    if [[ "$root_created" == "true" && -n "$isolated_root_dev_inode" ]]; then delete_isolated_root_if_exact_and_empty "$isolated_root_dev_inode" || cleanup_status="INCOMPLETE"; fi
    if [[ "$registration_attempted" == "true" ]]; then
      cleanup_resolved=$(resolve_handler) || cleanup_status="INCOMPLETE"
      [[ "$cleanup_resolved" == "$old_handler" ]] || cleanup_status="INCOMPLETE"
    fi
    verify_old_handler || cleanup_status="INCOMPLETE"
    [[ ! -e "$target" && ! -e "$isolated_root" ]] || cleanup_status="INCOMPLETE"
    resolved_handler=$cleanup_resolved
    journal_write "$failed_stage" "FAILED_CLEANED" "$code" "$failed_stage" "$cleanup_status" || true
    if [[ -n "$temp" ]]; then /bin/rm -rf -- "$temp"; fi
    exit "$code"
  }
  trap fail_closed_forward ERR

  journal_checkpoint "VERIFY_OLD_HANDLER"
  verify_old_handler
  journal_checkpoint "VERIFY_ROOT_PARENT"
  verify_stat_tuple "$isolated_root_parent" "$isolated_root_parent_dev_inode" "$isolated_root_parent_uid" "$isolated_root_parent_gid" "$isolated_root_parent_mode" "$isolated_root_parent_nlink" "isolated root parent"
  journal_checkpoint "VERIFY_PREWRITE_ABSENCE"
  [[ ! -e "$isolated_root" ]] || { echo "isolated root must be absent" >&2; false; }
  [[ ! -e "$target" ]] || { echo "isolated target must be absent" >&2; false; }
  journal_checkpoint "VERIFY_CARRIER"
  [[ "$(sha256_file "$carrier")" == "$carrier_sha" ]] || { echo "carrier SHA mismatch" >&2; false; }
  journal_checkpoint "CREATE_TEMP_DIRECTORY"
  temp=$(mktemp -d "${TMPDIR:-/tmp}/ynx-browser-preinstall.XXXXXX")
  journal_checkpoint "EXTRACT_CARRIER"
  ditto -x -k "$carrier" "$temp"
  source_app="$temp/$app_name"
  journal_checkpoint "VERIFY_EXTRACTED_APP"
  [[ -d "$source_app" ]] || { echo "carrier app missing" >&2; false; }
  [[ "$(sha256_file "$source_app/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "carrier binary mismatch" >&2; false; }
  journal_checkpoint "CREATE_ISOLATED_ROOT"
  /bin/mkdir -m "$isolated_root_mode" -- "$isolated_root"
  root_created=true
  isolated_root_dev_inode=$(dev_inode "$isolated_root")
  verify_stat_tuple "$isolated_root" "$isolated_root_dev_inode" "$isolated_root_uid" "$isolated_root_gid" "$isolated_root_mode" "$isolated_root_nlink" "isolated root"
  journal_checkpoint "COPY_CANDIDATE"
  ditto "$source_app" "$target"
  copied=true
  candidate_inode=$(dev_inode "$target")
  journal_checkpoint "VERIFY_CANDIDATE"
  [[ "$(sha256_file "$target/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "copied binary mismatch" >&2; false; }
  candidate_process_absent || { echo "candidate unexpectedly running" >&2; false; }
  journal_checkpoint "REGISTER_CANDIDATE"
  registration_attempted=true
  register_app "$target"
  registered=true
  journal_checkpoint "SET_DEFAULT_HANDLER_CANDIDATE"
  set_default_handler "$target" >/dev/null
  journal_checkpoint "RESOLVE_CANDIDATE_HANDLER"
  resolved_handler=$(resolve_handler)
  [[ "$resolved_handler" == "$target" ]] || { echo "candidate did not become handler" >&2; false; }
  journal_checkpoint "VERIFY_OLD_HANDLER_POSTREGISTER"
  verify_old_handler
  journal_checkpoint "VERIFY_ROOT_EXCLUSIVE"
  isolated_root_has_only_target || { echo "isolated root contains an unexpected entry" >&2; false; }
  journal_checkpoint "WRITE_SUCCESS_RECEIPT"
  printf 'target=%s\ncandidate_inode=%s\ncandidate_binary_sha256=%s\nisolated_root=%s\nisolated_root_created=true\nisolated_root_dev_inode=%s\nisolated_root_uid=%s\nisolated_root_gid=%s\nisolated_root_mode=%s\nisolated_root_nlink=%s\nold_handler=%s\nold_handler_dev_inode=%s\nold_binary_sha256=%s\n' \
    "$target" "$candidate_inode" "$candidate_binary_sha" "$isolated_root" "$isolated_root_dev_inode" "$isolated_root_uid" "$isolated_root_gid" "$isolated_root_mode" "$isolated_root_nlink" "$old_handler" "$old_handler_dev_inode" "$old_binary_sha" > "$receipt"
  journal_write "FORWARD_COMPLETE" "SUCCESS" 0 "" "NOT_REQUIRED"
  trap - ERR
  /bin/rm -rf -- "$temp"
  exit 0
fi

verify_old_handler
[[ -f "$receipt" ]] || { echo "forward receipt missing" >&2; exit 66; }
receipt_target=$(awk -F= '$1=="target"{print substr($0,index($0,"=")+1)}' "$receipt")
candidate_inode=$(awk -F= '$1=="candidate_inode"{print $2}' "$receipt")
receipt_root=$(awk -F= '$1=="isolated_root"{print substr($0,index($0,"=")+1)}' "$receipt")
receipt_root_created=$(awk -F= '$1=="isolated_root_created"{print $2}' "$receipt")
isolated_root_dev_inode=$(awk -F= '$1=="isolated_root_dev_inode"{print $2}' "$receipt")
receipt_old=$(awk -F= '$1=="old_handler"{print substr($0,index($0,"=")+1)}' "$receipt")
[[ "$receipt_target" == "$target" && "$receipt_root" == "$isolated_root" && "$receipt_root_created" == "true" && "$receipt_old" == "$old_handler" ]] || { echo "rollback receipt mismatch" >&2; exit 65; }
[[ -d "$isolated_root" && "$(dev_inode "$isolated_root")" == "$isolated_root_dev_inode" ]] || { echo "isolated root identity changed" >&2; exit 65; }
isolated_root_has_only_target || { echo "isolated root is substituted or non-empty" >&2; exit 65; }
[[ -d "$target" && "$(dev_inode "$target")" == "$candidate_inode" ]] || { echo "candidate target identity changed" >&2; exit 65; }
[[ "$(sha256_file "$target/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "candidate binary changed" >&2; exit 65; }
candidate_process_absent || { echo "candidate process exists; refusing rollback mutation" >&2; exit 75; }
unregister_candidate
register_app "$old_handler"
set_default_handler "$old_handler" >/dev/null
[[ "$(resolve_handler)" == "$old_handler" ]] || { echo "old handler was not restored" >&2; exit 74; }
verify_old_handler
delete_candidate_if_exact "$candidate_inode"
delete_isolated_root_if_exact_and_empty "$isolated_root_dev_inode"
printf 'rollback=complete\nrestored_handler=%s\n' "$old_handler" >> "$receipt"
