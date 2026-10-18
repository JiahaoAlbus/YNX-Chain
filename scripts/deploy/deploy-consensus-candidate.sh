#!/usr/bin/env bash
set -Eeuo pipefail

# Verify the original CI artifact, never a locally rebuilt replacement. This
# function is also exercised directly by the isolated retention regression.
validate_runtime_bundle() {
  python3 -B - "$1" "$2" "$3" <<'PY'
import hashlib, json, os, re, stat, sys
from pathlib import Path

def require(value, message):
    if not value:
        raise ValueError(message)

def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate manifest field')
        result[key] = value
    return result

def exact_fields(value, names):
    require(type(value) is dict and set(value) == set(names), 'unexpected manifest fields')

def pin(value, maximum):
    exact_fields(value, ('bytes', 'sha256'))
    require(type(value['bytes']) is int and 0 < value['bytes'] <= maximum, 'invalid manifest byte count')
    require(type(value['sha256']) is str and re.fullmatch('[0-9a-f]{64}', value['sha256']), 'invalid manifest SHA256')

def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def read_file(path, maximum, material=False):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum,
            'source must be an original bounded regular file')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(descriptor, 'rb') as source:
        require(identity(before) == identity(os.fstat(source.fileno())), 'source changed before read')
        digest, size, head, chunks = hashlib.sha256(), 0, b'', []
        while True:
            chunk = source.read(1 << 20)
            if not chunk:
                break
            size += len(chunk)
            require(size <= maximum, 'source grew beyond its bound')
            digest.update(chunk)
            if not head:
                head = chunk[:64]
            if material:
                chunks.append(chunk)
        require(size == before.st_size and identity(before) == identity(os.fstat(source.fileno()))
                and identity(before) == identity(path.lstat()), 'source changed during read')
    return dict(bytes=size, sha256=digest.hexdigest()), head, b''.join(chunks)

try:
    root_arg, expected_commit, expected_manifest = sys.argv[1:]
    require(re.fullmatch('[0-9a-f]{40}', expected_commit) and re.fullmatch('[0-9a-f]{64}', expected_manifest),
            'independent full commit and manifest SHA256 pins are required')
    root = Path(root_arg)
    require(root.is_absolute() and str(root.resolve(strict=True)) == root_arg and root.is_dir(),
            'runtime bundle must be an original canonical absolute directory')
    names = ('ynx-abci', 'ynx-comet', 'ynx-bft-gatewayd', 'ynx-consensus-pq-remote-signer',
             'ynx-consensus-pq-key-init', 'ynx-consensus-proof-verify',
             'ynx-consensus-package', 'ynx-consensus-keycheck')
    operators = ('ynx-consensus-pq-remote-signer.service.in', 'ynx-consensus-pq-remote-signer-launch.sh',
                 'ynx-consensus-pq-remote-signer.conf.in')
    require(set(p.name for p in root.iterdir()) == set(names) | {'SOURCE.json', 'operator'},
            'runtime bundle has missing or unapproved entries')
    operator = root / 'operator'
    require(not operator.is_symlink() and operator.is_dir() and set(p.name for p in operator.iterdir()) == set(operators),
            'operator configuration allowlist differs')
    source_pin, _, raw = read_file(root / 'SOURCE.json', 128 << 10, True)
    require(source_pin['sha256'] == expected_manifest, 'SOURCE.json differs from independent manifest pin')
    record = json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                        parse_constant=lambda _: (_ for _ in ()).throw(ValueError('invalid JSON number')))
    exact_fields(record, ('version', 'commit', 'runId', 'platform', 'cometForkTree', 'goMod', 'goSum',
                         'proofVerifierContract', 'proofVerifierSources', 'binaries', 'operator',
                         'runtimeStarted', 'publicDeployment', 'pqActivation', 'purpose'))
    require(record['version'] == 'YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2'
            and record['commit'] == expected_commit and record['platform'] == 'linux/amd64',
            'runtime version, platform or independent commit differs')
    require(type(record['runId']) is str and re.fullmatch('[1-9][0-9]*', record['runId'])
            and type(record['cometForkTree']) is str and re.fullmatch('[0-9a-f]{40}', record['cometForkTree']),
            'runtime CI/source identity is invalid')
    require(all(record[name] is False for name in ('runtimeStarted', 'publicDeployment', 'pqActivation')),
            'build provenance must not claim activation or deployment')
    require(record['purpose'] == 'normal entrypoint binaries and operator configuration only; no keys, credentials, ledger or signing history'
            and record['proofVerifierContract'] == 'YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1', 'runtime contract differs')
    pin(record['goMod'], 16 << 20)
    pin(record['goSum'], 16 << 20)
    sources = ('internal/consensus/pq_light_proof.go', 'cmd/ynx-consensus-proof-verify/main.go',
               'cmd/ynx-consensus-proof-verify/trust.go')
    exact_fields(record['proofVerifierSources'], sources)
    for value in record['proofVerifierSources'].values():
        pin(value, 16 << 20)
    exact_fields(record['binaries'], names)
    exact_fields(record['operator'], operators)
    total = 0
    for name in names:
        wanted = record['binaries'][name]
        pin(wanted, 128 << 20)
        require(wanted['bytes'] > 1 << 20, 'runtime binary is below its build bound')
        actual, header, _ = read_file(root / name, 128 << 20)
        require(actual == wanted, 'runtime binary SHA256 or byte count differs: ' + name)
        require(len(header) == 64 and header[:7] == b'\x7fELF\x02\x01\x01'
                and header[16:18] in (b'\x02\x00', b'\x03\x00')
                and header[18:24] == b'\x3e\x00\x01\x00\x00\x00', 'runtime binary is not amd64 ELF: ' + name)
        total += actual['bytes']
    require(total <= 512 << 20, 'runtime aggregate build bound exceeded')
    for name in operators:
        wanted = record['operator'][name]
        pin(wanted, 1 << 20)
        actual, _, _ = read_file(operator / name, 1 << 20)
        require(actual == wanted, 'operator configuration differs: ' + name)
except (OSError, ValueError, TypeError, KeyError) as error:
    print('runtime bundle rejected: ' + str(error), file=sys.stderr)
    sys.exit(1)
PY
}

# Artifact downloads commonly reset mode to 0644. Preserve the source archive's
# extracted bytes/modes and create one exclusively reserved executable copy.
# A failed or UNKNOWN preparation is retained and must never be overwritten.
prepare_runtime_bundle() {
  local source_bundle="$1" expected_commit="$2" expected_manifest="$3" destination="$4"
  local parent leaf binary operator
  validate_runtime_bundle "$source_bundle" "$expected_commit" "$expected_manifest" || return
  parent="$(cd "$(dirname -- "$destination")" && pwd -P)" || return
  leaf="$(basename -- "$destination")"
  if [[ "$destination" != /* || "${parent%/}/$leaf" != "$destination" || "$leaf" == . || "$leaf" == .. || "$destination" == "$source_bundle" || "$destination" == "$source_bundle/"* ]]; then
    echo "runtime copy requires a new canonical absolute destination outside the original bundle" >&2
    return 1
  fi
  if ! (umask 077; mkdir -m 0700 -- "$destination"); then
    echo "runtime copy destination already exists or cannot be reserved; retain and reconcile the original attempt" >&2
    return 1
  fi
  mkdir -m 0700 -- "$destination/operator" || return
  for binary in ynx-abci ynx-comet ynx-bft-gatewayd ynx-consensus-pq-remote-signer ynx-consensus-pq-key-init ynx-consensus-proof-verify ynx-consensus-package ynx-consensus-keycheck; do
    cp -- "$source_bundle/$binary" "$destination/$binary" || return
  done
  cp -- "$source_bundle/SOURCE.json" "$destination/SOURCE.json" || return
  for operator in ynx-consensus-pq-remote-signer.service.in ynx-consensus-pq-remote-signer-launch.sh ynx-consensus-pq-remote-signer.conf.in; do
    cp -- "$source_bundle/operator/$operator" "$destination/operator/$operator" || return
  done
  validate_runtime_bundle "$destination" "$expected_commit" "$expected_manifest" || return
  for binary in ynx-abci ynx-comet ynx-bft-gatewayd ynx-consensus-pq-remote-signer ynx-consensus-pq-key-init ynx-consensus-proof-verify ynx-consensus-package ynx-consensus-keycheck; do
    chmod 0755 -- "$destination/$binary" || return
  done
}

# Original verification callers may reuse this exact parser without invoking
# deployment initialization, work-directory creation or any remote command.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

cd "$(dirname "$0")/../.."
# shellcheck source=../ops/lib.sh
source scripts/ops/lib.sh
ynx_ops_init

package_root="${CONSENSUS_CANDIDATE_PACKAGE:-}"
[[ -n "$package_root" && -d "$package_root" ]] || { echo "CONSENSUS_CANDIDATE_PACKAGE must reference a generated candidate package" >&2; exit 1; }
[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || { echo "pinned runtime deployment verification requires a Linux amd64 operator host; no native rebuild fallback is allowed" >&2; exit 1; }
runtime_bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:-}"
runtime_commit="${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}"
runtime_manifest_sha="${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}"
validate_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha"
[[ "$(git rev-parse HEAD)" == "$runtime_commit" ]] || { echo "deployment source must match the independently pinned runtime commit" >&2; exit 1; }
if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
  [[ "${CONSENSUS_CANDIDATE_APPROVED:-}" == "yes" ]] || { echo "CONSENSUS_CANDIDATE_APPROVED=yes is required" >&2; exit 1; }
fi
commit="${runtime_commit:0:12}"
release="ynx-consensus-candidate-${commit}"
work_root="${CONSENSUS_CANDIDATE_WORK_ROOT:-tmp/consensus-candidate-deploy}"
work="$work_root/${release}"
mkdir -p "$work_root"
if ! mkdir -m 0700 "$work"; then
  echo "candidate work already exists or cannot be reserved: $work; retain and reconcile the original attempt" >&2
  exit 1
fi
mkdir -p "$work/bin" "$work/roles"

echo "verifying pinned production candidate runtime for linux/amd64"
prepare_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha" "$(cd "$work" && pwd -P)/runtime"
for binary in ynx-abci ynx-bft-gatewayd ynx-consensus-keycheck; do
  cp "$work/runtime/$binary" "$work/bin/$binary"
done
cp "$work/runtime/SOURCE.json" "$work/runtime-SOURCE.json"
# The generated role keeps its established on-disk cometbft name. Its bytes
# are exactly the independently pinned normal ynx-comet entrypoint.
cp "$work/runtime/ynx-comet" "$work/bin/cometbft"
"$work/runtime/ynx-consensus-package" -verify-package "$package_root"

if [[ "${DEPLOY_DRY_RUN:-0}" != "1" ]]; then
  CONSENSUS_CANDIDATE_RUNTIME_BUNDLE="$(cd "$work/runtime" && pwd -P)" \
    bash scripts/verify/consensus-candidate-deploy-gate.sh
fi

candidate_mutation_started=0
deployment_complete=0
cleanup_failed_candidate_deploy() {
  local status="$?"
  trap - EXIT
  if [[ "$status" != "0" && "$candidate_mutation_started" == "1" && "$deployment_complete" == "0" ]]; then
    # A role may already have committed blocks, reserved H/R/S or returned
    # UNKNOWN. Another role's failure is not evidence that these writes can be
    # undone. Retain all services, keys, state, backups and staged artifacts;
    # recovery must reconcile the exact installed release and durable state.
    echo "candidate deployment failed for $release; all existing services, state, signer history, backups and staged artifacts are retained for exact-result recovery" >&2
  fi
  exit "$status"
}
trap cleanup_failed_candidate_deploy EXIT

deploy_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local role_source="$package_root/roles/$role"
  [[ -d "$role_source" ]] || { echo "candidate package is missing role $role" >&2; return 1; }
  local stage="$work/roles/$role" archive="$work/${release}-${role}.tar.gz"
  if [[ -e "$stage" || -L "$stage" || -e "$archive" || -L "$archive" ]]; then
    echo "candidate role artifacts already exist for $role; retain and reconcile the original attempt" >&2
    return 1
  fi
  mkdir -m 0700 "$stage"
  (umask 077; set -o noclobber; : > "$archive")
  mkdir -p "$stage/bin" "$stage/role"
  cp "$work/bin/ynx-abci" "$work/bin/ynx-consensus-keycheck" "$work/bin/cometbft" "$stage/bin/"
  cp "$work/runtime-SOURCE.json" "$stage/runtime-SOURCE.json"
  if [[ "$role" == "primary" ]]; then
    cp "$work/bin/ynx-bft-gatewayd" "$stage/bin/"
  fi
  cp -R "$role_source/." "$stage/role/"
  tar -czf "$archive" -C "$stage" .
  chmod 0600 "$archive"
  local archive_hash
  archive_hash="$(shasum -a 256 "$archive" | awk '{print $1}')"
  local remote_archive="/tmp/${release}-${role}.tar.gz" remote_dir="/opt/ynx-chain/consensus-candidates/${release}/${role}"
  # Reserve before ynx_ops_copy (whose normal transport uses cat > destination).
  # Atomic mkdir/noclobber also reject competing attempts after the existence
  # checks. Any failed reservation/copy leaves its evidence in place; a retry
  # must reconcile it, never truncate an earlier UNKNOWN package or release.
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail
if sudo test -e '$remote_dir' || sudo test -L '$remote_dir' || test -e '$remote_archive' || test -L '$remote_archive'; then
  echo 'candidate release or archive already exists; retain and reconcile the original attempt' >&2
  exit 1
fi
sudo install -d -m 0700 '/opt/ynx-chain/consensus-candidates/${release}'
sudo mkdir -m 0700 '$remote_dir'
(umask 077; set -o noclobber; : > '$remote_archive')"
  ynx_ops_copy "$role" "$user" "$host" "$key" "$archive" "$remote_archive"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail; test -f '$remote_archive'; test ! -L '$remote_archive'; test \"\$(stat -c %a '$remote_archive')\" = 600; printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c -; sudo test -d '$remote_dir'; if sudo test -L '$remote_dir'; then exit 1; fi; sudo tar -xzf '$remote_archive' -C '$remote_dir'"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo '$remote_dir/bin/ynx-consensus-keycheck' -role-manifest '$remote_dir/role/role-manifest.json' -private-validator-key '/etc/ynx/consensus-candidate/$role/priv_validator_key.json' -node-key '/etc/ynx/consensus-candidate/$role/node_key.json'"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "if sudo test -d /var/lib/ynx-chain/consensus-candidate; then sudo bash '$remote_dir/role/scripts/backup-candidate.sh' '/var/backups/ynx-chain/consensus-candidate-before-${release}-${role}.tar.gz'; fi"
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo bash '$remote_dir/role/scripts/install-candidate.sh'"
  if [[ "$role" == "primary" ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo install -m 0755 -o root -g root '$remote_dir/bin/ynx-bft-gatewayd' '/var/lib/ynx-chain/consensus-candidate/bin/ynx-bft-gatewayd'"
  fi
}

[[ "${DEPLOY_DRY_RUN:-0}" == "1" ]] || candidate_mutation_started=1
ynx_ops_each_node deploy_candidate_role

verify_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local remote_dir="/opt/ynx-chain/consensus-candidates/${release}/${role}" remote_archive="/tmp/${release}-${role}.tar.gz" archive_hash
  archive_hash="$(shasum -a 256 "$work/${release}-${role}.tar.gz" | awk '{print $1}')"
  # A later role or verification may fail. Keep every original package even
  # after this role succeeds, and verify its exact bytes instead of deleting it.
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo bash '$remote_dir/role/scripts/verify-candidate.sh' && systemctl is-active ynx-chaind >/dev/null && test -f '$remote_archive' && test ! -L '$remote_archive' && printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c -"
}

ynx_ops_each_node verify_candidate_role
deployment_complete=1
echo "candidate deployment path completed for $release; public ingress and authoritative ynx-chaind remain unchanged"
