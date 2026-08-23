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
app_name="YNX Browser Testnet Preview.app"
binary_relative="Contents/MacOS/YNXBrowserNative"
scheme_probe="ynxbrowser://com.ynxweb4.browser.macos/preinstall-resolution"

[[ "$mode" == "fixture" || "$mode" == "production" ]] || { echo "execution mode must be fixture or production" >&2; exit 65; }
[[ -n "$carrier" && -n "$carrier_sha" && -n "$target" && -n "$isolated_root" && -n "$isolated_root_parent" && -n "$isolated_root_parent_dev_inode" && -n "$isolated_root_parent_uid" && -n "$isolated_root_parent_gid" && -n "$isolated_root_parent_mode" && -n "$isolated_root_parent_nlink" && -n "$isolated_root_uid" && -n "$isolated_root_gid" && -n "$isolated_root_mode" && -n "$isolated_root_nlink" && -n "$candidate_binary_sha" && -n "$old_handler" && -n "$old_handler_dev_inode" && -n "$old_binary_sha" && -n "$receipt" ]] || { echo "exact preinstall binding missing" >&2; exit 65; }
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
fi

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
dev_inode() {
  if stat -f '%d:%i' "$1" >/dev/null 2>&1; then stat -f '%d:%i' "$1"; else stat -c '%d:%i' "$1"; fi
}
stat_uid() { if stat -f '%u' "$1" >/dev/null 2>&1; then stat -f '%u' "$1"; else stat -c '%u' "$1"; fi; }
stat_gid() { if stat -f '%g' "$1" >/dev/null 2>&1; then stat -f '%g' "$1"; else stat -c '%g' "$1"; fi; }
stat_mode() { if stat -f '%Lp' "$1" >/dev/null 2>&1; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi; }
stat_nlink() { if stat -f '%l' "$1" >/dev/null 2>&1; then stat -f '%l' "$1"; else stat -c '%h' "$1"; fi; }
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

verify_old_handler

if [[ "$action" == "forward" ]]; then
  verify_stat_tuple "$isolated_root_parent" "$isolated_root_parent_dev_inode" "$isolated_root_parent_uid" "$isolated_root_parent_gid" "$isolated_root_parent_mode" "$isolated_root_parent_nlink" "isolated root parent"
  [[ ! -e "$isolated_root" ]] || { echo "isolated root must be absent" >&2; exit 73; }
  [[ ! -e "$target" ]] || { echo "isolated target must be absent" >&2; exit 73; }
  [[ "$(sha256_file "$carrier")" == "$carrier_sha" ]] || { echo "carrier SHA mismatch" >&2; exit 65; }

  temp=$(mktemp -d "${TMPDIR:-/tmp}/ynx-browser-preinstall.XXXXXX")
  registered=false
  copied=false
  root_created=false
  isolated_root_dev_inode=""
  candidate_inode=""
  fail_closed_forward() {
    local code=$?
    trap - ERR
    if [[ "$registered" == "true" ]]; then unregister_candidate || true; fi
    register_app "$old_handler" || true
    if [[ "$copied" == "true" && -n "$candidate_inode" ]]; then delete_candidate_if_exact "$candidate_inode" || true; fi
    if [[ "$root_created" == "true" && -n "$isolated_root_dev_inode" ]]; then delete_isolated_root_if_exact_and_empty "$isolated_root_dev_inode" || true; fi
    /bin/rm -rf -- "$temp"
    exit "$code"
  }
  trap fail_closed_forward ERR

  ditto -x -k "$carrier" "$temp"
  source_app="$temp/$app_name"
  [[ -d "$source_app" ]] || { echo "carrier app missing" >&2; false; }
  [[ "$(sha256_file "$source_app/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "carrier binary mismatch" >&2; false; }
  /bin/mkdir -m "$isolated_root_mode" -- "$isolated_root"
  root_created=true
  isolated_root_dev_inode=$(dev_inode "$isolated_root")
  verify_stat_tuple "$isolated_root" "$isolated_root_dev_inode" "$isolated_root_uid" "$isolated_root_gid" "$isolated_root_mode" "$isolated_root_nlink" "isolated root"
  ditto "$source_app" "$target"
  copied=true
  candidate_inode=$(dev_inode "$target")
  [[ "$(sha256_file "$target/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "copied binary mismatch" >&2; false; }
  candidate_process_absent || { echo "candidate unexpectedly running" >&2; false; }
  register_app "$target"
  registered=true
  [[ "$(resolve_handler)" == "$target" ]] || { echo "candidate did not become handler" >&2; false; }
  verify_old_handler
  isolated_root_has_only_target || { echo "isolated root contains an unexpected entry" >&2; false; }
  printf 'target=%s\ncandidate_inode=%s\ncandidate_binary_sha256=%s\nisolated_root=%s\nisolated_root_created=true\nisolated_root_dev_inode=%s\nisolated_root_uid=%s\nisolated_root_gid=%s\nisolated_root_mode=%s\nisolated_root_nlink=%s\nold_handler=%s\nold_handler_dev_inode=%s\nold_binary_sha256=%s\n' \
    "$target" "$candidate_inode" "$candidate_binary_sha" "$isolated_root" "$isolated_root_dev_inode" "$isolated_root_uid" "$isolated_root_gid" "$isolated_root_mode" "$isolated_root_nlink" "$old_handler" "$old_handler_dev_inode" "$old_binary_sha" > "$receipt"
  trap - ERR
  /bin/rm -rf -- "$temp"
  exit 0
fi

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
[[ "$(resolve_handler)" == "$old_handler" ]] || { echo "old handler was not restored" >&2; exit 74; }
verify_old_handler
delete_candidate_if_exact "$candidate_inode"
delete_isolated_root_if_exact_and_empty "$isolated_root_dev_inode"
printf 'rollback=complete\nrestored_handler=%s\n' "$old_handler" >> "$receipt"
