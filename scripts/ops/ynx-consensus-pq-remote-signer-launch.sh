#!/bin/bash
# Installed root-owned 0755 as /usr/local/libexec/ynx-consensus-pq-remote-signer-launch.
# Render the public .conf.in, then canonicalize with jq -cS and install root:
# ynx-pq-signer 0640. It is data, NEVER a sourced shell script. No values below
# generate custody or authorize a checkpoint; the normal CLI revalidates all
# pins, original history, policy and each actual engine H/AppHash.
set +x
set -euo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C
unset BASH_ENV ENV CDPATH LD_PRELOAD LD_LIBRARY_PATH

fail() { printf '%s\n' "remote signer configuration refused: $1" >&2; exit 78; }
[[ $# == 1 ]] || fail 'one operator configuration path is required'
[[ $(uname -s) == Linux && $EUID -ne 0 ]] || fail 'Linux and a dedicated non-root service user are required'
[[ $(id -un) == ynx-pq-signer && $(id -gn) == ynx-pq-signer ]] || fail 'unexpected service identity'
for tool in jq stat realpath sha256sum systemctl systemd-creds findmnt od; do
  command -v "$tool" >/dev/null 2>&1 || fail 'a required system dependency is absent'
done
[[ $(cat /proc/1/comm) == systemd ]] || fail 'the system systemd manager is required'
manager_version=$(systemctl show --property=Version --value 2>/dev/null) || fail 'cannot read the real system manager version'
[[ $manager_version =~ ^([0-9]+)([^0-9]|$) ]] || fail 'unrecognized system manager version'
(( 10#${BASH_REMATCH[1]} >= 250 )) || fail 'LoadCredentialEncrypted requires systemd 250 or newer'

# This restricted deployment profile accepts canonical Linux paths without
# unit expansion characters or whitespace. Never rename original HRS to make
# it fit: incompatible original custody requires its owning deployment change.
canonical_path() {
  [[ $1 =~ ^/[A-Za-z0-9_./-]+$ && $1 != / && ! -L $1 ]] || fail 'noncanonical or unsupported path'
  [[ $(realpath -e -- "$1") == "$1" ]] || fail 'missing path or symlink component'
}
trusted_parents() {
  local directory=$1 owner_scope=${2:-service} uid mode
  while :; do
    read -r uid mode < <(stat -c '%u %a' -- "$directory")
    [[ $uid == 0 || ( $owner_scope != root && $uid == "$EUID" ) ]] || fail 'untrusted directory owner'
    (( (8#$mode & 0022) == 0 )) || fail 'group or other writable directory'
    [[ $directory != / ]] || break
    directory=${directory%/*}; [[ -n $directory ]] || directory=/
  done
}
regular_file() {
  local path=$1 uid mode links
  canonical_path "$path"
  [[ -f $path && -r $path ]] || fail 'existing readable regular file is required'
  read -r uid mode links < <(stat -c '%u %a %h' -- "$path")
  [[ $links == 1 && ( $uid == 0 || $uid == "$EUID" ) ]] || fail 'file must have one link and a trusted owner'
  (( (8#$mode & 0022) == 0 )) || fail 'group or other writable file'
  trusted_parents "${path%/*}"
}
private_file() {
  regular_file "$1"
  [[ $(stat -c '%u:%a' -- "$1") == "$EUID:600" ]] || fail 'original private file must be owned by service UID with mode 0600'
}
readonly_mount() {
  local options
  options=$(findmnt -rn -o VFS-OPTIONS --target "$1") || fail 'cannot establish mount access mode'
  [[ ,$options, == *,ro,* ]] || fail 'source or credential mount is not read-only'
}
history_file() {
  private_file "$1"
  local directory=${1%/*}
  [[ $(stat -c '%u:%a' -- "$directory") == "$EUID:700" && -w $directory && -w $1 ]] || fail 'original history requires its writable service-owned 0700 directory'
  # Existing lock files are retained. The actual CLI acquires the OS locks;
  # this check neither deletes a lock nor pretends a stale file is a lease.
  local lock="$1$2"
  if [[ -e $lock || -L $lock ]]; then private_file "$lock"; fi
}
check_hash() {
  local actual
  actual=$(sha256sum -- "$1") || fail 'cannot hash an independently pinned input'
  [[ ${actual%% *} == "$2" ]] || fail 'input differs from its independent operator pin'
}

config=$1
regular_file "$config"
trusted_parents "${config%/*}" root
[[ $(stat -c '%u:%g:%a' -- "$config") == "0:$(id -g):640" ]] || fail 'configuration must be root-owned service-group mode 0640'
[[ $(stat -c '%s' -- "$config") -le 16384 ]] || fail 'configuration exceeds its bound'
config_json=$(cat -- "$config")
canonical=$(jq -cS . <<<"$config_json" 2>/dev/null) || fail 'invalid configuration JSON'
[[ $config_json == "$canonical" ]] || fail 'configuration must be canonical jq -cS JSON without duplicate or trailing fields'
jq -e '
  (keys == (["abciState","binary","binarySHA256","binding","bindingSHA256",
    "checkpointDirectory","checkpointFormat","checkpointProviderUnit","cometGenesisSHA256",
    "enginePeerPin","enginePeerPublicKey","genesis","goMemoryLimitBytes","legacyKey","legacyKeySHA256",
    "legacyState","listen","memoryBudgetEvidence","memoryBudgetEvidenceSHA256","memoryMaxBytes",
    "migration","migrationStateHash","originalGenesisHash","pqState",
    "runtimePlan","runtimePlanHash","schedule","scheduleHash","schema","timeoutSeconds",
    "transportKey","transportKeySHA256","vault","vaultSHA256"] | sort)) and
  ([to_entries[] | select(.key != "timeoutSeconds") | .value | type == "string"] | all) and
  .schema == "ynx-pq-remote-service-v1" and .checkpointFormat == "atomic-committed-json-v1" and
  (.timeoutSeconds | type == "number") and (.timeoutSeconds == (.timeoutSeconds | floor)) and
  .timeoutSeconds >= 1 and .timeoutSeconds <= 60 and
  ([.binarySHA256,.bindingSHA256,.cometGenesisSHA256,.enginePeerPublicKey,.legacyKeySHA256,
    .memoryBudgetEvidenceSHA256,.migrationStateHash,.originalGenesisHash,.scheduleHash,.transportKeySHA256,.vaultSHA256] |
    all(test("^[0-9a-f]{64}$") and . != ("0" * 64))) and
  ((.runtimePlan == "" and .runtimePlanHash == "") or
    (.runtimePlan != "" and (.runtimePlanHash | test("^[0-9a-f]{64}$") and . != ("0" * 64)))) and
  ([.memoryMaxBytes,.goMemoryLimitBytes] | all(test("^[1-9][0-9]{0,17}$"))) and
  (.checkpointProviderUnit | test("^[A-Za-z0-9][A-Za-z0-9_.-]*\\.(service|mount)$")) and
  .checkpointProviderUnit != "ynx-consensus-pq-remote-signer.service" and
  (.listen | test("^tcp://[^[:space:]@]+:[1-9][0-9]{0,4}$")) and
  ([.[] | select(type == "string")] | all(contains("@") | not))
' <<<"$config_json" >/dev/null 2>&1 || fail 'unsupported or incomplete operator configuration'
field() { jq -er --arg name "$1" '.[$name]' <<<"$config_json"; }
binary=$(field binary); genesis=$(field genesis); migration=$(field migration)
binding=$(field binding); vault=$(field vault); legacy_key=$(field legacyKey)
legacy_state=$(field legacyState); pq_state=$(field pqState); transport_key=$(field transportKey)
peer_pin=$(field enginePeerPin); schedule=$(field schedule); state=$(field abciState)
checkpoint_directory=$(field checkpointDirectory); provider=$(field checkpointProviderUnit)
runtime_plan=$(field runtimePlan)
memory_max=$(field memoryMaxBytes); go_memory_limit=$(field goMemoryLimitBytes)
budget_evidence=$(field memoryBudgetEvidence)
(( go_memory_limit < memory_max )) || fail 'Go memory limit must leave room below the measured service limit'
loaded_memory_max=$(systemctl show --property=MemoryMax --value ynx-consensus-pq-remote-signer.service 2>/dev/null) || fail 'cannot read actual service memory limit'
[[ $loaded_memory_max == "$memory_max" ]] || fail 'loaded service memory limit differs from independently configured target budget'
regular_file "$budget_evidence"; readonly_mount "$budget_evidence"
[[ $(stat -c '%s' -- "$budget_evidence") -gt 0 && $(stat -c '%s' -- "$budget_evidence") -le 1048576 ]] || fail 'bounded target measurement evidence is required'
check_hash "$budget_evidence" "$(field memoryBudgetEvidenceSHA256)"
# The operator owns whether this pinned measurement covers the actual target
# inputs and concurrency. A file digest is provenance, not a capacity proof.

regular_file "$binary"
trusted_parents "${binary%/*}" root
[[ $(stat -c '%u' -- "$binary") == 0 && -x $binary ]] || fail 'normal daemon must be a root-owned executable'
[[ $(od -An -tx1 -N4 -- "$binary" | tr -d ' \n') == 7f454c46 ]] || fail 'normal compiled Linux ELF is required'
check_hash "$binary" "$(field binarySHA256)"
for path in "$genesis" "$migration" "$binding" "$schedule" "$peer_pin"; do
  regular_file "$path"; readonly_mount "$path"
done
for path in "$vault" "$legacy_key" "$transport_key"; do
  private_file "$path"; readonly_mount "$path"
done
history_file "$legacy_state" .writer.lock
history_file "$pq_state" .lock
check_hash "$genesis" "$(field cometGenesisSHA256)"
check_hash "$binding" "$(field bindingSHA256)"
check_hash "$vault" "$(field vaultSHA256)"
check_hash "$legacy_key" "$(field legacyKeySHA256)"
check_hash "$transport_key" "$(field transportKeySHA256)"
[[ $(jq -er '.SignerStatePath' "$binding") == "$pq_state" ]] || fail 'binding does not preserve the original absolute PQ history path'
[[ $(cat -- "$peer_pin") == "$(field enginePeerPublicKey)" ]] || fail 'full peer key differs from the independent operator pin'

canonical_path "$checkpoint_directory"
[[ -d $checkpoint_directory && ${state%/*} == "$checkpoint_directory" ]] || fail 'snapshot must be directly inside the live checkpoint directory'
trusted_parents "$checkpoint_directory"
readonly_mount "$checkpoint_directory"
private_file "$state"
# Only inspect the format prefix here; do not parse/copy a large snapshot or
# take its self-reported height as authority. The CLI performs full validation
# against the authenticated engine checkpoint on EACH request. Journal frames
# are intentionally refused instead of silently exporting a stale JSON copy.
[[ $(od -An -tx1 -N1 -- "$state" | tr -d ' \n') == 7b ]] || fail 'fresh atomic JSON checkpoint is required; journal format is unsupported'
systemctl is-active --quiet -- "$provider" || fail 'configured real checkpoint provider is not active'

args=(--serve --migration-state "$migration" --genesis "$genesis" --abci-state "$state"
  --consensus-genesis-sha256 "$(field cometGenesisSHA256)" --original-genesis-hash "$(field originalGenesisHash)"
  --bound-migration-state-hash "$(field migrationStateHash)" --pq-engine-schedule "$schedule"
  --pq-engine-schedule-hash "$(field scheduleHash)" --pq-host-key-binding "$binding" --pq-host-key-vault "$vault"
  --legacy-key "$legacy_key" --legacy-state "$legacy_state" --listen "$(field listen)"
  --pq-transport-key "$transport_key" --pq-engine-peer-pin "$peer_pin" --timeout "$(field timeoutSeconds)s"
  --recovery-fd 3)
if [[ -n $runtime_plan ]]; then
  regular_file "$runtime_plan"; readonly_mount "$runtime_plan"
  args+=(--runtime-upgrade-plan "$runtime_plan" --runtime-upgrade-plan-hash "$(field runtimePlanHash)")
fi

credential_directory=${CREDENTIALS_DIRECTORY:-}
[[ $credential_directory == /run/credentials/ynx-consensus-pq-remote-signer.service ]] || fail 'systemd encrypted-credential mount is required'
credential="$credential_directory/ynx-pq-recovery"
canonical_path "$credential"
readonly_mount "$credential"
[[ -f $credential && -r $credential && $(stat -c '%s:%h' -- "$credential") == 32:1 ]] || fail 'recovery credential must be exactly 32 raw bytes in a regular single-link file'
read -r credential_uid credential_mode < <(stat -c '%u %a' -- "$credential")
[[ $credential_uid == "$EUID" && $credential_mode == 400 ]] || fail 'systemd credential must be private service-owned mode 0400'
credential_identity=$(stat -c '%d:%i' -- "$credential")
# Do not load credential bytes into shell variables, argv, environment or logs.
exec 3<"$credential"
[[ $(stat -Lc '%d:%i' /proc/self/fd/3) == "$credential_identity" && $(stat -Lc '%s' /proc/self/fd/3) == 32 ]] || fail 'credential changed while opening its original descriptor'
# CLI reads and closes FD3, authenticates/resumes both ORIGINAL histories and
# takes their existing OS leases. No retry loop, cleanup trap or key generation.
# Reconnect/restart after UNKNOWN requires explicit reconciliation by the owner.
exec /usr/bin/env -i PATH=/usr/bin:/bin LANG=C TZ=UTC GOMAXPROCS=2 GOMEMLIMIT="${go_memory_limit}B" GOGC=50 \
  "$binary" "${args[@]}"
