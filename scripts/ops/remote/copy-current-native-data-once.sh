#!/usr/bin/env bash
# Current-primary DATA copy only. Run inside the original bounded private unit.
# This adapter grants no authority and never starts/stops/changes a node.
set -Eeuo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C
unset BASH_ENV ENV CDPATH LD_PRELOAD LD_LIBRARY_PATH
case_reserved=false
bad() {
  if [[ $case_reserved == true && -n ${case_dir:-} && -d $case_dir && ! -e $case_dir/first-cause ]]; then
    (set -C; printf '%s\n' "$1" > "$case_dir/first-cause") || true
  fi
  printf 'YNX_CURRENT_NATIVE_COPY_REFUSED:%s\n' "$1" >&2
  exit 1
}
# Original3716-byte ROFD function, byte-for-byte. Primary995:986/marker2 only.
# BEGIN YNX_NATIVE_READONLY_FD_COPY
ynx_native_copy_readonly_fd() {
  [[ $# == 4 && $EUID == 0 ]] || bad readonly-copy-requires-four-original-inputs-and-root
  local source=$1 marker=$2 case_dir=$3 expected_bytes=$4 source_dir
  local source_before marker_before dir_before source_sha copy_marker_sha
  source_dir=${source%/*}
  [[ $expected_bytes =~ ^[1-9][0-9]{0,9}$ ]] && (( expected_bytes <= 1073741824 )) || bad independently-observed-bounded-source-size-required
  [[ $(realpath -e -- "$case_dir") == "$case_dir" && -d $case_dir && ! -L $case_dir &&
     $(stat -c '%u:%a' -- "$case_dir") == 0:700 ]] || bad original-private-case-required
  identity() { stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$1"; }
  fdidentity() { stat -Lc '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "/proc/$BASHPID/fd/$1"; }
  [[ $(realpath -e -- "$source") == "$source" && $(realpath -e -- "$marker") == "$marker" &&
     $(realpath -e -- "$source_dir") == "$source_dir" && -f $source && -f $marker && ! -L $source && ! -L $marker &&
     $(stat -c '%a' -- "$source_dir") == 755 &&
     $(stat -c '%u:%g:%a:%h:%s' -- "$source") == "995:986:600:1:$expected_bytes" &&
     $(stat -c '%u:%a:%h:%s' -- "$marker") == 995:600:1:2 ]] || bad original-source-metadata-mismatch
  # An independent sibling temporary file is neither read nor used as state.
  # Only these final paths and their already-open read-only FDs may be copied.
  source_before=$(identity "$source"); marker_before=$(identity "$marker")
  dir_before=$(stat -c '%d:%i:%f:%u:%g' -- "$source_dir")
  exec 3<"$source"; exec 4<"$marker"
  [[ $(fdidentity 3) == "$source_before" && $(fdidentity 4) == "$marker_before" &&
     $(identity "$source") == "$source_before" && $(identity "$marker") == "$marker_before" ]] || bad original-changed-while-opening-readonly-FD
  printf '%s\n' "$source_before" > "$case_dir/source.before"
  printf '%s\n' "$marker_before" > "$case_dir/marker.before"
  mkdir -m 0700 -- "$case_dir/data-verified" "$case_dir/logs" || bad original-copy-output-or-partial-already-exists
  set -C
  head -c "$expected_bytes" <&3 > "$case_dir/data-verified/devnet-state.json" || bad original-readonly-source-copy-failed
  head -c 2 <&4 > "$case_dir/data-verified/devnet-state.integrity-version" || bad original-readonly-marker-copy-failed
  set +C
  [[ $(stat -c '%s:%a:%u:%g:%h' -- "$case_dir/data-verified/devnet-state.json") == "$expected_bytes:600:0:0:1" &&
     $(stat -c '%s:%a:%u:%g:%h' -- "$case_dir/data-verified/devnet-state.integrity-version") == 2:600:0:0:1 ]] || bad truncated-or-unsafe-copy
  source_sha=$(sha256sum "/proc/$BASHPID/fd/3"); source_sha=${source_sha%% *}
  marker_sha=$(sha256sum "/proc/$BASHPID/fd/4"); marker_sha=${marker_sha%% *}
  copy_sha=$(sha256sum "$case_dir/data-verified/devnet-state.json"); copy_sha=${copy_sha%% *}
  copy_marker_sha=$(sha256sum "$case_dir/data-verified/devnet-state.integrity-version"); copy_marker_sha=${copy_marker_sha%% *}
  [[ $source_sha == "$copy_sha" && $marker_sha == "$copy_marker_sha" &&
     $marker_sha == 53c234e5e8472b6ac51c1ae1cab3fe06fad053beb8ebfd8977b010655bfdd3c3 &&
     $(od -An -tx1 -- "$case_dir/data-verified/devnet-state.integrity-version" | tr -d ' \n') == 320a &&
     $(fdidentity 3) == "$source_before" && $(fdidentity 4) == "$marker_before" &&
     $(identity "$source") == "$source_before" && $(identity "$marker") == "$marker_before" &&
     $(stat -c '%d:%i:%f:%u:%g' -- "$source_dir") == "$dir_before" ]] || bad source-FD-path-or-full-copy-SHA-changed
  exec 3<&-; exec 4<&-
  printf 'sourceSHA256=%s\ncopySHA256=%s\nmarkerSHA256=%s\nsourceBytes=%s\nclassification=DATA\nauthoritativeFinalCheckpoint=false\nliveSourceNotPaused=true\n' "$source_sha" "$copy_sha" "$marker_sha" "$expected_bytes" > "$case_dir/copy-receipt"
}
# END YNX_NATIVE_READONLY_FD_COPY

if [[ ${BASH_SOURCE[0]} != "$0" ]]; then return 0; fi
if [[ $# == 0 ]]; then
  printf '%s\n' 'CURRENT_PRIMARY_DATA_ONLY source=/var/lib/ynx-chain/testnet/devnet-state.json freshBytesRequired=true source<=1073741824 liveSourceNotPaused=true authoritativeFinalCheckpoint=false exported=false noAutomaticRetry=true'
  exit 0
fi
mode= case_dir= expected_bytes= native_pid= native_start= native_sha= owned_unit= confirmed=
while [[ $# != 0 ]]; do
  case "$1" in
    --prepare|--execute) [[ -z $mode ]] || bad duplicate-mode; mode=$1; shift ;;
    --case-dir|--source-bytes|--native-pid|--native-start-ticks|--native-exe-sha256|--owned-unit|--confirmed-script-sha256)
      [[ $# -ge 2 ]] || bad missing-value
      case "$1" in
        --case-dir) [[ -z $case_dir ]] || bad duplicate; case_dir=$2 ;;
        --source-bytes) [[ -z $expected_bytes ]] || bad duplicate; expected_bytes=$2 ;;
        --native-pid) [[ -z $native_pid ]] || bad duplicate; native_pid=$2 ;;
        --native-start-ticks) [[ -z $native_start ]] || bad duplicate; native_start=$2 ;;
        --native-exe-sha256) [[ -z $native_sha ]] || bad duplicate; native_sha=$2 ;;
        --owned-unit) [[ -z $owned_unit ]] || bad duplicate; owned_unit=$2 ;;
        --confirmed-script-sha256) [[ -z $confirmed ]] || bad duplicate; confirmed=$2 ;;
      esac
      shift 2 ;;
    *) bad unknown-option ;;
  esac
done
[[ $mode == --prepare || $mode == --execute ]] || bad explicit-mode-required
[[ $case_dir =~ ^/var/tmp/ynx-pq-current-native-[A-Za-z0-9][A-Za-z0-9._-]{7,95}$ &&
   $case_dir != *..* ]] || bad new-private-current-case-required
[[ $expected_bytes =~ ^[1-9][0-9]{0,9}$ ]] && (( expected_bytes <= 1073741824 )) || bad fresh-bounded-source-size-required
[[ $native_pid =~ ^[1-9][0-9]{0,9}$ && $native_start =~ ^[1-9][0-9]{0,19}$ ]] || bad independent-native-kernel-identity-required
[[ $native_sha =~ ^[0-9a-f]{64}$ && $native_sha != 0000000000000000000000000000000000000000000000000000000000000000 &&
   $confirmed =~ ^[0-9a-f]{64}$ ]] || bad independent-binary-and-control-pins-required
[[ $owned_unit =~ ^ynx-pq-current-native-[A-Za-z0-9][A-Za-z0-9._-]{7,95}\.service$ ]] || bad exact-private-owned-unit-required
if [[ $mode == --prepare ]]; then
  printf 'CURRENT_PRIMARY_COPY_PREPARED sourceBytes=%s executionPerformed=false authoritativeFinalCheckpoint=false exported=false\n' "$expected_bytes"
  exit 0
fi
[[ $EUID == 0 && $(uname -s) == Linux ]] || bad Linux-root-protected-worker-required
self=$(realpath -e -- "${BASH_SOURCE[0]}"); actual=$(sha256sum -- "$self")
[[ ${actual%% *} == "$confirmed" ]] || bad exact-current-control-source-mismatch
[[ $(cat /proc/self/cgroup) == "0::/system.slice/$owned_unit" ]] || bad original-private-cgroup-required
[[ $(cat "/sys/fs/cgroup/system.slice/$owned_unit/memory.max") == 6442450944 &&
   $(systemctl show --property=RuntimeMaxUSec --value -- "$owned_unit") == 2min &&
   $(systemctl show --property=TimeoutStopUSec --value -- "$owned_unit") == 12s &&
   $(systemctl show --property=KillMode --value -- "$owned_unit") == control-group &&
   $(systemctl show --property=Restart --value -- "$owned_unit") == no ]] || bad original-bounded-private-unit-required
[[ $(realpath -e /var/tmp) == /var/tmp &&
   ! -e $case_dir && ! -L $case_dir && ! -e $case_dir.partial && ! -e $case_dir.UNKNOWN ]] || bad existing-case-or-UNKNOWN-retained
available=$(df -B1 --output=avail /var/tmp | tail -n1 | tr -d ' ')
[[ $available =~ ^[0-9]+$ ]] && (( available >= 23622320128 )) || bad original-disk-reserve-required
native_identity() {
  local row rest exe digest
  [[ $(systemctl is-active ynx-chaind.service) == active &&
     $(systemctl show --property=MainPID --value ynx-chaind.service) == "$native_pid" ]] || return 1
  row=$(cat "/proc/$native_pid/stat") || return 1
  [[ ${row%% *} == "$native_pid" ]] || return 1
  rest=${row##*) }; read -r -a fields <<<"$rest"
  [[ ${fields[0]} != Z && ${fields[0]} != X && ${fields[19]} == "$native_start" &&
     $(awk '/^Uid:/{print $2":"$3":"$4":"$5}' "/proc/$native_pid/status") == 995:995:995:995 ]] || return 1
  exe=$(readlink "/proc/$native_pid/exe") || return 1
  [[ $exe == /* && $exe != *' (deleted)' ]] || return 1
  digest=$(sha256sum "/proc/$native_pid/exe") || return 1
  [[ ${digest%% *} == "$native_sha" ]] || return 1
  printf '%s|%s|%s|%s\n' "$native_pid" "$native_start" "$exe" "$(stat -Lc '%d:%i' "/proc/$native_pid/exe")"
}
native_before=$(native_identity) || bad original-current-native-identity-mismatch
mkdir -m 0700 -- "$case_dir"
case_reserved=true
# Retain intent, all partial bytes and first cause. No case is retried or removed.
(set -C; printf 'classification=DATA\nstatus=UNKNOWN\nsourceBytes=%s\ncontrolSHA256=%s\nnativeExeSHA256=%s\nnoAutomaticRetry=true\n' "$expected_bytes" "$confirmed" "$native_sha" > "$case_dir/intent")
(set -C; printf '%s\n' "$native_before" > "$case_dir/native.before")
ynx_native_copy_readonly_fd /var/lib/ynx-chain/testnet/devnet-state.json /var/lib/ynx-chain/testnet/devnet-state.integrity-version "$case_dir" "$expected_bytes"
[[ $(native_identity) == "$native_before" ]] || bad original-current-native-process-changed
(set -C; printf '%s\n' "$native_before" > "$case_dir/native.after")
[[ $(du -sb "$case_dir" | cut -f1) -le 6442450944 &&
   $(df -B1 --output=avail "$case_dir" | tail -n1 | tr -d ' ') -ge 17179869184 ]] || bad original-retention-or-reserve-bound
printf 'CURRENT_PRIMARY_COPY_DATA_OK case=%s sourceBytes=%s copyVerified=true exported=false authoritativeFinalCheckpoint=false pqActivation=false\n' "$case_dir" "$expected_bytes"
