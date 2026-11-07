#!/usr/bin/env python3
"""One hosted, original-input FinalizeBlock semantic comparison; no node/load.

The existing Linux Window owns every preparation/build/replay child. The new
controller adds only the explicit PID16 constraint and fixed source/input
qualification; it does not implement consensus or normalize replay results.
"""
import argparse
import base64
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time

PROFILE = 'finalize-1b-vs-f27'
REPOSITORY = 'JiahaoAlbus/YNX-Chain'
REF = 'refs/heads/codex/ynx-pq-current75-baseline-20261101'
WORKFLOW = REPOSITORY + '/.github/workflows/pq-source-compare.yml@' + REF
CONTROLLER_BASE = '454cad4a0edca86eeb3183da7b9edd542755a267'
AFTER = '1b0ea548aca6b5260a9824d0edd3012d52e53521'
AFTER_TREE = '7c8f6cd8af01b366ea31ffc9f58659e6ca0099e6'
BEFORE_BASE = 'f27e07df6dd96114135aceace20a9413bba94649'
CALLER = '6cc85996524896c68aa9877b209c777fbcc25ae0'
BEFORE_TREE = 'd6ff40c8e2603d2ef4086fcca6bafc276fd710b1'
BEFORE_ORIGINAL_COMMIT = 'fa67017923834a6414e73e31d742e41e83d55a1e'
ROOTS = ('go.mod', 'go.sum', 'cmd', 'internal', 'third_party/cometbft')
OVERLAY = ('internal/consensus/pq_lab_finalize_trace.go', 'internal/consensus/pq_lab_finalize_trace_test.go',
           'cmd/ynx-consensus-pq-lab/finalize_trace.go', 'cmd/ynx-consensus-pq-lab/finalize_trace_test.go', 'cmd/ynx-consensus-pq-lab/main.go')
TRACE_BLOBS = ('9a9b5f7950d58774ed6df6379dee16dc56f2f171', 'f6d661feaad91811c78a688a765096bc67b5101b',
               '6a64e7449a405d4784124d5c385bac5d9c7d7677', 'b62e8877a2b9046fc0366880d7d8fe4137e00d10')
MAIN_BLOBS = ('b1a3fe64559c3eaac83a4f48999a25761684501f', 'd776f988f1b81257c3f65fdd346b226510d3a98a')
DISPATCH = b'\tif args[0] == "finalize-trace" {\n\t\treturn runPQLabFinalizeTrace(args[1:], out)\n\t}'
CAPS = dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30, newBytes=8 << 30,
            initialMemoryBytes=6 << 30, initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2)
MAX_PROCESSES = 16
GUARD_PINS = {'consensus-linux-cohort.py': '09bd36f7a52451d6b30fd58b9ac54dc3d2e2ca2bc4c6c5bd1335c7c4c7d4fcd2',
              'pq-paired-linux-window.py': '92f0d63ddf6a08f9e332a2b7e058d8e2f581827a12eda9dced953472bbd988f5'}
TRACE_PIN = '11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6'
FIXTURE = {
    'final-state.json': (517890, '38d32aa3bddfc5e7c21b4343095283eb3c3e1b8da514c9b267fd222aca0ba2fa'),
    'genesis.json': (147821, '6e09180e59a88862edc4776081de5a44f39c4a0a60e2c6cd0784a32368aeec10'),
    'init-chain.pb': (146789, '65d2f618928fe6c7229721f001c355898cb7aea04aa10fd2e92c0b2724ee619d'),
    'initial-state.json': (8091, 'e6a613a06b304c3fde545bcbf223bd1ff68448f2fa6aecdb61a34361f00d2806'),
    'intent.json': (555, '99946b5a605d1c2022e101dd3cf4d5bd6b7a69e01b5bf67a5e680d3bbd86e230'),
    'migration.json': (151841, 'c4afd84f68caa5d1ec488f31d6cd207751b0cab5c69e20a97bcd88472fe507be'),
    'records.jsonl': (4439710, '6777a90f7ca86a0ecd462ded9740d0413d7dc063b73e114f1c1722e960590573'),
    'result.json': (2027, TRACE_PIN),
    'schedule.json': (498, 'e6ec87fa003d32387e438290a91c0e4b03cdee9ec0a87495eb4df8ed1a5c95bc'),
}


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def pin(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'regular nonaliased original file required')
    with path.open('rb') as reader:
        result = hashlib.file_digest(reader, 'sha256').hexdigest()
    after = path.lstat()
    fields = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    require(all(getattr(after, key) == getattr(info, key) for key in fields), 'original file changed during hashing')
    return dict(bytes=info.st_size, sha256=result)


def unique(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, 'duplicate JSON key')
        out[key] = value
    return out


def read_json(path):
    require(path.stat().st_size <= 8 << 20, 'bounded public JSON required')
    return json.loads(path.read_bytes().decode('utf-8'), object_pairs_hook=unique)


def write_new(path, value):
    with path.open('x') as output:
        json.dump(value, output, separators=(',', ':'), sort_keys=True)
        output.write('\n'); output.flush(); os.fsync(output.fileno())


def validate_identity(profile, env, platform):
    require(profile == PROFILE and env.get('YNX_SEMANTIC_PROFILE') == PROFILE, 'explicit fixed semantic profile required')
    require(platform == 'linux' and env.get('GITHUB_ACTIONS') == 'true' and env.get('RUNNER_ENVIRONMENT') == 'github-hosted' and env.get('RUNNER_OS') == 'Linux', 'only original hosted Linux execution allowed')
    require(env.get('GITHUB_REPOSITORY') == REPOSITORY and env.get('GITHUB_REF') == REF and env.get('GITHUB_WORKFLOW_REF') == WORKFLOW, 'original repository/ref/workflow required')
    require(env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and env.get('GITHUB_RUN_ATTEMPT') == '1' and env.get('GITHUB_JOB') == 'finalize-1b-semantic', 'one explicit first-attempt semantic job required')
    require(re.fullmatch('[0-9a-f]{40}', env.get('GITHUB_SHA', '')) and env.get('GITHUB_WORKFLOW_SHA') == env.get('GITHUB_SHA'), 'exact resolved workflow/controller source required')


def canonical(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'canonical existing path required')
    require(all(not part.is_symlink() for part in (path, *path.parents)), 'symlink path refused')
    return path


def validate_fixture(root):
    canonical(root)
    require({p.name for p in root.iterdir()} == set(FIXTURE), 'exact nine PUBLIC originals required')
    for name, (size, digest) in FIXTURE.items():
        require(pin(root / name) == dict(bytes=size, sha256=digest), 'original PUBLIC fixture pin differs: ' + name)
    return read_json(root / 'result.json')


def git(repo, *args, env=None):
    return subprocess.check_output(['git', '-C', str(repo), *args], env=env, timeout=45).strip()


def source_inventory(root):
    rows = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        relative = Path(directory).relative_to(root)
        require(len(relative.parts) <= 40 and '.git' not in dirs and '.git' not in files, 'source depth/VCS directory refused')
        for name in dirs:
            require(not (Path(directory) / name).is_symlink(), 'source directory symlink refused')
        for name in files:
            path = Path(directory) / name
            rows.append(dict(path=path.relative_to(root).as_posix(), **pin(path)))
            require(len(rows) <= 20000, 'source file bound')
    rows.sort(key=lambda row: row['path'])
    require(sum(row['bytes'] for row in rows) <= 256 << 20, 'source byte bound')
    return rows


def extract_source(archive, destination):
    require(not destination.exists() and not destination.is_symlink(), 'fresh source destination required')
    with tarfile.open(archive, 'r:') as reader:
        entries = reader.getmembers()
        names = [entry.name for entry in entries]
        require(len(names) <= 24000 and len(names) == len(set(names)), 'bounded unique source archive required')
        for entry in entries:
            name = PurePosixPath(entry.name)
            require(not name.is_absolute() and '..' not in name.parts and '\\' not in entry.name and name.as_posix() == entry.name, 'source archive path refused')
            require(entry.isdir() or entry.isfile(), 'source archive link/device refused')
            require(any(entry.name == root or entry.name.startswith(root + '/') or (entry.isdir() and root.startswith(entry.name + '/')) for root in ROOTS), 'source archive outside fixed roots')
        require(sum(entry.size for entry in entries) <= 256 << 20, 'source archive expanded byte bound')
        destination.mkdir(mode=0o700)
        for entry in entries:
            path = destination / entry.name
            if entry.isdir():
                path.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with reader.extractfile(entry) as original, path.open('xb') as output:
                    shutil.copyfileobj(original, output, 65536)
                os.chmod(path, 0o700 if entry.mode & 0o111 else 0o600)


def prepare_sources(repo, work):
    """Child inside Window: isolated index only, no branch/ref/commit created."""
    require(git(repo, 'rev-parse', 'HEAD').decode() == AFTER and git(repo, 'rev-parse', 'HEAD^{tree}').decode() == AFTER_TREE, 'exact after source required')
    index = work / '.private/before-index'
    require(not index.exists() and not index.is_symlink(), 'private fresh index required')
    env = os.environ.copy(); env['GIT_INDEX_FILE'] = str(index)
    git(repo, 'read-tree', BEFORE_BASE, env=env)
    caller = []
    for i, path in enumerate(OVERLAY):
        before_blob = git(repo, 'rev-parse', CALLER + ':' + path).decode()
        after_blob = git(repo, 'rev-parse', AFTER + ':' + path).decode()
        require((before_blob, after_blob) == ((TRACE_BLOBS[i], TRACE_BLOBS[i]) if i < 4 else MAIN_BLOBS), 'fixed original caller blob mismatch')
        git(repo, 'update-index', '--add', '--cacheinfo', '100644', before_blob, path, env=env)
        caller.append(dict(path=path, beforeBlob=before_blob, afterBlob=after_blob, fullBytesEqual=before_blob == after_blob))
    tree = git(repo, 'write-tree', env=env).decode()
    require(tree == BEFORE_TREE, 'composed f27 plus five original caller tree mismatch')
    for revision in (tree, AFTER):
        main = git(repo, 'show', revision + ':' + OVERLAY[-1])
        require(main.count(DISPATCH) == 1, 'original exact finalize-trace dispatch missing')
    output = dict(beforeProductionBase=BEFORE_BASE, beforeOriginalLocalCommit=BEFORE_ORIGINAL_COMMIT,
                  beforeTree=tree, afterCommit=AFTER, afterTree=AFTER_TREE, caller=caller,
                  sameFourTraceBlobs=True, sameFiveCallerBlobs=False, afterMainOverwritten=False, arms={})
    for arm, revision in [('before', tree), ('after', AFTER)]:
        archive = work / '.private' / (arm + '.tar')
        require(not archive.exists(), 'fresh source archive required')
        git(repo, 'archive', '--format=tar', '--output=' + str(archive), revision, '--', *ROOTS)
        destination = work / '.private' / arm
        extract_source(archive, destination)
        inventory = source_inventory(destination)
        write_new(work / 'public' / (arm + '-source-inventory.json'), inventory)
        output['arms'][arm] = dict(archive=pin(archive), inventory=pin(work / 'public' / (arm + '-source-inventory.json')), files=len(inventory), bytes=sum(row['bytes'] for row in inventory))
    write_new(work / 'public/SOURCE.json', output)
    return output


def same_bytes(left, right):
    require(pin(left) == pin(right), 'complete original byte length/SHA mismatch: ' + left.name)
    with left.open('rb') as a, right.open('rb') as b:
        while True:
            x, y = a.read(65536), b.read(65536)
            require(x == y, 'complete original bytes differ: ' + left.name)
            if not x:
                break


def compare_outputs(work, fixture):
    validate_fixture(fixture)
    required = {'intent.json', 'result.json', 'replay.jsonl', 'final-state.json'}
    expected = dict(version='YNX-PQ-LAB-FINALIZE-REPLAY/v1', traceSHA256=TRACE_PIN, firstHeight='4', lastHeight='12',
                    records=dict(name='replay.jsonl', bytes='4439710', sha256=FIXTURE['records.jsonl'][1]),
                    finalState=dict(name='final-state.json', bytes='517890', sha256=FIXTURE['final-state.json'][1]),
                    completeStateBytesReconstructed=True, fullResponsesCompared=True, normalizationApplied=False,
                    sourceReadOnly=True, syntheticOnly=True, nodeStarted=False, authorityGranted=False, liveNetworkPairQualified=False)
    for arm in ('before', 'after'):
        out = work / 'public' / (arm + '-replay')
        require({p.name for p in out.iterdir()} == required, 'complete exact normal replay output required')
        for name in required:
            pin(out / name)
        require(pin(out / 'result.json') == dict(bytes=640, sha256='e787b349efac338c7358353b86e937a119c961d556aec165e8c964ea3cc8ed88'), 'complete original replay receipt bytes differ')
        require(pin(out / 'intent.json') == dict(bytes=82, sha256='32d388da6f4a52e854cea31ee69d346d75a09c2a0f33e4ccf51e3d015b3e81f7'), 'complete original replay intent bytes differ')
        require(read_json(out / 'result.json') == expected, 'normal replay result is incomplete or changes the fixed scope')
        same_bytes(out / 'replay.jsonl', fixture / 'records.jsonl')
        same_bytes(out / 'final-state.json', fixture / 'final-state.json')
        rows = [json.loads(line, object_pairs_hook=unique) for line in (out / 'replay.jsonl').read_bytes().splitlines()]
        require([row.get('height') for row in rows] == list(map(str, range(4, 13))), 'all nine original heights required')
        require(all(row.get('request') and row.get('response') and row.get('stateSHA256') and row.get('stateBytes') and row.get('appHash') for row in rows), 'full original request/response/state coordinates missing')
    for name in required:
        same_bytes(work / 'public/before-replay' / name, work / 'public/after-replay' / name)
    return dict(allNineHeights=True, fullRequestsResponsesIncludingLogEqual=True, fullCanonicalStateLengthsHashesAndAppHashesVerifiedByEachNormalGoReplay=True,
                completeRecordsBytesEqual=True, completeFinalStateBytesEqual=True, completeReceiptsBytesEqual=True,
                normalizationApplied=False, onlyFinalBalancesCompared=False, liveNetworkPairQualified=False, throughputMeasured=False)


def original_window(controller):
    directory = controller / 'scripts/loadtest'
    for name, digest in GUARD_PINS.items():
        require(pin(directory / name)['sha256'] == digest, 'original Window/guard pin differs')
    path = directory / 'consensus-linux-cohort.py'
    spec = importlib.util.spec_from_file_location('fixed_finalize_original_window', path)
    lab = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lab)
    require(lab.CAPS == CAPS, 'original Window caps differ')
    for name, digest in GUARD_PINS.items():
        require(pin(directory / name)['sha256'] == digest, 'original Window/guard changed during load')
    return lab


def counted_roots(roots):
    result = []
    for root in sorted({canonical(p) for p in roots}, key=lambda p: len(p.parts)):
        if not any(p == root or p in root.parents for p in result):
            result.append(root)
    return result


def enforce_pid_budget(lab, window):
    rows, _ = lab.guard.proc_inventory()
    owned = lab.guard.owned_set(rows, os.getpid(), known=window.known)
    require(len(owned) <= MAX_PROCESSES, 'original owned PID16 bound exceeded')


def fetch_original_objects(window, repo, call, token):
    require(token and '\n' not in token and '\r' not in token, 'normal contents-read job token required for fixed source fetch')
    window.env.update(GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='http.https://github.com/.extraheader',
                      GIT_CONFIG_VALUE_0='AUTHORIZATION: basic ' + base64.b64encode(('x-access-token:' + token).encode()).decode(), GIT_TERMINAL_PROMPT='0')
    try:
        call('fetch-original-source-objects', ['git', '-C', str(repo), 'fetch', '--no-tags', '--no-write-fetch-head', '--depth=1', 'origin', BEFORE_BASE, CALLER], repo)
    finally:
        for key in list(window.env):
            if key.startswith('GIT_'):
                window.env.pop(key)


def run(args):
    validate_identity(args.profile, os.environ, sys.platform)
    controller, repo = canonical(args.controller), canonical(args.after_source)
    workspace, parent = canonical(os.environ['GITHUB_WORKSPACE']), canonical(os.environ['RUNNER_TEMP'])
    require(controller == workspace / 'controller' and repo == workspace / 'after-source', 'fixed original checkout paths required')
    work = Path(args.operation)
    require(work == parent / 'pq-finalize-1b-semantic' and not work.exists() and not work.is_symlink(), 'fresh exact operation path required')
    require(git(controller, 'rev-parse', 'HEAD').decode() == os.environ['GITHUB_SHA'] and not git(controller, 'status', '--porcelain', '--untracked-files=normal'), 'clean resolved controller required')
    require(git(repo, 'rev-parse', 'HEAD').decode() == AFTER and not git(repo, 'status', '--porcelain', '--untracked-files=normal'), 'clean exact after checkout required')
    require(git(repo, 'remote', 'get-url', 'origin').decode() in ('https://github.com/' + REPOSITORY, 'https://github.com/' + REPOSITORY + '.git'), 'original GitHub source remote required')
    fixture = controller / 'scripts/loadtest/fixtures/finalize-1b-public'
    validate_fixture(fixture)
    lab = original_window(controller)
    rows, _ = lab.guard.proc_inventory()
    memory, disk, heavy = lab.guard.memory_available(), shutil.disk_usage(parent).free, lab.heavy_processes(rows)
    work.mkdir(mode=0o700); (work / 'public').mkdir(mode=0o700)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('public=' + str(work / 'public') + '\n')
    write_new(work / 'public/ADMISSION.json', dict(profile=PROFILE, controllerCommit=os.environ['GITHUB_SHA'],
              memoryAvailableBytes=memory, diskAvailableBytes=disk, otherHeavyProcesses=heavy,
              originalCaps=dict(CAPS, processes=MAX_PROCESSES), originalAdmissionUnchanged=True))
    try:
        lab.admit(memory, disk, heavy)
    except BaseException as error:
        write_new(work / 'public/SEMANTIC-RESULT.json', dict(profile=PROFILE, firstCause=str(error),
                  admissionPassed=False, semanticQualified=False, ownedChildrenStarted=0, nodeStarted=False,
                  cleanupComplete=True, binariesBuilt=False, liveNetworkPairQualified=False, throughputMeasured=False))
        raise
    try:
        require(len(os.sched_getaffinity(0)) >= 2, 'two actual CPU affinity slots required')
        require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, 'original Linux subreaper required')
        (work / '.private').mkdir(mode=0o700)
        window = lab.Window(repo, work, additional_storage=(parent, workspace, Path(shutil.which('go')).resolve(strict=True).parent.parent))
    except BaseException as error:
        write_new(work / 'public/SEMANTIC-RESULT.json', dict(profile=PROFILE, firstCause=str(error),
                  admissionPassed=True, semanticQualified=False, ownedChildrenStarted=0, nodeStarted=False,
                  cleanupComplete=True, binariesBuilt=False, liveNetworkPairQualified=False, throughputMeasured=False))
        raise
    window.storage_roots = counted_roots(window.storage_roots)
    window.env.update(CGO_ENABLED='0', GOMAXPROCS='2', PYTHONDONTWRITEBYTECODE='1', YNX_SEMANTIC_PROFILE=PROFILE)
    for key in list(window.env):
        if key.startswith('GIT_') or key in ('GH_TOKEN', 'GITHUB_TOKEN'):
            window.env.pop(key, None)
    original_sample = window.sample
    def sample():
        original_sample()
        enforce_pid_budget(lab, window)
    window.sample = sample
    record = dict(version='YNX-FINALIZE-1B-SEMANTIC-CI/v1', profile=PROFILE, controllerCommit=os.environ['GITHUB_SHA'],
                  afterCommit=AFTER, beforeProductionBase=BEFORE_BASE, beforeComposedTree=BEFORE_TREE,
                  traceSHA256=TRACE_PIN, caps=dict(CAPS, processes=MAX_PROCESSES), firstCause=None, cleanupComplete=False,
                  semanticQualified=False, liveNetworkPairQualified=False, throughputMeasured=False, nodeStarted=False,
                  buildTarget='linux/amd64', reusedDarwinBinary=False, actualCommands=[], comparison=None,
                  actualMachine=dict(machine=os.uname().machine, kernel=os.uname().release, logicalCPUs=os.cpu_count(),
                      actualAffinity=sorted(os.sched_getaffinity(0)), imageOS=os.environ.get('ImageOS'), imageVersion=os.environ.get('ImageVersion')),
                  executionEnvironment=dict(CGO_ENABLED='0', GOMAXPROCS='2', GOMEMLIMIT=window.env['GOMEMLIMIT'], GOGC=window.env['GOGC'], GOTOOLCHAIN='local'))
    def call(name, command, cwd):
        window.source = cwd
        record['actualCommands'].append(dict(name=name, argv=command, cwd=str(cwd)))
        window.wait(window.launch(name, command))
    def interrupted(signum, frame):
        raise RuntimeError('original semantic window interrupted: ' + str(signum))
    previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        window.sample()
        call('go-version', ['go', 'version'], repo)
        require((work / 'public/go-version.log').read_text().strip() == 'go version go1.26.10 linux/amd64', 'exact Linux Go1.26.10 required')
        # Normal read-only job token reaches only this exact original fetch,
        # through Git's child environment, never argv/logs/build/replay.
        fetch_original_objects(window, repo, call, os.environ.get('GH_TOKEN', ''))
        call('prepare-fixed-two-source-trees', [sys.executable, '-B', str(Path(__file__).resolve()), '_prepare', str(repo), str(work)], repo)
        for arm in ('before', 'after'):
            src = work / '.private' / arm
            binary = work / '.private/bin' / ('ynx-consensus-pq-lab-' + arm)
            call(arm + '-build', ['go', 'build', '-mod=readonly', '-trimpath', '-buildvcs=false', '-p', '1', '-o', str(binary), './cmd/ynx-consensus-pq-lab'], src)
            with binary.open('rb') as reader:
                header = reader.read(20)
                require(header[:6] == b'\x7fELF\x02\x01' and header[18:20] == b'\x3e\x00', 'actual Linux amd64 ELF required')
            call(arm + '-buildinfo', ['go', 'version', '-m', str(binary)], src)
            buildinfo = (work / 'public' / (arm + '-buildinfo.log')).read_text()
            require('go1.26.10' in buildinfo and '\tbuild\tCGO_ENABLED=0' in buildinfo and '\tbuild\tGOARCH=amd64' in buildinfo and '\tbuild\tGOOS=linux' in buildinfo and '\tbuild\tvcs.' not in buildinfo, 'actual build target/configuration differs')
            record.setdefault('binaries', {})[arm] = pin(binary)
            call(arm + '-replay', [str(binary), 'finalize-trace', 'replay', '--synthetic', '--trace', str(fixture), '--trace-sha256', TRACE_PIN, '--output', str(work / 'public' / (arm + '-replay'))], src)
            require(source_inventory(src) == read_json(work / 'public' / (arm + '-source-inventory.json')), 'source bytes changed during build/replay')
        record['comparison'] = compare_outputs(work, fixture)
        require(not git(repo, 'status', '--porcelain', '--untracked-files=normal') and not git(controller, 'status', '--porcelain', '--untracked-files=normal'), 'original checkout/index mutated')
        window.sample()
    except BaseException as error:
        record['firstCause'] = str(error)
    finally:
        try:
            record['cleanupComplete'] = window.stop()
        except BaseException as error:
            record['cleanupError'] = str(error)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        if not record['cleanupComplete'] and record['firstCause'] is None:
            record['firstCause'] = record.get('cleanupError', 'original owned process cleanup incomplete')
        record.update(elapsedSeconds=time.monotonic()-window.started, resourceSamples=window.samples,
                      peakRSSBytes=window.peak_rss, peakNewBytes=window.peak_bytes,
                      storageRoots=[str(p) for p in window.storage_roots], processes=window.process_receipt(), retiredSamplingEvidence=window.retired_samples)
        record['semanticQualified'] = record['firstCause'] is None and record['cleanupComplete'] and record['comparison'] is not None
        write_new(work / 'public/SEMANTIC-RESULT.json', record)
        print(json.dumps(dict(profile=PROFILE, semanticQualified=record['semanticQualified'], firstCause=record['firstCause'], cleanupComplete=record['cleanupComplete'])))
    require(record['semanticQualified'], 'semantic qualification failed; preserve original first cause and partial evidence')


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ['_prepare']:
        require(len(argv) == 3, 'fixed private preparation arguments required')
        validate_identity(PROFILE, os.environ, sys.platform)
        prepare_sources(canonical(argv[1]), canonical(argv[2]))
        return 0
    flags = [arg.split('=', 1)[0] for arg in argv if arg.startswith('--')]
    require(len(flags) == len(set(flags)), 'duplicate controller option refused')
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--profile', choices=(PROFILE,), required=True)
    parser.add_argument('--controller', required=True)
    parser.add_argument('--after-source', required=True)
    parser.add_argument('--operation', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args(argv)
    if not args.execute:
        print(json.dumps(dict(profile=PROFILE, status='prepared-only', semanticQualified=False, nodeStarted=False)))
        return 0
    run(args)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
