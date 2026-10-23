#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# The preparation and remote execution share the same strict public-material
# reader. Neither branch reads a service environment or starts a node. The
# independent pins come from the original approved cutover, never SOURCE.json.
exec python3 -B - "$@" <<'PY'
import hashlib, json, os, re, stat, subprocess, sys, time
from pathlib import Path

def require(ok, message):
    if not ok:
        raise ValueError(message)

def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'duplicate JSON field')
        value[key] = item
    return value

def decode(raw):
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('invalid JSON constant')))

def fields(value, names):
    require(type(value) is dict and set(value) == set(names), 'unexpected public material fields')

def pin(value):
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value) and value != '0' * 64,
            'independent nonzero lowercase SHA256 is required')
    return value

def absolute(value):
    require(type(value) is str and re.fullmatch('/[A-Za-z0-9._/-]+', value)
            and str(Path(value)) == value and '..' not in Path(value).parts,
            'canonical absolute public path is required')
    return Path(value)

def original(path):
    require(str(path.resolve(strict=True)) == str(path), 'symlink or noncanonical original path')
    return path

def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)

def read(path, maximum, material=False):
    original(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum,
            'original bounded single-link regular file required: ' + str(path))
    digest, chunks, size = hashlib.sha256(), [], 0
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as stream:
        require(identity(before) == identity(os.fstat(stream.fileno())), 'file changed before read')
        while True:
            chunk = stream.read(65536)
            if not chunk:
                break
            size += len(chunk)
            require(size <= maximum, 'file grew beyond bound')
            digest.update(chunk)
            if material:
                chunks.append(chunk)
        require(size == before.st_size and identity(before) == identity(os.fstat(stream.fileno()))
                and identity(before) == identity(path.lstat()), 'file changed during read')
    return dict(bytes=size, sha256=digest.hexdigest()), b''.join(chunks), identity(before)

def durable(path, raw, mode=0o600):
    # Retain incomplete files on write/fsync failure. There is no cleanup trap,
    # replacement rename, retry or interpretation of an existing file as success.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
    sync_dir(path.parent)

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def absent(path):
    require(not os.path.lexists(path), 'existing output/partial/UNKNOWN must be preserved: ' + str(path))

def source_record(path, expected, tx, commit, native_release, bft_release, native_identity):
    actual, raw, _ = read(path, 16384, True)
    require(actual['sha256'] == pin(expected), 'snapshot source differs from original approval pin')
    value = decode(raw)
    names = ('version', 'transactionId', 'commit', 'authoritativeRelease', 'bftRelease',
                   'statePath', 'stateBytes', 'stateSHA256', 'integrityMarkerPath', 'integrityMarkerBytes',
                   'integrityMarkerSHA256', 'pauseMarkerPath', 'pauseMarkerSHA256',
                   'mutationMarkerPath', 'mutationMarkerSHA256', 'height', 'blockHash')
    fields(value, names + (('authoritativeCommit', 'authoritativeBinarySha256') if native_identity else ()))
    require(value['version'] == 'YNX-PUBLIC-BFT-SNAPSHOT-SOURCE/v1' and value['transactionId'] == tx
            and value['commit'] == commit and value['authoritativeRelease'] == native_release
            and value['bftRelease'] == bft_release, 'approved source identity mismatch')
    if native_identity:
        require(all(value[name] == native_identity[name] for name in ('authoritativeCommit', 'authoritativeBinarySha256'))
                and all(value[name] == filename for name, filename in native_identity['authoritativeSource'].items()),
                'final source differs from independently approved original native identity/paths')
    for key in ('stateBytes', 'integrityMarkerBytes', 'height'):
        require(type(value[key]) is str and re.fullmatch('[1-9][0-9]*', value[key]), 'noncanonical source integer')
    require(int(value['stateBytes']) <= 1 << 40 and int(value['integrityMarkerBytes']) <= 8,
            'source byte count exceeds bound')
    for key in ('stateSHA256', 'integrityMarkerSHA256', 'pauseMarkerSHA256', 'mutationMarkerSHA256'):
        pin(value[key])
    for key in ('statePath', 'integrityMarkerPath', 'pauseMarkerPath', 'mutationMarkerPath'):
        absolute(value[key])
    state = Path(value['statePath'])
    require(state.name == 'devnet-state.json' and value['integrityMarkerPath'] == str(state.parent / 'devnet-state.integrity-version'),
            'approved source must be the original native checkpoint and adjacent integrity marker')
    require(type(value['blockHash']) is str and re.fullmatch('(0x)?[0-9a-f]{64}', value['blockHash']),
            'invalid approved checkpoint block hash')
    return value, raw

def tools_record(root, full_commit, expected):
    original(root)
    names = ('ynx-chaind', 'ynx-consensus-package')
    require(root.is_dir() and {p.name for p in root.iterdir()} == set(names) | {'SOURCE.json'},
            'offline exporter bundle allowlist differs (8-ELF operator runtime is not an exporter)')
    actual, raw, _ = read(root / 'SOURCE.json', 16384, True)
    require(actual['sha256'] == pin(expected), 'offline SOURCE.json differs from original approval pin')
    value = decode(raw)
    fields(value, ('version', 'commit', 'runId', 'platform', 'purpose', 'binaries'))
    require(value['version'] == 'YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1' and value['commit'] == full_commit
            and re.fullmatch('[0-9a-f]{40}', full_commit) and value['platform'] == 'linux/amd64'
            and value['purpose'] == 'offline copied-state validation; not installed or activated'
            and type(value['runId']) is str and re.fullmatch('[1-9][0-9]*', value['runId']),
            'offline exporter source identity differs')
    fields(value['binaries'], names)
    for name in names:
        entry = value['binaries'][name]
        fields(entry, ('bytes', 'sha256'))
        require(type(entry['bytes']) is int and 0 < entry['bytes'] <= 128 << 20, 'invalid tool size')
        pin(entry['sha256'])
        actual, _, _ = read(root / name, 128 << 20)
        require(actual == entry, 'offline tool differs from pinned SOURCE: ' + name)
    return value

def check_source(value, tx, commit, release, native_identity=None):
    observed = {}
    for kind in ('state', 'integrityMarker', 'pauseMarker', 'mutationMarker'):
        path = Path(value[kind + 'Path'])
        maximum = (1 << 40) if kind == 'state' else 65536
        actual, raw, ident = read(path, maximum, kind != 'state')
        require(actual['sha256'] == value[kind + 'SHA256'], 'approved source/marker hash mismatch: ' + kind)
        if kind in ('state', 'integrityMarker'):
            require(actual['bytes'] == int(value[kind + 'Bytes']), 'approved source byte count mismatch')
        if kind == 'integrityMarker':
            require(raw in (b'2\n', b'3\n'), 'original integrity marker is not a supported exact version')
        if kind in ('pauseMarker', 'mutationMarker'):
            marker = decode(raw)
            require(marker.get('transactionId') == tx and marker.get('commit') == commit
                    and marker.get('bftRelease') == release, 'transaction-bound original marker required')
            if native_identity:
                require(marker.get('authoritativeRelease') == value['authoritativeRelease']
                        and marker.get('authoritativeCommit') == native_identity['authoritativeCommit'],
                        'original marker native identity mismatch')
        observed[kind] = (actual, ident)
    return observed

def main():
    args = sys.argv[1:]
    prepare = args and args[0] == '--prepare'
    expected = 11 if prepare else 15
    native_identity = None
    if len(args) == expected + 3:
        native_full, native_binary, native_paths = args[-3:]
        args = args[:-3]
        require(re.fullmatch('[0-9a-f]{40}', native_full) and native_full != '0' * 40,
                'independent original native full commit required')
        native_paths = decode(native_paths.encode())
        fields(native_paths, ('statePath', 'integrityMarkerPath', 'pauseMarkerPath', 'mutationMarkerPath'))
        for filename in native_paths.values():
            absolute(filename)
        native_identity = dict(authoritativeCommit=native_full, authoritativeBinarySha256=pin(native_binary),
                               authoritativeSource=native_paths)
    if prepare:
        require(len(args) == 11, 'offline preparation requires exact public inputs')
        _, source_path, bundle, full_commit, source_pin, manifest_pin, tx, commit, native, release, destination = args
    else:
        require(len(args) == 15, 'final snapshot requires independently approved source and offline exporter pins')
        tx, commit, native, release, pause, mutation, evidence, url, config_root, bundle, observation, source_path, source_pin, manifest_pin, full_commit = args
        require(re.fullmatch('[1-9][0-9]*', observation) and int(observation) <= 15, 'invalid observation window')
        require(re.fullmatch(r'http://127\.0\.0\.1:[0-9]{4,5}', url), 'invalid local status URL')
        original(absolute(config_root))
    native_short = native_identity['authoritativeCommit'][:12] if native_identity else commit
    native_releases = ('ynx-chain-' + native_short, 'ynx-network-surgical-' + native_short) if native_identity else ('ynx-chain-' + commit,)
    require(re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', tx) and re.fullmatch('[0-9a-f]{12}', commit)
            and native in native_releases and release == 'ynx-bft-gateway-' + commit
            and full_commit[:12] == commit, 'final snapshot transaction/source identity mismatch')
    source, source_raw = source_record(absolute(source_path), source_pin, tx, commit, native, release, native_identity)
    bundle = absolute(bundle)
    tools = tools_record(bundle, full_commit, manifest_pin)
    if prepare:
        destination = absolute(destination)
        original(destination.parent)
        os.mkdir(destination, 0o700)
        sync_dir(destination.parent)
        os.mkdir(destination / 'tools', 0o700)
        sync_dir(destination)
        durable(destination / 'snapshot-source.json', source_raw)
        for name in ('SOURCE.json', 'ynx-chaind', 'ynx-consensus-package'):
            _, raw, _ = read(bundle / name, 128 << 20, True)
            durable(destination / 'tools' / name, raw, 0o600 if name == 'SOURCE.json' else 0o700)
        tools_record(destination / 'tools', full_commit, manifest_pin)
        return
    require(source['pauseMarkerPath'] == pause and source['mutationMarkerPath'] == mutation,
            'approved original marker path mismatch')
    evidence = original(absolute(evidence))
    require(evidence.is_dir(), 'original evidence directory required')
    # A fixture root is only an isolation boundary. It cannot select a different
    # state: the exact state and both markers still come from the external pin.
    root = Path(config_root)
    require(all(Path(source[k]).is_relative_to(root) for k in ('statePath', 'integrityMarkerPath', 'pauseMarkerPath', 'mutationMarkerPath')),
            'approved source is outside the explicit original root')
    before = check_source(source, tx, commit, release, native_identity)
    _, raw, _ = read(evidence / 'primary-pause-authoritative.json', 65536, True)
    pause_record = decode(raw)
    require(pause_record.get('transactionId') == tx and pause_record.get('commit') == commit
            and pause_record.get('bftRelease') == release and pause_record.get('productionStateVerified') is True,
            'validated original authoritative pause evidence required')
    if native_identity:
        require(pause_record.get('authoritativeRelease') == native
                and pause_record.get('authoritativeCommit') == native_identity['authoritativeCommit'],
                'original pause evidence native identity mismatch')
    snapshot, metadata, attempt = (evidence / 'final-migration-state.json',
                                  evidence / 'final-migration-state.evidence.json', evidence / 'snapshot-attempt')
    for path in (snapshot, metadata, attempt, Path(str(snapshot) + '.partial-' + tx),
                 Path(str(snapshot) + '.tmp'), Path(str(snapshot) + '.UNKNOWN'), Path(str(metadata) + '.partial')):
        absent(path)
    env = {'PATH': '/usr/bin:/bin'}
    def status():
        raw = subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--max-time', '10', url + '/status'], env=env)
        require(len(raw) <= 65536, 'status response exceeds bound')
        value = decode(raw)
        require(type(value.get('height')) is int and str(value['height']) == source['height']
                and value.get('latestBlockHash') == source['blockHash'], 'paused status differs from approved checkpoint')
        if native_identity:
            require(value.get('build', {}).get('commit') == native_short
                    and value.get('build', {}).get('release') == native,
                    'paused native status build differs from original approval')
    status()
    time.sleep(int(observation))
    status()
    os.mkdir(attempt, 0o700)
    sync_dir(evidence)
    durable(attempt / 'intent.json', (json.dumps(dict(version='YNX-PUBLIC-BFT-SNAPSHOT-ATTEMPT/v1',
        transactionId=tx, commit=commit, snapshotSourceSha256=source_pin, exporterManifestSha256=manifest_pin,
        status='unknown', automaticRetry=False), separators=(',', ':')) + '\n').encode())
    # The normal exporter reserves its own output and preserves uncertain files.
    # It runs before any mutating constructor and receives no service env/keys.
    for label, command in (
        ('export', [str(bundle / 'ynx-chaind'), '--data-dir', str(Path(source['statePath']).parent), '--export-consensus-state', str(snapshot)]),
        ('verify', [str(bundle / 'ynx-consensus-package'), '-verify-migration-state', str(snapshot)])):
        with open(attempt / (label + '.stdout'), 'xb') as out, open(attempt / (label + '.stderr'), 'xb') as err:
            completed = subprocess.run(command, env=env, stdout=out, stderr=err, check=False)
            out.flush(); os.fsync(out.fileno()); err.flush(); os.fsync(err.fileno())
            durable(attempt / (label + '.exit-code'), (str(completed.returncode) + '\n').encode())
            completed.check_returncode()
    _, verified, _ = read(attempt / 'verify.stdout', 65536, True)
    match = re.fullmatch(rb'consensus migration state passed: height=([1-9][0-9]*) lastBlockHash=((?:0x)?[0-9a-f]{64}) stateHash=([0-9a-f]{64}) accounts=([0-9]+) validators=([0-9]+)\n', verified)
    require(match and match[1].decode() == source['height'] and match[2].decode() == source['blockHash'],
            'normal migration verifier did not confirm the exact approved checkpoint')
    status()
    require(check_source(source, tx, commit, release, native_identity) == before, 'original source or markers changed across export')
    source_record(absolute(source_path), source_pin, tx, commit, native, release, native_identity)
    tools_record(bundle, full_commit, manifest_pin)
    actual, _, _ = read(snapshot, 1 << 40)
    result = dict(transactionId=tx, commit=commit, authoritativeRelease=native, bftRelease=release,
                  height=int(source['height']), lastBlockHash=source['blockHash'], stateHash=match[3].decode(),
                  sha256=actual['sha256'], snapshotSourceSha256=source_pin, exporterManifestSha256=manifest_pin,
                  exporterCommit=full_commit, pauseVerified=True, mutationFreezeVerified=True,
                  sourceUnchanged=True, validated=True, reused=False, deployment=False, runtimeStarted=False,
                  recordedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    if native_identity:
        result.update(native_identity)
    durable(metadata, (json.dumps(result, separators=(',', ':')) + '\n').encode())
    for key, value in result.items():
        print(str(key) + '=' + (str(value).lower() if type(value) is bool else str(value)))

try:
    main()
except Exception as error:
    print('final snapshot refused; retain original inputs/partial/UNKNOWN: ' + type(error).__name__ + ': ' + str(error), file=sys.stderr)
    sys.exit(1)
PY
