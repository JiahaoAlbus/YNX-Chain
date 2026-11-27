"""Original e339 source-only client build; the resulting client is not run."""
import ctypes
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import sys
import threading

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('e339_original_guard', ROOT / 'pq-perf-client-vuln-ci.py')
guard = importlib.util.module_from_spec(spec); sys.modules[spec.name] = guard; spec.loader.exec_module(guard)
lab, driver, cross = guard.lab, guard.driver, guard.cross
SOURCE, TREE, FORK = guard.PROFILES['fixed-e339']
TARGET = 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-perf-client'
TESTS = {'TestEndpointAndWorkloadBounds', 'TestExpandedDecoderBoundIsFinite'}
BUILD_PROFILES = {'fixed-e339': (SOURCE, TREE, FORK, 'go1.26.10'),
    'fixed-491188-go12611': (*guard.PROFILES['fixed-491188-go12611'], 'go1.26.11')}


def inspect_test_events(raw):
    events = []; original = []; downloads = 0
    for line in raw.splitlines(keepends=True):
        lab.require(line.endswith(b'\n') and len(line) <= 65536, 'truncated original client test stream')
        if line.startswith(b'go: downloading '):
            downloads += 1; continue
        event = json.loads(line, object_pairs_hook=guard.events._pairs)
        lab.require(type(event) is dict and set(event) <= {'Time', 'Action', 'Package', 'Test', 'Elapsed', 'Output'}
            and event.get('Package') == TARGET and type(event.get('Time')) is str
            and event.get('Action') in ('start', 'run', 'pass', 'output')
            and ('Elapsed' not in event or type(event['Elapsed']) in (int, float) and math.isfinite(event['Elapsed']) and event['Elapsed'] >= 0)
            and (event.get('Test') is None or event['Test'] in TESTS), 'unexpected original client test event')
        events.append(event); original.append(line)
    def positions(action, test):
        return [i for i, event in enumerate(events) if event['Action'] == action and event.get('Test') == test]
    start, end = positions('start', None), positions('pass', None)
    lab.require(len(start) == len(end) == 1 and start[0] < end[0], 'original client package lifecycle incomplete')
    for name in TESTS:
        first, last = positions('run', name), positions('pass', name)
        lab.require(len(first) == len(last) == 1 and start[0] < first[0] < last[0] < end[0],
            'original client test missing, repeated or outside package lifecycle')
    lab.require(all(start[0] <= i <= end[0] for i in range(len(events))), 'client test event outside package lifecycle')
    return b''.join(original), downloads


def inspect_build_info(raw, *, source=SOURCE, expected_go='go1.26.10'):
    lab.require(any((source, expected_go) == (row[0], row[3]) for row in BUILD_PROFILES.values()),
        'original client build source/toolchain is not frozen')
    lines = raw.decode('utf-8').splitlines()
    lab.require(lines and lines[0].endswith(': ' + expected_go), 'original client Go BuildInfo version differs')
    paths = []; settings = {}
    for line in lines[1:]:
        fields = line.split('\t')
        if len(fields) == 3 and fields[:2] == ['', 'path']:
            paths.append(fields[2])
        if len(fields) == 3 and fields[:2] == ['', 'build'] and '=' in fields[2]:
            key, value = fields[2].split('=', 1)
            lab.require(key not in settings, 'duplicate original client build setting')
            settings[key] = value
    lab.require(paths == [TARGET] and all(settings.get(k) == v for k, v in {
        'GOOS': 'linux', 'GOARCH': 'amd64', 'CGO_ENABLED': '1', '-trimpath': 'true',
        'vcs.revision': source, 'vcs.modified': 'false'}.items()), 'original client BuildInfo identity differs')
    return settings


def binary_digest(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        before = os.fstat(fd); named = path.lstat()
        fields = lambda v: (v.st_dev, v.st_ino, v.st_mode, v.st_nlink, v.st_size, v.st_mtime_ns, v.st_ctime_ns)
        lab.require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= 128 << 20
            and fields(before) == fields(named), 'original client binary identity unavailable')
        digest = hashlib.sha256(); size = 0
        while True:
            chunk = os.read(fd, min(65536, before.st_size + 1 - size))
            if not chunk: break
            digest.update(chunk); size += len(chunk)
            lab.require(size <= before.st_size, 'original client binary grew beyond bound')
        lab.require(size == before.st_size and fields(before) == fields(os.fstat(fd)) == fields(path.lstat()),
            'original client binary changed during read')
        return dict(bytes=size, sha256=digest.hexdigest(), dev=before.st_dev, ino=before.st_ino)
    finally:
        guard.close_once([fd])


def main():
    lab.require(sys.platform == 'linux' and platform.machine() == 'x86_64'
        and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
        and os.environ.get('GITHUB_EVENT_NAME') == 'push' and os.environ.get('GITHUB_RUN_ATTEMPT') == '1',
        'original hosted Linux source-only push required')
    profile = os.environ.get('YNX_PERF_BUILD_PROFILE', 'fixed-e339')
    lab.require(profile in BUILD_PROFILES, 'exact frozen client build profile required')
    source_commit, source_tree, fork_tree, expected_go = BUILD_PROFILES[profile]
    source, tools = (Path(os.environ[k]) for k in ('YNX_CLIENT_SOURCE', 'YNX_TOOLS_SOURCE'))
    work, public = (Path(os.environ[k]) for k in ('YNX_PRIVATE_WORK', 'YNX_PUBLIC_OUTPUT'))
    temp = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    lab.require(all(p.is_absolute() and p.resolve(strict=True) == p for p in (source, tools, work))
        and source != tools and work.parent == temp and public.parent == temp and not public.exists()
        and stat.S_IMODE(work.stat().st_mode) == 0o700 and not any(work.iterdir()), 'fresh canonical job paths required')
    rows, _ = lab.guard.proc_inventory()
    lab.admit(lab.guard.memory_available(), shutil.disk_usage(temp).free, lab.heavy_processes(rows))
    lab.require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, 'original Linux subreaper required')
    (work / '.private').mkdir(mode=0o700); (work / 'public').mkdir(mode=0o700)
    window = lab.Window(source, work, additional_storage=(source, tools))
    keep = {'GOMAXPROCS', 'GOMEMLIMIT', 'GOGC', 'GOTOOLCHAIN', 'GOCACHE', 'GOMODCACHE', 'GOPATH',
        'GOENV', 'GOTELEMETRY', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'GOTMPDIR', 'TMPDIR'}
    window.env = {k: v for k, v in window.env.items() if k in keep}
    (work / '.private/home').mkdir(mode=0o700)
    window.env.update(HOME=str(work / '.private/home'), LANG='C.UTF-8', GOOS='linux', GOARCH='amd64',
        CGO_ENABLED='1', GOAMD64='v1', GOWORK='off', GOPROXY='https://proxy.golang.org,direct', GOSUMDB='sum.golang.org')
    go = shutil.which('go'); lab.require(go is not None and os.path.isabs(go), 'original Go unavailable')
    window.env['PATH'] = str(Path(go).parent) + ':' + os.defpath
    stop = threading.Event(); monitor = driver.Monitor(window, stop); state = dict(name=None, process=None)

    def run(name, command):
        process = guard.launch_owned(window, state, name, command, stop, ())
        cross.wait_original(window, process, monitor, stop); window.retire_log(process)
        return guard.read_log(work / '.private' / (name + '.log'))

    def operation():
        def checkout(path, prefix):
            ident = run(prefix+'-identity', ['git', '-C', str(path), 'rev-parse', 'HEAD', 'HEAD^{tree}', 'HEAD:third_party/cometbft']).decode().splitlines()
            lab.require(len(ident) == 3 and all(re.fullmatch(r'[0-9a-f]{40}', x) for x in ident)
                and not run(prefix+'-status', ['git', '-C', str(path), 'status', '--porcelain', '--untracked-files=all'])
                and not run(prefix+'-ignored', ['git', '-C', str(path), 'ls-files', '--others', '--ignored', '--exclude-standard']),
                'original clean checkout identity unavailable')
            return ident
        client = checkout(source, 'client-before'); guard.check_profile(profile, client)
        tools_id = checkout(tools, 'tools-before'); lab.require(tools_id[0] == os.environ['GITHUB_SHA'], 'Tools source differs')
        before = run('tree-before', ['git', 'ls-tree', '-r', '-z', source_commit]); first = guard.inventory(source, before)
        go_env = json.loads(run('original-go-env', [go, 'env', '-json', 'GOVERSION', 'GOOS', 'GOARCH', 'CGO_ENABLED', 'GOAMD64']))
        lab.require(go_env == dict(GOVERSION=expected_go, GOOS='linux', GOARCH='amd64', CGO_ENABLED='1', GOAMD64='v1'),
            'actual client build toolchain differs')
        binary = work / '.private/bin/ynx-consensus-perf-client'
        build_log = run('original-client-build', [go, 'build', '-mod=readonly', '-p', '1', '-trimpath', '-buildvcs=true',
            '-o', str(binary), './cmd/ynx-consensus-perf-client'])
        first_binary = binary_digest(binary)
        info = run('original-client-build-info', [go, 'version', '-m', str(binary)])
        inspect_build_info(info, source=source_commit, expected_go=expected_go)
        test_log = run('original-independent-client-race-controls', [go, 'test', '-mod=readonly', '-p', '1', '-race', '-json',
            '-count=1', '-timeout=60s', '-run', '^(' + '|'.join(sorted(TESTS)) + ')$',
            './cmd/ynx-consensus-perf-client'])
        test_events, downloads = inspect_test_events(test_log)
        after = run('tree-after', ['git', 'ls-tree', '-r', '-z', source_commit]); second = guard.inventory(source, after)
        lab.require(before == after and first == second and checkout(source, 'client-after') == client
            and checkout(tools, 'tools-after') == tools_id and binary_digest(binary) == first_binary, 'original source or client binary changed')
        metadata = dict(version='YNX-PERF-CLIENT-FIX-BUILD/v1', sourceProfile=profile, source=source_commit, sourceTree=source_tree, forkTree=fork_tree,
            toolsSource=tools_id[0], toolsTree=tools_id[1], toolsForkTree=tools_id[2], runId=os.environ['GITHUB_RUN_ID'],
            attempt=os.environ['GITHUB_RUN_ATTEMPT'], job=os.environ['GITHUB_JOB'], goEnv=go_env, sourceInventory=first,
            binaryBytes=first_binary['bytes'], binarySHA256=first_binary['sha256'], buildInfoSHA256=hashlib.sha256(info).hexdigest(),
            buildLogSHA256=hashlib.sha256(build_log).hexdigest(), binaryExecuted=False, binaryExported=False, testBinaryExecuted=True,
            independentClientRaceTests=sorted(TESTS), clientTestEventsSHA256=hashlib.sha256(test_events).hexdigest(),
            clientTestLogSHA256=hashlib.sha256(test_log).hexdigest(), clientTestDownloadNotices=downloads,
            originalPQRaceControls='NOT_SUPPLIED', readySenderTests='NOT_SUPPLIED',
            nestedModuleIndependentlyVerified=False, sourceQualified=False,
            runtimeAuthorized=False, resourceGuard='original Window sampled; no continuous hard RSS bound')
        return first_binary, info, build_log, test_log, test_events, metadata

    def after_stop(result):
        expected, info, build_log, test_log, _, _ = result
        lab.require(binary_digest(work / '.private/bin/ynx-consensus-perf-client') == expected
            and guard.read_log(work / '.private/original-client-build-info.log') == info
            and guard.read_log(work / '.private/original-client-build.log') == build_log
            and guard.read_log(work / '.private/original-independent-client-race-controls.log') == test_log,
            'original build or test output changed after retirement')

    binary, info, build_log, test_log, test_events, metadata = guard.run_preserving(window, monitor, operation, after_stop, work, public, state,
        dict(source=source_commit, toolsSource=os.environ['GITHUB_SHA'], runId=os.environ['GITHUB_RUN_ID'], attempt=os.environ['GITHUB_RUN_ATTEMPT']))
    metadata['postRetirementReadRSS'] = 'UNKNOWN'
    public.mkdir(mode=0o700)
    (public/'client-build-info.txt').write_bytes(info)
    (public/'client-build.log').write_bytes(build_log)
    (public/'client-test-original.log').write_bytes(test_log)
    (public/'client-test-events.jsonl').write_bytes(test_events)
    encoded = (json.dumps(metadata, sort_keys=True, separators=(',', ':')) + '\n').encode()
    (public/'metadata.json').write_bytes(encoded)
    print('YNX-PERF-CLIENT-FIX-BUILD/v1 ' + encoded.decode(), end='')


if __name__ == '__main__': main()
