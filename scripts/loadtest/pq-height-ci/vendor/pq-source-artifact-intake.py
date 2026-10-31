#!/usr/bin/env python3
"""Fixed hosted source comparisons using the original Perf tools and Window.

No node, production key, dispatch, new before for B8, or chain TPS conclusion.
The GitHub token is read only from GH_TOKEN and never appears in argv/receipts.
"""
import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = 'JiahaoAlbus/YNX-Chain'
REPOSITORY_ID = 1285041796
FDC = 'fdc08527514587d5756264e43ab63588791e189a'
A = 'b77a3df453d880ab31aca99ce94fc9a7feb4fffb'
B = 'b2120f6a0dc65666145cc9976b9f13d8b175f34d'
B8_TOOLS = 'b6a0cab84f5985f647972209b3c389f2892b44e7'
MULTI_TOOLS = 'aa9447df2f5867542892f6fdbfbefbd116daed91'
B8_INPUT = 'c819fb976a422b855d3fc3e6939338995fa380556e642bda2ab59dcc66353401'
OLD_ARTIFACT = dict(artifactId=13042588614, runId=41202295972, name='pq-current-baseline-fdc-41202295972-1',
                    digest='b1ebf76cbb3bf3819e4f111ec48ac640e84ff5dc3d5279b6a53220303446ccd1', size=139140942)
SCOPES = {'b8': (B8_TOOLS, B, 'original'), 'multi-before': (MULTI_TOOLS, FDC, 'multi-whole'),
          'multi-a': (MULTI_TOOLS, A, 'multi-whole'), 'multi-b': (MULTI_TOOLS, B, 'multi-whole')}
MAX_ZIP = 1 << 30
MAX_LEAF = 512 << 20
MAX_EXPANDED = 2 << 30
OLD_PREFIX = 'pq-baseline-e9xos8tl/public/'
EXTRA_PUBLIC = {'HOST-MACHINE.json', 'SOURCE-COMPARE-CONTROLLER.json'}


class Refused(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def normalize_digest(value):
    require(type(value) is str, 'explicit artifact digest required')
    if value.startswith('sha256:'):
        value = value[7:]
    require(re.fullmatch('[0-9a-f]{64}', value) is not None and value != '0' * 64, 'canonical nonzero SHA256 required')
    return value


def strict_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def read_json(path, limit=MAX_LEAF):
    path = Path(path)
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= limit, 'bounded regular public JSON required')
    with path.open('r', encoding='utf-8') as source:
        return json.load(source, object_pairs_hook=strict_pairs)


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def write_new(path, value):
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as out:
        out.write(raw); out.flush(); os.fsync(out.fileno())


def cases(profile):
    if profile == 'original':
        return ['H%d-K%d' % (h, k) for h in (0, 64, 256, 512) for k in (1, 16)]
    require(profile == 'multi-whole', 'fixed original or multi-whole profile required')
    return ['H%d-W%d-K1' % (h, w) for h in (0, 512) for w in (1, 16)]


def public_names(profile):
    result = {'receipt.json', 'baseline-input.json', 'compile-baseline.log', 'actual-baseline.log'}
    result.update(case + suffix for case in cases(profile) for suffix in ('-measure.json', '-after.json'))
    if profile == 'multi-whole':
        result |= EXTRA_PUBLIC
    return result


def validate_artifact_metadata(value, expected):
    require(type(value) is dict and value.get('id') == expected['artifactId'] and type(value.get('id')) is int, 'original artifact ID differs')
    require(type(expected['runId']) is int and type(expected['artifactId']) is int and expected['runId'] > 0 and expected['artifactId'] > 0, 'positive actual artifact/run IDs required')
    require(value.get('name') == expected['name'] and value.get('expired') is False, 'artifact name or expiry differs')
    run = value.get('workflow_run', {})
    require(run.get('id') == expected['runId'] and run.get('repository_id') == REPOSITORY_ID and run.get('head_repository_id') == REPOSITORY_ID, 'artifact original run/repository differs')
    if expected.get('workflowCommit'):
        require(run.get('head_sha') == expected['workflowCommit'], 'artifact workflow producer commit differs')
    require(normalize_digest(value.get('digest')) == normalize_digest(expected['digest']), 'official artifact digest differs')
    size = value.get('size_in_bytes')
    require(type(size) is int and 0 < size <= MAX_ZIP and (expected['size'] is None or size == expected['size']), 'official ZIP byte bound differs')
    return value


def safe_extract(zip_path, destination, profile, sample=lambda: None):
    """Closed PUBLIC catalog only. Never extractall or trust ZIP path/mode."""
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), 'fresh extraction destination required')
    prefix = OLD_PREFIX if profile == 'original' else ''
    allowed = {prefix + name for name in public_names(profile)}
    with zipfile.ZipFile(zip_path) as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        require(len(names) == len(set(names)) and len(names) <= len(allowed) + 3, 'duplicate/unbounded ZIP catalog')
        files = set()
        for info in infos:
            name = info.filename
            require(name and '\\' not in name and not name.startswith('/') and all(part not in ('', '.', '..') for part in name.rstrip('/').split('/')), 'ZIP path escaped public scope')
            mode = stat.S_IFMT(info.external_attr >> 16)
            if info.is_dir():
                require(profile == 'original' and name in ('pq-baseline-e9xos8tl/', OLD_PREFIX) and info.file_size == 0 and mode in (0, stat.S_IFDIR), 'unexpected ZIP directory')
                continue
            require(name in allowed and mode in (0, stat.S_IFREG) and not info.flag_bits & 1 and info.compress_type in (0, 8), 'nonpublic/secret/nonregular ZIP member')
            require(0 <= info.file_size <= MAX_LEAF and 0 <= info.compress_size <= MAX_ZIP, 'expanded public leaf bound')
            files.add(name)
        require(files == allowed and sum(info.file_size for info in infos) <= MAX_EXPANDED, 'incomplete/unbounded closed public ZIP')
        # Reject unindexed local entries, prepended/trailing payloads and
        # central/local disagreement. Inspect fixed headers without retaining
        # the 139 MB old ZIP or all expanded states in memory.
        with Path(zip_path).open('rb') as raw:
            cursor = 0
            for info in sorted(infos, key=lambda item: item.header_offset):
                require(info.header_offset == cursor, 'unindexed ZIP bytes or local member gap')
                raw.seek(cursor); header = raw.read(30)
                require(len(header) == 30, 'truncated local ZIP header')
                h = struct.unpack('<4s5H3I2H', header)
                require(h[0] == b'PK\x03\x04' and h[2] == info.flag_bits and h[3] == info.compress_type and h[9] <= 512 and h[10] <= 4096, 'local ZIP framing differs')
                require(raw.read(h[9]) == info.filename.encode('ascii'), 'local/central ZIP name differs')
                end = cursor + 30 + h[9] + h[10] + info.compress_size
                require(end <= archive.start_dir, 'ZIP member overlaps central directory')
                if info.flag_bits & 8:
                    raw.seek(end); descriptor = raw.read(16)
                    signed = descriptor[:4] == b'PK\x07\x08'
                    values = struct.unpack('<3I', descriptor[4:16] if signed else descriptor[:12])
                    require(values == (info.CRC, info.compress_size, info.file_size), 'ZIP data descriptor differs')
                    cursor = end + (16 if signed else 12)
                else:
                    require(h[6:9] == (info.CRC, info.compress_size, info.file_size), 'local ZIP sizes/CRC differ')
                    cursor = end
            require(cursor == archive.start_dir and archive.comment == b'', 'unindexed ZIP trailer/comment')
            raw.seek(-22, os.SEEK_END); trailer = raw.read(22)
            e = struct.unpack('<4s4H2IH', trailer)
            require(e[0] == b'PK\x05\x06' and e[1:5] == (0, 0, len(infos), len(infos)) and e[6] == archive.start_dir and e[5] + e[6] == raw.tell()-22 and e[7] == 0, 'closed single-disk ZIP central directory required')
        destination.mkdir(mode=0o700)
        for info in infos:
            sample()
            if info.is_dir():
                continue
            target = destination / info.filename
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            count = 0
            with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as out, archive.open(info) as source:
                while block := source.read(65536):
                    count += len(block)
                    require(count <= info.file_size, 'ZIP expanded size changed')
                    out.write(block); sample()
                out.flush(); os.fsync(out.fileno())
            require(count == info.file_size, 'ZIP leaf truncated')  # ZipExtFile also verifies actual CRC at EOF.
    return destination / prefix.rstrip('/') if prefix else destination


def validate_public(root, profile, source_commit, expected_input=None, raw_runner=False):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), 'original public directory required')
    names = public_names(profile) - (EXTRA_PUBLIC if raw_runner else set())
    require({p.name for p in root.iterdir()} == names, 'closed complete original public subtree required')
    for path in root.iterdir():
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and not path.is_symlink() and info.st_nlink == 1 and 0 <= info.st_size <= MAX_LEAF, 'nonregular/symlink/unbounded public leaf refused')
    receipt = read_json(root / 'receipt.json', 4 << 20)
    required_cases = cases(profile)
    require(receipt.get('schema') == 'YNX-CURRENT-SOURCE-BASELINE-RUN/v1' and receipt.get('sourceCommit') == source_commit, 'before/after source identity differs')
    require(receipt.get('profile', 'original') == profile and receipt.get('completedCases') == required_cases and receipt.get('expectedCases', required_cases) == required_cases, 'complete exact case denominator required')
    require(receipt.get('sourceMatrixComplete') is True and receipt.get('cleanupComplete') is True and receipt.get('testExitCode') == 0 and type(receipt.get('testExitCode')) is int and receipt.get('firstCause') is None, 'actual complete source execution and cleanup required')
    require(receipt.get('originalOwnerDirtyExcluded') == '', 'dirty owner preparation cannot qualify')
    actual_input = digest(root / 'baseline-input.json')
    require(receipt.get('inputSha256') == actual_input and (expected_input is None or normalize_digest(expected_input) == actual_input), 'original actual input SHA differs')
    payload = read_json(root / 'baseline-input.json')
    if profile == 'multi-whole':
        history = payload.get('history')
        require(payload.get('schema') == 'YNX-PQ-MULTI-WHOLE-PUBLIC-INPUT/v1' and type(history) is list and len(history) == 528 and all(type(item) is str and item for item in history) and len(set(history)) == 528 and payload.get('cases') == {}, 'new 528 signed PUBLIC inputs required; old K16 cannot be relabeled')
        candidates = payload.get('candidateCases')
        require(type(candidates) is dict and set(candidates) == set(required_cases), 'new four candidate inputs required')
        for h in (0, 512):
            for w in (1, 16):
                require(candidates['H%d-W%d-K1' % (h, w)] == history[h:h+w], 'original multi-Whole input slices differ')
    else:
        require(payload.get('schema') == 'YNX-PQ-BASELINE-PUBLIC-INPUT/v1' and type(payload.get('history')) is list and len(payload['history']) == 512 and type(payload.get('cases')) is dict and set(payload['cases']) == set(required_cases), 'original eight-case input profile differs')
    del payload
    for case in required_cases:
        require((root / (case + '-after.json')).is_file(), 'complete full state missing')
        measure = read_json(root / (case + '-measure.json'), 16 << 20)
        require(measure.get('case') == case and measure.get('inputSha256') == actual_input, 'case measure detached from original input')
        require(measure.get('goVersion') == 'go1.26.10' and type(measure.get('gomaxprocs')) is int and measure.get('gomaxprocs') == 1 and measure.get('architecture') == 'amd64', 'actual source execution configuration differs')
    return dict(receipt=receipt, inputSha256=actual_input, cases=required_cases)


HARDWARE_KEYS = ('cpuModels', 'cpuVendors', 'architecture', 'logicalCPUs', 'memoryTotalBytes', 'imageOS', 'imageVersion', 'kernel', 'goVersion', 'affinityCount', 'probeGOMAXPROCS')


def hardware_qualification(before, after, allow_missing=False):
    def typed(row):
        require(type(row) is dict and all(key in row for key in HARDWARE_KEYS), 'actual machine fields required')
        for key in ('cpuModels', 'cpuVendors'):
            require(type(row[key]) is list and row[key] and all(type(v) is str and v.strip() == v and v for v in row[key]), 'actual nonempty CPU model/vendor required')
        for key in ('logicalCPUs', 'memoryTotalBytes', 'affinityCount', 'probeGOMAXPROCS'):
            require(type(row[key]) is int and row[key] > 0, 'actual positive integer machine counters required')
        require(row['logicalCPUs'] >= 2 and row['memoryTotalBytes'] >= 6 << 30 and row['affinityCount'] == 2 and row['probeGOMAXPROCS'] == 1, 'fixed actual CPU/memory configuration required')
        require(row['architecture'] == 'amd64' and row['goVersion'] == 'go1.26.10' and all(type(row[key]) is str and row[key] for key in ('imageOS', 'imageVersion', 'kernel')), 'actual pinned hosted image/kernel/Go/architecture required')
    typed(after)
    if before is None and allow_missing:
        return dict(performanceComparisonQualified=False, reason='original-before-hardware-NOT_SUPPLIED', samePhysicalHostClaim=False)
    typed(before)
    differences = [key for key in HARDWARE_KEYS if before[key] != after[key]]
    if differences:
        # Full original-state comparison is independent of machine identity.
        # Preserve its result, but never qualify a cross-configuration speedup.
        return dict(performanceComparisonQualified=False, samePhysicalHostClaim=False,
                    reason='actual-runner-hardware-or-image-differs', differentFields=differences)
    require(after['affinityCount'] == 2 and after['probeGOMAXPROCS'] == 1 and after['goVersion'] == 'go1.26.10', 'fixed two-CPU Go configuration differs')
    return dict(performanceComparisonQualified=True, samePhysicalHostClaim=False, reason='paired-same-configuration-source-measurements-only')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_request(path):
    token = os.environ.get('GH_TOKEN', '')
    require(token and '\r' not in token and '\n' not in token, 'normal actions-read GH_TOKEN environment required')
    require(type(path) is str and re.fullmatch('/repos/' + re.escape(REPOSITORY) + r'/actions/artifacts/[1-9][0-9]{0,19}(?:/zip)?', path) is not None, 'fixed original artifact metadata/ZIP API required')
    return urllib.request.Request('https://api.github.com' + path, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'YNX-original-source-intake'})


def download_artifact(expected, destination, profile, sample):
    """One exact download; authorization never follows the signed redirect."""
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), 'fresh counted artifact intake required')
    destination.mkdir(mode=0o700)
    sample()
    try:
        with urllib.request.urlopen(api_request('/repos/' + REPOSITORY + '/actions/artifacts/' + str(expected['artifactId'])), timeout=15) as response:
            raw = response.read((1 << 20) + 1)
        require(len(raw) <= 1 << 20, 'artifact metadata response bound')
        metadata = validate_artifact_metadata(json.loads(raw, object_pairs_hook=strict_pairs), expected)
        write_new(destination / 'metadata.json', metadata)
        opener = urllib.request.build_opener(NoRedirect())
        try:
            opener.open(api_request('/repos/' + REPOSITORY + '/actions/artifacts/' + str(expected['artifactId']) + '/zip'), timeout=15)
            raise Refused('artifact ZIP must use the normal signed redirect')
        except urllib.error.HTTPError as redirect:
            require(redirect.code in (302, 303, 307), 'artifact ZIP redirect HTTP status ' + str(redirect.code))
            location = redirect.headers.get('Location', '')
        parsed = urllib.parse.urlsplit(location)
        require(parsed.scheme == 'https' and parsed.port in (None, 443) and parsed.username is None and parsed.password is None and
                parsed.hostname is not None and (parsed.hostname.endswith('.blob.core.windows.net') or parsed.hostname.endswith('.actions.githubusercontent.com')),
                'normal GitHub artifact storage host required')
        count = 0; calculated = hashlib.sha256()
        # A fresh request has NO Authorization header; never log the SAS URL.
        with urllib.request.urlopen(urllib.request.Request(location, headers={'User-Agent': 'YNX-original-source-intake'}), timeout=15) as response, (destination / 'artifact.zip').open('xb') as out:
            require(response.status == 200, 'complete original artifact HTTP status required')
            while block := response.read(65536):
                count += len(block)
                require(count <= metadata['size_in_bytes'], 'artifact exceeded official byte size')
                out.write(block); calculated.update(block); sample()
            out.flush(); os.fsync(out.fileno())
        require(count == metadata['size_in_bytes'] and calculated.hexdigest() == normalize_digest(expected['digest']), 'complete official ZIP bytes/SHA256 differ')
        public = safe_extract(destination / 'artifact.zip', destination / 'extracted', profile, sample)
        write_new(destination / 'intake.json', dict(artifactId=expected['artifactId'], runId=expected['runId'],
            zipBytes=count, zipSHA256=calculated.hexdigest(), CRCClosedPublic=True, public=str(public)))
        return public
    except urllib.error.HTTPError as error:
        raise Refused('GitHub artifact HTTP status ' + str(error.code)) from None
    except urllib.error.URLError as error:
        raise Refused('GitHub artifact network error ' + type(error.reason).__name__) from None


def git(source, *args):
    return subprocess.check_output(['git', '-C', str(source), *args], timeout=30).decode().strip()


def original_lab(tools, commit):
    require(git(tools, 'rev-parse', 'HEAD') == commit and not git(tools, 'status', '--porcelain', '--untracked-files=normal'), 'exact clean readonly original Perf tools required')
    # Actual original byte comparison before importing its unchanged Window.
    verified = {}
    for path in (tools / 'scripts/loadtest').rglob('*'):
        if path.is_file() and path.suffix in ('.py', '.in'):
            relative = path.relative_to(tools).as_posix()
            raw = path.read_bytes()
            require(not path.is_symlink() and raw == subprocess.check_output(['git', '-C', str(tools), 'show', commit + ':' + relative], timeout=30), 'original Perf tool byte changed')
            verified[path] = raw
    path = tools / 'scripts/loadtest/consensus-linux-cohort.py'
    spec = importlib.util.spec_from_file_location('original_source_comparison_window', path)
    module = importlib.util.module_from_spec(spec)
    # Execute only the already verified raw source, not a pycache replacement.
    exec(compile(verified[path], str(path), 'exec'), module.__dict__)
    require(all(not path.is_symlink() and path.read_bytes() == raw for path, raw in verified.items()), 'original tool inputs changed during import')
    require(module.CAPS == dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30,
        newBytes=8 << 30, initialMemoryBytes=6 << 30, initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2), 'original fixed source Window caps differ')
    return module


def nonoverlapping_roots(paths):
    result = []
    for path in sorted({Path(p).resolve(strict=True) for p in paths}, key=lambda p: len(p.parts)):
        if not any(root == path or root in path.parents for root in result):
            result.append(path)
    return result


def actual_machine(window):
    go = window.launch('actual-go-version', ['go', 'env', 'GOVERSION'])
    window.wait(go)
    version = (window.work / 'public/actual-go-version.log').read_text().strip()
    info = Path('/proc/cpuinfo').read_text()
    memory = Path('/proc/meminfo').read_text()
    model = sorted(set(re.findall(r'^model name\s*:\s*(.+)$', info, re.M)))
    vendor = sorted(set(re.findall(r'^vendor_id\s*:\s*(.+)$', info, re.M)))
    total = re.findall(r'^MemTotal:\s*(\d+)\s+kB$', memory, re.M)
    require(len(total) == 1 and os.uname().machine == 'x86_64', 'actual hosted amd64 machine evidence required')
    record = dict(cpuModels=model, cpuVendors=vendor, architecture='amd64', logicalCPUs=os.cpu_count(),
        memoryTotalBytes=int(total[0]) * 1024, imageOS=os.environ.get('ImageOS', ''), imageVersion=os.environ.get('ImageVersion', ''),
        goVersion=version, affinityCount=len(os.sched_getaffinity(0)), probeGOMAXPROCS=1,
        actualAffinity=sorted(os.sched_getaffinity(0)), kernel=os.uname().release,
        runId=os.environ['GITHUB_RUN_ID'], job=os.environ['GITHUB_JOB'], physicalHostIdentity='NOT_CLAIMED')
    hardware_qualification(record, record)
    return record


def public_from_entry(path, operation):
    rows = []
    require(path.is_file() and path.stat().st_size <= 4 << 20, 'bounded actual original runner entry required')
    for line in path.read_text().splitlines():
        try:
            value = json.loads(line, object_pairs_hook=strict_pairs)
        except (ValueError, Refused):
            continue  # A traceback is retained in the original log, not a result.
        if type(value) is dict and 'publicArtifacts' in value:
            rows.append(value)
    require(len(rows) == 1, 'exact one original runner public-artifact record required')
    public = Path(rows[0]['publicArtifacts'])
    require(public.is_absolute() and public.resolve(strict=True) == public and operation in public.parents and public.name == 'public', 'actual public result escaped counted operation')
    relative = public.relative_to(operation).parts
    require(len(relative) == 2 and re.fullmatch(r'pq-baseline-[A-Za-z0-9_-]+', relative[0]) is not None and relative[1] == 'public', 'only original runner PUBLIC output can be uploaded')
    return public


def set_output(name, value):
    require(name in ('diagnostics', 'public', 'input_sha256', 'run_id') and type(value) is str and '\n' not in value and '\r' not in value, 'closed actual workflow output required')
    target = os.environ.get('GITHUB_OUTPUT')
    require(target, 'normal GitHub job output file required')
    with open(target, 'a') as out:
        out.write(name + '=' + value + '\n')


def validate_in_window(window, name, public, profile, source_commit, expected_input=None, raw_runner=False):
    # The original public input is ~80 MB. Validate it in an owned child so
    # original Window samples aggregate RSS throughout parsing, and the next
    # original runner's fresh-memory admission does not inherit Python arenas.
    command = [sys.executable, '-B', str(Path(__file__).resolve(strict=True)), 'verify-public',
               '--public', str(public), '--profile', profile, '--source-commit', source_commit]
    if expected_input is not None:
        command += ['--expected-input', expected_input]
    if raw_runner:
        command += ['--raw-runner']
    window.wait(window.launch(name, command))
    return read_json(window.work / ('public/' + name + '.log'), 4 << 20)


def run_scope(args):
    require(sys.platform == 'linux' and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted', 'only the admitted fresh hosted Linux job can execute')
    require(os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'do not automatically rerun a consumed source scope')
    tools_commit, owner_commit, profile = SCOPES[args.scope]
    tools, owner, controller, operation = map(Path, (args.tools, args.owner, args.controller, args.operation))
    for path in (tools, owner, controller):
        require(path.is_absolute() and path.resolve(strict=True) == path, 'canonical actual checkout required')
    parent = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    workspace = Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    require(operation.is_absolute() and operation.parent == parent and not operation.exists() and not operation.is_symlink(), 'fresh job-owned counted operation required')
    require(git(controller, 'rev-parse', 'HEAD') == os.environ['GITHUB_SHA'] and not git(controller, 'status', '--porcelain', '--untracked-files=normal'), 'exact clean current controller source required')
    lab = original_lab(tools, tools_commit)
    lab.check_source(owner, owner_commit)
    require(len(os.sched_getaffinity(0)) >= 2, 'two actual CPU affinity slots required')
    rows, _ = lab.guard.proc_inventory()
    lab.admit(lab.guard.memory_available(), shutil.disk_usage(parent).free, lab.heavy_processes(rows))
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(36, 1, 0, 0, 0) == 0, 'original Linux subreaper required')
    operation.mkdir(mode=0o700); (operation / '.private').mkdir(mode=0o700); (operation / 'public').mkdir(mode=0o700)
    window = lab.Window(owner, operation, additional_storage=(parent, workspace, Path(shutil.which('go')).resolve(strict=True).parent.parent))
    # Count EVERY job temporary/setup/download/cache/source root exactly once.
    # This only normalizes nested roots; it never removes an uncovered root or
    # changes original Window limits/sampling/process ownership.
    window.storage_roots = nonoverlapping_roots(window.storage_roots)
    window.env.update(RUNNER_TEMP=str(operation), GOMAXPROCS='1', PYTHONDONTWRITEBYTECODE='1')
    window.env.pop('GH_TOKEN', None); window.env.pop('GITHUB_TOKEN', None)
    record = dict(version='YNX-SOURCE-COMPARE-CONTROLLER/v1', scope=args.scope, toolsCommit=tools_commit, sourceCommit=owner_commit,
        workflowCommit=os.environ['GITHUB_SHA'], runId=os.environ['GITHUB_RUN_ID'], job=os.environ['GITHUB_JOB'],
        firstCause=None, cleanupComplete=False, comparisonComplete=False, beforeRecord=False,
        configuration=dict(performanceComparisonQualified=False, samePhysicalHostClaim=False, reason='not-yet-qualified'),
        storageRoots=[str(p) for p in window.storage_roots], caps=lab.CAPS, chainMetrics='UNMEASURED', samePhysicalHostClaim=False)
    public = None; validated = None; machine = None; intake_destination = None
    set_output('diagnostics', str(operation / 'public'))
    try:
        window.sample()
        machine = actual_machine(window)
        prepared = operation / 'prepared'
        window.wait(window.launch('prepare-original-source', [sys.executable, '-B', str(tools / 'scripts/loadtest/prepare-pq-baseline.py'), '--owner', str(owner), '--commit', owner_commit, '--output', str(prepared)]))
        inputs = prepared / '.inputs'; inputs.mkdir(mode=0o700)
        window.sample(); shutil.move(str(tools), inputs / 'tools'); shutil.move(str(owner), inputs / 'owner')
        tools, owner = inputs / 'tools', inputs / 'owner'; window.source = owner
        before = None; before_machine = None; expected_input = None
        if args.scope == 'b8':
            record['beforeArtifact'] = dict(OLD_ARTIFACT)
            intake_destination = inputs / 'original'
            before = download_artifact(OLD_ARTIFACT, intake_destination, profile, window.sample)
            validate_in_window(window, 'verify-original-eight-public', before, profile, FDC, B8_INPUT); expected_input = B8_INPUT
        elif args.scope != 'multi-before':
            require(all(os.environ.get(key) for key in ('MULTI_BEFORE_ARTIFACT_ID', 'MULTI_BEFORE_RUN_ID', 'MULTI_BEFORE_ARTIFACT_NAME', 'MULTI_BEFORE_ARTIFACT_DIGEST', 'MULTI_BEFORE_INPUT_SHA256')), 'actual successful before job outputs required')
            expected = dict(artifactId=int(os.environ['MULTI_BEFORE_ARTIFACT_ID']), runId=int(os.environ['MULTI_BEFORE_RUN_ID']),
                name=os.environ['MULTI_BEFORE_ARTIFACT_NAME'], digest=normalize_digest(os.environ['MULTI_BEFORE_ARTIFACT_DIGEST']), size=None,
                workflowCommit=os.environ['GITHUB_SHA'])
            require(str(expected['runId']) == os.environ['GITHUB_RUN_ID'] and expected['name'] == 'pq-source-multi-before-' + os.environ['GITHUB_RUN_ID'], 'same original workflow before artifact required')
            record['beforeArtifact'] = dict(expected)
            intake_destination = inputs / 'original-before-public'
            before = download_artifact(expected, intake_destination, profile, window.sample)
            expected_input = normalize_digest(os.environ['MULTI_BEFORE_INPUT_SHA256'])
            validate_in_window(window, 'verify-original-four-public', before, profile, FDC, expected_input)
            original_controller = read_json(before / 'SOURCE-COMPARE-CONTROLLER.json', 4 << 20)
            require(original_controller.get('scope') == 'multi-before' and original_controller.get('toolsCommit') == MULTI_TOOLS and original_controller.get('sourceCommit') == FDC and original_controller.get('cleanupComplete') is True and original_controller.get('firstCause') is None and original_controller.get('beforeRecord') is True and original_controller.get('workflowCommit') == os.environ['GITHUB_SHA'] and original_controller.get('runId') == os.environ['GITHUB_RUN_ID'], 'actual complete original before controller receipt required')
            before_machine = read_json(before / 'HOST-MACHINE.json', 1 << 20)
        command = [sys.executable, '-B', str(tools / 'scripts/loadtest/run-pq-baseline.py'), '--prepared', str(prepared / 'prepared.json')]
        if profile == 'multi-whole':
            command += ['--profile', 'multi-whole']  # Never pass --profile to old b6 runner.
        command += ['--mode', 'record' if args.scope == 'multi-before' else 'replay']
        if before is not None:
            command += ['--input', str(before / 'baseline-input.json'), '--input-sha256', expected_input]
        command += ['--execute']
        window.wait(window.launch('original-source-entry', command))
        public = public_from_entry(operation / 'public/original-source-entry.log', operation)
        validated = validate_in_window(window, 'verify-actual-source-public', public, profile, owner_commit, expected_input, raw_runner=True)
        if before is not None:
            diff_name = 'B8-complete-differential.json' if args.scope == 'b8' else 'MULTI-complete-differential.json'
            window.wait(window.launch('original-full-state-compare', [sys.executable, '-B', str(tools / 'scripts/loadtest/compare-pq-baseline.py'), '--before', str(before), '--after', str(public), '--output', str(public / diff_name)]))
            record['comparisonComplete'] = True
            record['configuration'] = hardware_qualification(before_machine, machine, allow_missing=args.scope == 'b8')
        else:
            record['beforeRecord'] = True
            record['configuration'] = dict(performanceComparisonQualified=False, samePhysicalHostClaim=False,
                reason='actual-before-record-only-no-after-pair-yet')
        window.sample()
    except BaseException as error:
        record['firstCause'] = str(error)
        if public is None:
            try:
                public = public_from_entry(operation / 'public/original-source-entry.log', operation)
            except BaseException:
                pass
    finally:
        try:
            record['cleanupComplete'] = window.stop()
        except BaseException as error:
            record['cleanupError'] = str(error)
        if not record['cleanupComplete'] and record['firstCause'] is None:
            record['firstCause'] = record.get('cleanupError', 'original Window cleanup incomplete')
        if intake_destination is not None:
            # Retain bounded PUBLIC provenance even if a network/CRC/source
            # failure prevented the original runner from producing any output.
            # Never upload the old ZIP again or include signed URLs/credentials.
            record['artifactIntake'] = dict(completeZipVerified=False)
            try:
                zip_path = intake_destination / 'artifact.zip'
                if zip_path.is_file() and not zip_path.is_symlink():
                    record['artifactIntake']['downloadedZipBytes'] = zip_path.stat().st_size
                if (intake_destination / 'intake.json').is_file():
                    observed = read_json(intake_destination / 'intake.json', 1 << 20)
                    record['artifactIntake'].update(observed, completeZipVerified=True)
                if (intake_destination / 'metadata.json').is_file():
                    metadata = read_json(intake_destination / 'metadata.json', 1 << 20)
                    record['artifactIntake']['official'] = {key: metadata[key] for key in ('id', 'name', 'size_in_bytes', 'digest')}
                observed = record['artifactIntake']
                if observed['completeZipVerified']:
                    expected = record['beforeArtifact']; official = observed.get('official', {})
                    require(observed.get('artifactId') == expected['artifactId'] and observed.get('runId') == expected['runId'] and observed.get('CRCClosedPublic') is True and observed.get('zipSHA256') == normalize_digest(expected['digest']) and observed.get('zipBytes') == official.get('size_in_bytes') and official.get('id') == expected['artifactId'] and official.get('name') == expected['name'] and normalize_digest(official.get('digest')) == normalize_digest(expected['digest']), 'original artifact readback provenance differs')
            except BaseException as error:
                record['artifactIntakeEvidenceError'] = str(error)
                record['artifactIntake']['completeZipVerified'] = False
            if record['firstCause'] is None and (not record['artifactIntake']['completeZipVerified'] or 'official' not in record['artifactIntake']):
                record['firstCause'] = 'complete original artifact intake provenance missing'
        record.update(elapsedSeconds=time.monotonic()-window.started, peakRSSBytes=window.peak_rss, peakNewBytes=window.peak_bytes,
            resourceSamples=window.samples, processes=window.process_receipt(), retiredSamplingEvidence=window.retired_samples)
        write_new(operation / 'public/SOURCE-COMPARE-CONTROLLER.json', record)
        if machine is not None:
            write_new(operation / 'public/HOST-MACHINE.json', machine)
        if public is not None:
            # Only the original runner's PUBLIC subtree is ever uploaded.
            if machine is not None:
                write_new(public / 'HOST-MACHINE.json', machine)
            write_new(public / 'SOURCE-COMPARE-CONTROLLER.json', record)
            set_output('public', str(public))
        print(json.dumps(dict(scope=args.scope, firstCause=record['firstCause'], cleanupComplete=record['cleanupComplete'], public=str(public) if public else None, comparisonComplete=record['comparisonComplete'])))
    require(record['firstCause'] is None and record['cleanupComplete'] and validated is not None and (record['beforeRecord'] or record['comparisonComplete']), 'source scope failed; preserve original first cause and partial PUBLIC evidence')
    set_output('input_sha256', validated['inputSha256'])
    set_output('run_id', os.environ['GITHUB_RUN_ID'])
    return record


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ['verify-public']:
        parser = argparse.ArgumentParser(description='Readonly complete PUBLIC source-profile validation', allow_abbrev=False)
        parser.add_argument('--public', required=True)
        parser.add_argument('--profile', choices=('original', 'multi-whole'), required=True)
        parser.add_argument('--source-commit', choices=(FDC, A, B), required=True)
        parser.add_argument('--expected-input')
        parser.add_argument('--raw-runner', action='store_true')
        args = parser.parse_args(argv[1:])
        print(json.dumps(validate_public(args.public, args.profile, args.source_commit, args.expected_input, args.raw_runner), separators=(',', ':')))
        return 0
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--scope', choices=tuple(SCOPES), required=True)
    for name in ('tools', 'owner', 'controller', 'operation'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args(argv)
    if not args.execute:
        print(json.dumps(dict(status='prepared-only', scope=args.scope, fixed=SCOPES[args.scope], sourceComparisonExecuted=False)))
        return 0
    def interrupted(signum, frame):
        raise Refused('source comparison received signal ' + str(signum))
    prior = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        run_scope(args)
    finally:
        for sig, handler in prior.items():
            signal.signal(sig, handler)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
