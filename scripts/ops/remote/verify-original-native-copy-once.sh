#!/usr/bin/env bash
# DRAFT ONLY until the original operator grants this exact script/pins/window.
# One original-path live read + offline copied-state checks, never finality.
set -Eeuo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C
unset BASH_ENV ENV CDPATH LD_PRELOAD LD_LIBRARY_PATH
# Preserved once01 source SHA256: 8c6e4306f48f1873cc04058053fab442659baa767e931de882853f129a304996
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

refuse() { printf 'YNX_NATIVE_OFFLINE_ONCE_REFUSED:%s\n' "$1" >&2; exit 1; }
if [[ $# == 0 ]]; then
  printf '%s\n' 'DRAFT_DATA_ONLY candidate=<successful normal CI exact commit> case=/var/tmp/ynx-pq-offline-native-<candidate12>-once02 active<=120s cleanup<=15s MemoryMax=6442450944 retained<=6442450944 reserve>=17179869184 source<=1073741824 logsEach<=1048576 noNodeStart=true noFreeze=true noRetry=true executionAuthorized=false'
  exit 0
fi
candidate= tools= source_pin= source_bytes= confirmed= execute=false
while [[ $# != 0 ]]; do
  case "$1" in
    --execute) [[ $execute == false ]] || refuse duplicate; execute=true; shift ;;
    --candidate|--tools|--tools-source-sha256|--source-bytes|--confirmed-script-sha256)
      [[ $# -ge 2 ]] || refuse missing-value
      case "$1" in
        --candidate) [[ -z $candidate ]] || refuse duplicate; candidate=$2 ;;
        --tools) [[ -z $tools ]] || refuse duplicate; tools=$2 ;;
        --tools-source-sha256) [[ -z $source_pin ]] || refuse duplicate; source_pin=$2 ;;
        --source-bytes) [[ -z $source_bytes ]] || refuse duplicate; source_bytes=$2 ;;
        --confirmed-script-sha256) [[ -z $confirmed ]] || refuse duplicate; confirmed=$2 ;;
      esac
      shift 2 ;;
    *) refuse unknown-option ;;
  esac
done
[[ $execute == true && $EUID == 0 && $(uname -s) == Linux ]] || refuse explicit-Linux-root-execution-required
[[ $candidate =~ ^[0-9a-f]{40}$ && $candidate != 0000000000000000000000000000000000000000 &&
   $source_pin =~ ^[0-9a-f]{64}$ && $source_pin != 0000000000000000000000000000000000000000000000000000000000000000 &&
   $confirmed =~ ^[0-9a-f]{64}$ ]] || refuse independent-source-and-control-pins-required
[[ $source_bytes =~ ^[1-9][0-9]{0,9}$ ]] && (( source_bytes <= 1073741824 )) || refuse independently-observed-bounded-source-size-required
[[ $tools =~ ^/[A-Za-z0-9_./-]+$ && $tools != / && $(realpath -e -- "$tools") == "$tools" && -d $tools && ! -L $tools ]] || refuse canonical-tools-directory-required
self=$(realpath -e -- "${BASH_SOURCE[0]}")
actual=$(sha256sum -- "$self"); [[ ${actual%% *} == "$confirmed" ]] || refuse exact-control-source-not-confirmed
start=$(awk '{print $1}' /proc/uptime)
case_dir="/var/tmp/ynx-pq-offline-native-${candidate:0:12}-once02"
unit="ynx-pq-offline-native-${candidate:0:12}-once02.service"
[[ ! -e $case_dir && ! -L $case_dir && ! -e $case_dir.partial && ! -e $case_dir.UNKNOWN ]] || refuse existing-attempt-or-UNKNOWN-retained
[[ $(realpath -e /var/tmp) == /var/tmp && -d /sys/fs/cgroup && -f /sys/fs/cgroup/cgroup.controllers ]] || refuse real-host-cgroup-v2-required
for name in systemd-run systemctl jq stat realpath sha256sum head prlimit mkfifo install du df od timeout; do command -v "$name" >/dev/null || refuse missing-system-tool; done
[[ $(systemctl show --property=LoadState --value -- "$unit" 2>/dev/null || true) == not-found ]] || refuse prior-owned-unit-must-be-retained
available=$(df -B1 --output=avail /var/tmp | tail -n1 | tr -d ' ')
[[ $available =~ ^[0-9]+$ ]] && (( available >= 23622320128 )) || refuse insufficient-disk-reserve-plus-maximum-retention
[[ $(find "$tools" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort) == $'SOURCE.json\nynx-chaind\nynx-consensus-package' ]] || refuse exact-three-file-tools-bundle-required
for name in SOURCE.json ynx-chaind ynx-consensus-package; do
  file="$tools/$name"
  [[ -f $file && ! -L $file && $(realpath -e -- "$file") == "$file" && $(stat -c '%h' -- "$file") == 1 ]] || refuse unsafe-tool-input
  mode=$(stat -c '%a' -- "$file"); (( (8#$mode & 0022) == 0 )) || refuse writable-tool-input
  [[ $(stat -c '%s' -- "$file") -le 268435456 ]] || refuse tool-input-too-large
done
[[ $(stat -c '%s' -- "$tools/SOURCE.json") -le 65536 ]] || refuse source-document-too-large
actual=$(sha256sum -- "$tools/SOURCE.json"); [[ ${actual%% *} == "$source_pin" ]] || refuse independent-SOURCE-pin-mismatch
[[ $(cat -- "$tools/SOURCE.json") == "$(jq -cS . "$tools/SOURCE.json")" ]] || refuse noncanonical-or-duplicate-SOURCE-document
jq -e --arg commit "$candidate" '
 keys == (["version","commit","runId","platform","binaries","purpose"]|sort) and
 .version == "YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1" and .commit == $commit and .platform == "linux/amd64" and
 (.runId|type == "string" and test("^[1-9][0-9]*$")) and
 .purpose == "offline copied-state validation; not installed or activated" and
 (.binaries|keys == ["ynx-chaind","ynx-consensus-package"]) and
 (.binaries|all(keys == ["bytes","sha256"] and (.bytes|type == "number" and floor == . and . > 0 and . <= 268435456) and
   (.sha256|type == "string" and test("^[0-9a-f]{64}$") and . != ("0"*64))))
' "$tools/SOURCE.json" >/dev/null || refuse normal-CI-tool-SOURCE-contract-mismatch
mkdir -m 0700 -- "$case_dir"
printf 'candidate=%s\ncontrolSHA256=%s\nSOURCEsha256=%s\nstatus=UNKNOWN\nnoAutomaticRetry=true\n' "$candidate" "$confirmed" "$source_pin" > "$case_dir/intent"
# No cleanup removes this attempt or any source/result/partial/UNKNOWN.
failed=true
finish() {
  local rc=$?
  trap - EXIT
  printf 'YNX_NATIVE_OFFLINE_ONCE_RETAINED case=%s status=%s executionAuthorizedByThisScript=false\n' "$case_dir" "$rc" >&2
  exit "$rc"
}
trap finish EXIT
mkdir -m 0700 -- "$case_dir/tools"
for name in SOURCE.json ynx-chaind ynx-consensus-package; do
  stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$tools/$name" > "$case_dir/$name.input-stat"
  [[ ! -e $case_dir/tools/$name ]] || refuse duplicate-stage-target
  install -m 0600 -o root -g root -- "$tools/$name" "$case_dir/tools/$name"
  actual=$(sha256sum -- "$case_dir/tools/$name")
  if [[ $name == SOURCE.json ]]; then expected=$source_pin; else expected=$(jq -er --arg name "$name" '.binaries[$name].sha256' "$case_dir/tools/SOURCE.json"); fi
  [[ ${actual%% *} == "$expected" ]] || refuse staged-tool-SHA-mismatch
  if [[ $name != SOURCE.json ]]; then
    [[ $(stat -c '%s' -- "$case_dir/tools/$name") == "$(jq -er --arg name "$name" '.binaries[$name].bytes|tostring' "$case_dir/tools/SOURCE.json")" &&
       $(od -An -tx1 -N7 -- "$case_dir/tools/$name" | tr -d ' \n') == 7f454c46020101 &&
       $(od -An -tx1 -j18 -N2 -- "$case_dir/tools/$name" | tr -d ' \n') == 3e00 ]] || refuse normal-Linux-amd64-tool-required
    chmod 0700 -- "$case_dir/tools/$name" # Only these NEW, independently pinned case copies.
  fi
done
{
printf '%s\n' '#!/bin/bash'
declare -f ynx_native_copy_readonly_fd
cat <<'WORKER'
set -Eeuo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C
bad() { printf '%s\n' "$1" > "$case_dir/first-cause"; exit 1; }
case_dir=$1; expected_bytes=$2; expected_control=$3; expected_unit=$4
[[ $EUID == 0 && $case_dir =~ ^/var/tmp/ynx-pq-offline-native-[0-9a-f]{12}-once02$ &&
   $(stat -c '%u:%a' -- "$case_dir") == 0:700 ]] || exit 78
[[ $(cat /proc/self/cgroup) == "0::/system.slice/$expected_unit" ]] || bad wrong-owned-cgroup
[[ $(cat "/sys/fs/cgroup/system.slice/$expected_unit/memory.max") == 6442450944 ]] || bad real-MemoryMax-not-applied
native_identity() {
 local row rest exe
 row=$(cat /proc/569890/stat) || return 1
 [[ ${row%% *} == 569890 ]] || return 1
 rest=${row##*) }; read -r -a fields <<<"$rest"
 [[ ${fields[0]} != Z && ${fields[0]} != X && ${fields[19]} =~ ^[1-9][0-9]*$ ]] || return 1
 [[ $(awk '/^Uid:/{print $2":"$3":"$4":"$5}' /proc/569890/status) == 995:995:995:995 ]] || return 1
 exe=$(readlink /proc/569890/exe) || return 1
 [[ $exe == /* && $exe != *' (deleted)' ]] || return 1
 printf '%s|%s|%s\n' "${fields[19]}" "$exe" "$(stat -Lc '%d:%i' /proc/569890/exe)"
}
native_before=$(native_identity) || bad original-native-process-unavailable
printf '%s\n' "$native_before" > "$case_dir/native.before"
ynx_native_copy_readonly_fd /var/lib/ynx-chain/testnet/devnet-state.json /var/lib/ynx-chain/testnet/devnet-state.integrity-version "$case_dir" "$expected_bytes"
[[ $(native_identity) == "$native_before" ]] || bad original-native-process-changed
run_tool() {
 local label=$1; shift
 local out="$case_dir/logs/$label.stdout" err="$case_dir/logs/$label.stderr" a b rc
 [[ ! -e $out && ! -e $err && ! -e $case_dir/logs/out.pipe && ! -e $case_dir/logs/err.pipe ]] || bad prior-tool-effect-retained
 mkfifo -m 0600 "$case_dir/logs/out.pipe" "$case_dir/logs/err.pipe"
 head -c 1048576 < "$case_dir/logs/out.pipe" > "$out" & a=$!
 head -c 1048576 < "$case_dir/logs/err.pipe" > "$err" & b=$!
 set +e
 /usr/bin/prlimit --fsize=4294967296:4294967296 -- "$@" > "$case_dir/logs/out.pipe" 2> "$case_dir/logs/err.pipe"
 rc=$?
 wait "$a"; local ar=$?; wait "$b"; local br=$?
 set -e
 [[ $rc == 0 && $ar == 0 && $br == 0 && $(stat -c '%s' "$out") -lt 1048576 && $(stat -c '%s' "$err") -lt 1048576 ]] || bad "$label-failed-or-log-cap"
 # Only our two completed named FIFOs are removed, never evidence or data.
 rm -- "$case_dir/logs/out.pipe" "$case_dir/logs/err.pipe"
 [[ $(du -sb "$case_dir" | cut -f1) -le 6442450944 && $(df -B1 --output=avail "$case_dir" | tail -n1 | tr -d ' ') -ge 17179869184 ]] || bad retained-size-or-disk-reserve
}
migration="$case_dir/migration.json"
[[ ! -e $migration && ! -L $migration && ! -e $migration.tmp && ! -e $migration.UNKNOWN ]] || bad existing-export-or-UNKNOWN-retained
run_tool export "$case_dir/tools/ynx-chaind" --data-dir "$case_dir/data-verified" --export-consensus-state "$migration"
run_tool verify-state "$case_dir/tools/ynx-consensus-package" --verify-migration-state "$migration"
run_tool verify-execution "$case_dir/tools/ynx-consensus-package" --verify-migration-execution "$migration"
grep -Eq '^consensus migration state passed: height=[0-9]+ lastBlockHash=[^ ]+ stateHash=[^ ]+ accounts=[0-9]+ validators=[0-9]+$' "$case_dir/logs/verify-state.stdout" || bad unexpected-state-verifier-output
grep -Eq '^consensus migration execution passed: height=[0-9]+ lastBlockHash=[^ ]+ stateHash=[^ ]+ blockers=0 scope=executor-compatibility-only validatorBinding=unchecked applicationRestore=unchecked deployment=not-performed initChain=not-performed pqActivation=not-performed$' "$case_dir/logs/verify-execution.stdout" || bad unexpected-execution-verifier-output
[[ $(native_identity) == "$native_before" ]] || bad original-native-process-changed
# The live path may keep advancing after the verified read. Do not claim that
# its future inode equals this old copy or that this is an activation snapshot.
copy_after=$(sha256sum "$case_dir/data-verified/devnet-state.json"); [[ ${copy_after%% *} == "$copy_sha" ]] || bad offline-input-was-rewritten
copy_marker_after=$(sha256sum "$case_dir/data-verified/devnet-state.integrity-version"); [[ ${copy_marker_after%% *} == "$marker_sha" ]] || bad offline-marker-was-rewritten
sha256sum "$migration" > "$case_dir/migration.sha256"
printf 'classification=DATA\ncopyVerified=true\nmigrationVerified=true\nexecutionCompatible=true\nauthoritativeFinalCheckpoint=false\ndeploymentVerified=false\npqActivation=false\nnodeStarted=false\n' > "$case_dir/worker-success"
WORKER
} > "$case_dir/worker.sh"
chmod 0700 -- "$case_dir/worker.sh"
remaining=$(awk -v start="$start" '{printf "%.2f", 119.5-($1-start)}' /proc/uptime)
awk -v value="$remaining" 'BEGIN{exit !(value>0 && value<=120)}' || refuse active-budget-exhausted-before-start
# RuntimeMax includes copying, all hashes, and all three offline commands.
# MemoryMax applies to the worker AND every tool/logger descendant. No native
# process is joined to this newly created one-shot cgroup.
set +e
systemd-run --quiet --unit="$unit" --description="YNX offline DATA once $confirmed" --service-type=exec --wait --pipe \
  --property=MemoryMax=6442450944 --property=RuntimeMaxSec="${remaining}s" --property=TimeoutStopSec=12s \
  --property=KillMode=control-group --property=KillSignal=SIGTERM --property=SendSIGKILL=yes --property=Restart=no \
  --property=UMask=0077 --property=WorkingDirectory="$case_dir" --property=LimitCORE=0 \
  /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C LANG=C TZ=UTC GOMAXPROCS=2 GOMEMLIMIT=6GiB GOGC=50 \
  /bin/bash "$case_dir/worker.sh" "$case_dir" "$source_bytes" "$confirmed" "$unit" &
runner=$!
set -e
task_start() {
  local row rest
  row=$(cat "/proc/$1/stat") || return 1
  [[ ${row%% *} == "$1" ]] || return 1
  rest=${row##*) }; read -r -a fields <<<"$rest"
  printf '%s\n' "${fields[19]}"
}
runner_start=$(task_start "$runner") || runner_start=
expired=false
while kill -0 "$runner" 2>/dev/null; do
  if ! awk -v start="$start" '{exit !(($1-start)<120)}' /proc/uptime; then
    expired=true
    # Only the exact transient unit created by THIS confirmed script may be
    # stopped; never use a service name/PID supplied by tool output or config.
    properties=$(/usr/bin/timeout --foreground --signal=TERM --kill-after=0.2s 1s /usr/bin/systemctl show --property=Description --property=ControlGroup -- "$unit" 2>/dev/null || true)
    description=$(sed -n 's/^Description=//p' <<<"$properties")
    group=$(sed -n 's/^ControlGroup=//p' <<<"$properties")
    [[ $description == "YNX offline DATA once $confirmed" && ( -z $group || $group == "/system.slice/$unit" ) ]] || refuse owned-unit-identity-unavailable-retain-UNKNOWN
    /usr/bin/timeout --foreground --signal=TERM --kill-after=0.5s 12s /usr/bin/systemctl stop -- "$unit" || true
    # The systemd client is our own child, not the native service or a guessed
    # process group. Signal it only if its original kernel start identity holds.
    if [[ -n $runner_start && $(task_start "$runner" 2>/dev/null || true) == "$runner_start" ]]; then
      kill -TERM "$runner" 2>/dev/null || true
      sleep 0.1
      if [[ $(task_start "$runner" 2>/dev/null || true) == "$runner_start" ]]; then kill -KILL "$runner" 2>/dev/null || true; fi
    fi
    break
  fi
  sleep 0.2
done
set +e
if [[ $expired == true ]]; then
  status=124
  # Do not block forever waiting for an unreapable kernel task; its unchanged
  # identity and nonempty cgroup remain UNKNOWN, never a successful cleanup.
  if [[ -n $runner_start && $(task_start "$runner" 2>/dev/null || true) == "$runner_start" ]]; then
    printf '%s\n' owned-client-cleanup-UNKNOWN > "$case_dir/cleanup-UNKNOWN"
  else
    wait "$runner"
  fi
else
  wait "$runner"
  status=$?
fi
set -e
# Never reset/clear the unit, journal, attempt, copy, output or UNKNOWN.
# systemd's owned KillMode/TimeoutStopSec handles TERM->KILL only for this unit.
for pass in 1 2; do
  group="/sys/fs/cgroup/system.slice/$unit"
  if [[ -d $group ]]; then
    # cgroup.procs has stat size 0 even when populated: read its real contents,
    # including descendants, never use test -s as proof of an empty group.
    lists=$(find "$group" -name cgroup.procs -type f -print) || refuse owned-cgroup-readback-incomplete
    while IFS= read -r list; do
      [[ -n $list && $list == "$group/"* ]] || refuse unexpected-owned-cgroup-path
      if tasks=$(cat -- "$list"); then
        [[ -z $tasks ]] || refuse owned-cgroup-not-empty
      else
        [[ ! -e $group ]] || refuse owned-cgroup-readback-incomplete
      fi
    done <<<"$lists"
  fi
  [[ $pass == 2 ]] || sleep 0.2
done
if [[ -f $case_dir/native.before ]]; then
  row=$(cat /proc/569890/stat) || refuse original-native-PID-disappeared
  rest=${row##*) }; read -r -a fields <<<"$rest"
  [[ ${row%% *} == 569890 && ${fields[0]} != Z && ${fields[0]} != X &&
     $(awk '/^Uid:/{print $2":"$3":"$4":"$5}' /proc/569890/status) == 995:995:995:995 ]] || refuse original-native-process-changed
  native_after="${fields[19]}|$(readlink /proc/569890/exe)|$(stat -Lc '%d:%i' /proc/569890/exe)"
  printf '%s\n' "$native_after" > "$case_dir/native.after"
  [[ $native_after == "$(cat "$case_dir/native.before")" ]] || refuse original-native-process-changed
fi
[[ $status == 0 && -f $case_dir/worker-success ]] || refuse offline-command-or-owned-runtime-failed
[[ $(du -sb "$case_dir" | cut -f1) -le 6442450944 ]] || refuse retained-budget-exceeded
for name in SOURCE.json ynx-chaind ynx-consensus-package; do
  [[ $(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$tools/$name") == "$(cat "$case_dir/$name.input-stat")" ]] || refuse original-tool-input-metadata-changed
  actual=$(sha256sum -- "$tools/$name")
  if [[ $name == SOURCE.json ]]; then expected=$source_pin; else expected=$(jq -er --arg name "$name" '.binaries[$name].sha256' "$case_dir/tools/SOURCE.json"); fi
  [[ ${actual%% *} == "$expected" ]] || refuse original-tool-input-SHA-changed
done
printf 'YNX_NATIVE_OFFLINE_ONCE_DATA_ONLY candidate=%s case=%s exit=0 copyVerified=true migrationVerified=true executionCompatible=true ownedCgroupEmpty=true authoritativeFinalCheckpoint=false deployment=false pqActivation=false nodeStarted=false\n' "$candidate" "$case_dir"
