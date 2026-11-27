"""Single public NIST vector test on exact 491188 under the original Window."""
import ctypes
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import os
import platform
import re
import shutil
import stat
import sys
import threading

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('nist_original_guard', ROOT / 'pq-perf-client-vuln-ci.py')
guard = importlib.util.module_from_spec(spec); sys.modules[spec.name] = guard; spec.loader.exec_module(guard)
lab, driver, cross = guard.lab, guard.driver, guard.cross
PROFILE = 'fixed-491188-go12611'
SOURCE, TREE, FORK = guard.PROFILES[PROFILE]
PACKAGE = 'github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch'
TEST = 'TestNISTACVPPublishedVectors'
PINS = {
    'internal/ynxbatch/nist_test.go': 'ba63a5317766b361180a33afdd33e1323624c70e',
    'internal/ynxbatch/testdata/nist-acvp.json': '6249ff7e6f86211247b8aa3508785f765b258d74',
    'internal/ynxbatch/ynxbatch_test.go': '9b1811a3993e2e7f8f687f2d1af5ce6c920556ac',
}


def run_nist_preserving(window, monitor, operation, after_stop, work, public, state, identity):
    try:
        return guard.run_preserving(window, monitor, operation, after_stop, work, public, state, identity)
    except BaseException as original:
        # The generic failure receipt covers the current owned command. If a
        # later source/readback step failed, retain the earlier NIST log too.
        try:
            if state.get('name') != 'original-nist-test':
                public.mkdir(mode=0o700, exist_ok=True)
                info = public.lstat()
                lab.require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid()
                    and public.resolve(strict=True) == public, 'failure evidence directory unavailable')
                path = work / '.private/original-nist-test.log'
                extra = dict(version='YNX-PERF-NIST-FAILURE-EVIDENCE/v1', status='NOT_SUPPLIED',
                    originalErrorType=type(original).__name__, genericReceiptUnmodified=True,
                    firstCauseStatus='ORIGINAL_EXCEPTION_RETHROWN', runtimeAuthorized=False)
                try:
                    if path.exists():
                        raw = guard.read_log(path)
                        with open(public / 'failure-nist-test-original.log', 'xb') as output: output.write(raw)
                        extra.update(status='ORIGINAL_BOUNDED_LOG', bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
                except BaseException as error:
                    extra['readbackErrorType'] = type(error).__name__
                encoded = (json.dumps(extra, sort_keys=True, separators=(',', ':')) + '\n').encode()
                with open(public / 'failure-nist-evidence.json', 'xb') as output: output.write(encoded)
        except BaseException as error:
            original.add_note('NIST failure evidence unavailable: ' + type(error).__name__)
        raise


def check_fixture_pins(tree):
    entries = tree.split(b'\0')
    lab.require(entries[-1] == b'', 'original source tree truncated')
    found = {}
    for entry in entries[:-1]:
        header, path = entry.split(b'\t', 1)
        name = path.decode('utf-8')
        if name in PINS:
            lab.require(name not in found, 'duplicate NIST original source entry')
            found[name] = header.decode('ascii')
    lab.require(found == {name: '100644 blob ' + value for name, value in PINS.items()},
        'NIST test/vector/helper source differs')


def inspect_nist_events(raw):
    lab.require(type(raw) is bytes and 0 < len(raw) <= lab.CAPS['logBytes'], 'original NIST stream unavailable')
    events = []; original = []; downloads = 0
    for line in raw.splitlines(keepends=True):
        lab.require(line.endswith(b'\n') and len(line) <= 65536, 'truncated original NIST event')
        if line.startswith(b'go: downloading '): downloads += 1; continue
        event = json.loads(line, object_pairs_hook=guard.events._pairs)
        lab.require(type(event) is dict and set(event) <= {'Time', 'Action', 'Package', 'Test', 'Elapsed', 'Output'}
            and type(event.get('Time')) is str and event.get('Package') == PACKAGE
            and event.get('Action') in ('start', 'run', 'pass', 'output')
            and ('Elapsed' not in event or type(event['Elapsed']) in (int, float)
                 and math.isfinite(event['Elapsed']) and 0 <= event['Elapsed'] <= 90)
            and (event.get('Test') is None or event['Test'] == TEST), 'unexpected NIST test event')
        if event['Action'] == 'output':
            output = event.get('Output')
            allowed = (output == '=== RUN   ' + TEST + '\n' or output == 'PASS\n'
                or re.fullmatch(r'--- PASS: ' + TEST + r' \([0-9.]+s\)\n', output or '') is not None
                or re.fullmatch(r'ok\s+' + re.escape(PACKAGE) + r'\s+[0-9.]+s\n', output or '') is not None)
            lab.require(bool(allowed), 'unexpected NIST test output')
        events.append(event); original.append(line)
    roles = [(event['Action'], event.get('Test')) for event in events]
    lab.require(roles == [('start',None),('run',TEST),('output',TEST),('output',TEST),('pass',TEST),
        ('output',None),('output',None),('pass',None)] and events[2]['Output'] == '=== RUN   ' + TEST + '\n'
        and re.fullmatch(r'--- PASS: ' + TEST + r' \([0-9.]+s\)\n', events[3]['Output']) is not None
        and events[5]['Output'] == 'PASS\n'
        and re.fullmatch(r'ok\s+' + re.escape(PACKAGE) + r'\s+[0-9.]+s\n', events[6]['Output']) is not None,
        'original NIST test lifecycle incomplete')
    return b''.join(original), downloads


def main():
    lab.require(sys.platform == 'linux' and platform.machine() == 'x86_64'
        and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
        and os.environ.get('GITHUB_EVENT_NAME') == 'push' and os.environ.get('GITHUB_RUN_ATTEMPT') == '1',
        'original hosted Linux source-only push required')
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
        client = checkout(source, 'client-before'); guard.check_profile(PROFILE, client)
        tools_id = checkout(tools, 'tools-before'); lab.require(tools_id[0] == os.environ['GITHUB_SHA'], 'Tools source differs')
        before = run('tree-before', ['git', 'ls-tree', '-r', '-z', SOURCE]); check_fixture_pins(before)
        first = guard.inventory(source, before)
        go_env = json.loads(run('original-go-env', [go, 'env', '-json', 'GOVERSION', 'GOOS', 'GOARCH', 'CGO_ENABLED', 'GOAMD64']))
        lab.require(go_env == dict(GOVERSION='go1.26.11', GOOS='linux', GOARCH='amd64', CGO_ENABLED='1', GOAMD64='v1'),
            'actual NIST test toolchain differs')
        raw = run('original-nist-test', [go, 'test', '-mod=readonly', '-p', '1', '-json', '-count=1', '-timeout=90s',
            '-run', '^' + TEST + '$', './internal/ynxbatch'])
        events, downloads = inspect_nist_events(raw)
        after = run('tree-after', ['git', 'ls-tree', '-r', '-z', SOURCE]); check_fixture_pins(after)
        second = guard.inventory(source, after)
        lab.require(before == after and first == second and checkout(source, 'client-after') == client
            and checkout(tools, 'tools-after') == tools_id, 'original source changed')
        metadata = dict(version='YNX-PERF-CLIENT-NIST-VECTORS/v1', source=SOURCE, sourceTree=TREE, forkTree=FORK,
            toolsSource=tools_id[0], toolsTree=tools_id[1], toolsForkTree=tools_id[2], runId=os.environ['GITHUB_RUN_ID'],
            attempt=os.environ['GITHUB_RUN_ATTEMPT'], job=os.environ['GITHUB_JOB'], goEnv=go_env, sourceInventory=first,
            originalGitBlobs=PINS, originalTest=TEST, originalPackage=PACKAGE, originalTestCount=1, skipped=0,
            goEventsBytes=len(events), goEventsSHA256=hashlib.sha256(events).hexdigest(),
            originalLogSHA256=hashlib.sha256(raw).hexdigest(), downloadNotices=downloads,
            crossVersionBusinessInteroperabilityVerified=False, sourceQualified=False, runtimeAuthorized=False,
            resourceGuard='original Window sampled; no continuous hard RSS bound')
        return raw, events, metadata

    def after_stop(result):
        raw, _, _ = result
        lab.require(guard.read_log(work / '.private/original-nist-test.log') == raw, 'original NIST test stream changed after retirement')

    raw, events, metadata = run_nist_preserving(window, monitor, operation, after_stop, work, public, state,
        dict(source=SOURCE, toolsSource=os.environ['GITHUB_SHA'], runId=os.environ['GITHUB_RUN_ID'], attempt=os.environ['GITHUB_RUN_ATTEMPT']))
    metadata['postRetirementReadRSS'] = 'UNKNOWN'
    public.mkdir(mode=0o700)
    (public/'nist-test-original.log').write_bytes(raw)
    (public/'nist-test-events.jsonl').write_bytes(events)
    encoded = (json.dumps(metadata, sort_keys=True, separators=(',', ':')) + '\n').encode()
    (public/'metadata.json').write_bytes(encoded)
    print('YNX-PERF-CLIENT-NIST-METADATA/v1 ' + encoded.decode(), end='')
    print('YNX-PERF-CLIENT-NIST-ORIGINAL-BEGIN/v1')
    sys.stdout.flush(); sys.stdout.buffer.write(events); sys.stdout.flush()
    print('YNX-PERF-CLIENT-NIST-ORIGINAL-END/v1')


if __name__ == '__main__': main()
