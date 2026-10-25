#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
ynx_ops_init
# A lost SSH response may follow successful key creation. Shared transport
# retry is never appropriate for this one-shot ceremony, including copy/inspect.
export YNX_DEPLOY_CONNECTION_ATTEMPTS=1

# Keep the original Ed25519 ceremony intact. PQ creation, original-key approval
# and inspection are independent operator actions, never an automatic sequence.
phase="${CONSENSUS_CANDIDATE_KEY_PHASE:-legacy}"
case "$phase" in
  legacy|legacy-verify-recovery|pq-new-epoch|pq-inspect|pq-approve-first-registration) ;;
  *) echo 'invalid CONSENSUS_CANDIDATE_KEY_PHASE' >&2; exit 64 ;;
esac

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" && "${CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED:-}" != "yes" ]]; then
  echo "CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED=yes is required" >&2
  exit 1
fi

pq_key_ceremony() {
  local role="${CONSENSUS_CANDIDATE_KEY_ROLE:-}" user host key
  local bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:-}" full_commit="${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}"
  local manifest_pin="${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}" work="${CONSENSUS_CANDIDATE_KEY_WORK_ROOT:-}"
  local out="${CONSENSUS_PQ_KEY_DIRECTORY:-}" state="${CONSENSUS_PQ_STATE_DIRECTORY:-}"
  local approval="${CONSENSUS_PQ_APPROVAL_DIRECTORY:-}" credential_pin="${CONSENSUS_PQ_ENCRYPTED_CREDENTIAL_SHA256:-}"
  local input='' input_pin='' genesis="${CONSENSUS_PQ_CONSENSUS_GENESIS:-}" genesis_pin="${CONSENSUS_PQ_CONSENSUS_GENESIS_SHA256:-}"
  local binary=ynx-consensus-pq-key-init binary_pin stage command attempt
  local recovery_parent="${CONSENSUS_LEGACY_RECOVERY_PARENT:-}" recovery_manifest="${CONSENSUS_LEGACY_RECOVERY_ROLE_MANIFEST_REMOTE:-}"
  [[ -z "${CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME:-}" ]] || { echo 'PQ phases are explicit; legacy RESUME is not accepted' >&2; return 64; }
  case "$role" in
    primary) user=$PRIMARY_NODE_USER; host=$PRIMARY_NODE_HOST; key=$PRIMARY_NODE_SSH_KEY ;;
    singapore) user=$SG_NODE_USER; host=$SG_NODE_HOST; key=$SG_NODE_SSH_KEY ;;
    silicon-valley) user=$SILICON_VALLEY_NODE_USER; host=$SILICON_VALLEY_NODE_HOST; key=$SILICON_VALLEY_NODE_SSH_KEY ;;
    seoul) user=$SEOUL_NODE_USER; host=$SEOUL_NODE_HOST; key=$SEOUL_NODE_SSH_KEY ;;
    *) echo 'one original CONSENSUS_CANDIDATE_KEY_ROLE is required per PQ attempt' >&2; return 64 ;;
  esac
  # Paths enter the remote shell as quoted arguments. Reject ambiguous spellings
  # here; canonical identity and ownership are checked again on the real host.
  pq_absolute() { [[ $1 =~ ^/[A-Za-z0-9_./-]+$ && $1 != / && $1 != */ && $1 != *//* && $1 != */./* && $1 != */../* && $1 != */. && $1 != */.. ]]; }
  pq_public_pin() {
    # DATA validation is portable to the existing macOS operator. No Linux ELF
    # is ever executed locally; the normal target process runs over transport.
    python3 -B - "$1" "$2" "$3" <<'PUBLIC_PIN'
import hashlib, os, re, stat, sys
filename, pin, maximum = sys.argv[1:]
def identity(s):
    return s.st_dev, s.st_ino, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns
try:
    assert os.path.isabs(filename) and os.path.realpath(filename) == filename
    assert re.fullmatch('[0-9a-f]{64}', pin)
    before = os.lstat(filename)
    assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= int(maximum)
    with os.fdopen(os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        assert identity(before) == identity(os.fstat(source.fileno()))
        digest, size = hashlib.sha256(), 0
        while True:
            chunk = source.read(1 << 20)
            if not chunk: break
            digest.update(chunk); size += len(chunk)
            assert size <= int(maximum)
        assert size == before.st_size and digest.hexdigest() == pin
        assert identity(before) == identity(os.fstat(source.fileno())) == identity(os.lstat(filename))
except (OSError, ValueError, AssertionError):
    sys.exit(1)
PUBLIC_PIN
  }
  case "$phase" in
    legacy-verify-recovery)
      binary=ynx-consensus-keycheck
      input_pin="${CONSENSUS_LEGACY_RECOVERY_ROLE_MANIFEST_SHA256:-}"
      pq_absolute "$recovery_parent" && pq_absolute "$recovery_manifest" && [[ $input_pin =~ ^[0-9a-f]{64}$ && $input_pin != "$(printf '0%.0s' {1..64})" ]] || { echo 'explicit new private recovery parent and independently pinned original remote public role manifest required' >&2; return 1; }
      [[ $recovery_manifest =~ ^/opt/ynx-chain/consensus-candidates/ynx-consensus-candidate-[0-9a-f]{12}/$role/role/role-manifest\.json$ ]] || { echo 'recovery requires the exact original role public manifest path' >&2; return 1; }
      [[ -z $out && -z $state && -z $approval && -z $credential_pin && -z $genesis && -z $genesis_pin && -z "${CONSENSUS_PQ_EPOCH_REQUEST:-}" && -z "${CONSENSUS_PQ_EPOCH_REQUEST_SHA256:-}" && -z "${CONSENSUS_PQ_PUBLIC_RECORD:-}" && -z "${CONSENSUS_PQ_PUBLIC_RECORD_SHA256:-}" ]] || { echo 'legacy recovery cannot consume PQ creation, credential, approval or Genesis options' >&2; return 1; }
      [[ $recovery_parent != /etc/ynx/consensus-candidate && $recovery_parent != /etc/ynx/consensus-candidate/* ]] || { echo 'recovery cannot write into original custody' >&2; return 1; } ;;
    pq-new-epoch)
      input="${CONSENSUS_PQ_EPOCH_REQUEST:-}"; input_pin="${CONSENSUS_PQ_EPOCH_REQUEST_SHA256:-}"
      [[ $credential_pin =~ ^[0-9a-f]{64}$ ]] || { echo 'independent encrypted credential SHA256 is required' >&2; return 1; }
      pq_public_pin "$input" "$input_pin" 262144 || { echo 'pinned original public epoch request required' >&2; return 1; } ;;
    pq-approve-first-registration)
      binary=ynx-comet
      input="${CONSENSUS_PQ_PUBLIC_RECORD:-}"; input_pin="${CONSENSUS_PQ_PUBLIC_RECORD_SHA256:-}"
      pq_absolute "$approval" || { echo 'explicit new original-owner approval directory required' >&2; return 1; }
      pq_public_pin "$input" "$input_pin" 262144 || { echo 'pinned original key-init public record required' >&2; return 1; } ;;
  esac
  if [[ $phase != pq-inspect && $phase != legacy-verify-recovery ]]; then
    pq_public_pin "$genesis" "$genesis_pin" 67108864 || { echo 'independently pinned original Ed25519 Comet genesis required' >&2; return 1; }
  fi
  if [[ $phase != pq-approve-first-registration && $phase != legacy-verify-recovery ]]; then
    pq_absolute "$out" && pq_absolute "$state" && [[ $out != "$state" && $out != "$state/"* && $state != "$out/"* ]] || { echo 'explicit disjoint custody and HRS directories required' >&2; return 1; }
  fi
  [[ -n $work && ! -e $work && ! -L $work ]] || { echo 'new exclusive PQ work directory required; retain earlier UNKNOWN' >&2; return 1; }
  # Reuse the original portable full artifact DATA parser, not a new manifest
  # format, local ELF execution or per-host go build. Import returns functions.
  source scripts/deploy/deploy-consensus-candidate.sh
  [[ $(git rev-parse HEAD) == "$full_commit" ]] || { echo 'operator source must match the independently pinned runtime commit' >&2; return 1; }
  validate_runtime_bundle "$bundle" "$full_commit" "$manifest_pin" || return
  mkdir -p -- "$(dirname -- "$work")"
  mkdir -m 0700 -- "$work"
  work="$(cd "$work" && pwd -P)"
  trap 'status=$?; printf "PQ ceremony UNKNOWN/failed attempt retained (exit=%s): %s; inspect the original, never regenerate or approve automatically\n" "$status" "$work" >&2; exit "$status"' ERR
  mkdir -m 0700 -- "$work/public"
  printf 'phase=%s\nrole=%s\ncommit=%s\nruntimeManifestSHA256=%s\npublicInputSHA256=%s\nconsensusGenesisSHA256=%s\noutDirectory=%s\nstateDirectory=%s\napprovalDirectory=%s\nrecoveryParent=%s\nrecoveryPublicManifest=%s\n' "$phase" "$role" "$full_commit" "$manifest_pin" "$input_pin" "$genesis_pin" "$out" "$state" "$approval" "$recovery_parent" "$recovery_manifest" >"$work/intent.txt"
  prepare_runtime_bundle "$bundle" "$full_commit" "$manifest_pin" "$work/runtime"
  binary_pin="$(python3 -B -c 'import json,sys; from pathlib import Path; print(json.loads((Path(sys.argv[1])/"SOURCE.json").read_bytes())["binaries"][sys.argv[2]]["sha256"])' "$work/runtime" "$binary")"
  pq_public_pin "$work/runtime/$binary" "$binary_pin" 134217728
  attempt="$(basename "$(mktemp -d "$work/attempt.XXXXXXXXXXXX")")"
  stage="/var/tmp/ynx-consensus-pq-ceremony-${full_commit:0:12}-${attempt}-${role}"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "umask 077; mkdir -m 0700 '$stage'" >"$work/reserve.stdout" 2>"$work/reserve.stderr"
  ynx_ops_copy "$role" "$user" "$host" "$key" "$work/runtime/$binary" "$stage/$binary" >"$work/binary.copy.stdout" 2>"$work/binary.copy.stderr"
  if [[ $phase != pq-inspect && $phase != legacy-verify-recovery ]]; then
    ynx_ops_copy "$role" "$user" "$host" "$key" "$input" "$stage/public-input.json" >"$work/input.copy.stdout" 2>"$work/input.copy.stderr"
    ynx_ops_copy "$role" "$user" "$host" "$key" "$genesis" "$stage/genesis.json" >"$work/genesis.copy.stdout" 2>"$work/genesis.copy.stderr"
  fi
  printf -v command '%q ' sudo -n /usr/bin/timeout --signal=TERM --kill-after=1 25 /usr/bin/env -i PATH=/usr/bin:/bin /bin/bash -s -- "$phase" "$role" "$stage" "$binary" "$binary_pin" "$out" "$state" "$approval" "$input_pin" "$genesis_pin" "$credential_pin" "$recovery_parent" "$recovery_manifest"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "$command" >"$work/public/$role.json.partial" 2>"$work/ceremony.stderr" <<'REMOTE_PQ'
set -Eeuo pipefail
umask 077
phase=$1 role=$2 stage=$3 binary=$4 binary_pin=$5 out=$6 state=$7 approval=$8 input_pin=$9 genesis_pin=${10} credential_pin=${11}
recovery_parent=${12} recovery_manifest=${13}
fail() { printf 'PQ host ceremony refused: %s; preserve originals/UNKNOWN\n' "$1" >&2; exit 1; }
[[ $EUID == 0 && $(uname -s):$(uname -m) == Linux:x86_64 ]] || fail 'normal privileged Linux host required'
for tool in /usr/sbin/runuser /usr/bin/sha256sum /usr/bin/stat /usr/bin/realpath; do [[ -x $tool ]] || fail 'normal host tool missing'; done
[[ -d $stage && ! -L $stage && $(realpath -e -- "$stage") == "$stage" ]] || fail 'original stage required'
chown root:root -- "$stage"
chmod 0700 -- "$stage"
mkdir -m 0700 -- "$stage/verified"
[[ -f $stage/$binary && ! -L $stage/$binary && $(stat -c %h -- "$stage/$binary") == 1 ]] || fail 'original runtime transport file required'
cp -P -- "$stage/$binary" "$stage/verified/$binary"
[[ -f $stage/verified/$binary && ! -L $stage/verified/$binary && $(stat -c '%u:%h' -- "$stage/verified/$binary") == 0:1 && $(sha256sum -- "$stage/verified/$binary" | cut -d ' ' -f 1) == "$binary_pin" ]] || fail 'runtime binary pin changed'
chmod 0755 -- "$stage/verified/$binary"
if [[ $phase != pq-inspect && $phase != legacy-verify-recovery ]]; then
  for name in public-input.json genesis.json; do
    [[ -f $stage/$name && ! -L $stage/$name && $(stat -c %h -- "$stage/$name") == 1 ]] || fail 'public input is not original regular single-link file'
    cp -P -- "$stage/$name" "$stage/verified/$name"
    [[ -f $stage/verified/$name && ! -L $stage/verified/$name && $(stat -c '%u:%h' -- "$stage/verified/$name") == 0:1 ]] || fail 'public verified copy is not original root-owned regular file'
  done
  [[ $(sha256sum -- "$stage/verified/public-input.json" | cut -d ' ' -f 1) == "$input_pin" && $(sha256sum -- "$stage/verified/genesis.json" | cut -d ' ' -f 1) == "$genesis_pin" ]] || fail 'original public input pin changed'
  chmod 0444 -- "$stage/verified/public-input.json" "$stage/verified/genesis.json"
fi
chmod 0755 -- "$stage" "$stage/verified"
stage="$stage/verified"
if [[ $phase == pq-approve-first-registration || $phase == legacy-verify-recovery ]]; then
  owner=ynx
else
  owner=ynx-pq-signer
fi
uid=$(id -u "$owner"); gid=$(id -g "$owner")
[[ $uid != 0 ]] || fail 'dedicated original service identity required'
trusted_parent() {
  local directory=$1 mode observed
  [[ -d $directory && ! -L $directory && $(realpath -e -- "$directory") == "$directory" ]] || fail 'canonical existing custody parent required'
  while :; do
    read -r observed mode < <(stat -c '%u %a' -- "$directory")
    [[ $observed == 0 || $observed == "$uid" ]] && (( (8#$mode & 8#022) == 0 )) || fail 'custody ancestor is writable by another identity'
    [[ $directory != / ]] || break
    directory=${directory%/*}; [[ -n $directory ]] || directory=/
  done
}
if [[ $phase == legacy-verify-recovery ]]; then
  original="/etc/ynx/consensus-candidate/$role"
  trusted_parent "$original"; trusted_parent "${recovery_parent%/*}"
  [[ $(stat -c '%u:%a' -- "$original") == "$uid:700" ]] || fail 'original custody must remain owned by its original service UID'
  for name in priv_validator_key.json priv_validator_state.json node_key.json; do
    [[ -f $original/$name && ! -L $original/$name ]] || fail "missing-original-$name"
    [[ $(stat -c '%u:%a:%h' -- "$original/$name") == "$uid:600:1" ]] || fail "unprotected-original-$name"
  done
  [[ ! -e $recovery_parent && ! -L $recovery_parent && $recovery_parent != "$original" && $recovery_parent != "$original/"* && $original != "$recovery_parent/"* ]] || fail 'new disjoint recovery parent required; retain original UNKNOWN'
  [[ -f $recovery_manifest && ! -L $recovery_manifest && $(realpath -e -- "$recovery_manifest") == "$recovery_manifest" && $(stat -c %h -- "$recovery_manifest") == 1 ]] || fail 'original public role manifest unavailable'
  cp -P -- "$recovery_manifest" "$stage/recovery-role-manifest.json"
  [[ -f $stage/recovery-role-manifest.json && ! -L $stage/recovery-role-manifest.json && $(stat -c '%u:%h' -- "$stage/recovery-role-manifest.json") == 0:1 && $(sha256sum -- "$stage/recovery-role-manifest.json" | cut -d ' ' -f 1) == "$input_pin" ]] || fail 'independent original public role pin differs'
  chown "$uid:$gid" -- "$stage/recovery-role-manifest.json"
  chmod 0600 -- "$stage/recovery-role-manifest.json"
  mkdir -m 0700 -- "$recovery_parent"
  chown "$uid:$gid" -- "$recovery_parent"
  # This exact normal keycheck copies only three fixed original files, then
  # restores from its actual backup and verifies with the SAME original UID.
  # It cannot sign, Save HRS, restore live paths, create keys or change services.
  exec /usr/sbin/runuser -u ynx -- /usr/bin/env -i PATH=/usr/bin:/bin LANG=C TZ=UTC GOMAXPROCS=1 GOMEMLIMIT=96MiB GOGC=50 "$stage/$binary" --verify-isolated-recovery --role "$role" --key-dir "$original" --recovery-dir "$recovery_parent/attempt" --role-manifest "$stage/recovery-role-manifest.json" --role-manifest-sha256 "$input_pin"
fi
if [[ $phase == pq-approve-first-registration ]]; then
  legacy="/etc/ynx/consensus-candidate/$role/priv_validator_key.json"
  trusted_parent "${legacy%/*}"; trusted_parent "${approval%/*}"
  [[ $(stat -c '%u:%a' -- "${approval%/*}") == "$uid:700" ]] || fail 'approval parent must already be original-owner private 0700'
  [[ -f $legacy && ! -L $legacy && $(stat -c '%u:%a:%h' -- "$legacy") == "$uid:600:1" ]] || fail 'original legacy key owner/mode required'
  [[ ! -e $approval && ! -L $approval ]] || fail 'original approval/UNKNOWN already exists'
  # Open the ORIGINAL regular FilePVKey only after dropping to its original
  # owner. No key body crosses SSH, sudo stdin, a pipe, argv or an env variable.
  exec /usr/sbin/runuser -u ynx -- /usr/bin/env -i PATH=/usr/bin:/bin LANG=C TZ=UTC /bin/bash -c 'set -euo pipefail; exec 3<"$1"; exec "$2" approve-first-validator-registration --public-record "$3" --public-record-sha256 "$4" --consensus-genesis "$5" --consensus-genesis-sha256 "$6" --approval-directory "$7" --legacy-key-fd 3' bash "$legacy" "$stage/$binary" "$stage/public-input.json" "$input_pin" "$stage/genesis.json" "$genesis_pin" "$approval"
fi
for directory in "$out" "$state"; do trusted_parent "${directory%/*}"; done
if [[ $phase == pq-inspect ]]; then
  # The CLI does not follow an untrusted marker to a different state path.
  exec /usr/sbin/runuser -u ynx-pq-signer -- /usr/bin/env -i PATH=/usr/bin:/bin LANG=C TZ=UTC "$stage/$binary" --inspect --out-dir "$out" --state-dir "$state"
fi
[[ $out != "$state" && $out != "$state/"* && $state != "$out/"* ]] || fail 'custody and writable HRS must be disjoint'
for directory in "$out" "$state"; do [[ ! -e $directory && ! -L $directory ]] || fail 'new epoch directory or UNKNOWN already exists'; done
credential=/etc/credstore.encrypted/ynx-pq-recovery
trusted_parent "${credential%/*}"
[[ -x /usr/bin/systemd-creds && -f $credential && ! -L $credential && $(stat -c '%u:%a:%h' -- "$credential") == 0:600:1 && $(sha256sum -- "$credential" | cut -d ' ' -f 1) == "$credential_pin" ]] || fail 'original encrypted credential pin/metadata required'
# Each mkdir is exclusive. Partial provisioning, decrypt failure or lost ACK
# remains visible; there is no cleanup, fallback, second create or key copy.
for directory in "$out" "$state"; do mkdir -m 0700 -- "$directory"; chown "$uid:$gid" -- "$directory"; done
# Only the raw32 anonymous pipe crosses runuser. Open FD3 after dropping UID,
# detach stdin and require BOTH exits via pipefail; even late decrypt failure
# is UNKNOWN if the consumer has already written its immutable epoch marker.
/usr/bin/systemd-creds decrypt --name=ynx-pq-recovery "$credential" - | /usr/sbin/runuser -u ynx-pq-signer -- /usr/bin/env -i PATH=/usr/bin:/bin LANG=C TZ=UTC /bin/bash -c 'set -euo pipefail; exec 3<&0; exec 0</dev/null; exec "$1" --new-epoch --request "$2" --request-sha256 "$3" --genesis "$4" --genesis-sha256 "$5" --out-dir "$6" --state-dir "$7" --recovery-fd 3' bash "$stage/$binary" "$stage/public-input.json" "$input_pin" "$stage/genesis.json" "$genesis_pin" "$out" "$state"
REMOTE_PQ
  if [[ $phase == pq-approve-first-registration ]]; then
    # Registration wire is PUBLIC authorization, never a private key or HRS.
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo -u ynx /usr/bin/head -c 262145 -- '$approval/registration.wire'" >"$work/public/$role.registration.wire.partial" 2>"$work/registration.readback.stderr"
  fi
  if [[ ${DEPLOY_DRY_RUN:-0} != 1 ]]; then
    python3 -B - "$phase" "$work/public/$role.json.partial" "$out" "$state" "$input_pin" "$genesis_pin" "$work/public/$role.registration.wire.partial" "$recovery_parent" "$role" <<'PUBLIC_PQ'
import hashlib, json, sys
from pathlib import Path
phase, filename, out, state, source_pin, genesis_pin, wire, recovery, role = sys.argv[1:]
with Path(filename).open('rb') as source: raw = source.read(262145)
assert 0 < len(raw) <= 262144, 'bounded original public receipt required'
v = json.loads(raw)
if phase == 'legacy-verify-recovery':
    assert len(raw) <= 8192 and v['version'] == 'YNX-CONSENSUS-KEYCHECK-ISOLATED-RECOVERY/v1'
    assert v['role'] == role and v['roleManifestSHA256'] == source_pin
    assert v['sourceDirectory'] == '/etc/ynx/consensus-candidate/'+role and v['privateRecoveryDirectory'] == recovery+'/attempt'
    assert all(v[k] is True for k in ('sourceReadOnly', 'sourceFilesUnchanged', 'backupBytesMatched', 'restoreBytesMatched', 'restoredIdentityMatched', 'restoredHRSConsistency', 'manifestMatched', 'isolatedRecoveryVerified', 'sameHost'))
    assert all(v[k] is False for k in ('offHostRecoveryVerified', 'hrsHistoryVerified', 'independentReview', 'authorityGranted', 'signingPerformed', 'liveRestorePerformed', 'serviceChanged', 'rotationVerified'))
elif phase == 'pq-new-epoch':
    assert v['format'] == 'YNX-CONSENSUS-PQ-CEREMONY-PUBLIC/v1'
    assert v['status'] == 'new_epoch_files_durable_registration_not_authorized'
    assert v['paths']['directory'] == out and v['paths']['state'] == state + '/original-sign-state.json'
    assert v['binding']['SignerStatePath'] == v['paths']['state']
elif phase == 'pq-inspect':
    assert v['readOnly'] is True and v['privateMaterialOpened'] is False and v['registrationAuthorized'] is False
else:
    assert v['version'] == 'YNX-FIRST-VALIDATOR-APPROVAL/v1'
    assert v['publicRecordSHA256'] == source_pin and v['genesisSHA256'] == genesis_pin
    assert v['authorizationSigned'] is True and all(v[k] is False for k in ('broadcast', 'committed', 'pqActivated'))
    with Path(wire).open('rb') as source: body = source.read(262145)
    assert 0 < len(body) <= 262144 and hashlib.sha256(body).hexdigest() == v['registrationSHA256']
PUBLIC_PQ
    (set -o noclobber; cat "$work/public/$role.json.partial" >"$work/public/$role.json")
    if [[ $phase == pq-approve-first-registration ]]; then
      (set -o noclobber; cat "$work/public/$role.registration.wire.partial" >"$work/public/$role.registration.wire")
    fi
  fi
  printf 'PQ %s result retained at %s; no automatic registration, service start or activation\n' "$phase" "$work/public"
}

if [[ $phase != legacy ]]; then
  pq_key_ceremony
  exit 0
fi

case "${CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME:-}" in
  ''|no) mode=create ;;
  yes) mode=inspect ;;
  *) echo 'CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME must be yes, no or empty' >&2; exit 64 ;;
esac

commit="$(git rev-parse --short=12 HEAD)"
if [[ "${DEPLOY_DRY_RUN:-0}" == "1" && -z "${CONSENSUS_CANDIDATE_KEY_WORK_ROOT:-}" ]]; then
  work="$(mktemp -d)"
else
  work="${CONSENSUS_CANDIDATE_KEY_WORK_ROOT:-tmp/consensus-candidate-key-ceremony}"
  # A new attempt cannot replace any earlier public record, partial output or
  # UNKNOWN. Mkdir is the exclusive reservation even after the precheck races.
  [[ ! -e "$work" && ! -L "$work" ]] || { echo "key ceremony work directory already exists; retain and reconcile it: $work" >&2; exit 1; }
  mkdir -p -- "$(dirname "$work")"
  mkdir -m 0700 -- "$work"
fi
work="$(cd "$work" && pwd -P)"
trap 'status=$?; printf "key ceremony attempt retained (exit=%s): %s; no automatic retry or regeneration\n" "$status" "$work" >&2; exit "$status"' ERR
mkdir -m 0700 "$work/public"
# The token reserves only a public transport attempt, never a validator epoch.
# It gives each host a new exclusive stage without overwriting old /tmp files.
attempt="$(basename "$(mktemp -d "$work/attempt.XXXXXXXXXXXX")")"
printf 'mode=%s\ncommit=%s\nattempt=%s\n' "$mode" "$commit" "$attempt" >"$work/intent.txt"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o "$work/ynx-consensus-key-init" ./cmd/ynx-consensus-key-init >"$work/build.stdout" 2>"$work/build.stderr"

preflight_key_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_dir="/etc/ynx/consensus-candidate/$role"
  if [[ "$mode" == "create" ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "id -u ynx >/dev/null && sudo test ! -e '$key_dir' && sudo test ! -L '$key_dir' && systemctl is-active ynx-chaind >/dev/null" >"$work/$role.preflight.stdout" 2>"$work/$role.preflight.stderr"
  else
    # Metadata only. A missing directory/key/HRS is not evidence that identity
    # was never used; resume must never turn it into a new create operation.
    ynx_ops_ssh "$role" "$user" "$host" "$key" "id -u ynx >/dev/null && sudo test -d '$key_dir' && sudo test ! -L '$key_dir' && test \"\$(sudo realpath -e '$key_dir')\" = '$key_dir' && test \"\$(sudo stat -c %U:%a '$key_dir')\" = ynx:700 && for name in priv_validator_key.json priv_validator_state.json node_key.json; do sudo test -f '$key_dir'/\"\$name\" && sudo test ! -L '$key_dir'/\"\$name\" && sudo test -s '$key_dir'/\"\$name\" && test \"\$(sudo stat -c %U:%a:%h '$key_dir'/\"\$name\")\" = ynx:600:1 || exit 1; done && systemctl is-active ynx-chaind >/dev/null" >"$work/$role.preflight.stdout" 2>"$work/$role.preflight.stderr"
  fi
}
ynx_ops_each_node preflight_key_role

initialize_key_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local key_dir="/etc/ynx/consensus-candidate/$role" remote_stage="/var/tmp/ynx-consensus-key-ceremony-${commit}-${attempt}-${role}"
  local remote_binary="$remote_stage/ynx-consensus-key-init" remote_record="$remote_stage/public-record.json" prepare_custody='' finalize=''
  ynx_ops_ssh "$role" "$user" "$host" "$key" "umask 077; mkdir -m 0700 '$remote_stage' && (set -o noclobber; : > '$remote_binary')" >"$work/$role.reserve.stdout" 2>"$work/$role.reserve.stderr"
  ynx_ops_copy "$role" "$user" "$host" "$key" "$work/ynx-consensus-key-init" "$remote_binary" >"$work/$role.copy.stdout" 2>"$work/$role.copy.stderr"
  if [[ "$mode" == create ]]; then
    prepare_custody="sudo install -d -m 0750 -o root -g ynx /etc/ynx/consensus-candidate && "
    finalize=" && sudo chown -R ynx:ynx '$key_dir' && sudo chmod 0700 '$key_dir' && sudo chmod 0600 '$key_dir/priv_validator_key.json' '$key_dir/priv_validator_state.json' '$key_dir/node_key.json'"
  fi
  # Neither custody nor transport/public evidence is deleted after failure or
  # success. The only cat is the newly written PUBLIC record, never a key/HRS.
  ynx_ops_ssh "$role" "$user" "$host" "$key" "chmod 0755 '$remote_binary' && ${prepare_custody}sudo '$remote_binary' -mode '$mode' -owner-controlled -role '$role' -key-dir '$key_dir' -public-record '$remote_record' >/dev/null$finalize && sudo cat '$remote_record'" >"$work/public/$role.json.partial" 2>"$work/$role.ceremony.stderr"
  if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
    node -e 'const fs=require("fs"),p=process.argv[1],r=process.argv[2],v=JSON.parse(fs.readFileSync(p)); if(v.role!==r||v.custodyBoundary!=="owner-controlled-host-local"||!/^[0-9A-F]{40}$/.test(v.consensusAddress)||!/^[0-9a-f]{40}$/.test(v.nodeId)) process.exit(1)' "$work/public/$role.json.partial" "$role" >"$work/$role.validation.stdout" 2>"$work/$role.validation.stderr"
    (set -o noclobber; cat "$work/public/$role.json.partial" >"$work/public/$role.json")
  fi
}
ynx_ops_each_node initialize_key_role

if [[ "${DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  echo "candidate key ceremony dry-run completed; no keys were generated"
else
  echo "candidate public key records written to $work/public; secret keys remain mode-restricted on their assigned owner-controlled hosts"
fi
