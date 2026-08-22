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
candidate_binary_sha=${YNX_BROWSER_CANDIDATE_BINARY_SHA256:-}
old_handler=${YNX_BROWSER_OLD_HANDLER:-}
old_handler_dev_inode=${YNX_BROWSER_OLD_HANDLER_DEV_INODE:-}
old_binary_sha=${YNX_BROWSER_OLD_BINARY_SHA256:-}
receipt=${YNX_BROWSER_RECEIPT:-}
app_name="YNX Browser Testnet Preview.app"
binary_relative="Contents/MacOS/YNXBrowserNative"
scheme_probe="ynxbrowser://com.ynxweb4.browser.macos/preinstall-resolution"

[[ "$mode" == "fixture" || "$mode" == "production" ]] || { echo "execution mode must be fixture or production" >&2; exit 65; }
[[ -n "$carrier" && -n "$carrier_sha" && -n "$target" && -n "$candidate_binary_sha" && -n "$old_handler" && -n "$old_handler_dev_inode" && -n "$old_binary_sha" && -n "$receipt" ]] || { echo "exact preinstall binding missing" >&2; exit 65; }
[[ "$carrier_sha" =~ ^[0-9a-f]{64}$ && "$candidate_binary_sha" =~ ^[0-9a-f]{64}$ && "$old_binary_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid SHA binding" >&2; exit 65; }

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
  [[ ! -e "$target" ]] || { echo "isolated target must be absent" >&2; exit 73; }
  [[ "$(sha256_file "$carrier")" == "$carrier_sha" ]] || { echo "carrier SHA mismatch" >&2; exit 65; }

  temp=$(mktemp -d "${TMPDIR:-/tmp}/ynx-browser-preinstall.XXXXXX")
  registered=false
  copied=false
  candidate_inode=""
  fail_closed_forward() {
    local code=$?
    trap - ERR
    if [[ "$registered" == "true" ]]; then unregister_candidate || true; fi
    register_app "$old_handler" || true
    if [[ "$copied" == "true" && -n "$candidate_inode" ]]; then delete_candidate_if_exact "$candidate_inode" || true; fi
    /bin/rm -rf -- "$temp"
    exit "$code"
  }
  trap fail_closed_forward ERR

  ditto -x -k "$carrier" "$temp"
  source_app="$temp/$app_name"
  [[ -d "$source_app" ]] || { echo "carrier app missing" >&2; false; }
  [[ "$(sha256_file "$source_app/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "carrier binary mismatch" >&2; false; }
  mkdir -p "$(dirname "$target")"
  ditto "$source_app" "$target"
  copied=true
  candidate_inode=$(dev_inode "$target")
  [[ "$(sha256_file "$target/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "copied binary mismatch" >&2; false; }
  candidate_process_absent || { echo "candidate unexpectedly running" >&2; false; }
  register_app "$target"
  registered=true
  [[ "$(resolve_handler)" == "$target" ]] || { echo "candidate did not become handler" >&2; false; }
  verify_old_handler
  printf 'target=%s\ncandidate_inode=%s\ncandidate_binary_sha256=%s\nold_handler=%s\nold_handler_dev_inode=%s\nold_binary_sha256=%s\n' \
    "$target" "$candidate_inode" "$candidate_binary_sha" "$old_handler" "$old_handler_dev_inode" "$old_binary_sha" > "$receipt"
  trap - ERR
  /bin/rm -rf -- "$temp"
  exit 0
fi

[[ -f "$receipt" ]] || { echo "forward receipt missing" >&2; exit 66; }
receipt_target=$(awk -F= '$1=="target"{print substr($0,index($0,"=")+1)}' "$receipt")
candidate_inode=$(awk -F= '$1=="candidate_inode"{print $2}' "$receipt")
receipt_old=$(awk -F= '$1=="old_handler"{print substr($0,index($0,"=")+1)}' "$receipt")
[[ "$receipt_target" == "$target" && "$receipt_old" == "$old_handler" ]] || { echo "rollback receipt mismatch" >&2; exit 65; }
[[ -d "$target" && "$(dev_inode "$target")" == "$candidate_inode" ]] || { echo "candidate target identity changed" >&2; exit 65; }
[[ "$(sha256_file "$target/$binary_relative")" == "$candidate_binary_sha" ]] || { echo "candidate binary changed" >&2; exit 65; }
candidate_process_absent || { echo "candidate process exists; refusing rollback mutation" >&2; exit 75; }
unregister_candidate
register_app "$old_handler"
[[ "$(resolve_handler)" == "$old_handler" ]] || { echo "old handler was not restored" >&2; exit 74; }
verify_old_handler
delete_candidate_if_exact "$candidate_inode"
printf 'rollback=complete\nrestored_handler=%s\n' "$old_handler" >> "$receipt"
