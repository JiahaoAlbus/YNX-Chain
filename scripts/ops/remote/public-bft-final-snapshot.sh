#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# The preparation and remote execution share the same strict public-material
# reader. Neither branch reads a service environment or starts a node. The
# independent pins come from the original approved cutover, never SOURCE.json.
exec python3 -B - "$@" <<'PY'
import hashlib, json, os, re, resource, stat, subprocess, sys, time
from pathlib import Path

# This normal publish path already accepts at most one GiB in both the local
# candidate binding/Go summary and the Mac public transport. Do not infer the
# canonical exported length M from the live legacy state length S.
SNAPSHOT_MAX_BYTES = 1 << 30
SNAPSHOT_RESERVE_BYTES = 2 << 30

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

def snapshot_capacity(evidence):
    original(evidence)
    require(evidence.is_dir(), 'original snapshot filesystem required')
    fs = os.statvfs(evidence)
    available = fs.f_bavail * fs.f_frsize
    required = SNAPSHOT_MAX_BYTES + SNAPSHOT_RESERVE_BYTES
    require(available > required, 'insufficient original snapshot filesystem capacity')
    limits = resource.getrlimit(resource.RLIMIT_FSIZE)
    require(all(value == resource.RLIM_INFINITY or value >= SNAPSHOT_MAX_BYTES for value in limits),
            'existing file limit cannot support the original migration cap')
    return dict(version='YNX-NATIVE-SNAPSHOT-CAPACITY/v1', availableBytes=available,
                requiredBytes=required, device=evidence.stat().st_dev,
                exportCeilingBytes=SNAPSHOT_MAX_BYTES, reserveBytes=SNAPSHOT_RESERVE_BYTES,
                exportedMigrationBytes=None, fullFirstImportReady=False, growthReserved=False)

def snapshot_file_limit():
    # Child-only kernel ceiling; no host/process-wide tuning or caller override.
    # An oversized/uncertain original export remains failed and retained.
    resource.setrlimit(resource.RLIMIT_FSIZE, (SNAPSHOT_MAX_BYTES, SNAPSHOT_MAX_BYTES))

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

def tools_build_info(value, name, full_commit):
    fields(value, ('goVersion', 'path', 'settings', 'raw'))
    require(value['goVersion'] == 'go1.26.10' and type(value['path']) is str
            and value['path'].endswith('/cmd/' + name) and type(value['raw']) is str
            and 0 < len(value['raw'].encode('utf8')) <= 128 << 10,
            'offline original Go build identity differs')
    lines = value['raw'].splitlines()
    require(lines and lines[0].endswith('/' + name + ': go1.26.10'),
            'offline original Go metadata header differs')
    settings, main_path = {}, None
    for line in lines[1:]:
        if line.startswith('\tbuild\t'):
            key, equal, item = line[len('\tbuild\t'):].partition('=')
            require(equal and key not in settings, 'duplicate or invalid original build setting')
            if item.startswith('"'):
                item = decode(item.encode('utf8'))
            require(type(item) is str, 'invalid original build setting value')
            settings[key] = item
        elif line.startswith('\tpath\t'):
            require(main_path is None, 'duplicate original main package')
            main_path = line[len('\tpath\t'):]
    require(main_path == value['path'] and type(value['settings']) is dict
            and settings == value['settings'], 'offline BuildInfo raw/typed projection differs')
    for key, wanted in {'-buildmode': 'exe', '-trimpath': 'true', 'CGO_ENABLED': '0',
                        'GOOS': 'linux', 'GOARCH': 'amd64', 'vcs': 'git',
                        'vcs.revision': full_commit, 'vcs.modified': 'false'}.items():
        require(settings.get(key) == wanted, 'offline actual build setting differs: ' + key)
    require('-ldflags' not in settings, 'unexpected ldflags metadata under original trimpath toolchain')

def tools_record(root, full_commit, expected):
    original(root)
    names = ('ynx-chaind', 'ynx-consensus-package')
    require(root.is_dir() and {p.name for p in root.iterdir()} == set(names) | {'SOURCE.json'},
            'offline exporter bundle allowlist differs (8-ELF operator runtime is not an exporter)')
    actual, raw, _ = read(root / 'SOURCE.json', 256 << 10, True)
    require(actual['sha256'] == pin(expected), 'offline SOURCE.json differs from original approval pin')
    value = decode(raw)
    common = ('version', 'commit', 'runId', 'platform', 'purpose', 'binaries')
    require(type(value) is dict, 'offline SOURCE must be an object')
    version = value.get('version')
    if version == 'YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1':
        fields(value, common)
        require(len(raw) <= 16384, 'original v1 SOURCE bound exceeded')
    elif version == 'YNX-PQ-OFFLINE-MIGRATION-TOOLS/v2':
        fields(value, common + ('tree', 'runAttempt', 'controllerCI', 'sourceBefore', 'sourceAfter',
                               'runtimeStarted', 'deploymentReady', 'authorityGranted', 'executionReady'))
        require(type(value['tree']) is str and re.fullmatch('[0-9a-f]{40}', value['tree'])
                and value['tree'] != '0' * 40, 'offline original source tree differs')
        for label in ('sourceBefore', 'sourceAfter'):
            fields(value[label], ('head', 'tree', 'status'))
            require(value[label] == dict(head=full_commit, tree=value['tree'], status=''),
                    'offline source was not the same clean original checkout')
        fields(value['controllerCI'], ('commit', 'runId', 'runAttempt'))
        controller = value['controllerCI']
        require(type(controller['commit']) is str and re.fullmatch('[0-9a-f]{40}', controller['commit'])
                and controller['commit'] != '0' * 40, 'offline controller identity differs')
        for label in ('runId', 'runAttempt'):
            require(type(value[label]) is str and re.fullmatch('[1-9][0-9]{0,19}', value[label])
                    and int(value[label]) <= (1 << 64)-1 and controller[label] == value[label],
                    'offline controller run/attempt differs')
        require(all(value[label] is False for label in ('runtimeStarted', 'deploymentReady',
                                                       'authorityGranted', 'executionReady')),
                'offline build provenance cannot grant execution or activation')
    else:
        raise ValueError('unsupported offline exporter SOURCE version')
    require(value['commit'] == full_commit
            and re.fullmatch('[0-9a-f]{40}', full_commit) and value['platform'] == 'linux/amd64'
            and value['purpose'] == 'offline copied-state validation; not installed or activated'
            and type(value['runId']) is str and re.fullmatch('[1-9][0-9]*', value['runId']),
            'offline exporter source identity differs')
    fields(value['binaries'], names)
    for name in names:
        entry = value['binaries'][name]
        fields(entry, ('bytes', 'sha256') + (('goInfo',) if version.endswith('/v2') else ()))
        require(type(entry['bytes']) is int and 0 < entry['bytes'] <= 128 << 20, 'invalid tool size')
        pin(entry['sha256'])
        actual, _, original_identity = read(root / name, 128 << 20)
        require(actual == {key: entry[key] for key in ('bytes', 'sha256')},
                'offline tool differs from pinned SOURCE: ' + name)
        if version.endswith('/v2'):
            tools_build_info(entry['goInfo'], name, full_commit)
            # Read only the fixed ELF identification after the complete pinned
            # byte read. This does not execute the exporter or infer authority.
            descriptor = os.open(root / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
            with os.fdopen(descriptor, 'rb') as executable:
                require(identity(os.fstat(executable.fileno())) == original_identity,
                        'offline executable changed before ELF identification')
                header = executable.read(20)
                require(identity(os.fstat(executable.fileno())) == original_identity
                        and identity((root / name).lstat()) == original_identity,
                        'offline executable changed across ELF identification')
            require(header[:6] == b'\x7fELF\x02\x01' and header[18:20] == b'\x3e\x00',
                    'offline v2 executable is not Linux amd64 ELF')
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
    systemd = None
    if len(args) == expected + 4:
        require(len(args[-1].encode()) <= 65536, 'bounded original systemd pins required')
        systemd = decode(args[-1].encode())
        fields(systemd, ('fragmentSha256', 'dropIns'))
        pin(systemd['fragmentSha256'])
        require(type(systemd['dropIns']) is list and len(systemd['dropIns']) <= 16,
                'bounded original drop-in pins required')
        names = []
        for row in systemd['dropIns']:
            fields(row, ('path', 'sha256'))
            require(type(row['path']) is str and len(row['path']) <= 4096 and re.fullmatch(
                r'/etc/systemd/system/ynx-chaind\.service\.d/[A-Za-z0-9._-]+\.conf', row['path']),
                'canonical original native drop-in path required')
            pin(row['sha256'])
            names.append(row['path'])
        require(names == sorted(set(names)), 'sorted unique original drop-in pins required')
        args = args[:-1]
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
        if systemd is not None:
            native_identity['authoritativeSystemd'] = systemd
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
    capacity = snapshot_capacity(evidence)
    os.mkdir(attempt, 0o700)
    sync_dir(evidence)
    durable(attempt / 'intent.json', (json.dumps(dict(version='YNX-PUBLIC-BFT-SNAPSHOT-ATTEMPT/v1',
        transactionId=tx, commit=commit, snapshotSourceSha256=source_pin, exporterManifestSha256=manifest_pin,
        status='unknown', automaticRetry=False), separators=(',', ':')) + '\n').encode())
    durable(attempt / 'capacity.json', (json.dumps(capacity, separators=(',', ':')) + '\n').encode())
    # The normal exporter reserves its own output and preserves uncertain files.
    # It runs before any mutating constructor and receives no service env/keys.
    for label, command in (
        ('export', [str(bundle / 'ynx-chaind'), '--data-dir', str(Path(source['statePath']).parent), '--export-consensus-state', str(snapshot)]),
        ('verify', [str(bundle / 'ynx-consensus-package'), '-verify-migration-state', str(snapshot)])):
        with open(attempt / (label + '.stdout'), 'xb') as out, open(attempt / (label + '.stderr'), 'xb') as err:
            completed = subprocess.run(command, env=env, stdout=out, stderr=err, check=False,
                                       preexec_fn=snapshot_file_limit if label == 'export' else None)
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
    actual, _, _ = read(snapshot, SNAPSHOT_MAX_BYTES)
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
