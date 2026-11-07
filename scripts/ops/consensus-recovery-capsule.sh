#!/usr/bin/env bash
# Sourced only by pq_key_ceremony. Its finite role, original transport inputs,
# pq_absolute/pq_public_pin and explicit one-attempt policy remain in force.
# YNX-PQ-CAPSULE-OPS/v1 is independent of the old install-only CSP tuple.
pq_capsule_ceremony() {
  local runtime_manifest_pin=$manifest_pin
  local binding="${CONSENSUS_PQ_BINDING:-}" binding_pin="${CONSENSUS_PQ_BINDING_SHA256:-}"
  local record="${CONSENSUS_PQ_PUBLIC_RECORD:-}" record_pin="${CONSENSUS_PQ_PUBLIC_RECORD_SHA256:-}"
  local hrs_pin="${CONSENSUS_PQ_HRS_SHA256:-}" producer_pin="${CONSENSUS_PQ_CAPSULE_PRODUCER_BINARY_SHA256:-}"
  local operation="${CONSENSUS_PQ_CAPSULE_OPERATION_ID:-}" destination archive='' archive_pin='' manifest='' manifest_pin=''
  local target=$role name path pin maximum command binary_pin stage attempt
  local binary=ynx-consensus-pq-key-init
  [[ $phase == export-recovery-capsule || $phase == verify-recovery-capsule ]] || return 64
  [[ -z $approval && -z $recovery_parent && -z $recovery_manifest && -z "${CONSENSUS_PQ_EPOCH_REQUEST:-}" && -z "${CONSENSUS_PQ_EPOCH_REQUEST_SHA256:-}" && -z "${CONSENSUS_LEGACY_RECOVERY_ROLE_MANIFEST_SHA256:-}" && -z "${CONSENSUS_PQ_CAPSULE_CREDENTIAL_PATH:-}" ]] || { echo 'capsule phase cannot consume create/approval/legacy recovery or arbitrary credential inputs' >&2; return 1; }
  [[ $operation =~ ^[a-z0-9][a-z0-9._-]{0,95}$ && $operation != normal-csp-* ]] || { echo 'new fixed capsule operation required; old CSP operations cannot be replayed' >&2; return 1; }
  for pin in "$credential_pin" "$hrs_pin" "$producer_pin"; do
    [[ $pin =~ ^[0-9a-f]{64}$ && $pin != "$(printf '0%.0s' {1..64})" ]] || { echo 'independent encrypted credential, complete HRS and producer pins required' >&2; return 1; }
  done
  pq_public_pin "$genesis" "$genesis_pin" 67108864 && pq_public_pin "$binding" "$binding_pin" 262144 && pq_public_pin "$record" "$record_pin" 262144 || { echo 'independently pinned original genesis, complete binding and public record required' >&2; return 1; }
  if [[ $phase == export-recovery-capsule ]]; then
    destination="${CONSENSUS_PQ_CAPSULE_EXPORT_DIRECTORY:-}"
    [[ -z "${CONSENSUS_PQ_CAPSULE_SCRATCH_DIRECTORY:-}" && -z "${CONSENSUS_PQ_CAPSULE_ARCHIVE:-}" && -z "${CONSENSUS_PQ_CAPSULE_ARCHIVE_SHA256:-}" && -z "${CONSENSUS_PQ_CAPSULE_MANIFEST:-}" && -z "${CONSENSUS_PQ_CAPSULE_MANIFEST_SHA256:-}" ]] || { echo 'export cannot consume verify inputs' >&2; return 1; }
    pq_absolute "$out" && pq_absolute "$state" && [[ $out != "$state" && $out != "$state/"* && $state != "$out/"* ]] || { echo 'original disjoint custody and HRS directories required' >&2; return 1; }
  else
    [[ -z $out && -z $state && -z "${CONSENSUS_PQ_CAPSULE_EXPORT_DIRECTORY:-}" ]] || { echo 'verification cannot select or rewrite original custody/HRS paths' >&2; return 1; }
    destination="${CONSENSUS_PQ_CAPSULE_SCRATCH_DIRECTORY:-}"
    archive="${CONSENSUS_PQ_CAPSULE_ARCHIVE:-}"; archive_pin="${CONSENSUS_PQ_CAPSULE_ARCHIVE_SHA256:-}"
    manifest="${CONSENSUS_PQ_CAPSULE_MANIFEST:-}"; manifest_pin="${CONSENSUS_PQ_CAPSULE_MANIFEST_SHA256:-}"
    pq_public_pin "$archive" "$archive_pin" 4194304 && pq_public_pin "$manifest" "$manifest_pin" 262144 || { echo 'independently pinned original capsule and manifest required' >&2; return 1; }
    # Original normal CSP contract: primary's custodian is Singapore; every
    # other original role's custodian is primary. No caller-selected target.
    if [[ $role == primary ]]; then target=singapore; user=$SG_NODE_USER; host=$SG_NODE_HOST; key=$SG_NODE_SSH_KEY
    else target=primary; user=$PRIMARY_NODE_USER; host=$PRIMARY_NODE_HOST; key=$PRIMARY_NODE_SSH_KEY; fi
  fi
  pq_absolute "$destination" || { echo 'new canonical exclusive capsule directory required' >&2; return 1; }
  # Public correlation only. The unchanged Go CLI remains the sole capsule,
  # full-pair, dual-PoP, AEAD and complete HRS validator.
  python3 -B - "$phase" "$binding" "$record" "$out" "$state" "$manifest" "$manifest_pin" "$operation" "$producer_pin" "$genesis_pin" "$binding_pin" "$record_pin" "$hrs_pin" "$destination" <<'CAPSULE_INPUT'
import json, os, sys
phase, binding, record, out, state, manifest, mp, operation, producer, genesis, bp, rp, hp, destination = sys.argv[1:]
def unique(pairs):
    result = {}
    for k, v in pairs:
        if k in result: raise ValueError('duplicate public input key')
        result[k] = v
    return result
def read(path, expected):
    import hashlib
    with open(path, 'rb') as f: raw = f.read(262145)
    assert 0 < len(raw) <= 262144 and hashlib.sha256(raw).hexdigest() == expected
    return json.loads(raw, object_pairs_hook=unique)
try:
    b, r = read(binding, bp), read(record, rp)
    assert r['binding'] == b and r['format'] == 'YNX-CONSENSUS-PQ-CEREMONY-PUBLIC/v1'
    assert r['status'] == 'new_epoch_files_durable_registration_not_authorized'
    original = b['SignerStatePath']; custody = r['paths']['directory']
    assert type(original) is str and os.path.isabs(original) and os.path.normpath(original) == original
    assert original == r['paths']['state'] and original.endswith('/original-sign-state.json')
    for parent in (custody, os.path.dirname(original)):
        assert destination != parent and not destination.startswith(parent+'/') and not parent.startswith(destination+'/')
    if phase == 'export-recovery-capsule':
        assert custody == out and original == state+'/original-sign-state.json'
    else:
        m = read(manifest, mp)
        assert m['schema'] == 'YNX_OFFHOST_RECOVERY_RECEIVE/v1' and m['operationId'] == operation
        assert m['purpose'] == 'NORMAL_ENCRYPTED_BACKUP_TRANSPORT'
        assert m['producer'] == dict(tool='ynx-consensus-pq-key-init', contract='YNX-CONSENSUS-PQ-RECOVERY-CAPSULE/v1', binarySHA256=producer)
        assert m['epoch']['genesisSHA256'] == genesis
        members = m['members']; by_name = {x['path']: x for x in members}
        assert len(by_name) == len(members) == 6
        for name, pin in [('epoch/validator-binding.json', bp), ('epoch/new-epoch-public.json', rp), ('epoch/original-sign-state.json', hp)]:
            assert by_name[name]['sha256'] == pin
except (OSError, ValueError, TypeError, KeyError, AssertionError):
    sys.exit('capsule public inputs differ from independently pinned originals')
CAPSULE_INPUT
  [[ -n $work && ! -e $work && ! -L $work ]] || { echo 'new exclusive capsule work directory required; reconcile prior UNKNOWN' >&2; return 1; }
  source scripts/deploy/deploy-consensus-candidate.sh
  [[ $(git rev-parse HEAD) == "$full_commit" ]] || { echo 'operator source must match independently pinned runtime commit' >&2; return 1; }
  prepare_runtime_tool "$bundle" "$full_commit" "$runtime_manifest_pin" "$work" "$binary" || return
  work="$(cd "$work" && pwd -P)"
  trap 'status=$?; printf "capsule UNKNOWN/failed attempt retained (exit=%s): %s; reconcile originals without replay\n" "$status" "$work" >&2; exit "$status"' ERR
  mkdir -m 0700 -- "$work/public" "$work/ciphertext"
  binary_pin="$(python3 -B -c 'import json,sys; print(json.load(open(sys.argv[1]))["binaries"]["ynx-consensus-pq-key-init"]["sha256"])' "$work/tool/SOURCE.json")"
  pq_public_pin "$work/tool/$binary" "$binary_pin" 134217728
  [[ $phase != export-recovery-capsule || $producer_pin == "$binary_pin" ]] || { echo 'export producer differs from independent current runtime pin' >&2; return 1; }
  printf 'contract=YNX-PQ-CAPSULE-OPS/v1\nphase=%s\nrole=%s\ntarget=%s\ncommit=%s\nruntimeManifestSHA256=%s\nproducerSHA256=%s\noperation=%s\noriginalHRS_SHA256=%s\ndestination=%s\n' "$phase" "$role" "$target" "$full_commit" "$runtime_manifest_pin" "$producer_pin" "$operation" "$hrs_pin" "$destination" >"$work/intent.txt"
  if [[ ${DEPLOY_DRY_RUN:-0} == 1 ]]; then
    printf 'DRY RUN capsule %s role=%s custodian=%s: public inputs prepared; no credential, SSH, recovery or authority operation\n' "$phase" "$role" "$target"
    return 0
  fi
  attempt="$(basename "$(mktemp -d "$work/attempt.XXXXXXXXXXXX")")"
  stage="/var/tmp/ynx-consensus-pq-capsule-${full_commit:0:12}-${attempt}-${role}"
  ynx_ops_ssh "$target" "$user" "$host" "$key" "umask 077; mkdir -m 0700 '$stage'" >"$work/reserve.stdout" 2>"$work/reserve.stderr"
  ynx_ops_copy "$target" "$user" "$host" "$key" "$work/tool/$binary" "$stage/$binary" >"$work/binary.copy.stdout" 2>"$work/binary.copy.stderr"
  for name in genesis.json binding.json record.json; do
    case "$name" in genesis.json) path=$genesis ;; binding.json) path=$binding ;; record.json) path=$record ;; esac
    ynx_ops_copy "$target" "$user" "$host" "$key" "$path" "$stage/$name" >"$work/$name.copy.stdout" 2>"$work/$name.copy.stderr"
  done
  if [[ $phase == verify-recovery-capsule ]]; then
    ynx_ops_copy "$target" "$user" "$host" "$key" "$archive" "$stage/capsule.tar" >"$work/archive.copy.stdout" 2>"$work/archive.copy.stderr"
    ynx_ops_copy "$target" "$user" "$host" "$key" "$manifest" "$stage/MANIFEST.json" >"$work/manifest.copy.stdout" 2>"$work/manifest.copy.stderr"
  fi
  printf -v command '%q ' sudo -n /usr/bin/timeout --signal=TERM --kill-after=1 25 /usr/bin/env -i PATH=/usr/bin:/bin /bin/bash -s -- "$phase" "$role" "$target" "$stage" "$binary_pin" "$out" "$state" "$destination" "$operation" "$genesis_pin" "$binding_pin" "$record_pin" "$credential_pin" "$hrs_pin" "$producer_pin" "$archive_pin" "$manifest_pin"
  ynx_ops_ssh "$target" "$user" "$host" "$key" "$command" >"$work/public/$role.json.partial" 2>"$work/ceremony.stderr" <<'REMOTE_CAPSULE'
set -Eeuo pipefail
umask 077
[[ $# == 17 ]] || exit 64
phase=$1 role=$2 target=$3 stage=$4 binary_pin=$5 out=$6 state=$7 destination=$8 operation=$9
genesis_pin=${10} binding_pin=${11} record_pin=${12} credential_pin=${13} hrs_pin=${14} producer_pin=${15} archive_pin=${16} manifest_pin=${17}
binary=ynx-consensus-pq-key-init
fail() { printf 'capsule refused: %s; preserve original/UNKNOWN\n' "$1" >&2; exit 1; }
[[ $EUID == 0 && $(uname -s):$(uname -m) == Linux:x86_64 ]] || fail 'normal privileged Linux host required'
case "$role" in primary|singapore|silicon-valley|seoul) ;; *) fail 'finite original role required' ;; esac
case "$phase" in
  export-recovery-capsule) [[ $target == "$role" && $producer_pin == "$binary_pin" ]] || fail 'original producer role/image differs'; credential=/etc/credstore.encrypted/ynx-pq-recovery ;;
  verify-recovery-capsule)
    expected=primary; [[ $role != primary ]] || expected=singapore
    [[ $target == "$expected" && -z $out && -z $state ]] || fail 'independent original custodian differs'
    credential="/etc/credstore.encrypted/ynx-pq-offhost/$role/ynx-pq-recovery" ;;
  *) fail 'fixed capsule phase required' ;;
esac
for tool in /usr/sbin/runuser /usr/bin/sha256sum /usr/bin/stat /usr/bin/realpath /usr/bin/systemd-creds; do [[ -x $tool ]] || fail 'normal host tool missing'; done
owner=ynx-pq-signer; uid=$(id -u "$owner"); gid=$(id -g "$owner")
[[ $uid != 0 ]] || fail 'dedicated original signer identity required'
trusted_parent() {
  local directory=$1 observed mode
  [[ -d $directory && ! -L $directory && $(realpath -e -- "$directory") == "$directory" ]] || fail 'canonical existing parent required'
  while :; do
    read -r observed mode < <(stat -c '%u %a' -- "$directory")
    [[ $observed == 0 || $observed == "$uid" ]] && (( (8#$mode & 8#022) == 0 )) || fail 'ancestor writable by another identity'
    [[ $directory != / ]] || break
    directory=${directory%/*}; [[ -n $directory ]] || directory=/
  done
}
trusted_parent "${destination%/*}"
[[ $(stat -c '%u:%a' -- "${destination%/*}") == "$uid:700" && ! -e $destination && ! -L $destination ]] || fail 'new exclusive owner-controlled capsule case required'
trusted_parent "${credential%/*}"
[[ -f $credential && ! -L $credential && $(realpath -e -- "$credential") == "$credential" && $(stat -c '%u:%a:%h' -- "$credential") == 0:600:1 && $(sha256sum -- "$credential" | cut -d ' ' -f 1) == "$credential_pin" ]] || fail 'independent original encrypted credential differs'
credential_identity=$(stat -c '%d:%i:%u:%g:%a:%h:%s:%y:%z' -- "$credential")
[[ -d $stage && ! -L $stage && $(realpath -e -- "$stage") == "$stage" ]] || fail 'original transport stage required'
chown root:"$gid" -- "$stage"; chmod 0750 -- "$stage"
mkdir -m 0750 -- "$stage/verified"; chown root:"$gid" -- "$stage/verified"
names=("$binary" genesis.json binding.json record.json)
[[ $phase != verify-recovery-capsule ]] || names+=(capsule.tar MANIFEST.json)
for name in "${names[@]}"; do
  case "$name" in
    "$binary") pin=$binary_pin; maximum=134217728 ;;
    genesis.json) pin=$genesis_pin; maximum=67108864 ;;
    binding.json) pin=$binding_pin; maximum=262144 ;;
    record.json) pin=$record_pin; maximum=262144 ;;
    capsule.tar) pin=$archive_pin; maximum=4194304 ;;
    MANIFEST.json) pin=$manifest_pin; maximum=262144 ;;
  esac
  [[ -f $stage/$name && ! -L $stage/$name && $(stat -c %h -- "$stage/$name") == 1 ]] || fail 'original single-link transport input required'
  cp -P -- "$stage/$name" "$stage/verified/$name"
  path="$stage/verified/$name"
  [[ -f $path && ! -L $path && $(stat -c '%u:%h' -- "$path") == 0:1 && $(stat -c %s -- "$path") -gt 0 && $(stat -c %s -- "$path") -le $maximum && $(sha256sum -- "$path" | cut -d ' ' -f 1) == "$pin" ]] || fail 'independent runtime/input pin changed'
  chown root:"$gid" -- "$path"; chmod 0440 -- "$path"
done
stage="$stage/verified"; chmod 0750 -- "$stage/$binary"
if [[ $phase == export-recovery-capsule ]]; then
  trusted_parent "$out"; trusted_parent "$state"
  [[ $(stat -c '%u:%a' -- "$out") == "$uid:700" && $(stat -c '%u:%a' -- "$state") == "$uid:700" ]] || fail 'original private epoch directories required'
  for item in "$out/validator-binding.json:$binding_pin" "$out/new-epoch-public.json:$record_pin" "$state/original-sign-state.json:$hrs_pin"; do
    path=${item%:*}; pin=${item##*:}
    [[ -f $path && ! -L $path && $(stat -c '%u:%a:%h' -- "$path") == "$uid:600:1" && $(sha256sum -- "$path" | cut -d ' ' -f 1) == "$pin" ]] || fail 'original complete binding/public record/HRS differs'
  done
  args=(export-recovery-capsule --out-dir "$out" --state-dir "$state" --binding-sha256 "$binding_pin" --public-record-sha256 "$record_pin" --genesis "$stage/genesis.json" --genesis-sha256 "$genesis_pin" --recovery-fd 3 --operation-id "$operation" --export-dir "$destination")
else
  args=(verify-recovery-capsule --archive "$stage/capsule.tar" --archive-sha256 "$archive_pin" --manifest "$stage/MANIFEST.json" --manifest-sha256 "$manifest_pin" --binding "$stage/binding.json" --binding-sha256 "$binding_pin" --public-record "$stage/record.json" --public-record-sha256 "$record_pin" --genesis "$stage/genesis.json" --genesis-sha256 "$genesis_pin" --producer-binary-sha256 "$producer_pin" --recovery-fd 3 --scratch-dir "$destination")
fi
# Raw credential never crosses SSH, argv or the controller. pipefail retains
# late decrypt/consumer failure as UNKNOWN even if the CLI already wrote files.
/usr/bin/systemd-creds decrypt --name=ynx-pq-recovery "$credential" - | /usr/sbin/runuser -u ynx-pq-signer -- /usr/bin/env -i PATH=/usr/bin:/bin LANG=C TZ=UTC /bin/bash -c 'set -Eeuo pipefail; exec 3<&0; exec 0</dev/null; exec "$@"' bash "$stage/$binary" "${args[@]}"
[[ $(stat -c '%d:%i:%u:%g:%a:%h:%s:%y:%z' -- "$credential") == "$credential_identity" && $(sha256sum -- "$credential" | cut -d ' ' -f 1) == "$credential_pin" ]] || fail 'credential changed; retained result is UNKNOWN'
REMOTE_CAPSULE
  # Do not turn a failed/lost-ACK invocation into a new attempt or readback.
  # On success only encrypted capsule/public outputs can leave the host.
  if [[ $phase == export-recovery-capsule ]]; then
    for name in capsule.tar MANIFEST.json; do
      maximum=262145; path="$work/public/$name.partial"
      if [[ $name == capsule.tar ]]; then maximum=4194305; path="$work/ciphertext/$name.partial"; fi
      printf -v command '%q ' sudo -n /usr/sbin/runuser -u ynx-pq-signer -- /usr/bin/head -c "$maximum" -- "$destination/$name"
      ynx_ops_ssh "$target" "$user" "$host" "$key" "$command" >"$path" 2>"$work/$name.readback.stderr"
    done
    archive="$work/ciphertext/capsule.tar.partial"; manifest="$work/public/MANIFEST.json.partial"
  fi
  python3 -B - "$work/public/$role.json.partial" "$binding" "$binding_pin" "$operation" "$hrs_pin" "$archive" "$manifest" "$archive_pin" "$manifest_pin" <<'CAPSULE_RESULT'
import hashlib, json, sys
result, binding, binding_pin, operation, hrs, archive, manifest, expected_archive, expected_manifest = sys.argv[1:]
def unique(pairs):
    obj = {}
    for k, v in pairs:
        if k in obj: raise ValueError('duplicate result key')
        obj[k] = v
    return obj
try:
    with open(result, 'rb') as f: raw = f.read(262145)
    assert 0 < len(raw) <= 262144
    r = json.loads(raw, object_pairs_hook=unique)
    with open(binding, 'rb') as f: body = f.read(262145)
    assert 0 < len(body) <= 262144 and hashlib.sha256(body).hexdigest() == binding_pin
    b = json.loads(body, object_pairs_hook=unique)
    assert r['version'] == 'YNX-CONSENSUS-PQ-RECOVERY-CAPSULE/v1' and r['operationId'] == operation
    assert r['cryptographicRecoveryVerified'] is True
    for name in ('offHostSourceVerified','registryMembershipVerified','antiRollbackFreshness','authorityGranted','signingReady','runtimeResume','signaturesProduced','epochCreated','originalHRSWritten'): assert r[name] is False
    s = r['snapshot']; assert s['stateSHA256'] == hrs and s['originalSignerStatePath'] == b['SignerStatePath']
    for name in ('vaultAuthenticated','completeHRSValidated','publicStateOnly'): assert s[name] is True
    for name in ('registryMembershipVerified','antiRollbackFreshness','offHostSourceVerified','signingReady','authorityGranted','filesWritten','signaturesProduced'): assert s[name] is False
    for path, maximum, field, expected in [(archive,4194304,'archiveSHA256',expected_archive),(manifest,262144,'manifestSHA256',expected_manifest)]:
        with open(path, 'rb') as f: body = f.read(maximum+1)
        assert 0 < len(body) <= maximum and hashlib.sha256(body).hexdigest() == r[field]
        assert not expected or r[field] == expected
except (OSError, ValueError, TypeError, KeyError, AssertionError):
    sys.exit('capsule result/input readback differs; retain UNKNOWN without replay')
CAPSULE_RESULT
  (set -o noclobber; cat "$work/public/$role.json.partial" >"$work/public/$role.json")
  if [[ $phase == export-recovery-capsule ]]; then
    (set -o noclobber; cat "$archive" >"$work/ciphertext/capsule.tar")
    (set -o noclobber; cat "$manifest" >"$work/public/MANIFEST.json")
  fi
  printf 'Capsule %s role=%s custodian=%s result retained at %s; cryptographic DATA only, no offhost authority, signing, resume or activation\n' "$phase" "$role" "$target" "$work/public"
}
