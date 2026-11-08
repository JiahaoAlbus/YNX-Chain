#!/usr/bin/env python3
"""One-shot DATA transport for original Linux public tools; never a controller.

The existing driver retains approval, phase and journal ownership. This module
has no key, Node, RPC, service, registration or signing command. The target is
one original role selected by the original ops transport. A failed transport
leaves its request and INTENT; reconcile reads the same completed result only.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import selectors
import signal
import time
import stat
import subprocess
import sys
import tarfile

VERSION = 'YNX-PUBLIC-LINUX-TOOL/v1'
ROLES = ('primary', 'singapore', 'silicon-valley', 'seoul')
BINARIES = ('ynx-abci', 'ynx-comet', 'ynx-bft-gatewayd', 'ynx-consensus-pq-remote-signer', 'ynx-consensus-pq-key-init', 'ynx-consensus-proof-verify', 'ynx-consensus-package', 'ynx-consensus-keycheck')
OPERATORS = ('ynx-consensus-pq-remote-signer-launch.sh', 'ynx-consensus-pq-remote-signer.conf.in', 'ynx-consensus-pq-remote-signer.service.in')
PROOF_FIELDS = ('migrationFile', 'genesisFile', 'stateFile', 'scheduleFile', 'runtimePlanFile', 'trustedLightBlockFile')
MAX_FILE = 1 << 30
# The existing Go package has common + four role copies of the full migration.
# Keep its one-GiB per-original bound and all five physical single-link files.
MAX_OPERATOR_PLAN = 96 << 20
MAX_PACKAGE = 5 * MAX_FILE + 6 * MAX_OPERATOR_PLAN + (64 << 20)
MAX_TOTAL = MAX_PACKAGE + (4 << 20)
MAX_ARCHIVE = MAX_TOTAL + (16 << 20)  # bounded USTAR headers/padding, no compression
DISK_RESERVE = 256 << 20
MAX_FILES = 8192
MAX_LIGHT_TOTAL = 2 * MAX_FILE + (256 << 20)
CLEAN_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'GOMAXPROCS': '2'}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def unique(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, 'duplicate JSON key')
        out[key] = value
    return out


def decode(raw):
    return json.loads(raw.decode('utf8'), object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def pin(value):
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value) and value != '0' * 64, 'independent SHA256 required')
    return value


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def absolute(value):
    require(type(value) is str and value.startswith('/') and str(Path(value)) == value
            and '..' not in Path(value).parts and not any(ord(c) < 32 for c in value), 'canonical absolute path required')
    return Path(value)


def original(path):
    path = absolute(str(path))
    require(path.resolve(strict=True) == path, 'symlink or aliased original path')
    return path


def read(path, maximum=MAX_FILE, material=True):
    path = original(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 <= before.st_size <= maximum
            and not before.st_mode & 0o022, 'bounded original single-link regular file required')
    digest = hashlib.sha256()
    chunks, count = [], 0
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        require(identity(before) == identity(os.fstat(fd)), 'original changed before read')
        while True:
            raw = os.read(fd, 1 << 20)
            if not raw:
                break
            count += len(raw)
            require(count <= maximum, 'original exceeded bound')
            digest.update(raw)
            if material:
                chunks.append(raw)
        require(count == before.st_size and identity(before) == identity(os.fstat(fd))
                and identity(before) == identity(path.lstat()), 'original changed during read')
    finally:
        os.close(fd)
    return {'bytes': count, 'sha256': digest.hexdigest()}, b''.join(chunks), identity(before)


def disk_required(path, needed, label):
    require(type(needed) is int and 0 <= needed <= 12 * MAX_ARCHIVE, 'bounded disk reservation')
    parent = original(Path(path))
    info = os.statvfs(parent)
    available = info.f_bavail * info.f_frsize
    require(available >= needed + DISK_RESERVE,
            label + ': insufficient original filesystem free bytes: available=' + str(available)
            + ' required=' + str(needed + DISK_RESERVE))
    return {'availableBytes': available, 'requiredBytes': needed + DISK_RESERVE}


def output_bound(request):
    op = request['operation']
    if op == 'generate-package':
        migration = next(p['bytes'] for p in request['inputs'] if p['path']=='inputs/migration.json')
        plan = next(p['bytes'] for p in request['inputs'] if p['path']=='inputs/operator-plan.json')
        return 5 * migration + 6 * plan + (64 << 20)
    if op == 'exporter-files': return 257 << 20
    if op == 'inventory': return 2 << 20
    if op == 'light-files': return MAX_LIGHT_TOTAL
    if op in ('light-metadata','proof-capture'):return 32<<20
    return 3 << 20


def operation_space(request, remote=False):
    inputs = sum(p['bytes'] for p in request['inputs'])
    # Original inputs, archive, sandbox, output archive and exclusive publish
    # are all counted. No deduplication, hard links or compression is assumed.
    return (3 if remote else 2) * inputs + (2 if remote else 3) * output_bound(request) + (144 << 20)


def data_root(transaction):
    """Local public bytes only. The original ASCII transaction/journal stays put."""
    transaction = original(Path(transaction))
    chosen = os.environ.get('PUBLIC_BFT_LINUX_TOOL_DATA_ROOT')
    require(chosen, 'explicit canonical local public data root required')
    parent = original(absolute(chosen))
    st = parent.lstat()
    require(stat.S_ISDIR(st.st_mode) and stat.S_IMODE(st.st_mode)==0o700
            and st.st_uid==os.geteuid(), 'local public data parent must be original owned 0700')
    target = parent / transaction.name
    marker = transaction / 'linux-public-data-root.json'
    record = {'version': 'YNX-PUBLIC-LINUX-DATA-ROOT/v1', 'transaction': str(transaction),
              'parent': str(parent), 'parentDevice': str(st.st_dev), 'parentInode': str(st.st_ino),
              'dataRoot': str(target)}
    raw = encode(record)
    if marker.exists():
        require(read(marker, 16 << 10)[1] == raw, 'original public data root changed; no retarget')
        original(target)
    else:
        fresh(target)
        durable(marker, raw)
    require(stat.S_IMODE(target.stat().st_mode)==0o700 and target.stat().st_uid==os.geteuid(), 'local data root ownership changed')
    return target


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def ensure_directories(path):
    path=absolute(str(path))
    if path.exists():
        original(path);require(path.is_dir() and not path.stat().st_mode&0o022,'original public parent is writable or not a directory');return
    ensure_directories(path.parent)
    os.mkdir(path,0o700);sync(path.parent)


def fresh(path):
    path = absolute(str(path))
    original(path.parent)
    os.mkdir(path, 0o700)
    sync(path.parent)
    return path


def durable(path, raw, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)


def checked_copy(source, target, expected):
    # Bounded streaming. All partials remain on error; never rename over one.
    actual, _, before = read(source, material=False)
    require(actual == expected, 'copy input differs from independently retained pin')
    original(target.parent)
    src = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    dst = None
    digest, count = hashlib.sha256(), 0
    try:
        dst = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        require(identity(os.fstat(src)) == before, 'copy source replaced')
        while True:
            raw = os.read(src, 1 << 20)
            if not raw:
                break
            count += len(raw)
            require(count <= expected['bytes'], 'copy source grew')
            digest.update(raw)
            view = memoryview(raw)
            while view:
                n = os.write(dst, view)
                require(n > 0, 'short copy write')
                view = view[n:]
        os.fsync(dst)
        require(count == expected['bytes'] and digest.hexdigest() == expected['sha256']
                and identity(os.fstat(src)) == before and identity(Path(source).lstat()) == before,
                'copy source changed')
    finally:
        os.close(src)
        if dst is not None:
            os.close(dst)
    sync(target.parent)


def catalog(root):
    result = []
    walked, total = 0, 0
    for path in root.rglob('*'):
        walked += 1
        require(walked <= MAX_FILES, 'public catalog entry bound')
        if path.is_dir() and not path.is_symlink():
            original(path)
            continue
        require(not path.is_symlink(), 'links in public catalog')
        rel = path.relative_to(root).as_posix()
        p, _, _ = read(path, material=False)
        total += p['bytes']
        require(total <= MAX_TOTAL, 'public catalog byte bound')
        result.append({'path': rel, **p})
    require(len(result) <= MAX_FILES and sum(p['bytes'] for p in result) <= MAX_TOTAL, 'public catalog bound')
    return sorted(result, key=lambda entry: entry['path'])


def public_package_catalog(root):
    # Only files emitted by the existing single-App public package producer.
    # Reject custody/data/unknown paths before reading any member body. This
    # transport allowlist grants no validity; original Go verification follows.
    allowed = {'package-manifest.json', 'common/bound-migration.json', 'common/genesis.json', 'common/operator-plan.json'}
    role_files = {'role-manifest.json', 'config/config.toml', 'config/genesis.json', 'config/bound-migration.json',
                  'config/runtime-plan.json', 'config/pq-host-binding.json', 'config/pq-engine-schedule.json', 'config/pq-signer-peer-pin',
                  'systemd/ynx-consensus-operator-candidate.service'}
    role_files |= {'scripts/' + name + '.sh' for name in ('install-candidate', 'start-operator', 'verify-candidate', 'stop-candidate', 'backup-candidate', 'rollback-candidate')}
    allowed |= {'roles/' + role + '/' + name for role in ROLES for name in role_files}
    directories = {str(parent) for name in allowed for parent in Path(name).parents if str(parent) != '.'}
    for path in root.rglob('*'):
        require(not path.is_symlink(), 'public package links forbidden')
        if path.is_dir():
            require(path.relative_to(root).as_posix() in directories, 'nonpublic package directory forbidden before transport')
            original(path)
        else:
            require(path.relative_to(root).as_posix() in allowed, 'nonpublic package member forbidden before transport')
    return catalog(root)


def relative(name):
    p = Path(name)
    require(type(name) is str and name and not p.is_absolute() and p.as_posix() == name
            and all(x not in ('.', '..', '') for x in p.parts), 'unsafe public member')
    return p


def pack(root, entries, archive):
    disk_required(archive.parent, sum(e['bytes'] for e in entries) + (16 << 20), 'public archive write')
    with tarfile.open(archive, 'x', format=tarfile.USTAR_FORMAT) as out:
        for entry in entries:
            name = entry['path']
            p = root / relative(name)
            actual, _, before = read(p, material=False)
            require(actual == {k: entry[k] for k in ('bytes', 'sha256')}, 'pack input changed')
            info = tarfile.TarInfo(name)
            info.size, info.mode = actual['bytes'], 0o600
            fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            with os.fdopen(fd,'rb') as stream:
                require(identity(os.fstat(fd))==before,'pack source changed before read')
                out.addfile(info,stream)
                require(identity(os.fstat(fd))==before and identity(p.lstat())==before,'pack input changed after read')
    os.chmod(archive, 0o600)
    with archive.open('rb') as stream:
        os.fsync(stream.fileno())
    sync(archive.parent)


def unpack(archive, destination):
    seen, total = set(), 0
    with tarfile.open(archive, 'r:') as src:
        for member in src:
            rel = relative(member.name)
            require(member.isfile() and not member.pax_headers and member.name not in seen
                    and 0 <= member.size <= MAX_FILE and len(seen) < MAX_FILES, 'invalid/duplicate public member')
            total += member.size
            require(total <= MAX_TOTAL, 'public transport total exceeded')
            disk_required(destination, member.size, 'public archive extraction')
            seen.add(member.name)
            p = destination / rel
            ensure_directories(p.parent)
            original(p.parent)
            fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as out, src.extractfile(member) as inp:
                shutil.copyfileobj(inp, out, 1 << 20)
                out.flush()
                os.fsync(out.fileno())
            sync(p.parent)
    return seen


def validate_request(r):
    require(type(r) is dict and set(r) == {'version', 'transaction', 'role', 'runtime', 'commit', 'sourceSHA256', 'operation', 'arguments', 'inputs', 'phase', 'transportSources', 'destination'}, 'closed request fields')
    require(r['version'] == VERSION and r['role'] in ROLES
            and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', r['transaction'])
            and re.fullmatch('[0-9a-f]{40}', r['commit']) and r['commit'] != '0' * 40, 'original role/transaction/source required')
    pin(r['sourceSHA256'])
    require(type(r['phase']) is str and re.fullmatch('[a-z][a-z0-9_-]{0,63}',r['phase']), 'original phase correlation required')
    require(type(r['transportSources']) is dict and set(r['transportSources']) == {'controller.py','runtime-validator.sh','exporter-validator.sh'}, 'closed controller source pins')
    for v in r['transportSources'].values():
        require(type(v) is dict and set(v) == {'bytes','sha256'} and type(v['bytes']) is int and 0 < v['bytes'] <= 1 << 20, 'bounded controller source')
        pin(v['sha256'])
    path = absolute(r['runtime'])
    require(re.fullmatch(r'/var/tmp/ynx-pq-runtime-[A-Za-z0-9._-]+/verified', str(path))
            and '-' + r['role'] + '-' in str(path), 'runtime must be original role intake verified directory')
    require(r['operation'] in ('inventory', 'migration-summary', 'verify-migration', 'generate-package', 'verify-package', 'proof', 'stage-public', 'exporter-files', 'light-files', 'light-metadata', 'proof-capture'), 'unapproved public operation')
    require(type(r['arguments']) is dict and type(r['inputs']) is list and len(r['inputs']) <= MAX_FILES, 'bounded typed public request')
    names = set()
    for p in r['inputs']:
        require(type(p) is dict and set(p) == {'path', 'bytes', 'sha256'}, 'closed input pin')
        relative(p['path'])
        require(p['path'].startswith('inputs/') and p['path'] not in names and type(p['bytes']) is int
                and 0 <= p['bytes'] <= MAX_FILE, 'input path/count bound')
        pin(p['sha256'])
        names.add(p['path'])
    require(sum(p['bytes'] for p in r['inputs']) <= MAX_TOTAL, 'input byte bound')
    require(type(r['destination']) is str, 'destination correlation')
    if r['destination']: absolute(r['destination'])
    keys = {'inventory': set(), 'migration-summary': set(), 'verify-migration': set(),
            'generate-package': {'genesisTime', 'planSHA256'}, 'verify-package': {'planSHA256'},
            'proof': {'contextPath', 'contextSHA256', 'proofPaths'}, 'light-files': {'captureRoot','captureReceiptSHA256','sourcePlanSHA256'}, 'light-metadata': {'captureRoot','captureReceiptSHA256','sourcePlanSHA256'}, 'proof-capture': {'captureRoot','captureReceiptSHA256','sourcePlanSHA256'}, 'stage-public': {'profile'}, 'exporter-files': {'bundle','sourceSHA256'}}[r['operation']]
    extras=set(r['arguments'])-keys
    permitted=({'captureRoot','captureReceiptSHA256','sourcePlanSHA256'} if r['operation']=='proof' else
               {'migrationEvidenceSHA256'} if r['operation'] in ('migration-summary','verify-migration','generate-package') else
               {'producerRequestSHA256'} if r['operation']=='verify-package' else set())
    require(keys<=set(r['arguments']) and (not extras or extras==permitted), 'fixed operation fields')
    for name in ('migrationEvidenceSHA256','producerRequestSHA256'):
        if name in r['arguments']:pin(r['arguments'][name])
    if 'migrationEvidenceSHA256' in r['arguments']:require(r['role']=='primary','original migration is retained only on original primary')
    a = r['arguments']
    if 'planSHA256' in a:
        pin(a['planSHA256'])
    if 'genesisTime' in a:
        require(re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', a['genesisTime']), 'whole-second original genesis time')
    if r['operation'] in ('light-files','light-metadata','proof-capture') or (r['operation']=='proof' and 'captureRoot' in a):
        require(a['captureRoot']=='/var/lib/ynx-chain/operator-transitions/'+r['transaction']+'/'+r['role']+'/capture-attempt', 'fixed original normal capture root')
        pin(a['captureReceiptSHA256']);pin(a['sourcePlanSHA256'])
    if r['operation'] == 'exporter-files':
        absolute(a['bundle']);pin(a['sourceSHA256'])
        require(re.fullmatch(r'/var/tmp/ynx-pq-exporter-[A-Za-z0-9._-]+/verified',a['bundle']) and '-'+r['role']+'-' in a['bundle'], 'original role exporter intake path')
    if r['operation'] == 'stage-public':
        require(a['profile'] in ('initialize','deploy','gateway','transition-quiesce','transition-install','transition-start','transition-capture','transition-resume'), 'fixed public stage')
        require(a['profile'] != 'gateway' or r['role'] == 'primary', 'original gateway role')
    if r['operation'] == 'proof':
        pin(a['contextSHA256'])
        absolute(a['contextPath'])
        require(type(a['proofPaths']) is dict and set(a['proofPaths']) == set(PROOF_FIELDS), 'original six public proof paths')
        paths = [a['contextPath']]
        for name, value in a['proofPaths'].items():
            if name == 'runtimePlanFile' and value == '':
                continue
            absolute(value)
            paths.append(value)
        require(len(set(paths)) == len(paths), 'aliased proof originals')
        for name in paths:
            require(not name.startswith(('/tool/', '/dev/', '/proc/', '/sys/')) and name != '/tool', 'reserved public execution path')
    return r


def validate_inputs(root, r):
    want = {p['path']: {'bytes': p['bytes'], 'sha256': p['sha256']} for p in r['inputs']}
    actual = {p['path']: {'bytes': p['bytes'], 'sha256': p['sha256']} for p in catalog(root / 'inputs')}
    actual = {'inputs/' + name: value for name, value in actual.items()}
    require(actual == want, 'closed original public inputs differ')
    op = r['operation']
    names = set(actual)
    if op in ('inventory', 'stage-public', 'exporter-files', 'light-files', 'light-metadata', 'proof-capture'):
        require(not names, 'operation takes no input')
    elif op in ('migration-summary', 'verify-migration'):
        require(names == {'inputs/migration.json'}, 'exact migration input required')
    elif op == 'generate-package':
        require(names == {'inputs/migration.json', 'inputs/validators.json', 'inputs/operator-plan.json'}, 'exact package generation public inputs')
        require(actual['inputs/operator-plan.json']['sha256'] == r['arguments']['planSHA256'], 'plan differs from independent pin')
    elif op == 'verify-package':
        require(names and all(x.startswith('inputs/package/') for x in names), 'only original public package accepted')
        public_package_catalog(root / 'inputs/package')
    else:
        a = r['arguments']
        wanted = {'inputs/context.json', 'inputs/request.json'} | {'inputs/' + k for k, v in a['proofPaths'].items() if v}
        require(names == wanted and actual['inputs/context.json']['sha256'] == a['contextSHA256'], 'proof context/input catalog differs')
        c = decode(read(root / 'inputs/context.json', 32 << 10)[1])
        require(all(c.get(k) == v for k, v in a['proofPaths'].items()), 'original context paths differ; no relocation allowed')


LIGHT_NAMES=(('migration','migration.json','migrationFile'),('genesis','genesis.json','genesisFile'),
    ('state','committed-state.json','stateFile'),('schedule','schedule.json','scheduleFile'),
    ('runtime','runtime-plan.json','runtimePlanFile'),('trustedLightBlock','trusted-light-block.json','trustedLightBlockFile'),
    ('request','request.json',None),('context','trust-context.json',None))


def light_delivery(root, remote_output, export_raw, delivery_pin, plan_pin, metadata_only=False):
    """Transport closure after the actual normal capture, never a verifier.

    Caller must establish the captured original command/terminal provenance.
    This function cannot classify an arbitrary adjacent manifest as PUBLIC.
    It verifies all fixed paths/catalog pins before opening any material body.
    """
    receipt=decode(export_raw)
    keys={'version','planSHA256','manifestPath','manifestSHA256','contextPath','contextSHA256','requestPath','requestSHA256',
          'engineHeight','engineAppHash','verification','publicDataOnly','sourceReadOnly','nativeRootAuthorized','deploymentVerified'}
    require(type(receipt) is dict and set(receipt)==keys and receipt['version']=='YNX-PQ-LIGHT-SOURCE-EXPORT/v1'
        and receipt['planSHA256']==pin(plan_pin) and receipt['manifestSHA256']==pin(delivery_pin)
        and receipt['publicDataOnly'] is True and receipt['sourceReadOnly'] is True
        and receipt['nativeRootAuthorized'] is False and receipt['deploymentVerified'] is False,'original Go export receipt differs')
    paths={'manifestPath':'delivery.json','contextPath':'trust-context.json','requestPath':'request.json'}
    require(all(receipt[k]==remote_output+'/'+v for k,v in paths.items()),'original Go export path changed')
    manifest_raw=read(root/'delivery.json',128<<10)[1]
    require(sha(manifest_raw)==delivery_pin,'original Go delivery raw pin differs')
    manifest=decode(manifest_raw)
    require(type(manifest) is dict and set(manifest)=={'version','planSHA256','engineHeight','engineAppHash','verification','files','publicDataOnly'}
        and manifest['version']=='YNX-PQ-LIGHT-SOURCE-DELIVERY/v1' and manifest['publicDataOnly'] is True
        and all(manifest[k]==receipt[k] for k in ('planSHA256','engineHeight','engineAppHash','verification')),'original delivery metadata differs')
    entries=manifest['files'];require(type(entries) is list and len(entries) in (7,8),'closed original public delivery count')
    have_runtime=any(type(e) is dict and e.get('role')=='runtime' for e in entries)
    expected=[row for row in LIGHT_NAMES if row[0]!='runtime' or have_runtime]
    require(len(entries)==len(expected),'original delivery role count')
    pins={}
    for entry,(role,name,_) in zip(entries,expected):
        require(type(entry) is dict and set(entry)=={'role','name','bytes','sha256'} and entry['role']==role and entry['name']==name
            and type(entry['bytes']) is str and re.fullmatch('[1-9][0-9]*',entry['bytes']) and int(entry['bytes'])<=MAX_FILE,'closed original PUBLIC entry role/name/length')
        pins[name]={'bytes':int(entry['bytes']),'sha256':pin(entry['sha256'])}
    require(sum(v['bytes'] for v in pins.values())<=MAX_LIGHT_TOTAL,'original public delivery total bound')
    # Preflight directory names and all context path identities before reading
    # migration/state/genesis/etc. A self-selected private path is never opened.
    selected=({'trust-context.json','request.json','trusted-light-block.json'} if metadata_only else set(pins))
    require(set(p.name for p in original(root).iterdir())==selected|{'delivery.json'},'extra or partial public delivery')
    context_raw=read(root/'trust-context.json',32<<10)[1]
    require({'bytes':len(context_raw),'sha256':sha(context_raw)}==pins['trust-context.json']
        and sha(context_raw)==receipt['contextSHA256'],'original context raw pin differs')
    context=decode(context_raw)
    required={'version','chainId','scheduleHash','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','runtimePlanHash',
        'engineHeight','engineAppHash','expectedHeaderHeight','expectedBlockHash','expectedStateHeight','expectedStateAppHash','trustedLightBlockSHA256',
        'trustingPeriodNanoseconds','maxClockDriftNanoseconds','trustLevelNumerator','trustLevelDenominator'}|set(PROOF_FIELDS)
    require(type(context) is dict and set(context)==required and all(type(v) is str for v in context.values())
        and context['version']=='YNX-CONSENSUS-PROOF-TRUST/v1','original complete context required')
    for role,name,field in LIGHT_NAMES:
        if field:
            want=remote_output+'/'+name if role!='runtime' or have_runtime else ''
            require(context[field]==want,'context material is outside the actual original PUBLIC export')
    require(have_runtime or context['runtimePlanHash']=='','absent runtime pair differs')
    require(context['engineHeight']==receipt['engineHeight'] and context['engineAppHash']==receipt['engineAppHash']
        and context['trustedLightBlockSHA256']==pins['trusted-light-block.json']['sha256'],'context original engine/trusted pins differ')
    require(pins['request.json']['sha256']==receipt['requestSHA256'],'original request pin differs')
    for name in selected:require(read(root/name,MAX_FILE,False)[0]==pins[name],'original PUBLIC material changed')
    return receipt,context,pins


def verified_capture(r):
    a=r['arguments'];capture=original(absolute(a['captureRoot']))
    st=capture.stat();require(stat.S_IMODE(st.st_mode)==0o700 and st.st_uid==0,'original root-owned capture required')
    raw=read(capture/'result.json',128<<10)[1]
    require(sha(raw)==a['captureReceiptSHA256'],'original normal SSH capture terminal pin differs')
    value=decode(raw)
    required={'version','phase','status','transitionId','cutoverTransactionId','role','runtimeCommit','runtimeManifestSHA256','operatorPlanSHA256','inputSHA256',
        'sourcePlanSHA256','captureApprovalSHA256','engineHeight','engineAppHash','headerHeight','stateHeight','captureRoot','output','checkpointSHA256',
        'haltRequestSHA256','exportReceiptSHA256','deliverySHA256','signingStateIdentity','originalMaterialRetained','sourceReadOnly','nativeRootAuthorized','deploymentVerified'}
    require(type(value) is dict and set(value)==required and value['version']=='YNX-OPERATOR-LIGHT-CAPTURE-RESULT/v1'
        and value['phase']=='capture' and value['status']=='stopped_exported' and value['transitionId']==r['transaction']
        and value['cutoverTransactionId']==r['transaction'] and value['role']==r['role'] and value['runtimeCommit']==r['commit']
        and value['runtimeManifestSHA256']==r['sourceSHA256'] and value['sourcePlanSHA256']==a['sourcePlanSHA256']
        and value['captureRoot']==str(capture) and value['originalMaterialRetained'] is True and value['sourceReadOnly'] is True
        and value['nativeRootAuthorized'] is False and value['deploymentVerified'] is False,'normal source/operation/role capture terminal differs')
    output='/var/tmp/ynx-public-light-'+r['transaction']+'-'+r['role']+'/delivery'
    require(value['output']==output,'fixed original PUBLIC output root')
    delivery=original(absolute(output));parent=delivery.parent.stat()
    require(stat.S_IMODE(parent.st_mode)==0o700 and parent.st_uid==0,'actual original export parent ownership')
    export_raw=read(capture/'export-receipt.json',128<<10)[1]
    require(sha(export_raw)==pin(value['exportReceiptSHA256']),'normal Go stdout original differs')
    require(read(capture/'source-plan.json',32<<10,False)[0]['sha256']==a['sourcePlanSHA256'],'normal actual source plan differs')
    require(read(capture/'checkpoint.json',128<<10,False)[0]['sha256']==pin(value['checkpointSHA256']),'normal stopped checkpoint original differs')
    receipt,context,pins=light_delivery(delivery,output,export_raw,value['deliverySHA256'],a['sourcePlanSHA256'])
    require(all(value[k]==receipt[k] for k in ('engineHeight','engineAppHash'))
        and value['headerHeight']==context['expectedHeaderHeight'] and value['stateHeight']==context['expectedStateHeight'],'actual capture/export checkpoint differs')
    return capture,delivery,raw,export_raw,receipt,context,pins


def validate_transport_inputs(root,r):
    expected={e['path']:{k:e[k] for k in ('bytes','sha256')} for e in r['inputs']}
    if 'migrationEvidenceSHA256' in r['arguments']:expected.pop('inputs/migration.json',None)
    if 'producerRequestSHA256' in r['arguments']:expected={}
    actual={'inputs/'+e['path']:{k:e[k] for k in ('bytes','sha256')} for e in catalog(root/'inputs')}
    require(actual==expected,'closed original transport input pins differ')


def original_validator(root, r):
    # Actual unchanged full twelve-member / eight-ELF validator, not a second parser.
    result = subprocess.run(['/bin/bash', '-c', 'source "$1"; validate_runtime_bundle "$2" "$3" "$4"', 'public-tool',
                             str(root / 'runtime-validator.sh'), r['runtime'], r['commit'], r['sourceSHA256']],
                            env=CLEAN_ENV, capture_output=True, timeout=120, check=False)
    require(result.returncode == 0 and not result.stdout and not result.stderr, 'original complete runtime validator rejected')


def runtime_identity(bundle):
    # Capture the closed catalogue as well as all original file identities.
    # Directory ctime catches replacement/add/remove even if an attacker puts
    # the original files back before the final observation.
    operator = original(bundle / 'operator')
    require(set(p.name for p in bundle.iterdir()) == set(BINARIES) | {'SOURCE.json', 'operator'}
            and set(p.name for p in operator.iterdir()) == set(OPERATORS), 'original runtime catalog changed')
    paths = [bundle, operator, bundle / 'SOURCE.json'] + [bundle / x for x in BINARIES] + [operator / x for x in OPERATORS]
    result = {}
    for path in paths:
        original(path)
        info = path.lstat()
        require(not info.st_mode & 0o022, 'original runtime became writable')
        if path in (bundle, operator):
            require(stat.S_ISDIR(info.st_mode), 'original runtime directory changed')
        else:
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'original runtime file changed')
        result[str(path)] = identity(info)
    return result


def bounded_math(command, root, input_file=None):
    """Bound output while retaining original partials and joining owned child."""
    child = None
    drained = False
    selector = selectors.DefaultSelector()
    stream = input_file.open('rb') if input_file is not None else subprocess.DEVNULL
    try:
        with (root/'stdout').open('xb') as so, (root/'stderr').open('xb') as se:
            child = subprocess.Popen(command, stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     env=CLEAN_ENV, start_new_session=True)
            for pipe, target in ((child.stdout, so),(child.stderr, se)):
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, [target, 0])
            # The original timeout tool remains the authoritative 60/120 +5
            # child budget. This watcher only reaps a broken timeout/pipe.
            deadline = time.monotonic()+int(command[3])+6
            while selector.get_map():
                require(time.monotonic()<deadline, 'public math child did not drain in original timeout budget')
                for key, _ in selector.select(min(0.25,max(0,deadline-time.monotonic()))):
                    raw=os.read(key.fd,65536)
                    if not raw:
                        selector.unregister(key.fileobj);key.fileobj.close();continue
                    key.data[1]+=len(raw)
                    require(key.data[1]<=1<<20, 'public math output exceeded original bound')
                    key.data[0].write(raw)
            status=child.wait(timeout=max(0.01,deadline-time.monotonic()))
            for target in (so,se):target.flush();os.fsync(target.fileno())
            drained = True
            return status
    finally:
        first = sys.exc_info()[1]
        cleanup = []
        selector.close()
        if input_file is not None:stream.close()
        if child is not None and not drained:
            # The timeout parent may have exited while its child still holds
            # the pipes. Clean up our own process group even in that case.
            try:os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            except OSError as error:cleanup.append(error)
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:pass
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            except OSError as error:cleanup.append(error)
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired as error:cleanup.append(error)
        if child is not None:
            for pipe in (child.stdout, child.stderr):
                if pipe is not None:
                    pipe.close()
        if cleanup:
            if first is not None:
                first.add_note('owned process cleanup incomplete: ' + '; '.join(str(error) for error in cleanup))
            else:
                raise RuntimeError('owned process cleanup incomplete: ' + '; '.join(str(error) for error in cleanup))


def hydrate_original_inputs(root,r):
    a=r['arguments'];op=r['operation'];originals=[]
    if 'migrationEvidenceSHA256' in a:
        base=original(Path('/var/backups/ynx-chain/public-bft-cutover')/r['transaction'])
        require(base.stat().st_uid==0 and not base.stat().st_mode&0o022,'original protected final-snapshot directory')
        evidence_raw=read(base/'final-migration-state.evidence.json',64<<10)[1]
        require(sha(evidence_raw)==a['migrationEvidenceSHA256'],'original final-snapshot raw terminal differs')
        v=decode(evidence_raw)
        require(v.get('transactionId')==r['transaction'] and v.get('exporterCommit')==r['commit']
            and all(v.get(k) is True for k in ('validated','sourceUnchanged','pauseVerified','mutationFreezeVerified'))
            and v.get('deployment') is False and v.get('runtimeStarted') is False,'original normal final snapshot was not completed')
        wanted=next(e for e in r['inputs'] if e['path']=='inputs/migration.json')
        require(wanted['sha256']==pin(v.get('sha256')),'same original migration hash required')
        originals=[('inputs/migration.json',base/'final-migration-state.json')]
    elif 'producerRequestSHA256' in a:
        source=original(Path('/var/tmp')/('ynx-public-tools-'+r['transaction']+'-'+a['producerRequestSHA256']))
        require(source.stat().st_uid==0 and stat.S_IMODE(source.stat().st_mode)==0o700,'original public producer ownership')
        raw=read(source/'request.json',2<<20)[1];require(sha(raw)==a['producerRequestSHA256'],'original producer request bytes changed')
        producer=validate_request(decode(raw))
        require(producer['operation']=='generate-package' and all(producer[k]==r[k] for k in ('transaction','role','commit','sourceSHA256'))
            and producer['arguments']['planSHA256']==a['planSHA256'],'only same-operation/source original public package can be referenced')
        completion=decode(read(source/'COMPLETE.json',4096)[1])
        require(set(completion)=={'requestSHA256','response'} and completion['requestSHA256']==a['producerRequestSHA256']
            and read(source/'response.tar',MAX_ARCHIVE,False)[0]==completion['response'],'original producer completion archive changed')
        result=verified_result(source,producer,closed=False)
        require(result['exitCode']==0,'original public package producer failed/UNKNOWN')
        entries=public_package_catalog(source/'outputs/package')
        require([{'path':'inputs/package/'+e['path'],'bytes':e['bytes'],'sha256':e['sha256']} for e in entries]==r['inputs'], 'reference package catalog differs from client original')
        originals=[('inputs/package/'+e['path'],source/'outputs/package'/e['path']) for e in entries]
    by_name={e['path']:e for e in r['inputs']}
    for name,source in originals:
        target=root/name;ensure_directories(target.parent)
        checked_copy(source,target,{k:by_name[name][k] for k in ('bytes','sha256')})


def execute(root, r):
    validate_request(r)
    validate_transport_inputs(root,r)
    for name, expected in r['transportSources'].items():
        require(read(root/name,1<<20,False)[0] == expected, 'controller source changed after request')
    original_validator(root, r)
    durable(root/'SPACE.json', encode(disk_required(root, operation_space(r, True), 'original Linux public operation')))
    hydrate_original_inputs(root,r)
    validate_inputs(root,r)
    bundle = original(Path(r['runtime']))
    source_raw = read(bundle / 'SOURCE.json', 128 << 10)[1]
    require(sha(source_raw) == r['sourceSHA256'], 'original SOURCE pin')
    source = decode(source_raw)
    held = runtime_identity(bundle)
    out = fresh(root / 'outputs')
    op, a = r['operation'], r['arguments']
    stdout = b''
    stderr = b''
    status = 0
    math_started = math_finished = None
    if op == 'inventory':
        durable(out / 'SOURCE.json', source_raw)
        fresh(out / 'operator')
        for name in OPERATORS:
            checked_copy(bundle / 'operator' / name, out / 'operator' / name, source['operator'][name])
    elif op in ('light-files','light-metadata'):
        capture,delivery,capture_raw,export_raw,receipt,context,pins=verified_capture(r)
        fresh(out/'delivery')
        durable(out/'capture-receipt.json',capture_raw);durable(out/'export-receipt.json',export_raw)
        checked_copy(capture/'source-plan.json',out/'source-plan.json',read(capture/'source-plan.json',32<<10,False)[0])
        names=tuple(pins) if op=='light-files' else ('trust-context.json','request.json','trusted-light-block.json')
        for name in (*names,'delivery.json'):
            checked_copy(delivery/name,out/'delivery'/name,read(delivery/name,MAX_FILE,False)[0])
        # Recheck original capture and directory after copy; no source bool can
        # replace the real completed producer or its retained root-owned files.
        require(verified_capture(r)[2:4]==(capture_raw,export_raw),'original capture changed during collection')
        stdout=export_raw
    elif op == 'exporter-files':
        # Reuse the unchanged normal exporter parser definitions. Never invoke
        # its mutating snapshot main or synthesize a second SOURCE validator.
        import ast
        raw=read(root/'exporter-validator.sh',1<<20)[1].decode()
        body=raw.split("<<'PY'\n",1)[1].rsplit('\nPY',1)[0]
        tree=ast.parse(body); definitions=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef))]
        namespace={};exec(compile(ast.Module(body=definitions,type_ignores=[]),'original-exporter-validator','exec'),namespace)
        exporter=original(Path(a['bundle']))
        namespace['tools_record'](exporter,r['commit'],a['sourceSHA256'])
        originals={name:read(exporter/name,128<<20,False) for name in ('SOURCE.json','ynx-chaind','ynx-consensus-package')}
        for name,(expected,_,_) in originals.items():checked_copy(exporter/name,out/name,expected)
        require(all(identity((exporter/name).lstat())==item[2] for name,item in originals.items()),'exporter originals changed')
    elif op == 'stage-public':
        profile=a['profile']; release='ynx-consensus-candidate-'+r['commit'][:12]
        if profile.startswith('transition-'):
            phase=profile.removeprefix('transition-')
            target=Path('/opt/ynx-chain/operator-transitions')/r['transaction']/r['role']/phase/'source/bin'
            names=('ynx-comet','ynx-consensus-package','ynx-consensus-keycheck')
        elif profile == 'initialize':
            target=Path('/opt/ynx-chain/consensus-initialization')/release/r['role']; names=('ynx-comet','ynx-consensus-package')
        elif profile == 'deploy':
            target=Path('/opt/ynx-chain/consensus-candidates')/release/r['role']/'bin'; names=('ynx-comet','ynx-consensus-keycheck')
        else:
            target=Path('/var/backups/ynx-chain/public-bft-cutover')/r['transaction']/'gateway-runtime'; names=('ynx-bft-gatewayd','ynx-consensus-package')
        original(target)
        require(target.is_dir() and not target.stat().st_mode & 0o022, 'original phase must have exclusively reserved its public stage')
        for name in names:
            checked_copy(bundle/name,target/name,source['binaries'][name]);os.chmod(target/name,0o700)
            require(read(target/name,128<<20,False)[0] == source['binaries'][name], 'staged public binary readback differs')
        durable(out/'stage.json',encode({'profile':profile,'role':r['role'],'target':str(target),'files':{name:source['binaries'][name] for name in names},'installed':False,'runtimeStarted':False}))
    else:
        jail = fresh(root / 'public-root')
        # The normal Go operator verifier renders a public config with
        # os.MkdirTemp("", ...). Give it an exclusive 0700 /tmp inside this
        # jail, never a mount/link to host temp or an inherited TMPDIR.
        # Failed scratch stays with the original operation, outside outputs.
        fresh(jail / 'tmp')
        fresh(jail / 'tool')
        binary = 'ynx-consensus-proof-verify' if op in ('proof','proof-capture') else 'ynx-consensus-package'
        checked_copy(bundle / binary, jail / 'tool' / binary, source['binaries'][binary])
        os.chmod(jail / 'tool' / binary, 0o500)
        fresh(jail / 'inputs')
        if op=='proof-capture':
            capture,delivery,capture_raw,export_raw,receipt,context,pins=verified_capture(r)
            mappings=[('trust-context.json',receipt['contextPath'])]+[(name,context[field]) for _,name,field in LIGHT_NAMES if field and context[field]]
            for name,target in mappings:
                dest=jail/target.lstrip('/');ensure_directories(dest.parent)
                checked_copy(delivery/name,dest,pins[name])
            for original_name,name in (('trust-context.json','proof-context.json'),('trusted-light-block.json','proof-trusted-light-block.json')):
                checked_copy(delivery/original_name,out/name,pins[original_name])
            durable(out/'proof-capture-receipt.json',capture_raw);durable(out/'proof-export-receipt.json',export_raw)
            argv=['/tool/'+binary,'--trust-context',receipt['contextPath'],'--trust-context-sha256',receipt['contextSHA256']]
            proof_stdin=delivery/'request.json'
        if op=='proof' and 'captureRoot' in a:
            _,_,_,_,receipt,context,pins=verified_capture(r)
            require(a['contextPath']==receipt['contextPath'] and a['contextSHA256']==receipt['contextSHA256']
                and a['proofPaths']=={k:context[k] for k in PROOF_FIELDS},'proof differs from original completed capture')
            proof_pins={'inputs/context.json':pins['trust-context.json'],'inputs/request.json':pins['request.json']}
            proof_pins.update({'inputs/'+field:pins[name] for _,name,field in LIGHT_NAMES if field and context[field]})
            require({v['path']:{k:v[k] for k in ('bytes','sha256')} for v in r['inputs']}==proof_pins,'proof bytes differ from original PUBLIC capture')
        if op == 'proof':
            mappings = [('inputs/context.json', a['contextPath'])] + [('inputs/' + k, v) for k, v in a['proofPaths'].items() if v]
            for name, target in mappings:
                dest = jail / target.lstrip('/')
                ensure_directories(dest.parent)
                checked_copy(root / name, dest, read(root / name, material=False)[0])
            argv = ['/tool/' + binary, '--trust-context', a['contextPath'], '--trust-context-sha256', a['contextSHA256']]
        elif op!='proof-capture':
            for p in r['inputs']:
                dest = jail / p['path']
                ensure_directories(dest.parent)
                checked_copy(root / p['path'], dest, {k: p[k] for k in ('bytes', 'sha256')})
            if op in ('verify-migration', 'migration-summary'):
                argv = ['/tool/' + binary, '-verify-migration-state', '/inputs/migration.json']
                if op == 'migration-summary':
                    argv += ['-migration-public-summary', 'json']
            elif op == 'verify-package':
                argv = ['/tool/' + binary, '-verify-package', '/inputs/package', '-operator-plan-hash', a['planSHA256']]
            else:
                argv = ['/tool/' + binary, '-migration-state', '/inputs/migration.json', '-validator-manifest', '/inputs/validators.json',
                        '-genesis-time', a['genesisTime'], '-operator-plan', '/inputs/operator-plan.json',
                        '-operator-plan-hash', a['planSHA256'], '-output', '/package']
        # No mount/proc/dev/network/client env. CGO0 original executable only.
        # Kernel current time is the real Linux host's clock; no request clock.
        command = ['/usr/bin/timeout', '--signal=TERM', '--kill-after=5', '60' if op in ('proof','proof-capture') else '120',
                   '/usr/sbin/chroot', str(jail)] + argv
        durable(root / 'command.json', encode({'argv': command, 'environment': CLEAN_ENV, 'mounts': [], 'classification': 'data'}))
        math_started=str(time.time_ns())
        status = bounded_math(command, root, proof_stdin if op=='proof-capture' else root/'inputs/request.json' if op=='proof' else None)
        math_finished=str(time.time_ns())
        require(int(math_finished)>=int(math_started),'original math host clock moved backwards; retain UNKNOWN')
        stdout = read(root / 'stdout', 1 << 20)[1]
        stderr = read(root / 'stderr', 1 << 20)[1]
        if op == 'generate-package' and (jail / 'package').exists():
            # Preserve partial package even when producer failed; caller may not
            # publish it as a successful package or silently rerun the command.
            require(not (out/'package').exists(), 'exclusive original package publication')
            # Same-filesystem exclusive move retains the producer's real five
            # copies and nlink=1; it avoids a sixth redundant full-package copy.
            os.rename(jail/'package', out/'package')
            sync(jail); sync(out)
            for p in (out / 'package').rglob('*'):
                os.chmod(p, 0o700 if p.is_dir() else 0o600)
    validate_inputs(root, r)
    require(runtime_identity(bundle) == held, 'original full runtime changed during public operation')
    durable(out / 'stdout', stdout)
    durable(out / 'stderr', stderr)
    receipt = {'version': VERSION, 'requestSHA256': sha(read(root / 'request.json', 2 << 20)[1]),
               'role': r['role'], 'commit': r['commit'], 'sourceSHA256': r['sourceSHA256'], 'operation': op,
               'exitCode': status, 'outputs': catalog(out), 'sourceGrant': False, 'deployment': False, 'runtimeStarted': False,
               'mathStartedUnixNanoseconds':math_started,'mathFinishedUnixNanoseconds':math_finished}
    durable(root / 'RESULT.json', encode(receipt))
    entries = catalog(out)
    for p in entries:
        p['path'] = 'outputs/' + p['path']
    entries.append({'path': 'RESULT.json', **read(root / 'RESULT.json', material=False)[0]})
    pack(root, entries, root / 'response.tar')
    durable(root/'COMPLETE.json',encode({'requestSHA256':receipt['requestSHA256'],'response':read(root/'response.tar',MAX_ARCHIVE,material=False)[0]}))
    return status


def verified_result(target, request, closed=True):
    r = decode(read(target/'RESULT.json',4<<20)[1])
    require(set(r)=={'version','requestSHA256','role','commit','sourceSHA256','operation','exitCode','outputs','sourceGrant','deployment','runtimeStarted','mathStartedUnixNanoseconds','mathFinishedUnixNanoseconds'}, 'closed result')
    require(r['version']==VERSION and r['requestSHA256']==sha(encode(request))
            and all(r[k]==request[k] for k in ('role','commit','sourceSHA256','operation'))
            and type(r['exitCode']) is int and all(r[k] is False for k in ('sourceGrant','deployment','runtimeStarted')), 'result identity/authority mismatch')
    for clock in ('mathStartedUnixNanoseconds','mathFinishedUnixNanoseconds'):
        require(r[clock] is None or (type(r[clock]) is str and re.fullmatch('[1-9][0-9]{0,19}',r[clock])), 'original math clock encoding')
    require((r['mathStartedUnixNanoseconds'] is None)==(r['mathFinishedUnixNanoseconds'] is None), 'partial original math clock')
    if request['operation'] in ('inventory','stage-public','exporter-files','light-files','light-metadata'):
        require(r['mathStartedUnixNanoseconds'] is None,'non-math result cannot invent verifier clock')
    require(r['outputs']==catalog(target/'outputs'),'original output catalog mismatch')
    if closed:require(set(p['path'] for p in catalog(target))=={'RESULT.json'}|{'outputs/'+p['path'] for p in r['outputs']}, 'closed output catalog mismatch')
    return r


def accept_result(local, request, archive=None):
    target = fresh(local/'received')
    unpack(archive or local/'response.tar',target)
    r = verified_result(target,request)
    durable(local/'RESULT.json',encode(r))
    return target/'outputs',r['exitCode']


def publish_result(local, request, outputs, status, recovered=False):
    """Finish only this retained request. No command, retry, journal rewrite."""
    destination = absolute(request['destination']) if request['destination'] else None
    if status==0 and destination is not None:
        data=outputs/'package' if request['operation']=='generate-package' else outputs
        expected=[p for p in catalog(data) if p['path'] not in ('stdout','stderr')]
        intent=local/'DESTINATION-INTENT.json'
        if not intent.exists():
            # Reserve the destination exactly once; a caller-owned preexisting
            # directory is never adopted. A crash before this record is UNKNOWN.
            fresh(destination)
            st=destination.stat()
            durable(intent,encode({'requestSHA256':sha(encode(request)), 'destination':str(destination),
                'device':str(st.st_dev),'inode':str(st.st_ino)}))
        value=decode(read(intent,16<<10)[1]);st=original(destination).stat()
        require(value=={'requestSHA256':sha(encode(request)), 'destination':str(destination),
            'device':str(st.st_dev),'inode':str(st.st_ino)}, 'same-operation destination ownership changed')
        have={p['path']:p for p in catalog(destination)};want={p['path']:p for p in expected}
        require(set(have)<=set(want) and all(have[k]==want[k] for k in have), 'partial or foreign destination differs; retain UNKNOWN')
        disk_required(destination,sum(v['bytes'] for k,v in want.items() if k not in have),'exclusive result publication')
        for name,item in want.items():
            if name in have: continue
            target=destination/name;ensure_directories(target.parent)
            checked_copy(data/name,target,{k:item[k] for k in ('bytes','sha256')})
        require(catalog(destination)==expected,'published original result differs')
    record={'requestSHA256':sha(encode(request)), 'resultSHA256':read(outputs.parent/'RESULT.json',4<<20)[0]['sha256'],
            'received':str(outputs.parent.relative_to(local)), 'destination':request['destination'],
            'exitCode':status,'reconciled':recovered, 'mathReexecuted':False}
    name=local/'PUBLISHED.json'
    if name.exists():
        require(decode(read(name,16<<10)[1])==record,'completed original publication changed')
    else: durable(name,encode(record))
    return status


def proof_trust_expiry(context, trusted):
    timestamp=trusted['signed_header']['header']['time']
    match=re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z',timestamp)
    require(match is not None,'original canonical trusted UTC time required')
    import datetime,calendar
    parts=[int(x) for x in match.groups()[:6]]
    date=datetime.datetime(*parts,tzinfo=datetime.timezone.utc)
    trusted_ns=calendar.timegm(date.utctimetuple())*1000000000+int((match[7] or '').ljust(9,'0'))
    period=context['trustingPeriodNanoseconds']
    require(type(period) is str and re.fullmatch('[1-9][0-9]{0,18}',period) and int(period)<1<<63,'original trust period encoding')
    return trusted_ns+int(period)


def proof_reconcile_freshness(local, request, result, outputs=None):
    # Signatures/registry/roots were checked by the original Go call once.
    # This guard only prevents a reconciled result becoming a later-clock
    # success after trust expiry or clock rollback; it is not another verifier.
    require(request['operation'] in ('proof','proof-capture'),'proof-only clock guard')
    if request['operation']=='proof-capture':
        require(outputs is not None,'original captured proof outputs required')
        capture_raw=read(outputs/'proof-capture-receipt.json',128<<10)[1]
        require(sha(capture_raw)==request['arguments']['captureReceiptSHA256'],'original proof capture pin changed')
        capture=decode(capture_raw);export_raw=read(outputs/'proof-export-receipt.json',128<<10)[1]
        require(sha(export_raw)==capture['exportReceiptSHA256'],'original proof export pin changed')
        export=decode(export_raw);context_raw=read(outputs/'proof-context.json',32<<10)[1]
        require(sha(context_raw)==export['contextSHA256'],'original proof context pin changed')
        context=decode(context_raw);trusted_raw=read(outputs/'proof-trusted-light-block.json',10<<20)[1]
        require(sha(trusted_raw)==context['trustedLightBlockSHA256'],'original proof trusted block changed')
        trusted=decode(trusted_raw)
    else:
        validate_inputs(local,request)
        context=decode(read(local/'inputs/context.json',32<<10)[1])
        trusted=decode(read(local/'inputs/trustedLightBlockFile',10<<20)[1])
    start=result['mathStartedUnixNanoseconds'];finish=result['mathFinishedUnixNanoseconds']
    require(type(start) is str and type(finish) is str and int(start)<=int(finish),'original math clock unavailable')
    now=time.time_ns();expiry=proof_trust_expiry(context,trusted)
    require(int(finish)<=now<expiry,'original proof is expired or local clock precedes its completed verification; historical DATA only')
    return {'originalMathStartedUnixNanoseconds':start,'originalMathFinishedUnixNanoseconds':finish,
            'checkedAtUnixNanoseconds':str(now),'trustExpiresUnixNanoseconds':str(expiry),'mathReexecuted':False}


def retained_result(local, request):
    publication=decode(read(local/'PUBLISHED.json',16<<10)[1])
    require(set(publication)=={'requestSHA256','resultSHA256','received','destination','exitCode','reconciled','mathReexecuted'}
            and publication['requestSHA256']==sha(encode(request)) and publication['destination']==request['destination']
            and publication['mathReexecuted'] is False and type(publication['reconciled']) is bool
            and publication['received'] in ('received','reconciled/received'),'closed original publication correlation')
    target=local/publication['received'];r=verified_result(target,request)
    require(read(target/'RESULT.json',4<<20)[0]['sha256']==publication['resultSHA256'] and r['exitCode']==publication['exitCode'], 'completed result changed')
    if request['operation'] in ('proof','proof-capture') and r['exitCode']==0: proof_reconcile_freshness(local,request,r,target/'outputs')
    if request['destination'] and r['exitCode']==0:
        data=target/'outputs/package' if request['operation']=='generate-package' else target/'outputs'
        require(catalog(original(absolute(request['destination'])))==[p for p in catalog(data) if p['path'] not in ('stdout','stderr')], 'normal caller destination changed')
    return target/'outputs',r['exitCode']


# Bootstrap is deliberately fixed: it only reserves one SHA-addressed request,
# receives the public tar, verifies the original helper bytes, and dispatches.
# No existing directory is ever reused by execute. Reconcile never dispatches.
BOOTSTRAP = r'''import hashlib,json,os,pathlib,shutil,stat,sys,tarfile
root=pathlib.Path(sys.argv[1]); expected=sys.argv[2]; action=sys.argv[3]; ingress=int(sys.argv[4])
assert 0<=ingress<=5460983808
assert str(root).startswith('/var/tmp/ynx-public-tools-') and len(root.name)<240
if action=='read':
 assert ingress==0
 assert root.resolve(strict=True)==root and root.stat().st_uid==os.geteuid() and stat.S_IMODE(root.stat().st_mode)==0o700
 def ident(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
 def held(name,limit):
  p=root/name;s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==os.geteuid() and not s.st_mode&0o022 and s.st_size<=limit
  f=os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK),'rb');assert ident(os.fstat(f.fileno()))==ident(s)
  return p,s,f
 def unique(pairs):
  out={}
  for k,v in pairs:assert k not in out;out[k]=v
  return out
 c,cs,cf=held('COMPLETE.json',4096)
 with cf:
  v=json.loads(cf.read(),object_pairs_hook=unique)
  assert ident(os.fstat(cf.fileno()))==ident(cs)==ident(c.lstat())
 assert set(v)=={'requestSHA256','response'} and v['requestSHA256']==root.name[-64:]
 p,ps,f=held('response.tar',5460983808)
 h=hashlib.sha256();n=0
 with f:
  while True:
   b=f.read(1<<20)
   if not b:break
   n+=len(b);assert n<=5460983808;h.update(b)
  assert v['response']==dict(bytes=n,sha256=h.hexdigest()) and ident(os.fstat(f.fileno()))==ident(ps)==ident(p.lstat())
  f.seek(0);shutil.copyfileobj(f,sys.stdout.buffer,1<<20)
  assert ident(os.fstat(f.fileno()))==ident(ps)==ident(p.lstat())
 sys.exit(0)
assert action=='execute'
v=os.statvfs(root.parent);assert v.f_bavail*v.f_frsize >= 2*ingress+268435456, 'insufficient remote ingress disk'
os.mkdir(root,0o700)
f=os.open(root.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(f);os.close(f)
p=root/'request.tar'
with p.open('xb') as f:
 n=0
 while True:
  b=sys.stdin.buffer.read(1<<20)
  if not b:break
  n+=len(b);assert n<=ingress;f.write(b)
 assert n==ingress
 f.flush();os.fsync(f.fileno())
with tarfile.open(p,'r:') as t:
 seen=set();total=0
 for m in t:
  q=pathlib.PurePosixPath(m.name)
  assert m.isfile() and not m.pax_headers and not q.is_absolute() and '..' not in q.parts and str(q)==m.name and m.name not in seen
  assert m.name in ('controller.py','runtime-validator.sh','exporter-validator.sh','request.json') or m.name.startswith('inputs/')
  assert 0<=m.size<=1073741824
  if m.name in ('controller.py','runtime-validator.sh','exporter-validator.sh'):assert m.size<=1048576
  if m.name=='request.json':assert m.size<=2097152
  seen.add(m.name);total+=m.size;assert len(seen)<=8192 and total<=5444206592
  d=root/m.name;d.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with d.open('xb') as f,t.extractfile(m) as s:shutil.copyfileobj(s,f,1<<20);f.flush();os.fsync(f.fileno())
assert hashlib.sha256((root/'controller.py').read_bytes()).hexdigest()==expected
assert hashlib.sha256((root/'request.json').read_bytes()).hexdigest()==root.name[-64:]
os.execve('/usr/bin/python3',['python3','-B',str(root/'controller.py'),'server',str(root)],{'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'})
'''
BOOTSTRAP = BOOTSTRAP.replace('5460983808', str(MAX_ARCHIVE)).replace('5444206592', str(MAX_TOTAL))


def server(root):
    require(sys.platform.startswith('linux') and os.geteuid() == 0, 'Linux original host root public sandbox required')
    root = original(absolute(root))
    r = validate_request(decode(read(root / 'request.json', 2 << 20)[1]))
    require(root.name == 'ynx-public-tools-' + r['transaction'] + '-' + sha(encode(r)), 'same-operation root mismatch')
    require(r['operation']!='proof' or 'captureRoot' in r['arguments'], 'server proof requires actual normal capture; no context-only transport')
    (root / 'inputs').mkdir(mode=0o700, exist_ok=True)
    durable(root / 'INTENT.json', encode({'requestSHA256': sha(encode(r)), 'status': 'UNKNOWN', 'automaticRetry': False}))
    execute(root, r)
    with (root / 'response.tar').open('rb') as f:
        shutil.copyfileobj(f, sys.stdout.buffer, 1 << 20)


def receive_transport(command, input_stream, output_path, error_path, maximum):
    disk_required(output_path.parent, maximum+(1<<20), 'bounded public response')
    child=None;selector=selectors.DefaultSelector()
    try:
        with output_path.open('xb') as out,error_path.open('xb') as err:
            child=subprocess.Popen(command,stdin=input_stream,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
            for pipe,target,limit in ((child.stdout,out,maximum),(child.stderr,err,1<<20)):
                os.set_blocking(pipe.fileno(),False);selector.register(pipe,selectors.EVENT_READ,[target,0,limit])
            while selector.get_map():
                for key,_ in selector.select(0.25):
                    raw=os.read(key.fd,1<<20)
                    if not raw:selector.unregister(key.fileobj);key.fileobj.close();continue
                    key.data[1]+=len(raw)
                    require(key.data[1]<=key.data[2],'public transport output exceeded fixed bound')
                    key.data[0].write(raw)
            code=child.wait()
            for target in (out,err):target.flush();os.fsync(target.fileno())
            return code
    finally:
        first=sys.exc_info()[1];cleanup=[];selector.close()
        if child is not None:
            if child.poll() is None:
                try:os.killpg(child.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                except OSError as error:cleanup.append(error)
                try:child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:os.killpg(child.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    except OSError as error:cleanup.append(error)
                    try:child.wait(timeout=5)
                    except subprocess.TimeoutExpired as error:cleanup.append(error)
            for pipe in (child.stdout,child.stderr):
                if pipe is not None:pipe.close()
        if cleanup:
            message='original transport cleanup incomplete: '+'; '.join(str(e) for e in cleanup)
            if first is not None:first.add_note(message)
            else:raise RuntimeError(message)


def retain_migration(transaction_path, expected_pin, commit, stream):
    transaction=original(absolute(transaction_path));pin(expected_pin)
    target=data_root(transaction)/'final-snapshot/migration.json'
    original(target.parent);disk_required(target.parent,MAX_FILE,'bounded original migration download')
    # Exact final-snapshot destination only; no arbitrary filename or body
    # source selector. The original authenticated SSH producer supplies stdin.
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    digest=hashlib.sha256();count=0
    with os.fdopen(fd,'wb') as out:
        while True:
            chunk=stream.read(1<<20)
            if not chunk:break
            count+=len(chunk);require(count<=MAX_FILE,'original migration exceeds existing one-GiB transport bound')
            digest.update(chunk);out.write(chunk)
        out.flush();os.fsync(out.fileno())
    sync(target.parent)
    require(count>0 and digest.hexdigest()==expected_pin,'original downloaded migration pin differs; retain partial/UNKNOWN')
    original_migration(transaction,target,commit)
    return target


def original_migration(transaction, selected, commit):
    # Only the original authenticated final-snapshot phase's fixed publication
    # can be sent. A selected path, matching filename, or private JSON shape
    # cannot create a public migration. Do this before opening selected body.
    expected=data_root(transaction)/'final-snapshot/migration.json'
    require(absolute(str(selected))==expected,'migration is outside the original final-snapshot publication')
    evidence=decode(read(transaction/'final-snapshot/remote-evidence.json',64<<10)[1])
    stdout=read(transaction/'roles/primary-export-final-snapshot.txt',64<<10)[1]
    matches=re.findall(rb'^sha256=([0-9a-f]{64})$',stdout,re.M)
    require(len(matches)==1 and matches[0].decode()==pin(evidence.get('sha256'))
        and evidence.get('transactionId')==transaction.name and evidence.get('exporterCommit')==commit
        and all(evidence.get(k) is True for k in ('validated','sourceUnchanged','pauseVerified','mutationFreezeVerified'))
        and evidence.get('runtimeStarted') is False and evidence.get('deployment') is False,
        'original normal final-snapshot terminal/evidence differs')
    # These booleans are checked for producer-format consistency, never as
    # approval. The original driver retains raw protected approvals and source
    # pins; this reader cannot mint or bypass them.
    actual,_,_=read(expected,MAX_FILE,False)
    require(actual['sha256']==evidence['sha256'],'original public migration changed')
    return expected


def completed_publication(transaction, destination, commit, source_pin):
    work=data_root(transaction)/'linux-public-tools'
    candidates=list(work.iterdir()) if work.exists() else []
    require(len(candidates)<=128,'bounded original operation publication inventory')
    matches=[]
    for local in candidates:
        if not re.fullmatch('[0-9a-f]{64}',local.name) or not (local/'PUBLISHED.json').is_file():continue
        request=validate_request(decode(read(local/'request.json',2<<20)[1]))
        require(sha(encode(request))==local.name,'original operation path changed')
        if request['destination']!=str(destination):continue
        require(request['transaction']==transaction.name and request['commit']==commit and request['sourceSHA256']==source_pin,
                'original publication source/transaction mismatch')
        outputs,status=retained_result(local,request)
        require(status==0,'public producer did not complete successfully')
        matches.append((local,request,outputs))
    require(len(matches)==1,'one original successful public producer publication required')
    return matches[0]


def original_generation_inputs(transaction,migration,validators,plan,plan_pin,commit):
    original_migration(transaction,migration,commit)
    selected=os.environ.get('PUBLIC_BFT_LINUX_TOOL_OPERATOR_PLAN') or os.environ.get('PUBLIC_BFT_PRODUCTION_OPERATOR_PLAN')
    if not selected: selected=str(transaction/'preparation-operator-plan.json')
    require(absolute(plan)==absolute(selected) and plan_pin==os.environ.get('CONSENSUS_CANDIDATE_OPERATOR_PLAN_SHA256'),
            'generation plan differs from original protected caller selection')
    require(absolute(validators)==absolute(os.environ.get('PUBLIC_BFT_PRODUCTION_VALIDATOR_MANIFEST','')),
            'validator manifest differs from original public selection')
    raw=read(Path(plan),96<<20)[1];require(sha(raw)==pin(plan_pin),'original approved operator plan pin differs')
    value=decode(raw)
    required={'version','chainId','validatorManifestSHA256','consensusGenesis','consensusGenesisSHA256','originalGenesisHash','migrationStateHash',
        'stateLayout','runtimePlan','runtimePlanHash','pqSchedule','pqScheduleHash','roles'}
    require(type(value) is dict and required<=set(value)<=required|{'heightHaltSessionId','bootstrapRegistrationMode'}
            and value['version']=='YNX-PRODUCTION-OPERATOR/v1','closed original public operator plan required before transport')
    manifest=decode(read(Path(validators),256<<10)[1])
    require(type(manifest) is dict and set(manifest)=={'version','purpose','chainId','validators'} and type(manifest['validators']) is list and len(manifest['validators'])==4,
            'closed original public validator manifest before transport')
    fields=('validatorAddress','role','privateP2PHost','p2pPort','nodeId','consensusKeyType','consensusPubKey','consensusAddress')
    require(all(type(v) is dict and set(v)==set(fields) for v in manifest['validators']) and {v['role'] for v in manifest['validators']}==set(ROLES),
            'public validator identity fields only')
    normalized={k:manifest[k] for k in ('version','purpose','chainId')}
    normalized['validators']=[{k:v[k] for k in fields} for v in sorted(manifest['validators'],key=lambda v:v['role'])]
    canonical=json.dumps(normalized,separators=(',',':'),ensure_ascii=False).encode()
    require(sha(canonical)==pin(value['validatorManifestSHA256']),'public validator manifest differs from original plan')


def client(args):
    # shell supplies original role/commit/SOURCE and the original transaction
    # path, never an SSH hostname, credential, arbitrary executable or argv.
    require(len(args) >= 7, 'exact original public bridge context required')
    txdir, role, bundle, commit, source_pin, operation, *values = args
    transaction = original(absolute(txdir))
    require(transaction.is_dir(), 'original transaction directory required')
    work = data_root(transaction) / 'linux-public-tools'
    if not work.exists():
        fresh(work)
    else:
        original(work)
    script=Path(__file__).resolve()
    validator=script.parent.parent/'deploy/deploy-consensus-candidate.sh'
    r = dict(version=VERSION,transaction=transaction.name,role=role,runtime=bundle,commit=commit,sourceSHA256=source_pin,operation=operation,arguments={},inputs=[],phase=os.environ.get('PUBLIC_BFT_LINUX_TOOL_PHASE','public-data'),transportSources={'controller.py':read(script,1<<20,False)[0], 'runtime-validator.sh':read(validator,1<<20,False)[0], 'exporter-validator.sh':read(script.parent/'remote/public-bft-final-snapshot.sh',1<<20,False)[0]})
    sources, destination = [], None
    if operation == 'inventory':
        require(len(values) == 1, 'inventory destination required'); destination = absolute(values[0])
    elif operation == 'exporter-files':
        require(len(values)==3,'original exporter bundle/pin/destination');r['arguments']={'bundle':values[0],'sourceSHA256':values[1]};destination=absolute(values[2])
    elif operation in ('light-files','light-metadata','proof-capture'):
        require(len(values)==(3 if operation=='proof-capture' else 4),'normal capture root/raw receipt pin/source plan pin/destination required')
        r['arguments']={'captureRoot':values[0],'captureReceiptSHA256':values[1],'sourcePlanSHA256':values[2]}
        if operation!='proof-capture':destination=absolute(values[3])
    elif operation == 'proof-exported':
        require(len(values)==1,'one actual published PUBLIC capture required')
        public=original(absolute(values[0]));_,producer,outputs=completed_publication(transaction,public,commit,source_pin)
        require(producer['operation']=='light-files' and producer['role']==role,'proof must use original same-role source capture')
        export_raw=read(public/'export-receipt.json',128<<10)[1];capture=decode(read(public/'capture-receipt.json',128<<10)[1])
        receipt,context,pins=light_delivery(public/'delivery',capture['output'],export_raw,capture['deliverySHA256'],producer['arguments']['sourcePlanSHA256'])
        operation='proof';r['operation']='proof';r['arguments']={**producer['arguments'],'contextPath':receipt['contextPath'],'contextSHA256':receipt['contextSHA256'],'proofPaths':{k:context[k] for k in PROOF_FIELDS}}
        sources=[('inputs/context.json',public/'delivery/trust-context.json'),('inputs/request.json',public/'delivery/request.json')]+[('inputs/'+field,public/'delivery'/name) for _,name,field in LIGHT_NAMES if field and context[field]]
    elif operation == 'stage-public':
        require(len(values)==1, 'fixed public stage profile');r['arguments']={'profile':values[0]}
    elif operation in ('migration-summary','verify-migration'):
        require(len(values) == 1, 'migration original required'); sources=[('inputs/migration.json',original_migration(transaction,values[0],commit))]
        r['arguments']['migrationEvidenceSHA256']=read(transaction/'final-snapshot/remote-evidence.json',64<<10,False)[0]['sha256']
    elif operation == 'generate-package':
        require(len(values) == 6, 'six original generation inputs required')
        migration,validators,genesis,plan,plan_pin,output=values
        original_generation_inputs(transaction,migration,validators,plan,plan_pin,commit)
        r['arguments']={'genesisTime':genesis,'planSHA256':plan_pin,'migrationEvidenceSHA256':read(transaction/'final-snapshot/remote-evidence.json',64<<10,False)[0]['sha256']};destination=absolute(output)
        sources=[('inputs/migration.json',absolute(migration)),('inputs/validators.json',absolute(validators)),('inputs/operator-plan.json',absolute(plan))]
    elif operation == 'verify-package':
        require(len(values) == 2, 'operator package and independent pin required')
        r['arguments']={'planSHA256':values[1]}; package=original(absolute(values[0]))
        producer_case, producer, _=completed_publication(transaction,package,commit,source_pin)
        require(producer['role']==role,'original package math must stay on its producer role')
        r['arguments']['producerRequestSHA256']=producer_case.name
        require(producer['operation']=='generate-package' and producer['arguments']['planSHA256']==values[1], 'package is not original same-source public producer output')
        sources=[('inputs/package/'+p['path'],package/p['path']) for p in public_package_catalog(package)]
    elif operation == 'proof':
        # Legacy context-only transport is intentionally unavailable. It could
        # read arbitrary private paths before Go classified them. The default
        # local Linux verifier branch remains unchanged in the normal driver.
        raise ValueError('context-only transport has no original PUBLIC producer closure; use completed normal capture')

    else:
        raise ValueError('unknown public tool operation')
    r['destination']=str(destination) if destination is not None else ''
    held=[]
    for name,p in sources:
        actual,_,ident=read(p,material=False);r['inputs'].append({'path':name,**actual});held.append((p,ident))
    validate_request(r)
    raw=encode(r); request_sha=sha(raw)
    local=work/request_sha
    if local.exists():
        require(read(local/'request.json',2<<20)[1]==raw, 'original request differs')
        # A confirmed explicit reconciliation may complete a static producer's
        # original output. A proof is not reusable evidence of a later clock.
        require(operation!='stage-public', 'original stage is not replayable')
        if operation in ('proof','proof-capture'):
            require((local/'RECONCILED-PROOF-ORIGINAL.json').is_file(),'original proof requires explicit same-operation reconciliation')
        require((local/'PUBLISHED.json').is_file(),'existing request/UNKNOWN preserved; explicit reconcile only')
        outputs,status=retained_result(local,r)
        sys.stdout.buffer.write(read(outputs/'stdout',1<<20)[1]);sys.stderr.buffer.write(read(outputs/'stderr',1<<20)[1]);return status
    space = disk_required(work, operation_space(r), 'original local public operation')
    fresh(local)
    durable(local/'SPACE.json', encode(space))
    fresh(local/'inputs')
    durable(local/'request.json',raw)
    durable(local/'INTENT.json',encode({'status':'UNKNOWN','automaticRetry':False,'requestSHA256':request_sha}))
    transported=[]
    for entry,(_,p) in zip(r['inputs'],sources):
        if ('migrationEvidenceSHA256' in r['arguments'] and entry['path']=='inputs/migration.json') or 'producerRequestSHA256' in r['arguments']:continue
        transported.append(entry)
        dest=local/entry['path'];ensure_directories(dest.parent)
        checked_copy(p,dest,{k:entry[k] for k in ('bytes','sha256')})
    checked_copy(script,local/'controller.py',read(script,1<<20,False)[0])
    checked_copy(validator,local/'runtime-validator.sh',read(validator,1<<20,False)[0])
    checked_copy(script.parent/'remote/public-bft-final-snapshot.sh',local/'exporter-validator.sh',r['transportSources']['exporter-validator.sh'])
    entries=[{'path':n,**read(local/n,material=False)[0]} for n in ('controller.py','runtime-validator.sh','exporter-validator.sh','request.json')]+transported
    pack(local,entries,local/'request.tar')
    helper_sha=read(local/'controller.py',material=False)[0]['sha256']
    shell=script.with_suffix('.sh')
    with (local/'request.tar').open('rb') as inp:
        code=receive_transport(['/bin/bash',str(shell),'transport',role,transaction.name,request_sha,helper_sha,'execute',str((local/'request.tar').stat().st_size)], inp,
                               local/'response.tar',local/'transport.stderr', min(MAX_ARCHIVE,output_bound(r)+(16<<20)))
    durable(local/'TRANSPORT.json',encode({'exitCode':code,'automaticRetry':False}))
    require(code==0, 'transport failed; original INTENT/partial retained, reconcile same operation only')
    outputs,status=accept_result(local,r)
    require(all(identity(p.lstat())==ident for p,ident in held), 'original client public inputs changed during operation')
    if operation in ('proof','proof-capture') and status==0: proof_reconcile_freshness(local,r,verified_result(outputs.parent,r),outputs)
    publish_result(local,r,outputs,status)
    sys.stdout.buffer.write(read(outputs/'stdout',1<<20)[1])
    sys.stderr.buffer.write(read(outputs/'stderr',1<<20)[1])
    return status


def reconcile(case):
    local=original(absolute(case))
    request=validate_request(decode(read(local/'request.json',2<<20)[1]))
    require(local.name==sha(encode(request)) and local.parent.name=='linux-public-tools','same operation evidence path required')
    require(not (local/'PUBLISHED.json').exists(),'completed original result already published')
    # Preserve the first response, including a short/error response. Never
    # send original inputs or reexecute. Partial reconcile itself is retained.
    target=local/'reconciled-response.tar'
    recovered=local/'reconciled'
    if recovered.exists():
        # A completed original read may have lost its local publication ACK.
        # Continue from those exact closed bytes only, without another SSH or
        # math invocation. Partial receive/parse is never silently adopted.
        require(decode(read(local/'RECONCILE.json',4096)[1])==
            {'exitCode':0,'effect':'read-only-original-result','automaticRetry':False},'original reconciliation incomplete')
        result=verified_result(recovered/'received',request)
        require(read(recovered/'RESULT.json',4<<20)[1]==encode(result),'original reconciled result changed')
        outputs,status=recovered/'received/outputs',result['exitCode']
    else:
        code=receive_transport(['/bin/bash',str(Path(__file__).with_suffix('.sh')),'transport',request['role'],request['transaction'],local.name,request['transportSources']['controller.py']['sha256'],'read','0'],
                               subprocess.DEVNULL,target,local/'reconcile.stderr',min(MAX_ARCHIVE,output_bound(request)+(16<<20)))
        durable(local/'RECONCILE.json',encode({'exitCode':code,'effect':'read-only-original-result','automaticRetry':False}))
        require(code==0,'same-operation result unavailable; UNKNOWN remains')
        fresh(recovered)
        outputs,status=accept_result(recovered,request,target)
    if request['operation'] in ('proof','proof-capture'):
        original_result=verified_result(outputs.parent,request)
        freshness=proof_reconcile_freshness(local,request,original_result,outputs) if status==0 else None
        proof_record={'requestSHA256':local.name,
            'originalResultSHA256':read(recovered/'RESULT.json',4<<20)[0]['sha256'],
            'originalExitCode':status,'freshness':freshness,'mathReexecuted':False}
        retained=local/'RECONCILED-PROOF-ORIGINAL.json'
        if retained.exists():
            first=decode(read(retained,16<<10)[1])
            require(set(first)==set(proof_record) and all(first[k]==proof_record[k] for k in
                ('requestSHA256','originalResultSHA256','originalExitCode','mathReexecuted')),'original proof reconciliation changed')
            # Keep the first observation raw; the fresh guard above still runs.
        else:durable(retained,encode(proof_record))
    publish_result(local,request,outputs,status,recovered=True)
    sys.stdout.buffer.write(read(outputs/'stdout',1<<20)[1]);sys.stderr.buffer.write(read(outputs/'stderr',1<<20)[1])
    return status


if __name__ == '__main__':
    try:
        if len(sys.argv)==3 and sys.argv[1]=='server':server(sys.argv[2]);code=0
        elif len(sys.argv)==8 and sys.argv[1]=='bootstrap-command':
            import shlex
            role,tx,request,helper,action,ingress=sys.argv[2:]
            require(action in ('execute','read'), 'fixed transport action')
            require(role in ROLES and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}',tx), 'role/transaction')
            pin(request);pin(helper)
            require(re.fullmatch('0|[1-9][0-9]*',ingress) and int(ingress)<=MAX_ARCHIVE and (action!='read' or ingress=='0'),'fixed bounded ingress')
            print('sudo /usr/bin/python3 -c '+shlex.quote(BOOTSTRAP)+' '+shlex.quote('/var/tmp/ynx-public-tools-'+tx+'-'+request)+' '+helper+' '+action+' '+ingress);code=0
        elif len(sys.argv)==6 and sys.argv[1]=='publication-case':
            print(completed_publication(original(absolute(sys.argv[2])),absolute(sys.argv[3]),sys.argv[4],sys.argv[5])[0]);code=0
        elif len(sys.argv)==3 and sys.argv[1]=='reconcile':code=reconcile(sys.argv[2])
        elif len(sys.argv)==5 and sys.argv[1]=='retain-migration':retain_migration(sys.argv[2],sys.argv[3],sys.argv[4],sys.stdin.buffer);code=0
        elif len(sys.argv)==3 and sys.argv[1]=='data-root':print(data_root(original(absolute(sys.argv[2]))));code=0
        elif len(sys.argv)>2 and sys.argv[1]=='client':code=client(sys.argv[2:])
        else:raise ValueError('fixed public client/server command required')
        sys.exit(code)
    except Exception as error:
        print('public Linux tool refused: '+str(error),file=sys.stderr)
        for note in getattr(error,'__notes__',()):
            print(note,file=sys.stderr)
        sys.exit(1)
