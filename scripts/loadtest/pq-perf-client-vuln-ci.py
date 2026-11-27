"""Hosted, source-only 70e client govulncheck using the original resource Window."""
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import sys
import threading

ROOT = Path(__file__).resolve().parent
SOURCE = '70e7e450997a0ae77dbad5a8be3682f482c6ddd8'
TREE = '4866cc3924c060eb6a29939915d39b1c5c625607'
FORK = 'fa760970088d4f1a275d4cab254d63a014db9c74'
PROFILES = {
    'original70e': (SOURCE, TREE, FORK),
    'fixed-e339': ('e33955c90f05ba929d2053a90b969cb4f6b4edc1',
        'eefd84ce10d74ebb91f5aa48c6d828d556d4cac1', '9f2065952854305d5b3c0b6ee9f323e7eb3e63b9'),
    'fixed-491188-go12611': ('491188519d038b361ce04faa80137e79a409bd0e',
        '1f1ee4d9c0fdafc258f9a64ceaa3548efcac028d', '3dc2cd40c99512ae628714d17ddb4dab2692e8c6'),
}
PROFILE_TOOLCHAINS = {'original70e': 'go1.26.10', 'fixed-e339': 'go1.26.10', 'fixed-491188-go12611': 'go1.26.11'}
FIXED_WEBSOCKET = 'v1.5.4-0.20240701034025-d67f41855da4'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


cross = load('perf_vuln_original_cross', 'pq-synthetic-header-cross-source-ci.py')
events = load('perf_vuln_original_events', 'pq-perf-client-vuln-events.py')
lab, driver = cross.lab, cross.driver
UNKNOWN_STREAM_CUSTODY = []


def check_profile(profile, actual):
    lab.require(profile in PROFILES and type(actual) is list and actual == list(PROFILES[profile]),
        'exact original source/tree/fork identity differs')


class OnceStream:
    """Keep one close responsibility; an uncertain close is never retried."""
    def __init__(self, stream, path):
        self.stream = stream; self.name = str(path); self.attempted = False

    @property
    def closed(self):
        return self.attempted or self.stream.closed

    def fileno(self):
        return self.stream.fileno()

    def close(self):
        if self.attempted: return
        self.attempted = True
        try: self.stream.close()
        except BaseException:
            UNKNOWN_STREAM_CUSTODY.append(self)
            raise


def register_stream(window, path, stop):
    # No resource lock is held across the filesystem open.
    stream = OnceStream(open(path, 'xb', buffering=0), path)
    try:
        os.fchmod(stream.fileno(), 0o600)
        if not window.lock.acquire(timeout=1):
            raise RuntimeError('original Window stream registration lock unavailable')
        try:
            lab.require(not stop.is_set() and not window.closed_for_launch and not window.launches_closed,
                'original Window closed before scanner stream registration')
            window.logs.append(('original-scanner-events', stream))
        finally:
            window.lock.release()
        return stream
    except BaseException as original:
        try: stream.close()
        except BaseException as close_error:
            original.add_note('scanner stream close outcome UNKNOWN: ' + type(close_error).__name__)
        raise


def launch_owned(window, state, name, command, stop, pass_fds):
    state.update(name=name, process=None)
    process = window.launch(name, command, thread_safe=True, private_log=True, stop=stop, pass_fds=pass_fds)
    state['process'] = process
    return process


def close_once(fds):
    active = sys.exc_info()[1]
    first_close_error = None
    for fd in fds:
        try: os.close(fd)
        except BaseException as error:
            if active is not None:
                active.add_note('source descriptor close outcome UNKNOWN: ' + type(error).__name__)
            elif first_close_error is None:
                first_close_error = error
    if active is None and first_close_error is not None:
        raise first_close_error


def read_log(path):
    """The original scanner may have an empty stderr; still bind its inode."""
    if path.lstat().st_size:
        return driver.commit_clock.read_original(path, lab.CAPS['logBytes'])
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        before = os.fstat(fd); named = path.lstat()
        lab.require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == 0
            and (before.st_dev, before.st_ino, before.st_mode, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
            == (named.st_dev, named.st_ino, named.st_mode, named.st_size, named.st_mtime_ns, named.st_ctime_ns)
            and os.read(fd, 1) == b'', 'empty original process stream identity differs')
        return b''
    finally:
        close_once([fd])


def hash_scanner_descriptor(fd, info):
    lab.require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 128 << 20,
        'scanner descriptor size unavailable')
    digest = hashlib.sha256(); count = 0
    while True:
        chunk = os.read(fd, min(65536, info.st_size + 1 - count))
        if not chunk: break
        digest.update(chunk); count += len(chunk)
        lab.require(count <= info.st_size, 'scanner descriptor grew beyond bound')
    lab.require(count == info.st_size, 'scanner descriptor truncated')
    return digest.digest()


def capture_failure(work, public, state, original, identity):
    public.mkdir(mode=0o700, exist_ok=True)
    failures, files = [], []
    log_path = work / '.private' / (str(state['name']) + '.log')
    for path, destination in ((log_path, 'failure-original-stderr.log'),
            (work / '.private/original-scanner-stderr.log', 'failure-scanner-stderr.log'),
            (work / '.private/original-scanner-events.json', 'failure-scanner-events.partial')):
        try:
            if path.exists():
                data = read_log(path)
                (public / destination).write_bytes(data)
                files.append(dict(name=destination, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
        except BaseException as error:
            failures.append(dict(file=destination, errorType=type(error).__name__))
    try: first_message = str(original); formatting_error = None
    except BaseException as error: first_message = None; formatting_error = type(error).__name__
    failure = dict(version='YNX-PERF-CLIENT-VULN-FAILURE/v1', status='UNKNOWN', source=identity['source'],
        toolsSource=identity['toolsSource'], runId=identity['runId'], attempt=identity['attempt'],
        failedOwnedCommand=state['name'], originalReturnCode=getattr(state['process'], 'returncode', None),
        firstCaughtErrorType=type(original).__name__, firstCaughtError=first_message,
        firstCaughtErrorFormattingErrorType=formatting_error, originalFiles=files,
        resourceOrCleanupOrdering='UNKNOWN', failureReadbackErrors=failures, runtimeAuthorized=False)
    encoded = (json.dumps(failure, sort_keys=True, separators=(',', ':')) + '\n').encode()
    (public / 'failure-metadata.json').write_bytes(encoded)
    print('YNX-PERF-CLIENT-VULN-FAILURE/v1 ' + encoded.decode(), end='')


def run_preserving(window, monitor, operation, post_retirement, work, public, state, identity):
    try:
        result = cross.run_owned(window, monitor, operation)
        state.update(name='post-retirement-readback', process=None)
        post_retirement(result)
        return result
    except BaseException as original:
        try: capture_failure(work, public, state, original, identity)
        except BaseException as error: original.add_note('failure evidence unavailable: ' + type(error).__name__)
        raise


def inventory(root, tree_bytes, *, expected_files=6065):
    """Rehash every tracked regular blob through root-relative no-follow descriptors."""
    records = tree_bytes.split(b'\0')
    lab.require(records[-1] == b'', 'truncated original source inventory')
    rootfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    digest = hashlib.sha256(); count = 0; total = 0
    try:
        for entry in records[:-1]:
            header, path = entry.split(b'\t', 1)
            mode, kind, expected = header.split(b' ')
            parts = path.split(b'/')
            lab.require(mode in (b'100644', b'100755') and kind == b'blob'
                and re.fullmatch(rb'[0-9a-f]{40}', expected) is not None
                and all(p not in (b'', b'.', b'..', b'.git') for p in parts), 'unexpected source tree entry')
            held = []
            try:
                parent = rootfd
                for part in parts[:-1]:
                    parent = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
                    held.append(parent)
                fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
                held.append(fd)
                before = os.fstat(fd)
                lab.require(stat.S_ISREG(before.st_mode) and (before.st_mode & 0o111 != 0) == (mode == b'100755')
                    and 0 <= before.st_size <= 1 << 30, 'source file shape differs')
                blob = hashlib.sha1(b'blob ' + str(before.st_size).encode() + b'\0')
                read = 0
                while True:
                    chunk = os.read(fd, min(65536, before.st_size + 1 - read))
                    if not chunk: break
                    blob.update(chunk); read += len(chunk)
                    lab.require(read <= before.st_size, 'tracked source grew beyond bound')
                after = os.fstat(fd)
                lab.require(read == before.st_size and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                    == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                    and blob.hexdigest().encode() == expected, 'tracked source bytes changed')
                count += 1; total += read; digest.update(entry + b'\0')
            finally:
                close_once(reversed(held))
        lab.require(type(expected_files) is int and count == expected_files, 'complete original tracked inventory differs')
        return dict(files=count, bytes=total, gitInventorySHA256=digest.hexdigest())
    finally:
        close_once([rootfd])


def main():
    lab.require(sys.platform == 'linux' and platform.machine() == 'x86_64'
        and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
        and os.environ.get('GITHUB_EVENT_NAME') == 'push' and os.environ.get('GITHUB_RUN_ATTEMPT') == '1',
        'original hosted Linux source-only push required')
    profile = os.environ.get('YNX_PERF_VULN_PROFILE', 'original70e')
    lab.require(profile in PROFILES and set(PROFILES) == set(PROFILE_TOOLCHAINS), 'exact frozen source profile required')
    source_commit, source_tree, fork_tree = PROFILES[profile]
    expected_go = PROFILE_TOOLCHAINS[profile]
    source, tools = (Path(os.environ[k]) for k in ('YNX_CLIENT_SOURCE', 'YNX_TOOLS_SOURCE'))
    work, public = (Path(os.environ[k]) for k in ('YNX_PRIVATE_WORK', 'YNX_PUBLIC_OUTPUT'))
    temp = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    lab.require(all(p.is_absolute() and p.resolve(strict=True) == p for p in (source, tools, work))
        and source != tools and work.parent == temp and public.parent == temp and not public.exists(), 'distinct canonical job paths required')
    lab.require(stat.S_IMODE(work.stat().st_mode) == 0o700 and not any(work.iterdir()), 'fresh private work required')
    rows, _ = lab.guard.proc_inventory()
    lab.admit(lab.guard.memory_available(), shutil.disk_usage(temp).free, lab.heavy_processes(rows))
    lab.require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, 'original Linux subreaper required')
    (work / '.private').mkdir(mode=0o700); (work / 'public').mkdir(mode=0o700)
    window = lab.Window(source, work, additional_storage=(source, tools))
    keep = {'GOMAXPROCS', 'GOMEMLIMIT', 'GOGC', 'GOTOOLCHAIN', 'GOCACHE', 'GOMODCACHE', 'GOPATH',
        'GOENV', 'GOTELEMETRY', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'GOTMPDIR', 'TMPDIR'}
    window.env = {key: value for key, value in window.env.items() if key in keep}
    (work / '.private/home').mkdir(mode=0o700)
    window.env.update(HOME=str(work / '.private/home'), LANG='C.UTF-8')
    window.env.update(GOOS='linux', GOARCH='amd64', CGO_ENABLED='1', GOAMD64='v1',
        GOWORK='off', GOBIN=str(work / '.private/bin'), GOPROXY='https://proxy.golang.org,direct', GOSUMDB='sum.golang.org',
        YNX_PERF_VULN_SOURCE=str(source))
    go = shutil.which('go')
    lab.require(go is not None and os.path.isabs(go), 'original target Go executable unavailable')
    window.env['PATH'] = str(Path(go).parent) + ':' + os.defpath
    stop = threading.Event(); monitor = driver.Monitor(window, stop)
    state = dict(name=None, process=None)

    def run(name, command, *, with_status=False, pass_fds=()):
        proc = launch_owned(window, state, name, command, stop, pass_fds)
        cross.wait_original(window, proc, monitor, stop)
        window.retire_log(proc)
        raw = read_log(work / '.private' / (name + '.log'))
        return (raw, proc.returncode) if with_status else raw

    def operation():
        def checkout(path, prefix):
            ident = run(prefix + '-identity', ['git', '-C', str(path), 'rev-parse', 'HEAD', 'HEAD^{tree}', 'HEAD:third_party/cometbft']).decode().splitlines()
            lab.require(len(ident) == 3 and all(re.fullmatch(r'[0-9a-f]{40}', x) for x in ident), 'checkout Git identity unavailable')
            lab.require(not run(prefix + '-status', ['git', '-C', str(path), 'status', '--porcelain', '--untracked-files=all'])
                and not run(prefix + '-ignored', ['git', '-C', str(path), 'ls-files', '--others', '--ignored', '--exclude-standard']),
                'checkout has changed, untracked, or ignored inputs')
            return ident
        client_identity = checkout(source, 'client-before')
        tools_identity = checkout(tools, 'tools-before')
        check_profile(profile, client_identity)
        lab.require(tools_identity[0] == os.environ['GITHUB_SHA'], 'exact Tools source identity differs')
        before = run('source-tree-before', ['git', 'ls-tree', '-r', '-z', source_commit])
        first = inventory(source, before)
        go_env_raw = run('target-go-env', [go, 'env', '-json', 'GOVERSION', 'GOOS', 'GOARCH', 'CGO_ENABLED', 'GOAMD64'])
        env = json.loads(go_env_raw)
        lab.require(env == dict(GOVERSION=expected_go, GOOS='linux', GOARCH='amd64', CGO_ENABLED='1', GOAMD64='v1'),
            'actual source-scan Go target identity differs')
        run('install-original-scanner', [go, 'install', 'golang.org/x/vuln/cmd/govulncheck@v1.1.4'])
        scanner = work / '.private/bin/govulncheck'
        scanner_bytes = driver.commit_clock.read_original(scanner, 128 << 20)
        scanner_info = run('original-scanner-build-info', [go, 'version', '-m', str(scanner)])
        lab.require(b'golang.org/x/vuln/cmd/govulncheck' in scanner_info
            and re.search(rb'\b' + re.escape(expected_go.encode()) + rb'\b', scanner_info) is not None
            and re.search(rb'\bmod\s+golang.org/x/vuln\s+v1\.1\.4\s+h1:', scanner_info) is not None,
            'original scanner build identity differs')
        advisory = run('official-target-advisory', ['curl', '--fail', '--silent', '--show-error', '--proto', '=https',
            '--max-time', '30', 'https://vuln.go.dev/ID/GO-2026-6278.json'])
        advisory_value = json.loads(advisory, object_pairs_hook=events._pairs)
        lab.require(type(advisory_value) is dict and advisory_value.get('id') == events.ADVISORY
            and events.MODULE.encode() in advisory, 'official target advisory unavailable')
        window.env['GOFLAGS'] = '-mod=readonly -p=1'
        output = work / '.private/original-scanner-events.json'
        scanner_fd = os.open(scanner, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            scan_stat = os.fstat(scanner_fd); named = scanner.stat(follow_symlinks=False)
            key = lambda x: (x.st_dev, x.st_ino, x.st_mode, x.st_nlink, x.st_size, x.st_mtime_ns, x.st_ctime_ns)
            lab.require(stat.S_ISREG(scan_stat.st_mode) and scan_stat.st_nlink == 1 and key(scan_stat) == key(named),
                'scanner original descriptor identity differs')
            fd_hash = hash_scanner_descriptor(scanner_fd, scan_stat)
            lab.require(fd_hash == hashlib.sha256(scanner_bytes).digest() and key(os.fstat(scanner_fd)) == key(scan_stat),
                'scanner original descriptor bytes differ')
            # Register the same original stdout FD with the unchanged Window's
            # 4 MiB sampled process-log guard before publishing it to the child.
            stream = register_stream(window, output, stop)
            stderr, exit_code = run('original-scanner-stderr', [sys.executable, '-I', str(ROOT / 'pq-perf-client-vuln-exec.py'),
                str(scanner_fd), str(stream.fileno())], with_status=True, pass_fds=(scanner_fd, stream.fileno()))
            lab.require(key(os.fstat(scanner_fd)) == key(scan_stat) == key(scanner.stat(follow_symlinks=False))
                and hashlib.sha256(driver.commit_clock.read_original(scanner, 128 << 20)).digest() == fd_hash,
                'scanner original descriptor or named bytes changed')
        finally:
            close_once([scanner_fd])
        raw = driver.commit_clock.read_original(output, events.MAX_BYTES)
        observed = events.inspect(raw, exit_code=exit_code, output_complete=True, expected_go=expected_go)
        if profile in ('fixed-e339', 'fixed-491188-go12611'):
            lab.require(observed['targetModuleVersion'] == FIXED_WEBSOCKET and observed['targetFindings'] == [],
                'candidate version or original target advisory findings differ')
        after = run('source-tree-after', ['git', 'ls-tree', '-r', '-z', source_commit])
        second = inventory(source, after)
        lab.require(before == after and first == second
            and checkout(source, 'client-after') == client_identity
            and checkout(tools, 'tools-after') == tools_identity, 'source identity changed')
        observed.update(sourceProfile=profile, source=source_commit, sourceTree=source_tree, forkTree=fork_tree, toolsSource=os.environ['GITHUB_SHA'],
            toolsTree=tools_identity[1], toolsForkTree=tools_identity[2],
            runId=os.environ['GITHUB_RUN_ID'], attempt=os.environ['GITHUB_RUN_ATTEMPT'], job=os.environ['GITHUB_JOB'],
            scanExitCode=exit_code, scannerStderrBytes=len(stderr), scannerStderrSHA256=hashlib.sha256(stderr).hexdigest(),
            rawEventsBytes=len(raw), rawEventsSHA256=hashlib.sha256(raw).hexdigest(),
            sourceInventory=first, goEnv=env, scannerBinarySHA256=hashlib.sha256(scanner_bytes).hexdigest(),
            scannerBuildInfoSHA256=hashlib.sha256(scanner_info).hexdigest(),
            advisoryURL='https://vuln.go.dev/ID/GO-2026-6278.json', advisoryBytes=len(advisory),
            advisorySHA256=hashlib.sha256(advisory).hexdigest(),
            dbSnapshotImmutable=False, resourceGuard='original Window sampled; no continuous hard RSS bound')
        return raw, stderr, scanner_info, advisory, observed

    def post_retirement(result):
        raw, stderr, _, _, _ = result
        stopped_raw = driver.commit_clock.read_original(work / '.private/original-scanner-events.json', events.MAX_BYTES)
        stopped_stderr = read_log(work / '.private/original-scanner-stderr.log')
        lab.require(stopped_raw == raw and stopped_stderr == stderr, 'original scanner stream changed before child retirement')
    raw, stderr, scanner_info, advisory, observed = run_preserving(window, monitor, operation, post_retirement,
        work, public, state, dict(source=source_commit, toolsSource=os.environ['GITHUB_SHA'], runId=os.environ['GITHUB_RUN_ID'], attempt=os.environ['GITHUB_RUN_ATTEMPT']))
    # This bounded post-retirement read is not covered by the stopped monitor.
    observed['postRetirementStreamMatched'] = True
    observed['postRetirementReadRSS'] = 'UNKNOWN'
    public.mkdir(mode=0o700)
    (public / 'govulncheck-original.json').write_bytes(raw)
    (public / 'scanner-build-info.txt').write_bytes(scanner_info)
    (public / 'official-advisory.json').write_bytes(advisory)
    metadata = (json.dumps(observed, sort_keys=True, separators=(',', ':')) + '\n').encode()
    (public / 'metadata.json').write_bytes(metadata)
    print('YNX-PERF-CLIENT-VULN-METADATA/v1 ' + metadata.decode(), end='')
    print('YNX-PERF-CLIENT-VULN-ORIGINAL-BEGIN/v1')
    sys.stdout.flush(); sys.stdout.buffer.write(raw); sys.stdout.flush()
    print('\nYNX-PERF-CLIENT-VULN-ORIGINAL-END/v1')


if __name__ == '__main__':
    main()
