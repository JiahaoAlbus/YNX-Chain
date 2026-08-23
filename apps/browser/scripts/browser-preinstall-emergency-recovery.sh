#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "recover" ]] || { echo "usage: browser-preinstall-emergency-recovery.sh recover" >&2; exit 64; }

mode=${YNX_BROWSER_EXECUTION_MODE:-}
target=${YNX_BROWSER_ISOLATED_TARGET:-}
isolated_root=${YNX_BROWSER_ISOLATED_ROOT:-}
isolated_root_parent=${YNX_BROWSER_ISOLATED_ROOT_PARENT:-}
parent_dev_inode=${YNX_BROWSER_RECOVERY_PARENT_DEV_INODE:-}
parent_uid=${YNX_BROWSER_RECOVERY_PARENT_UID:-}
parent_gid=${YNX_BROWSER_RECOVERY_PARENT_GID:-}
parent_mode=${YNX_BROWSER_RECOVERY_PARENT_MODE:-}
parent_nlink=${YNX_BROWSER_RECOVERY_PARENT_NLINK:-}
root_dev_inode=${YNX_BROWSER_RECOVERY_ROOT_DEV_INODE:-}
root_uid=${YNX_BROWSER_RECOVERY_ROOT_UID:-}
root_gid=${YNX_BROWSER_RECOVERY_ROOT_GID:-}
root_mode=${YNX_BROWSER_RECOVERY_ROOT_MODE:-}
root_nlink=${YNX_BROWSER_RECOVERY_ROOT_NLINK:-}
target_dev_inode=${YNX_BROWSER_RECOVERY_TARGET_DEV_INODE:-}
target_uid=${YNX_BROWSER_RECOVERY_TARGET_UID:-}
target_gid=${YNX_BROWSER_RECOVERY_TARGET_GID:-}
target_mode=${YNX_BROWSER_RECOVERY_TARGET_MODE:-}
target_nlink=${YNX_BROWSER_RECOVERY_TARGET_NLINK:-}
candidate_binary_sha=${YNX_BROWSER_CANDIDATE_BINARY_SHA256:-}
old_handler=${YNX_BROWSER_OLD_HANDLER:-}
old_handler_dev_inode=${YNX_BROWSER_OLD_HANDLER_DEV_INODE:-}
old_binary_sha=${YNX_BROWSER_OLD_BINARY_SHA256:-}
old_pid=${YNX_BROWSER_OLD_PID:-}
old_process_path=${YNX_BROWSER_OLD_PROCESS_PATH:-}
failed_journal=${YNX_BROWSER_FAILED_DIAGNOSTIC_JOURNAL:-}
failed_journal_sha=${YNX_BROWSER_FAILED_DIAGNOSTIC_SHA256:-}
p0232_journal=${YNX_BROWSER_P0232_DIAGNOSTIC_JOURNAL:-}
p0232_journal_sha=${YNX_BROWSER_P0232_DIAGNOSTIC_SHA256:-}
recovery_receipt=${YNX_BROWSER_RECOVERY_RECEIPT:-}
recovery_journal=${YNX_BROWSER_RECOVERY_DIAGNOSTIC_JOURNAL:-}
recovery_temp=${YNX_BROWSER_RECOVERY_DIAGNOSTIC_TEMP:-}
binary_relative="Contents/MacOS/YNXBrowserNative"
scheme_probe="ynxbrowser://com.ynxweb4.browser.macos/preinstall-recovery-resolution"

[[ "$mode" == "fixture" || "$mode" == "production" ]] || { echo "execution mode must be fixture or production" >&2; exit 65; }
for value in "$target" "$isolated_root" "$isolated_root_parent" "$parent_dev_inode" "$parent_uid" "$parent_gid" "$parent_mode" "$parent_nlink" "$root_dev_inode" "$root_uid" "$root_gid" "$root_mode" "$root_nlink" "$target_dev_inode" "$target_uid" "$target_gid" "$target_mode" "$target_nlink" "$candidate_binary_sha" "$old_handler" "$old_handler_dev_inode" "$old_binary_sha" "$old_pid" "$old_process_path" "$failed_journal" "$failed_journal_sha" "$p0232_journal" "$p0232_journal_sha" "$recovery_receipt" "$recovery_journal" "$recovery_temp"; do
  [[ -n "$value" ]] || { echo "exact emergency recovery binding missing" >&2; exit 65; }
done
[[ "$candidate_binary_sha" =~ ^[0-9a-f]{64}$ && "$old_binary_sha" =~ ^[0-9a-f]{64}$ && "$failed_journal_sha" =~ ^[0-9a-f]{64}$ && "$p0232_journal_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid SHA binding" >&2; exit 65; }
[[ "$(dirname "$target")" == "$isolated_root" && "$(dirname "$isolated_root")" == "$isolated_root_parent" ]] || { echo "recovery path relationship mismatch" >&2; exit 66; }

if [[ "$mode" == "production" ]]; then
  [[ "${YNX_BROWSER_RECOVERY_LEASE_AUTHORIZED:-}" == "P0_BROWSER_RECOVERY_SINGLE_USE" ]] || { echo "production recovery lease authorization missing" >&2; exit 77; }
  case "$target" in "$HOME/Applications/YNX Browser Isolated/"*.app) ;; *) echo "target outside frozen recovery root" >&2; exit 66 ;; esac
  [[ "$failed_journal" == "/private/tmp/ynx-browser-preinstall-p0233.diagnostic" ]] || { echo "failed journal path mismatch" >&2; exit 66; }
  case "$recovery_journal" in /private/tmp/ynx-browser-preinstall-p0234-recovery.diagnostic) ;; *) echo "recovery journal path mismatch" >&2; exit 66 ;; esac
  [[ "$recovery_temp" == "$recovery_journal.tmp" ]] || { echo "recovery journal temp mismatch" >&2; exit 66; }
fi

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
dev_inode() { if stat -f '%d:%i' "$1" >/dev/null 2>&1; then stat -f '%d:%i' "$1"; else stat -c '%d:%i' "$1"; fi; }
stat_uid() { if stat -f '%u' "$1" >/dev/null 2>&1; then stat -f '%u' "$1"; else stat -c '%u' "$1"; fi; }
stat_gid() { if stat -f '%g' "$1" >/dev/null 2>&1; then stat -f '%g' "$1"; else stat -c '%g' "$1"; fi; }
stat_mode() { if stat -f '%Lp' "$1" >/dev/null 2>&1; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi; }
stat_nlink() { if stat -f '%l' "$1" >/dev/null 2>&1; then stat -f '%l' "$1"; else stat -c '%h' "$1"; fi; }
stat_size() { if stat -f '%z' "$1" >/dev/null 2>&1; then stat -f '%z' "$1"; else stat -c '%s' "$1"; fi; }
stat_type() { if stat -f '%HT' "$1" >/dev/null 2>&1; then stat -f '%HT' "$1"; else stat -c '%F' "$1"; fi; }
stat_tuple_or_absent() { if [[ -e "$1" ]]; then printf '%s:%s:%s:%s:%s:%s:%s' "$(dev_inode "$1")" "$(stat_uid "$1")" "$(stat_gid "$1")" "$(stat_mode "$1")" "$(stat_nlink "$1")" "$(stat_size "$1")" "$(stat_type "$1")"; else printf ABSENT; fi; }
verify_tuple() {
  local path=$1 expected_dev_inode=$2 expected_uid=$3 expected_gid=$4 expected_mode=$5 expected_nlink=$6 label=$7
  [[ -d "$path" ]] || { echo "$label missing" >&2; return 1; }
  [[ "$(dev_inode "$path")" == "$expected_dev_inode" && "$(stat_uid "$path")" == "$expected_uid" && "$(stat_gid "$path")" == "$expected_gid" && "$(stat_mode "$path")" == "$expected_mode" && "$(stat_nlink "$path")" == "$expected_nlink" ]] || { echo "$label tuple changed" >&2; return 1; }
}
journal_value() { awk -F= -v key="$1" '$1==key{print substr($0,index($0,"=")+1)}' "$failed_journal"; }
resolve_handler() { if [[ "$mode" == fixture ]]; then "$YNX_BROWSER_FIXTURE_ROOT/resolve-handler" "$scheme_probe"; else swift "$(dirname "$0")/resolve-macos-handler.swift" "$scheme_probe"; fi; }
unregister_candidate() { if [[ "$mode" == fixture ]]; then "$YNX_BROWSER_FIXTURE_ROOT/lsregister" -u "$target"; else /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$target"; fi; }
candidate_process_absent() { if [[ "$mode" == fixture ]]; then "$YNX_BROWSER_FIXTURE_ROOT/process-absent" "$target/$binary_relative"; else ! pgrep -f -x "$target/$binary_relative" >/dev/null 2>&1; fi; }
old_process_exact() { if [[ "$mode" == fixture ]]; then [[ "$(cat "$YNX_BROWSER_FIXTURE_ROOT/old-pid")" == "$old_pid" ]]; else [[ "$(ps -p "$old_pid" -o comm= | sed 's/^[[:space:]]*//')" == "$old_process_path" ]]; fi; }
root_has_only_target() {
  [[ -d "$isolated_root" && -d "$target" ]] || return 1
  local entry count=0
  while IFS= read -r entry; do count=$((count+1)); [[ "$entry" == "$target" ]] || return 1; done < <(/usr/bin/find "$isolated_root" -mindepth 1 -maxdepth 1 -print)
  [[ "$count" == 1 ]]
}
recovery_write() {
  local stage=$1 status=$2 exit_code=$3
  umask 077
  printf 'schema=ynx-browser-preinstall-emergency-recovery/1\naction=recover\nstage=%s\nstatus=%s\nexit_code=%s\nfailed_journal_sha256=%s\nisolated_root_tuple=%s\ncandidate_target_tuple=%s\nresolved_handler=%s\nold_pid=%s\n' "$stage" "$status" "$exit_code" "$failed_journal_sha" "$(stat_tuple_or_absent "$isolated_root")" "$(stat_tuple_or_absent "$target")" "${resolved_handler:-}" "$old_pid" > "$recovery_temp"
  /bin/mv -f -- "$recovery_temp" "$recovery_journal"
}
checkpoint() {
  current_stage=$1
  recovery_write "$current_stage" RUNNING 0
  if [[ "$mode" == fixture && "${YNX_BROWSER_FIXTURE_RECOVERY_FAIL_STAGE:-}" == "$current_stage" ]]; then echo "fixture recovery failure at $current_stage" >&2; return 97; fi
}
fail_recovery() { local code=$?; trap - ERR; recovery_write "$current_stage" FAILED_CLOSED "$code" || true; exit "$code"; }

[[ ! -e "$recovery_receipt" && ! -e "$recovery_journal" && ! -e "$recovery_temp" ]] || { echo "recovery output paths must be absent" >&2; exit 73; }
current_stage=START
resolved_handler=""
trap fail_recovery ERR

checkpoint VERIFY_FROZEN_JOURNALS
[[ "$(sha256_file "$failed_journal")" == "$failed_journal_sha" && "$(sha256_file "$p0232_journal")" == "$p0232_journal_sha" ]] || { echo "frozen journal SHA changed" >&2; false; }
[[ "$(journal_value schema)" == "ynx-browser-preinstall-diagnostic/1" && "$(journal_value action)" == forward && "$(journal_value stage)" == SET_DEFAULT_HANDLER_CANDIDATE && "$(journal_value status)" == RUNNING && "$(journal_value cleanup_status)" == NOT_STARTED && "$(journal_value registered)" == true && "$(journal_value registration_attempted)" == true && "$(journal_value root_created)" == true && "$(journal_value copied)" == true ]] || { echo "failed journal semantic boundary mismatch" >&2; false; }
checkpoint VERIFY_EXACT_IDENTITIES
verify_tuple "$isolated_root_parent" "$parent_dev_inode" "$parent_uid" "$parent_gid" "$parent_mode" "$parent_nlink" "applications parent"
verify_tuple "$isolated_root" "$root_dev_inode" "$root_uid" "$root_gid" "$root_mode" "$root_nlink" "isolated root"
verify_tuple "$target" "$target_dev_inode" "$target_uid" "$target_gid" "$target_mode" "$target_nlink" "candidate target"
[[ "$(sha256_file "$target/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "candidate binary changed" >&2; false; }
[[ -d "$old_handler" && "$(dev_inode "$old_handler")" == "$old_handler_dev_inode" && "$(sha256_file "$old_handler/$binary_relative")" == "$old_binary_sha" ]] || { echo "old handler changed" >&2; false; }
root_has_only_target || { echo "isolated root substituted or non-empty" >&2; false; }
candidate_process_absent || { echo "candidate process exists" >&2; false; }
old_process_exact || { echo "old PID/path changed" >&2; false; }
checkpoint VERIFY_OLD_HANDLER_BEFORE
resolved_handler=$(resolve_handler)
[[ "$resolved_handler" == "$old_handler" ]] || { echo "default handler is not frozen old app" >&2; false; }
checkpoint UNREGISTER_CANDIDATE
unregister_candidate
checkpoint VERIFY_OLD_HANDLER_AFTER_UNREGISTER
resolved_handler=$(resolve_handler)
[[ "$resolved_handler" == "$old_handler" ]] || { echo "default handler changed after unregister" >&2; false; }
old_process_exact || { echo "old PID/path changed after unregister" >&2; false; }
checkpoint DELETE_EXACT_CANDIDATE
verify_tuple "$target" "$target_dev_inode" "$target_uid" "$target_gid" "$target_mode" "$target_nlink" "candidate target"
[[ "$(sha256_file "$target/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "candidate binary changed before deletion" >&2; false; }
candidate_process_absent || { echo "candidate process exists before deletion" >&2; false; }
/bin/rm -rf -- "$target"
checkpoint DELETE_EXACT_EMPTY_ROOT
[[ ! -e "$target" ]] || { echo "candidate deletion incomplete" >&2; false; }
verify_tuple "$isolated_root" "$root_dev_inode" "$root_uid" "$root_gid" "$root_mode" "2" "isolated root"
[[ -z "$(/usr/bin/find "$isolated_root" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "isolated root not empty" >&2; false; }
/bin/rmdir -- "$isolated_root"
checkpoint VERIFY_TERMINAL_BASELINE
[[ ! -e "$target" && ! -e "$isolated_root" ]] || { echo "recovery paths remain" >&2; false; }
resolved_handler=$(resolve_handler)
[[ "$resolved_handler" == "$old_handler" ]] || { echo "old handler terminal mismatch" >&2; false; }
old_process_exact || { echo "old PID/path terminal mismatch" >&2; false; }
[[ "$(sha256_file "$failed_journal")" == "$failed_journal_sha" && "$(sha256_file "$p0232_journal")" == "$p0232_journal_sha" ]] || { echo "retained journal changed" >&2; false; }
checkpoint WRITE_RECOVERY_RECEIPT
printf 'status=RECOVERED\nfailed_journal_sha256=%s\nrestored_handler=%s\nold_pid=%s\ntarget=ABSENT\nisolated_root=ABSENT\n' "$failed_journal_sha" "$old_handler" "$old_pid" > "$recovery_receipt"
recovery_write RECOVERY_COMPLETE SUCCESS 0
trap - ERR
