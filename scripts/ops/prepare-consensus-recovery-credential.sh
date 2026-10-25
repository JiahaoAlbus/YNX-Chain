#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# One original role, original transport and same-source normal eight-ELF DATA.
# This is a separate, explicitly approved host-local provisioning action. It
# neither creates an epoch, approves a validator, starts services nor sets up
# /var/lib/systemd/credential.secret. The normal target CLI refuses absent OS
# setup and protects its existing host-key directory in a private namespace.
[[ $# == 0 ]] || { echo 'credential preparation accepts no arguments' >&2; exit 64; }
source "$(dirname "$0")/lib.sh"
ynx_ops_init
export YNX_DEPLOY_CONNECTION_ATTEMPTS=1
[[ ${CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED:-} == yes ]] || { echo 'explicit original-owner ceremony approval is required' >&2; exit 1; }
[[ -z ${CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME:-} ]] || { echo 'retain the original UNKNOWN; credential provisioning has no resume or retry' >&2; exit 64; }
role=${CONSENSUS_CANDIDATE_KEY_ROLE:-}
case "$role" in
  primary) user=$PRIMARY_NODE_USER; host=$PRIMARY_NODE_HOST; key=$PRIMARY_NODE_SSH_KEY ;;
  singapore) user=$SG_NODE_USER; host=$SG_NODE_HOST; key=$SG_NODE_SSH_KEY ;;
  silicon-valley) user=$SILICON_VALLEY_NODE_USER; host=$SILICON_VALLEY_NODE_HOST; key=$SILICON_VALLEY_NODE_SSH_KEY ;;
  seoul) user=$SEOUL_NODE_USER; host=$SEOUL_NODE_HOST; key=$SEOUL_NODE_SSH_KEY ;;
  *) echo 'one original credential host role is required' >&2; exit 64 ;;
esac
bundle=${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:-}
commit=${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}
manifest_pin=${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}
work=${CONSENSUS_CANDIDATE_KEY_WORK_ROOT:-}
[[ $commit =~ ^[0-9a-f]{40}$ && $manifest_pin =~ ^[0-9a-f]{64}$ ]] || { echo 'independent full runtime commit and SOURCE pin are required' >&2; exit 1; }
[[ $work == /* && $work != / && $work != */ && ! -e $work && ! -L $work ]] || { echo 'new exclusive work directory required; preserve previous UNKNOWN' >&2; exit 1; }
source scripts/deploy/deploy-consensus-candidate.sh
ynx_require_clean_worktree
[[ $(git rev-parse HEAD) == "$commit" ]] || { echo 'operator source must match the actual normal runtime commit' >&2; exit 1; }
validate_runtime_bundle "$bundle" "$commit" "$manifest_pin"
mkdir -m 0700 -- "$work"
work=$(cd "$work" && pwd -P)
trap 'status=$?; printf "credential UNKNOWN/failed attempt retained (exit=%s): %s; inspect original, never regenerate automatically\n" "$status" "$work" >&2; exit "$status"' ERR
printf 'phase=provision-recovery-credential\nrole=%s\ncommit=%s\nruntimeManifestSHA256=%s\ntarget=/etc/credstore.encrypted/ynx-pq-recovery\nplaintextTransport=false\nretry=false\n' "$role" "$commit" "$manifest_pin" >"$work/intent.txt"
prepare_runtime_bundle "$bundle" "$commit" "$manifest_pin" "$work/runtime"
binary_pin=$(python3 -B -c 'import json,sys; from pathlib import Path; print(json.loads((Path(sys.argv[1])/"SOURCE.json").read_bytes())["binaries"]["ynx-consensus-pq-key-init"]["sha256"])' "$work/runtime")
[[ $binary_pin =~ ^[0-9a-f]{64}$ ]] || exit 1
attempt=$(basename "$(mktemp -d "$work/attempt.XXXXXXXXXXXX")")
stage="/var/tmp/ynx-consensus-pq-credential-${commit:0:12}-${attempt}-${role}"
ynx_ops_ssh "$role" "$user" "$host" "$key" "umask 077; mkdir -m 0700 '$stage'" >"$work/reserve.stdout" 2>"$work/reserve.stderr"
ynx_ops_copy "$role" "$user" "$host" "$key" "$work/runtime/ynx-consensus-pq-key-init" "$stage/ynx-consensus-pq-key-init" >"$work/binary.copy.stdout" 2>"$work/binary.copy.stderr"
printf -v command '%q ' sudo -n /usr/bin/timeout --signal=TERM --kill-after=1 25 /usr/bin/env -i PATH=/usr/bin:/bin /bin/bash -s -- "$stage" "$binary_pin"
ynx_ops_ssh "$role" "$user" "$host" "$key" "$command" >"$work/credential.json.partial" 2>"$work/provision.stderr" <<'REMOTE_CREDENTIAL'
set -Eeuo pipefail
umask 077
ulimit -c 0
stage=$1 pin=$2
[[ $stage =~ ^/var/tmp/ynx-consensus-pq-credential-[0-9a-f]{12}-attempt\.[A-Za-z0-9]{12}-(primary|singapore|silicon-valley|seoul)$ && $pin =~ ^[0-9a-f]{64}$ ]] || exit 1
[[ -d $stage && ! -L $stage && $(realpath -e -- "$stage") == "$stage" ]] || exit 1
chown 0:0 -- "$stage"
chmod 0700 -- "$stage"
[[ -f $stage/ynx-consensus-pq-key-init && ! -L $stage/ynx-consensus-pq-key-init && $(stat -c %h -- "$stage/ynx-consensus-pq-key-init") == 1 ]] || exit 1
mkdir -m 0700 -- "$stage/verified"
cp -P -- "$stage/ynx-consensus-pq-key-init" "$stage/verified/ynx-consensus-pq-key-init"
[[ $(stat -c '%u:%h' -- "$stage/verified/ynx-consensus-pq-key-init") == 0:1 && $(sha256sum -- "$stage/verified/ynx-consensus-pq-key-init" | cut -d ' ' -f 1) == "$pin" ]] || exit 1
chmod 0755 -- "$stage/verified/ynx-consensus-pq-key-init"
exec "$stage/verified/ynx-consensus-pq-key-init" provision-recovery-credential
REMOTE_CREDENTIAL
if [[ ${DEPLOY_DRY_RUN:-0} != 1 ]]; then
  python3 -B - "$work/credential.json.partial" <<'PUBLIC_CREDENTIAL'
import json, re, sys
from pathlib import Path
raw = Path(sys.argv[1]).read_bytes()
assert 0 < len(raw) <= 8192
def unique(pairs):
    out = {}
    for key, value in pairs:
        assert key not in out
        out[key] = value
    return out
v = json.loads(raw, object_pairs_hook=unique)
assert set(v) == {'version', 'classification', 'credentialPath', 'ciphertextSHA256', 'ciphertextBytes', 'ownerUID', 'mode', 'encryptionProfile', 'ciphertextInstalled', 'localRoundTripVerified', 'machineKeyCreated', 'hostKeyUnchanged', 'offHostRecoveryVerified', 'hrsHistoryVerified', 'authorityGranted', 'signingPerformed', 'serviceChanged'}
assert v['version'] == 'YNX-PQ-RECOVERY-CREDENTIAL-PROVISION/v1' and v['classification'] == 'data'
assert v['credentialPath'] == '/etc/credstore.encrypted/ynx-pq-recovery'
assert re.fullmatch('[0-9a-f]{64}', v['ciphertextSHA256']) and v['ciphertextSHA256'] != '0'*64
assert re.fullmatch('[1-9][0-9]*', v['ciphertextBytes']) and int(v['ciphertextBytes']) <= 1 << 20
assert v['ownerUID'] == '0' and v['mode'] == '600' and v['encryptionProfile'] == 'systemd-default-auto'
assert all(v[k] is True for k in ('ciphertextInstalled', 'localRoundTripVerified', 'hostKeyUnchanged'))
assert all(v[k] is False for k in ('machineKeyCreated', 'offHostRecoveryVerified', 'hrsHistoryVerified', 'authorityGranted', 'signingPerformed', 'serviceChanged'))
PUBLIC_CREDENTIAL
  mv -- "$work/credential.json.partial" "$work/credential.json"
fi
echo "Credential preparation finished: $work"
