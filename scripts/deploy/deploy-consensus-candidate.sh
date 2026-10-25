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
    chmod 0755 "$destination/$binary" || return
  done
}

# A key ceremony needs one fixed PUBLIC helper, not another eight-ELF bundle.
# Verify the complete original artifact once before reserving any new attempt.
# The new work root contains tool/{SOURCE.json,selected ELF}; that directory is
# deliberately not a runtime bundle and must never replace the original one.
prepare_runtime_tool() {
  [[ "$#" -eq 5 ]] || { echo 'runtime tool requires five fixed preparation inputs' >&2; return 1; }
  case "$5" in
    ynx-consensus-keycheck|ynx-consensus-pq-key-init|ynx-comet) ;;
    *) echo 'unapproved public runtime tool' >&2; return 1 ;;
  esac
  local originals_snapshot
  originals_snapshot="$(python3 -B - "$1" <<'SNAPSHOT'
import json, os, stat, sys
from pathlib import Path

def require(value, message):
    if not value:
        raise ValueError(message)

def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

try:
    root_arg = sys.argv[1]
    root = Path(root_arg)
    require(root.is_absolute() and str(root.resolve(strict=True)) == root_arg,
            'canonical original source directory required before validation')
    names = ('ynx-abci', 'ynx-comet', 'ynx-bft-gatewayd', 'ynx-consensus-pq-remote-signer',
             'ynx-consensus-pq-key-init', 'ynx-consensus-proof-verify', 'ynx-consensus-package', 'ynx-consensus-keycheck')
    operators = ('ynx-consensus-pq-remote-signer.service.in', 'ynx-consensus-pq-remote-signer-launch.sh',
                 'ynx-consensus-pq-remote-signer.conf.in')
    directories = {}
    for name, path in (('.', root), ('operator', root / 'operator')):
        before = path.lstat()
        require(stat.S_ISDIR(before.st_mode) and str(path.resolve(strict=True)) == str(path),
                'original source directory alias refused')
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            require(identity(os.fstat(fd)) == identity(before) == identity(path.lstat()),
                    'original directory changed during metadata observation')
        finally:
            os.close(fd)
        directories[name] = identity(before)
    require({path.name for path in root.iterdir()} == set(names) | {'SOURCE.json', 'operator'}
            and {path.name for path in (root / 'operator').iterdir()} == set(operators),
            'complete original source catalog required before validation')
    files = {}
    for name in ('SOURCE.json',) + names + tuple('operator/' + name for name in operators):
        path = root / name
        before = path.lstat()
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= 128 << 20,
                'original source must be bounded single-link regular data')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            require(identity(os.fstat(fd)) == identity(before) == identity(path.lstat()),
                    'original file changed during metadata observation')
        finally:
            os.close(fd)
        files[name] = identity(before)
    require(all(identity((root / name).lstat()) == value for name, value in files.items())
            and all(identity((root if name == '.' else root / name).lstat()) == value
                    for name, value in directories.items()), 'original snapshot changed during observation')
    raw = json.dumps(dict(directories=directories, files=files), sort_keys=True, separators=(',', ':'))
    require(len(raw) <= 16384, 'original metadata witness exceeds its bound')
    print(raw)
except (OSError, ValueError, TypeError) as error:
    print('runtime tool metadata rejected: ' + str(error), file=sys.stderr)
    sys.exit(1)
SNAPSHOT
  )" || return
  validate_runtime_bundle "$1" "$2" "$3" || return
  python3 -B - "$1" "$2" "$3" "$4" "$5" "$originals_snapshot" <<'PY'
import hashlib, json, os, stat, sys
from pathlib import Path

def require(value, message):
    if not value:
        raise ValueError(message)

def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'duplicate original SOURCE field')
        value[key] = item
    return value

read_identities = {}

def read_pin(path, maximum, original=None, material=False):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
            and 0 < before.st_size <= maximum, 'bounded single-link regular input required')
    require(original is None or identity(before) == original, 'original source identity changed')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as source:
        require(identity(os.fstat(source.fileno())) == identity(before), 'input changed before read')
        digest, size, header, chunks = hashlib.sha256(), 0, b'', []
        for chunk in iter(lambda: source.read(1 << 20), b''):
            size += len(chunk)
            require(size <= maximum, 'input exceeded its bound')
            digest.update(chunk)
            if not header:
                header = chunk[:64]
            if material:
                chunks.append(chunk)
        require(size == before.st_size and identity(os.fstat(source.fileno())) == identity(before)
                and identity(path.lstat()) == identity(before), 'input changed during read')
    read_identities[path] = identity(before)
    return dict(bytes=size, sha256=digest.hexdigest()), header, b''.join(chunks)

def copy_original(path, destination, wanted, maximum):
    before = path.lstat()
    require(identity(before) == originals[path], 'original changed before copy')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    target_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, 'rb') as source, os.fdopen(target_fd, 'wb') as target:
        require(identity(os.fstat(source.fileno())) == identity(before), 'source changed at copy open')
        digest, size = hashlib.sha256(), 0
        for chunk in iter(lambda: source.read(1 << 20), b''):
            size += len(chunk)
            require(size <= maximum, 'copy exceeded its source bound')
            digest.update(chunk)
            target.write(chunk)
        target.flush()
        os.fsync(target.fileno())
        require(dict(bytes=size, sha256=digest.hexdigest()) == wanted
                and identity(os.fstat(source.fileno())) == identity(before)
                and identity(path.lstat()) == identity(before), 'original copy bytes or identity differ')
    actual, header, _ = read_pin(destination, maximum)
    require(actual == wanted, 'selected copy readback differs')
    return actual, header

try:
    source_arg, commit, manifest_sha, work_arg, binary, snapshot_raw = sys.argv[1:]
    require(binary in ('ynx-consensus-keycheck', 'ynx-consensus-pq-key-init', 'ynx-comet'), 'fixed tool required')
    root, work = Path(source_arg), Path(work_arg)
    require(root.is_absolute() and str(root.resolve(strict=True)) == source_arg,
            'original canonical runtime path required')
    require(work.is_absolute() and str(work.parent.resolve(strict=True) / work.name) == work_arg
            and work.name not in ('', '.', '..') and work != root and root not in work.parents,
            'new canonical tool work root outside original bundle required')
    parent = work.parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.geteuid()
            and not parent.st_mode & 0o022, 'protected original work parent required')
    require(not os.path.lexists(work), 'tool work already exists; retain and reconcile UNKNOWN')
    names = ('ynx-abci', 'ynx-comet', 'ynx-bft-gatewayd', 'ynx-consensus-pq-remote-signer',
             'ynx-consensus-pq-key-init', 'ynx-consensus-proof-verify', 'ynx-consensus-package', 'ynx-consensus-keycheck')
    operators = ('ynx-consensus-pq-remote-signer.service.in', 'ynx-consensus-pq-remote-signer-launch.sh',
                 'ynx-consensus-pq-remote-signer.conf.in')
    require({path.name for path in root.iterdir()} == set(names) | {'SOURCE.json', 'operator'}
            and not (root / 'operator').is_symlink() and (root / 'operator').is_dir()
            and {path.name for path in (root / 'operator').iterdir()} == set(operators),
            'original full source catalog changed after validation')
    paths = [root / 'SOURCE.json'] + [root / name for name in names] + [root / 'operator' / name for name in operators]
    require(all(stat.S_ISREG(path.lstat().st_mode) and path.lstat().st_nlink == 1 for path in paths),
            'original full source file identity changed after validation')
    # Bind the pre-validation witness; never adopt a later source identity.
    require(len(snapshot_raw) <= 16384, 'original metadata witness exceeds its bound')
    snapshot = json.loads(snapshot_raw, object_pairs_hook=unique)
    require(type(snapshot) is dict and set(snapshot) == {'directories', 'files'}
            and type(snapshot['directories']) is dict and set(snapshot['directories']) == {'.', 'operator'}
            and type(snapshot['files']) is dict and set(snapshot['files']) == {str(path.relative_to(root)) for path in paths}
            and all(type(value) is list and len(value) == 9 and all(type(item) is int for item in value)
                    for group in snapshot.values() for value in group.values()), 'closed original metadata witness required')
    originals = {root / name: tuple(value) for name, value in snapshot['files'].items()}
    original_directories = {root if name == '.' else root / name: tuple(value)
                            for name, value in snapshot['directories'].items()}
    def source_snapshot_matches():
        return (all(identity(path.lstat()) == original for path, original in originals.items())
                and all(identity(path.lstat()) == original for path, original in original_directories.items()))
    require(source_snapshot_matches(), 'original source changed after full validation')
    source_pin, _, raw = read_pin(root / 'SOURCE.json', 128 << 10, originals[root / 'SOURCE.json'], True)
    require(source_pin['sha256'] == manifest_sha, 'original SOURCE independent pin changed')
    record = json.loads(raw.decode('utf8'), object_pairs_hook=unique)
    require(record['version'] == 'YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2' and record['commit'] == commit,
            'original runtime identity changed')
    wanted = record['binaries'][binary]
    require(set(wanted) == {'bytes', 'sha256'} and type(wanted['bytes']) is int
            and 1 << 20 < wanted['bytes'] <= 128 << 20, 'selected original bound required')
    work.mkdir(mode=0o700)
    require(str(work.resolve(strict=True)) == work_arg and work.lstat().st_uid == os.geteuid()
            and stat.S_IMODE(work.lstat().st_mode) == 0o700, 'exclusive private work reservation required')
    tool = work / 'tool'
    tool.mkdir(mode=0o700)
    def directory_identity(path):
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o700, 'private selected directory changed')
        return info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid, info.st_gid
    work_identity, tool_identity = directory_identity(work), directory_identity(tool)
    copy_original(root / 'SOURCE.json', tool / 'SOURCE.json', source_pin, 128 << 10)
    actual, header = copy_original(root / binary, tool / binary, wanted, 128 << 20)
    require(len(header) == 64 and header[:7] == b'\x7fELF\x02\x01\x01'
            and header[16:18] in (b'\x02\x00', b'\x03\x00')
            and header[18:24] == b'\x3e\x00\x01\x00\x00\x00', 'selected tool is not the original amd64 ELF')
    require(all(identity(path.lstat()) == original for path, original in originals.items()),
            'original runtime files changed during tool preparation')
    require({path.name for path in tool.iterdir()} == {'SOURCE.json', binary}, 'selected tool catalog changed')
    fd = os.open(tool / binary, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as target:
        require(identity(os.fstat(target.fileno())) == read_identities[tool / binary]
                and identity((tool / binary).lstat()) == read_identities[tool / binary],
                'selected tool was replaced before executable mode')
        os.fchmod(target.fileno(), 0o755)
        require(stat.S_IMODE(os.fstat(target.fileno()).st_mode) == 0o755
                and identity(os.fstat(target.fileno())) == identity((tool / binary).lstat()),
                'selected executable copy identity changed')
    require(all(identity(path.lstat()) == original for path, original in originals.items()),
            'original runtime files changed before preparation completion')
    require(source_snapshot_matches(), 'pre-validation original source witness changed before completion')
    require(directory_identity(work) == work_identity and directory_identity(tool) == tool_identity
            and str(work.resolve(strict=True)) == work_arg
            and identity((tool / 'SOURCE.json').lstat()) == read_identities[tool / 'SOURCE.json'],
            'selected directory or original SOURCE copy identity changed')
    receipt = dict(version='YNX-PUBLIC-RUNTIME-TOOL-PREPARATION/v1', classification='data',
        commit=commit, sourceManifestSHA256=manifest_sha, selectedTool=binary, binaryPin=actual,
        fullSourceBinaryCount=8, copiedBinaryCount=1, originalSourceUnchanged=True,
        selectedDirectoryIsRuntimeBundle=False, binaryExecuted=False, authorityGranted=False)
    fd = os.open(work / 'runtime-tool-prepared.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf8') as output:
        json.dump(receipt, output, sort_keys=True, separators=(',', ':'))
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
except (OSError, ValueError, TypeError, KeyError) as error:
    print('runtime tool rejected: ' + str(error), file=sys.stderr)
    sys.exit(1)
PY
}

# The operator plan is authority input, so its expected hash must come from the
# operator's independent environment. Never infer it from the candidate itself.
# The normal verifier rejects an operator package when this pin is absent.
verify_candidate_package() {
  local binary="$1" package_root="$2"
  local operator_pin="${CONSENSUS_CANDIDATE_OPERATOR_PLAN_SHA256:-}"
  if [[ -n "$operator_pin" ]]; then
    [[ "$operator_pin" =~ ^[0-9a-f]{64}$ ]] || { echo "CONSENSUS_CANDIDATE_OPERATOR_PLAN_SHA256 must be an independent lowercase SHA256 pin" >&2; return 1; }
    "$binary" -verify-package "$package_root" -operator-plan-hash "$operator_pin"
  else
    "$binary" -verify-package "$package_root"
  fi
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
cp "$work/runtime/SOURCE.json" "$work/runtime-SOURCE.json"
verify_candidate_package "$work/runtime/ynx-consensus-package" "$package_root"
operator_package=0
if [[ -n "${CONSENSUS_CANDIDATE_OPERATOR_PLAN_SHA256:-}" ]]; then
  # The normal verifier above has authenticated this precise operator mode.
  operator_package=1
  cp "$work/runtime/ynx-comet" "$work/runtime/ynx-consensus-keycheck" "$work/bin/"
else
  for binary in ynx-abci ynx-bft-gatewayd ynx-consensus-keycheck; do
    cp "$work/runtime/$binary" "$work/bin/$binary"
  done
  # Preserve the explicitly selected legacy external-ABCI package profile.
  cp "$work/runtime/ynx-comet" "$work/bin/cometbft"
fi

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
  local operator_package="${operator_package:-0}"
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
  if [[ "$operator_package" == 1 ]]; then
    cp "$work/bin/ynx-comet" "$work/bin/ynx-consensus-keycheck" "$stage/bin/"
  else
    cp "$work/bin/ynx-abci" "$work/bin/ynx-consensus-keycheck" "$work/bin/cometbft" "$stage/bin/"
  fi
  cp "$work/runtime-SOURCE.json" "$stage/runtime-SOURCE.json"
  if [[ "$role" == "primary" && "$operator_package" == 0 ]]; then
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
  if [[ "$operator_package" == 0 ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo '$remote_dir/bin/ynx-consensus-keycheck' -role-manifest '$remote_dir/role/role-manifest.json' -private-validator-key '/etc/ynx/consensus-candidate/$role/priv_validator_key.json' -node-key '/etc/ynx/consensus-candidate/$role/node_key.json'"
    ynx_ops_ssh "$role" "$user" "$host" "$key" "if sudo test -d /var/lib/ynx-chain/consensus-candidate; then sudo bash '$remote_dir/role/scripts/backup-candidate.sh' '/var/backups/ynx-chain/consensus-candidate-before-${release}-${role}.tar.gz'; fi"
  fi
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo bash '$remote_dir/role/scripts/install-candidate.sh'"
  if [[ "$role" == "primary" && "$operator_package" == 0 ]]; then
    ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo install -m 0755 -o root -g root '$remote_dir/bin/ynx-bft-gatewayd' '/var/lib/ynx-chain/consensus-candidate/bin/ynx-bft-gatewayd'"
  fi
}

[[ "${DEPLOY_DRY_RUN:-0}" == "1" ]] || candidate_mutation_started=1
ynx_ops_each_node deploy_candidate_role

verify_candidate_role() {
  local role="$1" user="$2" host="$3" key="$4" _kind="$5"
  local operator_package="${operator_package:-0}"
  local remote_dir="/opt/ynx-chain/consensus-candidates/${release}/${role}" remote_archive="/tmp/${release}-${role}.tar.gz" archive_hash
  archive_hash="$(shasum -a 256 "$work/${release}-${role}.tar.gz" | awk '{print $1}')"
  if [[ "$operator_package" == 1 ]]; then
    # Installation deliberately does not start the single writer. Compare the
    # installed files to this independently verified, hash-pinned release; a
    # service-active check here would falsely conflate staging with activation.
    ynx_ops_ssh "$role" "$user" "$host" "$key" "set -euo pipefail
sudo cmp '$remote_dir/bin/ynx-comet' '/var/lib/ynx-chain/consensus-candidate/bin/ynx-comet'
sudo cmp '$remote_dir/bin/ynx-consensus-keycheck' '/var/lib/ynx-chain/consensus-candidate/bin/ynx-consensus-keycheck'
sudo cmp '$remote_dir/role/role-manifest.json' '/var/lib/ynx-chain/consensus-candidate/role-manifest.json'
sudo cmp '$remote_dir/role/scripts/start-operator.sh' '/var/lib/ynx-chain/consensus-candidate/scripts/start-operator.sh'
for input in '$remote_dir/role/config/'*; do sudo cmp \"\$input\" \"/var/lib/ynx-chain/consensus-candidate/config/\$(basename -- \"\$input\")\"; done
test -f '$remote_archive'
test ! -L '$remote_archive'
printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c -"
    return
  fi
  # A later role or verification may fail. Keep every original package even
  # after this role succeeds, and verify its exact bytes instead of deleting it.
  ynx_ops_ssh "$role" "$user" "$host" "$key" "sudo bash '$remote_dir/role/scripts/verify-candidate.sh' && systemctl is-active ynx-chaind >/dev/null && test -f '$remote_archive' && test ! -L '$remote_archive' && printf '%s  %s\\n' '$archive_hash' '$remote_archive' | sha256sum -c -"
}

ynx_ops_each_node verify_candidate_role
deployment_complete=1
if [[ "$operator_package" == 1 ]]; then
  echo "single-App operator package installation path completed for $release; runtimeStarted=false publicDeployment=false pqActivation=false; original home, signing custody and public ingress retained"
  exit 0
fi
echo "candidate deployment path completed for $release; public ingress and authoritative ynx-chaind remain unchanged"
