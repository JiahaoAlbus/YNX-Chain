#!/usr/bin/env bash
# DATA preparation only until this exact source/pins/window is independently granted.
# A single normal verifier reads the retained original; no copy/export or retry.
set -Eeuo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C LANG=C TZ=UTC
unset BASH_ENV ENV CDPATH LD_PRELOAD LD_LIBRARY_PATH
while IFS= read -r inherited; do builtin unset -f -- "$inherited"; done < <(builtin compgen -A function)

# BEGIN YNX_RETAINED_MIGRATION_ROFD_CHECK
ynx_retained_migration_rofd_check() {
  [[ $# == 4 && $EUID == 0 ]] || return 1
  local path=$1 bytes=$2 sha=$3 expected=$4 actual before after
  [[ $bytes =~ ^[1-9][0-9]{0,9}$ && $sha =~ ^[0-9a-f]{64}$ &&
     -f $path && ! -L $path && $(realpath -e -- "$path") == "$path" &&
     $(stat -c '%u:%g:%a:%h:%s' -- "$path") == "0:0:600:1:$bytes" ]] || return 1
  before=$(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$path") || return 1
  [[ $before == "$expected" && $(stat -Lc '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "/proc/$BASHPID/fd/3") == "$expected" ]] || return 1
  actual=$(sha256sum -- "/proc/$BASHPID/fd/3") || return 1
  after=$(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$path") || return 1
  [[ ${actual%% *} == "$sha" && $after == "$expected" &&
     $(stat -Lc '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "/proc/$BASHPID/fd/3") == "$expected" ]]
}
# END YNX_RETAINED_MIGRATION_ROFD_CHECK

fixed_native_identity() {
  local row rest exe
  row=$(cat /proc/569890/stat) || return 1
  [[ ${row%% *} == 569890 ]] || return 1
  rest=${row##*) }; read -r -a fields <<<"$rest"
  [[ ${fields[0]} != Z && ${fields[0]} != X && ${fields[19]} == 1308783438 &&
     $(awk '/^Uid:/{print $2":"$3":"$4":"$5}' /proc/569890/status) == 995:995:995:995 ]] || return 1
  exe=$(readlink /proc/569890/exe) || return 1
  [[ $exe == /usr/local/bin/ynx-chaind && $(stat -Lc '%d:%i' /proc/569890/exe) == 64770:793 ]] || return 1
  printf '%s\n' '569890|1308783438|/usr/local/bin/ynx-chaind|64770:793'
}

fresh_capacity() {
  local available memory rows pid state comm rss group
  available=$(df -B1 --output=avail /var/tmp | tail -n1 | tr -d ' ') || return 1
  memory=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo) || return 1
  [[ $available =~ ^[0-9]+$ && $memory =~ ^[0-9]+$ ]] &&
    (( available >= 23622320128 && memory >= 10485760 )) || return 1
  rows=$(ps -e -o pid=,stat=,comm=,rss=) || return 1
  while read -r pid state comm rss; do
    [[ $pid =~ ^[1-9][0-9]*$ && $rss =~ ^[0-9]+$ ]] || return 1
    [[ $state != Z* && $state != X* ]] || continue
    if [[ $pid == 569890 ]]; then fixed_native_identity >/dev/null || return 1; continue; fi
    case "$comm" in
      cargo|rustc|go|compile|link|cc1|cc1plus|gcc|g++|clang|clang++|cmake|make|ninja|ynx-chaind|ynx-comet*|ynx-consensus*) return 1 ;;
    esac
    (( rss < 1048576 )) || return 1
  done <<<"$rows"
}

refuse() {
  if [[ ${attempt_created-false} == true && ! -e $case_dir/first-cause ]]; then
    ( set -C; printf '%s\n' "$1" > "$case_dir/first-cause" ) || true
  fi
  printf 'YNX_RETAINED_PRESERVATION_ONCE_REFUSED:%s\n' "$1" >&2
  exit 1
}
readonly candidate=74d677f82997ca2547c23e5d285b7ee4618b2086
readonly migration=/var/tmp/ynx-pq-offline-native-78c7c581bff3-once02/migration.json
readonly migration_sha=f45c7a9659e2882ec9ea5f35aabd16a89f9d90ed5aac28fe6cb9034757b915f8
readonly migration_bytes=701825267
readonly migration_stat='64770:437212:8180:1:0:0:701825267:2026-10-24 01:14:46.366848522 +0000:2026-10-24 01:14:46.366848522 +0000'
readonly input_root=/var/tmp/ynx-pq-preservation-input-74d677f82997-once01
readonly tools=/var/tmp/ynx-pq-preservation-input-74d677f82997-once01/tools
readonly case_dir=/var/tmp/ynx-pq-preservation-74d677f82997-once01
readonly unit=ynx-pq-preservation-74d677f82997-once01.service
readonly source_sha=641a1dc67e911ec50d0931fedea24e00f0d6a8be54b01d911e719dc13ca080f2
readonly cli_sha=d353845b92612accd56e2b0384ce7ef964997c8f163081de20ea8edbcc7f07a3
readonly chaind_sha=6739e301029249fd39bd28a1701c4b582885f9414fed8eb43a538c5ebdc6ee00
if [[ $# == 0 ]]; then
  printf '%s\n' 'DRAFT_DATA_ONLY candidate=74d677f82997ca2547c23e5d285b7ee4618b2086 input=/var/tmp/ynx-pq-offline-native-78c7c581bff3-once02/migration.json device=64770 inode=437212 case=/var/tmp/ynx-pq-preservation-74d677f82997-once01 active<=180s cleanup<=15s MemoryMax=6442450944 MemorySwapMax=0 CPUQuota=200% stdout<=65536 stderr<=65536 noNodeStart=true noExport=true noRetry=true executionAuthorized=false'
  exit 0
fi
execute=false; confirmed=; device=; inode=
while [[ $# != 0 ]]; do
  case "$1" in
    --execute) [[ $execute == false ]] || refuse duplicate-option; execute=true; shift ;;
    --confirmed-script-sha256|--migration-device|--migration-inode)
      [[ $# -ge 2 ]] || refuse missing-value
      case "$1" in
        --confirmed-script-sha256) [[ -z $confirmed ]] || refuse duplicate-option; confirmed=$2 ;;
        --migration-device) [[ -z $device ]] || refuse duplicate-option; device=$2 ;;
        --migration-inode) [[ -z $inode ]] || refuse duplicate-option; inode=$2 ;;
      esac
      shift 2 ;;
    *) refuse unknown-option ;;
  esac
done
[[ $execute == true && $EUID == 0 && $(uname -s) == Linux && $device == 64770 && $inode == 437212 &&
   $confirmed =~ ^[0-9a-f]{64}$ && $confirmed != 0000000000000000000000000000000000000000000000000000000000000000 ]] || refuse exact-independent-execution-pins-required
start=$(awk '{print $1}' /proc/uptime)
self=$(realpath -e -- "${BASH_SOURCE[0]}")
[[ -f $self && ! -L ${BASH_SOURCE[0]} && $(stat -c '%u:%g:%h' -- "$self") == 0:0:1 ]] || refuse unsafe-reviewed-control-source
[[ $(stat -c '%a' -- "$self") == 600 || $(stat -c '%a' -- "$self") == 700 ]] || refuse unsafe-reviewed-control-mode
actual=$(timeout --foreground --signal=TERM --kill-after=0.2s 5s sha256sum -- "$self")
[[ ${actual%% *} == "$confirmed" ]] || refuse reviewed-control-source-pin-mismatch
for name in systemd-run systemctl jq stat realpath sha256sum head prlimit mkfifo install du df od timeout ps find awk; do
  command -v "$name" >/dev/null || refuse missing-system-tool
done
[[ $(realpath -e /var/tmp) == /var/tmp && -f /sys/fs/cgroup/cgroup.controllers &&
   ! -e $case_dir && ! -L $case_dir && ! -e $case_dir.partial && ! -L $case_dir.partial &&
   ! -e $case_dir.UNKNOWN && ! -L $case_dir.UNKNOWN ]] || refuse original-or-unknown-attempt-retained
[[ $(timeout --foreground --signal=TERM --kill-after=0.2s 2s systemctl show --property=LoadState --value -- "$unit") == not-found ]] || refuse owned-unit-already-exists-or-unknown
for directory in "$input_root" "$tools" "${migration%/*}"; do
  [[ -d $directory && ! -L $directory && $(realpath -e -- "$directory") == "$directory" &&
     $(stat -c '%u:%g:%a' -- "$directory") == 0:0:700 ]] || refuse unsafe-original-input-directory
done
[[ -f $migration && ! -L $migration && $(realpath -e -- "$migration") == "$migration" &&
   $(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$migration") == "$migration_stat" ]] || refuse independently-observed-migration-identity-changed
[[ $(find "$tools" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort) == $'SOURCE.json\nynx-chaind\nynx-consensus-package' ]] || refuse exact-three-file-staged-input-required
for name in SOURCE.json ynx-chaind ynx-consensus-package; do
  file="$tools/$name"
  case "$name" in SOURCE.json) bytes=459; expected=$source_sha ;; ynx-chaind) bytes=24567992; expected=$chaind_sha ;; ynx-consensus-package) bytes=26022072; expected=$cli_sha ;; esac
  [[ -f $file && ! -L $file && $(realpath -e -- "$file") == "$file" &&
     $(stat -c '%u:%g:%a:%h:%s' -- "$file") == "0:0:600:1:$bytes" ]] || refuse unsafe-or-wrong-size-staged-input
  before=$(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$file")
  actual=$(timeout --foreground --signal=TERM --kill-after=0.2s 5s sha256sum -- "$file")
  [[ ${actual%% *} == "$expected" && $(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$file") == "$before" ]] || refuse staged-input-sha-or-identity-changed
done
[[ $(cat -- "$tools/SOURCE.json") == "$(jq -cS . "$tools/SOURCE.json")" ]] || refuse noncanonical-or-duplicate-source-document
jq -e --arg commit "$candidate" --arg cli "$cli_sha" --arg daemon "$chaind_sha" '
  keys == (["version","commit","runId","platform","binaries","purpose"]|sort) and
  .version == "YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1" and .commit == $commit and .runId == "40050938524" and .platform == "linux/amd64" and
  .purpose == "offline copied-state validation; not installed or activated" and
  .binaries == {"ynx-chaind":{"bytes":24567992,"sha256":$daemon},"ynx-consensus-package":{"bytes":26022072,"sha256":$cli}}
' "$tools/SOURCE.json" >/dev/null || refuse normal-ci-source-contract-mismatch
native_before=$(fixed_native_identity) || refuse original-native-identity-changed
fresh_capacity || refuse fresh-capacity-or-other-heavy-owner
mkdir -m 0700 -- "$case_dir"
attempt_created=true; dispatched=false; cleanup_complete=false; cleanup_attempted=false; runner=; runner_start=
printf 'version=YNX-RETAINED-MIGRATION-PRESERVATION-ONCE/v1\nclassification=DATA\ncontrolSHA256=%s\ncandidate=%s\nmigrationSHA256=%s\nmigrationDevice=%s\nmigrationInode=%s\nstatus=UNKNOWN\nnoAutomaticRetry=true\nexecutionAuthorizedByThisScript=false\n' "$confirmed" "$candidate" "$migration_sha" "$device" "$inode" > "$case_dir/intent"
printf '%s\n' "$native_before" > "$case_dir/native.before"
# BEGIN YNX_OWNED_CLIENT_EXIT_CHECK
task_start() {
  local row rest
  row=$(cat "/proc/$1/stat") || return 1
  [[ ${row%% *} == "$1" ]] || return 1
  rest=${row##*) }; read -r -a fields <<<"$rest"
  [[ ${fields[19]-} =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "${fields[19]}"
}
owned_client_exited() {
  local pass observed
  [[ $runner =~ ^[1-9][0-9]*$ ]] || return 1
  for pass in 1 2; do
    if [[ -n $runner_start ]]; then
      if observed=$(task_start "$runner" 2>/dev/null); then
        [[ $observed != "$runner_start" ]] || return 1
        # A different observed start belongs to a foreign reused PID. The
        # original client has exited; this helper never signals that process.
      else
        if kill -0 "$runner" 2>/dev/null || [[ -e /proc/$runner ]]; then return 1; fi
      fi
    else
      # Missing startup provenance cannot make a visible client disappear.
      # Both the kernel existence probe and proc path must be absent twice.
      if kill -0 "$runner" 2>/dev/null || [[ -e /proc/$runner ]]; then return 1; fi
    fi
    [[ $pass == 2 ]] || sleep 0.2
  done
}
# END YNX_OWNED_CLIENT_EXIT_CHECK
owned_empty() {
  local group="/sys/fs/cgroup/system.slice/$unit" lists list tasks
  if [[ -d $group ]]; then
    lists=$(find "$group" -name cgroup.procs -type f -print) || return 1
    while IFS= read -r list; do
      [[ -n $list && $list == "$group/"* ]] || return 1
      if tasks=$(cat -- "$list"); then [[ -z $tasks ]] || return 1; else [[ ! -e $group ]] || return 1; fi
    done <<<"$lists"
  fi
}
cleanup_owned() {
  local properties description group load
  [[ $dispatched == true ]] || return 0
  [[ $cleanup_attempted == false ]] || return 1
  cleanup_attempted=true
  properties=$(timeout --foreground --signal=TERM --kill-after=0.2s 1s systemctl show --property=LoadState --property=Description --property=ControlGroup -- "$unit") || return 1
  load=$(sed -n 's/^LoadState=//p' <<<"$properties")
  description=$(sed -n 's/^Description=//p' <<<"$properties")
  group=$(sed -n 's/^ControlGroup=//p' <<<"$properties")
  if [[ $load == not-found ]]; then
    # A completed transient unit may already have been collected. Its exact
    # client must have exited and its original cgroup must still be empty.
    owned_client_exited || return 1
    owned_empty || return 1
    sleep 0.2
    owned_empty || return 1
    cleanup_complete=true
    return 0
  fi
  [[ $load == loaded ]] || return 1
  [[ $description == "YNX retained preservation once $confirmed" && ( -z $group || $group == "/system.slice/$unit" ) ]] || return 1
  # No global process group, daemon or foreign service can be selected here.
  timeout --foreground --signal=TERM --kill-after=0.5s 12s systemctl stop -- "$unit" || true
  if [[ -n $runner_start && $(task_start "$runner" 2>/dev/null || true) == "$runner_start" ]]; then
    kill -TERM "$runner" 2>/dev/null || true
    sleep 0.1
    if [[ $(task_start "$runner" 2>/dev/null || true) == "$runner_start" ]]; then kill -KILL "$runner" 2>/dev/null || true; fi
  fi
  owned_empty || return 1
  sleep 0.2
  owned_empty || return 1
  owned_client_exited || return 1
  cleanup_complete=true
}
finish() {
  local rc=$?
  trap - EXIT
  if [[ $dispatched == true && $cleanup_complete != true ]]; then
    cleanup_owned || printf '%s\n' 'owned-cleanup-unresolved-no-retry' > "$case_dir/cleanup-UNKNOWN"
  fi
  if [[ $rc != 0 && ! -e $case_dir/first-cause ]]; then printf 'controller-exit-%s\n' "$rc" > "$case_dir/first-cause"; fi
  printf 'YNX_RETAINED_PRESERVATION_ONCE_RETAINED case=%s exit=%s noAutomaticRetry=true executionAuthorizedByThisScript=false\n' "$case_dir" "$rc" >&2
  exit "$rc"
}
trap finish EXIT
trap 'refuse controller-interrupted-no-retry' HUP INT TERM
mkdir -m 0700 -- "$case_dir/tools" "$case_dir/logs"
for name in SOURCE.json ynx-chaind ynx-consensus-package; do
  stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$tools/$name" > "$case_dir/$name.input-stat"
done
# The unused chaind stays in the original closed DATA input; it is never executed or staged executable.
install -m 0600 -o root -g root -- "$tools/SOURCE.json" "$case_dir/tools/SOURCE.json"
install -m 0700 -o root -g root -- "$tools/ynx-consensus-package" "$case_dir/tools/ynx-consensus-package"
actual=$(sha256sum -- "$case_dir/tools/ynx-consensus-package")
[[ ${actual%% *} == "$cli_sha" && $(stat -c '%u:%g:%a:%h:%s' -- "$case_dir/tools/ynx-consensus-package") == 0:0:700:1:26022072 &&
   $(od -An -tx1 -N7 -- "$case_dir/tools/ynx-consensus-package" | tr -d ' \n') == 7f454c46020101 &&
   $(od -An -tx1 -j18 -N2 -- "$case_dir/tools/ynx-consensus-package" | tr -d ' \n') == 3e00 ]] || refuse staged-normal-cli-mismatch
{
  printf '%s\n' '#!/bin/bash'
  declare -f ynx_retained_migration_rofd_check fixed_native_identity
  cat <<'WORKER'
set -Eeuo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C LANG=C TZ=UTC
case_dir=/var/tmp/ynx-pq-preservation-74d677f82997-once01
unit=ynx-pq-preservation-74d677f82997-once01.service
migration=/var/tmp/ynx-pq-offline-native-78c7c581bff3-once02/migration.json
expected='64770:437212:8180:1:0:0:701825267:2026-10-24 01:14:46.366848522 +0000:2026-10-24 01:14:46.366848522 +0000'
bad() { if [[ ! -e $case_dir/first-cause ]]; then printf '%s\n' "$1" > "$case_dir/first-cause"; fi; exit 1; }
[[ $# == 0 && $EUID == 0 && $(stat -c '%u:%g:%a' -- "$case_dir") == 0:0:700 &&
   $(cat /proc/self/cgroup) == "0::/system.slice/$unit" &&
   $(cat "/sys/fs/cgroup/system.slice/$unit/memory.max") == 6442450944 &&
   $(cat "/sys/fs/cgroup/system.slice/$unit/memory.swap.max") == 0 &&
   $(cat "/sys/fs/cgroup/system.slice/$unit/cpu.max") == '200000 100000' &&
   $(readlink /proc/self/ns/net) != "$(readlink /proc/569890/ns/net)" ]] || bad original-owned-hard-isolation-not-applied
[[ $(fixed_native_identity) == "$(cat "$case_dir/native.before")" ]] || bad original-native-process-changed
exec 3<"$migration"
ynx_retained_migration_rofd_check "$migration" 701825267 f45c7a9659e2882ec9ea5f35aabd16a89f9d90ed5aac28fe6cb9034757b915f8 "$expected" || bad original-retained-input-or-rofd-changed
printf '%s\n' "$expected" > "$case_dir/migration.before"
[[ ! -e $case_dir/logs/verifier.stdout && ! -e $case_dir/logs/verifier.stderr &&
   ! -e $case_dir/logs/out.pipe && ! -e $case_dir/logs/err.pipe ]] || bad prior-verifier-effect-retained
mkfifo -m 0600 "$case_dir/logs/out.pipe" "$case_dir/logs/err.pipe"
head -c 65536 < "$case_dir/logs/out.pipe" > "$case_dir/logs/verifier.stdout" & out_pid=$!
head -c 65536 < "$case_dir/logs/err.pipe" > "$case_dir/logs/verifier.stderr" & err_pid=$!
set +e
/usr/bin/prlimit --fsize=65536:65536 -- "$case_dir/tools/ynx-consensus-package" --verify-migration-preservation /var/tmp/ynx-pq-offline-native-78c7c581bff3-once02/migration.json > "$case_dir/logs/out.pipe" 2> "$case_dir/logs/err.pipe"
code=$?
wait "$out_pid"; out_code=$?
wait "$err_pid"; err_code=$?
set -e
printf 'verifierExit=%s\nstdoutReaderExit=%s\nstderrReaderExit=%s\n' "$code" "$out_code" "$err_code" > "$case_dir/verifier-exit"
# Confirm the original even on a normal verifier failure; do not rewrite its output or retry it.
ynx_retained_migration_rofd_check "$migration" 701825267 f45c7a9659e2882ec9ea5f35aabd16a89f9d90ed5aac28fe6cb9034757b915f8 "$expected" || bad original-retained-input-or-rofd-changed
exec 3<&-
[[ $(fixed_native_identity) == "$(cat "$case_dir/native.before")" ]] || bad original-native-process-changed
[[ $code == 0 && $out_code == 0 && $err_code == 0 &&
   $(stat -c '%s' "$case_dir/logs/verifier.stdout") -lt 65536 &&
   $(stat -c '%s' "$case_dir/logs/verifier.stderr") -lt 65536 ]] || bad normal-preservation-verifier-failed-or-log-cap
jq -e '
  keys == (["version","classification","scope","sourceSHA256","sourceBytes","height","lastBlockHash","stateHash","applicationImport","infoInitialized","accountsChecked","contractsChecked","historyBlocksChecked","historyTransactionsChecked","accountPolicyChecked","persistedColdRestore","validatorBinding","executionCapabilities","blockers","deployment","initChain","pqActivation"]|sort) and
  .version == "YNX-MIGRATION-PRESERVATION-CHECK/v1" and .classification == "data" and .scope == "unbound-application-import" and
  .sourceSHA256 == "f45c7a9659e2882ec9ea5f35aabd16a89f9d90ed5aac28fe6cb9034757b915f8" and .sourceBytes == "701825267" and
  .height == "1991198" and .lastBlockHash == "761011132fd50907bc64176fde4b1e5ec32b4a55bb1998042da98276820a47b4" and
  .stateHash == "97fb0502a532c09a76b4fe88b97a1e08f8839833bdcad36bc73ad25c0ba69197" and
  .accountsChecked == "5310" and .historyBlocksChecked == "1991199" and
  .applicationImport == "verified" and .infoInitialized == false and .accountPolicyChecked == true and
  .persistedColdRestore == "unchecked" and .validatorBinding == "unchecked" and
  .deployment == "not-performed" and .initChain == "not-performed" and .pqActivation == "not-performed" and
  ([.height,.accountsChecked,.contractsChecked,.historyBlocksChecked,.historyTransactionsChecked]|all(type == "string" and test("^(0|[1-9][0-9]*)$"))) and
  (.lastBlockHash|type == "string" and test("^[0-9a-f]{64}$")) and (.stateHash|type == "string" and test("^[0-9a-f]{64}$")) and
  .executionCapabilities == "unresolved" and
  .blockers == [
    {"module":"pay","records":283,"reason":"source preservation validation passed; independent source merchant binding and original webhook secret custody have not been established for this migration"},
    {"module":"ai","records":39,"reason":"source preservation validation passed; source permissions have no signed principal or transaction; cannot create BFT signer authority during import"},
    {"module":"trust_governance","records":418,"reason":"source preservation validation passed; independently authenticated source reviewer/role binding is missing; original text identities cannot authorize review or resolution"}
  ]
' "$case_dir/logs/verifier.stdout" >/dev/null || bad unexpected-normal-preservation-receipt
printf 'classification=DATA\nnormalVerifierExit=0\napplicationImport=true\noriginalReadOnlyInputUnchanged=true\npersistedColdRestore=unchecked\nvalidatorBinding=unchecked\nauthoritativeFinalCheckpoint=false\ndeployment=false\ninitChain=false\npqActivation=false\nnodeStarted=false\n' > "$case_dir/worker-success"
WORKER
} > "$case_dir/worker.sh"
chmod 0700 -- "$case_dir/worker.sh"
remaining=$(awk -v start="$start" '{printf "%.2f", 179.5-($1-start)}' /proc/uptime)
awk -v value="$remaining" 'BEGIN{exit !(value>0 && value<=180)}' || refuse active-budget-exhausted-before-dispatch
fresh_capacity || refuse fresh-capacity-or-other-heavy-owner
[[ $(fixed_native_identity) == "$native_before" ]] || refuse original-native-process-changed
# Exactly one dispatch. The kernel-owned unit also stops after SSH/controller loss.
dispatched=true
/usr/bin/prlimit --fsize=65536:65536 -- systemd-run --quiet --unit="$unit" --description="YNX retained preservation once $confirmed" --service-type=exec --wait --pipe \
  --property=PrivateNetwork=yes --property=MemoryMax=6442450944 --property=MemorySwapMax=0 --property=CPUQuota=200% \
  --property=CPUQuotaPeriodSec=100ms --property=TasksMax=320 --property=RuntimeMaxSec="${remaining}s" --property=TimeoutStopSec=12s \
  --property=KillMode=control-group --property=KillSignal=SIGTERM --property=SendSIGKILL=yes --property=Restart=no \
  --property=NoNewPrivileges=yes --property=ProtectSystem=strict --property="ReadWritePaths=$case_dir" \
  --property="ReadOnlyPaths=$migration $tools" --property=UMask=0077 --property="WorkingDirectory=$case_dir" --property=LimitCORE=0 --property=LimitFSIZE=65536 \
  /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C LANG=C TZ=UTC GOMAXPROCS=2 GOGC=50 GOMEMLIMIT=5GiB \
  /bin/bash "$case_dir/worker.sh" > "$case_dir/dispatch.stdout" 2> "$case_dir/dispatch.stderr" &
runner=$!
if ! runner_start=$(task_start "$runner"); then
  runner_start=
  refuse owned-client-start-identity-unavailable-no-retry
fi
expired=false
printf '%s\n' 'uptimeSeconds memoryCurrentBytes pidsCurrent' > "$case_dir/telemetry"
while kill -0 "$runner" 2>/dev/null; do
  if ! awk -v start="$start" '{exit !(($1-start)<180)}' /proc/uptime; then expired=true; break; fi
  [[ $(fixed_native_identity) == "$native_before" ]] || refuse original-native-process-changed
  [[ $(du -sb "$case_dir" | cut -f1) -le 67108864 &&
     $(df -B1 --output=avail "$case_dir" | tail -n1 | tr -d ' ') -ge 17179869184 ]] || refuse retained-budget-or-disk-reserve
  group="/sys/fs/cgroup/system.slice/$unit"
  if [[ -d $group ]]; then
    memory=$(cat "$group/memory.current" 2>/dev/null || true)
    tasks=$(cat "$group/pids.current" 2>/dev/null || true)
    if [[ -d $group ]]; then
      [[ $memory =~ ^[0-9]+$ && $tasks =~ ^[0-9]+$ ]] &&
        (( memory <= 6442450944 && tasks <= 320 )) || refuse owned-telemetry-or-hard-cap-unresolved
      printf '%s %s %s\n' "$(awk '{print $1}' /proc/uptime)" "$memory" "$tasks" >> "$case_dir/telemetry"
    fi
  fi
  sleep 0.2
done
set +e
if [[ $expired == true ]]; then status=124; else wait "$runner"; status=$?; fi
set -e
cleanup_owned || refuse owned-cleanup-unresolved-no-retry
printf '%s\n' 'ownedCgroupEmpty=true' 'ownedClientExited=true' > "$case_dir/cleanup"
[[ $(fixed_native_identity) == "$native_before" ]] || refuse original-native-process-changed
printf '%s\n' "$native_before" > "$case_dir/native.after"
[[ $(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$migration") == "$migration_stat" ]] || refuse original-retained-migration-metadata-changed
for name in SOURCE.json ynx-chaind ynx-consensus-package; do
  [[ $(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$tools/$name") == "$(cat "$case_dir/$name.input-stat")" ]] || refuse original-tool-input-identity-changed
  case "$name" in SOURCE.json) expected=$source_sha ;; ynx-chaind) expected=$chaind_sha ;; ynx-consensus-package) expected=$cli_sha ;; esac
  budget=$(awk -v start="$start" '{left=180-($1-start); if(left>0) printf "%.2f", (left<5?left:5)}' /proc/uptime)
  [[ $budget =~ ^[0-9]+\.[0-9]{2}$ && $budget != 0.00 ]] || refuse active-budget-exhausted-before-final-input-check
  actual=$(timeout --foreground --signal=TERM --kill-after=0.2s "${budget}s" sha256sum -- "$tools/$name")
  [[ ${actual%% *} == "$expected" && $(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$tools/$name") == "$(cat "$case_dir/$name.input-stat")" ]] || refuse original-tool-input-sha-or-identity-changed
done
[[ $status == 0 && -f $case_dir/worker-success && $(du -sb "$case_dir" | cut -f1) -le 67108864 ]] || refuse normal-verifier-or-owned-runtime-failed
awk -v start="$start" '{exit !(($1-start)<180)}' /proc/uptime || refuse active-budget-exhausted-before-result
printf 'YNX_RETAINED_MIGRATION_PRESERVATION_DATA_ONLY candidate=%s case=%s normalVerifierExit=0 ownedCgroupEmpty=true applicationImport=true persistedColdRestore=unchecked validatorBinding=unchecked authoritativeFinalCheckpoint=false deployment=false initChain=false pqActivation=false nodeStarted=false\n' "$candidate" "$case_dir"
