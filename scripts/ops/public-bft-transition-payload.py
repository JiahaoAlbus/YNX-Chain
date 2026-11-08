#!/usr/bin/env python3
"""Stream complete, already verified PUBLIC packages without a second staging copy.

This is transport DATA, not a package verifier or phase authorization. The
original Go verifier runs before this caller and again on the target before
any service action. Each migration member remains a distinct regular file.
No symlinks, hard links, sparse shortcuts, cached hashes or private paths are
transported. A failed archive/attempt is retained, never repaired or retried.
"""
import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tarfile

spec = importlib.util.spec_from_file_location(
    'transition_original_public_tools', Path(__file__).with_name('public-bft-linux-public-tools.py'))
public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public)

VERSION = 'YNX-OPERATOR-TRANSITION-PAYLOAD/v1'
ROLES = public.ROLES
MIGRATIONS = ('common/bound-migration.json',) + tuple(
    'roles/' + role + '/config/bound-migration.json' for role in ROLES)
MIB = 1 << 20
GIB = 1 << 30
ALLOCATION = 65536  # conservative public filesystem block allowance; no du dedup
MAX_PACKAGE_MEMBERS = 64  # exact existing public_package_catalog allowlist
MAX_ENTRIES = 2 * MAX_PACKAGE_MEMBERS + 32
PUBLIC_STAGE_EXTRA = (96 + 384 + 2 + 4) * MIB
CAPACITY_RECEIPTS = {'capacity-receipts/' + role + '.json' for role in ROLES} | {'capacity-receipts/manifest.json'}
CAPACITY_RESERVE = 5 * (MIB + ALLOCATION) + 2 * ALLOCATION
CAPACITY_FILES = {'helper.sh', 'request.json', 'approval.json', 'old-SOURCE.json', 'SOURCE.json',
                  'old-package/package-manifest.json', 'old-package/common/operator-plan.json', 'old-role/role-manifest.json',
                  'old-role/scripts/start-operator.sh',
                  'old-role/systemd/ynx-consensus-operator-candidate.service'}
CAPACITY_IDENTITIES = ('transitionId', 'role', 'approvalSHA256', 'oldOperatorPlanSHA256',
                       'oldRuntimeCommit', 'oldRuntimeManifestSHA256', 'runtimeCommit', 'runtimeManifestSHA256')
REQUEST_FIELDS = {'version', *CAPACITY_IDENTITIES, 'quiesceStageBytesBound', 'futureStageBytesBound',
                  'oldPackageBytes', 'currentMigrationBytes', 'currentMigrationSHA256', 'bridgeMode'}


def need(ok, message):
    if not ok:
        raise ValueError(message)


def decimal(value, positive=False):
    need(type(value) is str and re.fullmatch('0|[1-9][0-9]*', value) is not None,
         'canonical capacity decimal required')
    result = int(value)
    need((result > 0 if positive else result >= 0) and result <= (1 << 63) - 1, 'capacity integer bound')
    return result


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def durable(path, raw):
    path = Path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
    public.sync(path.parent)


def capacity_request(catalog_path, binding_path, output, bridge_mode):
    record = public.decode(public.read(Path(catalog_path), 8 * MIB)[1])
    binding = public.decode(public.read(Path(binding_path), MIB)[1])
    need(record.get('version') == VERSION and record.get('phase') == 'quiesce'
         and record.get('nextOperatorPlanSHA256') is None, 'original pre-quiesce catalog required')
    need(binding.get('phase') == 'quiesce' and binding.get('role') in ROLES
         and binding.get('oldOperatorPlanSHA256') == record['oldOperatorPlanSHA256'],
         'capacity request differs from original phase binding')
    request = {'version': 'YNX-OPERATOR-TRANSITION-CAPACITY-REQUEST/v1',
               **{name: binding[name] for name in CAPACITY_IDENTITIES},
               'quiesceStageBytesBound': record['stageBytesBound'],
               'futureStageBytesBound': record['futureStageBytesBound'],
               'oldPackageBytes': record['oldPackageBytes'],
               'currentMigrationBytes': str(record['migration']['bytes']),
               'currentMigrationSHA256': record['migration']['sha256'],
               'bridgeMode': bridge_mode}
    durable(output, encode(request))


def validate_capacity(request_raw, receipt_raw, binding):
    request, receipt = public.decode(request_raw), public.decode(receipt_raw)
    need(type(binding) is dict and binding.get('phase') in ('quiesce', 'install', 'start'), 'normal phase binding required')
    need(type(request) is dict and set(request) == REQUEST_FIELDS
         and request['version'] == 'YNX-OPERATOR-TRANSITION-CAPACITY-REQUEST/v1', 'closed capacity request required')
    need(request['role'] in ROLES and type(request['bridgeMode']) is bool
         and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', request['transitionId']), 'capacity identity required')
    for field in CAPACITY_IDENTITIES:
        if field not in ('approvalSHA256',):
            need(request[field] == binding[field], 'capacity source/role differs from phase binding')
    if binding['phase'] == 'quiesce':
        need(request['approvalSHA256'] == binding['approvalSHA256'], 'original capacity approval differs')
    for field in ('approvalSHA256', 'oldOperatorPlanSHA256', 'oldRuntimeManifestSHA256', 'runtimeManifestSHA256', 'currentMigrationSHA256'):
        public.pin(request[field])
    for field in ('oldRuntimeCommit', 'runtimeCommit'):
        need(type(request[field]) is str and re.fullmatch('[0-9a-f]{40}', request[field])
             and request[field] != '0' * 40, 'full runtime commit required')
    for field in ('quiesceStageBytesBound', 'futureStageBytesBound', 'oldPackageBytes', 'currentMigrationBytes'):
        decimal(request[field], True)
    need(decimal(request['oldPackageBytes']) >= 5 * decimal(request['currentMigrationBytes']), 'five migration copies cannot be omitted')
    fields = {'version', *CAPACITY_IDENTITIES, 'requestSHA256', 'process', 'groups', 'bounds', 'filesystems',
              'capacityAvailable', 'sampleOnly', 'growthReserved', 'requiresRemeasure', 'sourceGrant', 'firstNativeImport'}
    need(type(receipt) is dict and set(receipt) == fields and receipt['version'] == 'YNX-OPERATOR-TRANSITION-CAPACITY/v1',
         'closed original capacity receipt required')
    need(all(receipt[k] == request[k] for k in CAPACITY_IDENTITIES)
         and receipt['requestSHA256'] == public.sha(request_raw), 'capacity original request pin/binding differs')
    for field, value in (('sampleOnly', True), ('growthReserved', False), ('requiresRemeasure', True),
                         ('sourceGrant', False), ('firstNativeImport', False)):
        need(receipt[field] is value, 'capacity DATA cannot grant source or reserve unknown growth')
    process = receipt['process']
    need(type(process) is dict and set(process) == {'mainPid', 'startTicks', 'runningExecutableSHA256'}, 'closed original process metadata')
    decimal(process['mainPid'], True); decimal(process['startTicks'], True)
    need(process['runningExecutableSHA256'] == binding['oldCometSHA256'], 'capacity running original differs')
    groups = receipt['groups']
    need(type(groups) is dict and set(groups) == {'committed', 'launch'}, 'complete private-scope numeric groups required')
    for group in groups.values():
        need(type(group) is dict and set(group) == {'rawBytes', 'files', 'directories', 'tarBytesBound', 'archiveBytesBound'}, 'closed numeric backup group')
        for value in group.values(): decimal(value)
        need(decimal(group['tarBytesBound']) >= decimal(group['rawBytes'])
             and decimal(group['archiveBytesBound']) >= decimal(group['tarBytesBound']), 'no assumed backup compression savings')
    bounds = receipt['bounds']
    need(type(bounds) is dict and set(bounds) == {'publicStagesBytesBound', 'backupBytesBound', 'installationBytesBound',
                                                 'heightHaltBytesBound', 'bridgeBytesBound', 'metadataReserveBytes'}, 'complete cumulative numeric bounds required')
    for value in bounds.values(): decimal(value)
    need(decimal(bounds['publicStagesBytesBound']) >= 2 * decimal(request['quiesceStageBytesBound'])
         + 4 * decimal(request['futureStageBytesBound']) + 3 * GIB, 'original per-phase margin or retained phase omitted')
    need(decimal(bounds['backupBytesBound']) >= sum(decimal(g['archiveBytesBound']) for g in groups.values()), 'backup archive retention omitted')
    need(decimal(bounds['installationBytesBound']) >= decimal(request['currentMigrationBytes'])
         and decimal(bounds['metadataReserveBytes']) >= 16 * MIB,
         'later installation or retained metadata budget omitted')
    need((decimal(bounds['bridgeBytesBound']) > 0) == request['bridgeMode'], 'bridge retention budget differs')
    filesystems = receipt['filesystems']
    need(type(filesystems) is list and 0 < len(filesystems) <= 16, 'bounded original filesystem set required')
    seen = set()
    for fs in filesystems:
        need(type(fs) is dict and set(fs) == {'device', 'availableBytes', 'requiredBytes'}, 'closed numeric filesystem record')
        for value in fs.values(): decimal(value)
        need(fs['device'] not in seen, 'duplicate filesystem record')
        seen.add(fs['device'])
        need(decimal(fs['requiredBytes']) >= sum(decimal(v) for v in bounds.values()),
             'a target filesystem omits cumulative retained bytes')
    available = all(decimal(fs['availableBytes']) > decimal(fs['requiredBytes']) for fs in filesystems)
    need(type(receipt['capacityAvailable']) is bool and receipt['capacityAvailable'] == available, 'capacity availability differs from strict numeric comparison')
    need(available, 'a role lacks cumulative original capacity; no freeze permitted')
    return request, receipt


def capacity_accept(request_path, receipt_path, binding_path):
    request_raw = public.read(Path(request_path), MIB)[1]
    receipt_raw = public.read(Path(receipt_path), MIB)[1]
    binding = public.decode(public.read(Path(binding_path), MIB)[1])
    request, receipt = validate_capacity(request_raw, receipt_raw, binding)
    return request, receipt, {'requestSHA256': public.sha(request_raw), 'receiptSHA256': public.sha(receipt_raw)}


def capacity_set(directory, bindings, output=None, record=None, phase=None, bridge_mode=None):
    directory, bindings = Path(directory), Path(bindings)
    roles, identity = {}, None
    for role in ROLES:
        request, receipt, pins = capacity_accept(directory / role / 'source/request.json',
                                                directory / role / 'receipt.json', bindings / (role + '.binding.json'))
        current = {k: request[k] for k in ('transitionId', 'runtimeCommit', 'runtimeManifestSHA256')}
        need(identity is None or identity == current, 'four capacity sources differ')
        identity, roles[role] = current, pins
        if record is not None:
            need(record['phase'] == phase and phase in ('install', 'start')
                 and type(bridge_mode) is bool and request['bridgeMode'] == bridge_mode
                 and record['oldOperatorPlanSHA256'] == request['oldOperatorPlanSHA256']
                 and record['oldPackageBytes'] == request['oldPackageBytes']
                 and str(record['migration']['bytes']) == request['currentMigrationBytes']
                 and record['migration']['sha256'] == request['currentMigrationSHA256']
                 and decimal(record['stageBytesBound']) <= decimal(request['futureStageBytesBound']),
                 'actual later phase exceeds original full-path capacity contract')
    result = {'version': 'YNX-OPERATOR-TRANSITION-CAPACITY-SET/v1', **identity, 'roles': roles}
    if output is not None: durable(output, encode(result))
    return result


def capacity_size(root):
    root = public.original(public.absolute(str(root)))
    entries = public.catalog(root)
    need({e['path'] for e in entries} == CAPACITY_FILES, 'closed small capacity public packet required')
    for entry in entries:
        maximum = 96 * MIB if entry['path'] in ('approval.json', 'old-package/common/operator-plan.json') else MIB
        need(0 < entry['bytes'] <= maximum, 'capacity packet member bound')
    # Small packet archive, directory and gzip overhead; no dedup/compression.
    return sum(((e['bytes'] + ALLOCATION - 1) // ALLOCATION) * ALLOCATION for e in entries) + 16 * MIB


def package(root, independent_plan):
    root = public.original(public.absolute(str(root)))
    public.pin(independent_plan)
    entries = public.public_package_catalog(root)
    need(len(entries) <= MAX_PACKAGE_MEMBERS, 'normal public package member bound')
    by_name = {e['path']: e for e in entries}
    need('package-manifest.json' in by_name and 'common/operator-plan.json' in by_name,
         'complete original package and independent plan required')
    need(by_name['common/operator-plan.json']['sha256'] == independent_plan,
         'original plan differs from independent pin')
    need(all(name in by_name for name in MIGRATIONS), 'all five original migration members required')
    first = by_name[MIGRATIONS[0]]
    need(0 < first['bytes'] <= GIB and all(
        (by_name[n]['bytes'], by_name[n]['sha256']) == (first['bytes'], first['sha256'])
        for n in MIGRATIONS), 'five complete equal migrations required')
    # This existing producer bound admits future operator-plan/config changes;
    # it does not assume an unavailable post-checkpoint package equals the old.
    bound = 5 * first['bytes'] + 6 * public.MAX_OPERATOR_PLAN + (64 << 20)
    need(sum(e['bytes'] for e in entries) <= bound, 'original package exceeds public producer bound')
    return entries, {'bytes': first['bytes'], 'sha256': first['sha256']}, bound


def inspect_inputs(payload, old_package, old_pin, new_package, new_pin, phase):
    need(phase in ('quiesce', 'install', 'start'), 'fixed operator transition phase required')
    payload = public.original(public.absolute(str(payload)))
    entries = public.catalog(payload)
    limits = {'helper.sh': MIB, 'approval.json': 96 * MIB,
              'old-SOURCE.json': 128 << 10, 'SOURCE.json': 128 << 10}
    limits.update({'bin/' + name: 128 * MIB for name in
                   ('ynx-comet', 'ynx-consensus-package', 'ynx-consensus-keycheck')})
    if phase == 'quiesce':
        limits.update({'freeze-markers/' + role + '.json': MIB for role in ROLES})
        limits.update({name: MIB for name in CAPACITY_RECEIPTS})
    names = {e['path'] for e in entries}
    required = {'helper.sh', 'approval.json', 'old-SOURCE.json', 'SOURCE.json'}
    if phase == 'quiesce':
        required.update('freeze-markers/' + role + '.json' for role in ROLES)
    binaries = {n for n in limits if n.startswith('bin/')}
    need(required <= names <= set(limits) and names & binaries in (set(), binaries),
         'closed original public stage members required')
    need(names & CAPACITY_RECEIPTS in (set(), CAPACITY_RECEIPTS), 'all four capacity receipts and raw-pin manifest required together')
    need(all(0 < e['bytes'] <= limits[e['path']] for e in entries), 'public stage member bound')
    source = public.decode(public.read(payload / 'SOURCE.json', 128 << 10)[1])
    binary_pins = source.get('binaries')
    need(type(binary_pins) is dict, 'original runtime binary metadata required')
    staged_binary_bytes = 0
    for name in ('ynx-comet', 'ynx-consensus-package', 'ynx-consensus-keycheck'):
        wanted = binary_pins.get(name)
        need(type(wanted) is dict and set(wanted) == {'bytes', 'sha256'}
             and type(wanted['bytes']) is int and 0 < wanted['bytes'] <= 128 * MIB,
             'original selected runtime byte bound')
        public.pin(wanted['sha256'])
        if 'bin/' + name in names:
            actual = next(e for e in entries if e['path'] == 'bin/' + name)
            need({k: actual[k] for k in ('bytes', 'sha256')} == wanted, 'selected runtime differs from original SOURCE')
        else:
            staged_binary_bytes += ((wanted['bytes'] + ALLOCATION - 1) // ALLOCATION) * ALLOCATION
    sources = {e['path']: payload / e['path'] for e in entries}
    old, migration, future_bound = package(old_package, old_pin)
    need((phase == 'quiesce') == (str(new_package) == '-' and new_pin == '-'),
         'quiesce has no fabricated future package')
    packages = [('old-package', Path(old_package), old)]
    if phase != 'quiesce':
        new, next_migration, _ = package(new_package, new_pin)
        need(next_migration == migration, 'future package changed original migration')
        packages.append(('new-package', Path(new_package), new))
    for prefix, root, members in packages:
        for e in members:
            name = prefix + '/' + e['path']
            sources[name] = root / e['path']
            entries.append({'path': name, 'bytes': e['bytes'], 'sha256': e['sha256']})
    entries.sort(key=lambda e: e['path'])
    need(len(entries) <= MAX_ENTRIES, 'public entry bound')
    raw = sum(e['bytes'] for e in entries)
    # Count every file independently, including all five full migrations.
    base_entries = [e for e in entries if e['path'] not in CAPACITY_RECEIPTS]
    allocated = sum(((e['bytes'] + ALLOCATION - 1) // ALLOCATION) * ALLOCATION for e in base_entries)
    directories = {str(p) for e in base_entries for p in Path(e['path']).parents if str(p) != '.'} | {'bin'}
    allocated += (len(directories) + 2) * ALLOCATION + staged_binary_bytes + CAPACITY_RESERVE
    all_directories = {str(p) for e in entries for p in Path(e['path']).parents if str(p) != '.'} | {'bin'}
    tar_bytes = sum(512 + ((e['bytes'] + 511) // 512) * 512 for e in entries) + 512 * len(all_directories) + 10240
    # Gzip is the same transport format as the original caller. This allowance
    # never assumes compression savings; actual archive size must fit it.
    archive_bound = tar_bytes + (tar_bytes + 999) // 1000 + MIB
    base_tar_bytes = sum(512 + ((e['bytes'] + 511) // 512) * 512 for e in base_entries) + 512 * len(directories) + 10240
    base_archive_bound = base_tar_bytes + (base_tar_bytes + 999) // 1000 + MIB + CAPACITY_RESERVE
    stage_bound = max(allocated, base_archive_bound)
    future_raw = sum(e['bytes'] for e in old) + future_bound + PUBLIC_STAGE_EXTRA
    future_stage_bound = future_raw + (MAX_ENTRIES * 6 + 32) * ALLOCATION + (32 * MIB) + CAPACITY_RESERVE
    record = {'version': VERSION, 'phase': phase, 'oldOperatorPlanSHA256': old_pin,
              'nextOperatorPlanSHA256': None if new_pin == '-' else new_pin,
              'migration': migration, 'files': entries, 'rawBytes': str(raw),
              'oldPackageBytes': str(sum(e['bytes'] for e in old)),
              'localPackageCopyBytesAvoided': str(sum(e['bytes'] for _, _, ms in packages for e in ms)),
              'archiveBytesBound': str(archive_bound), 'stageBytesBound': str(stage_bound),
              'phaseFreeBytesRequired': str(2 * stage_bound + GIB),
              'futurePackageBytesBound': str(future_bound),
              'futureStageBytesBound': str(future_stage_bound),
              'futurePhaseFreeBytesRequired': str(2 * future_stage_bound + GIB),
              'privateBackupBudgetSupplied': False, 'remoteCapacityQualified': False}
    return record, sources


class DigestReader:
    def __init__(self, stream):
        self.stream, self.digest, self.count = stream, hashlib.sha256(), 0

    def read(self, size):
        raw = self.stream.read(size)
        self.digest.update(raw)
        self.count += len(raw)
        return raw


def pack(payload, old_package, old_pin, new_package, new_pin, phase, catalog_path, archive):
    expected = public.decode(public.read(Path(catalog_path), 8 * MIB)[1])
    record, sources = inspect_inputs(payload, old_package, old_pin, new_package, new_pin, phase)
    need(record == expected, 'original public catalog changed before archive')
    archive = Path(archive)
    public.disk_required(archive.parent, int(record['archiveBytesBound']), 'exclusive public archive')
    before = {name: public.identity(path.lstat()) for name, path in sources.items()}
    # O_EXCL retains failed partials. No file is streamed to a host until this
    # whole operation and the independent archive SHA have completed locally.
    fd = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output:
        with gzip.GzipFile(filename='', mode='wb', fileobj=output, compresslevel=6, mtime=0) as gz:
            with tarfile.open(mode='w|', fileobj=gz, format=tarfile.USTAR_FORMAT) as tar:
                directories = {str(p) for e in record['files'] for p in Path(e['path']).parents if str(p) != '.'} | {'bin'}
                for name in sorted(directories):
                    info = tarfile.TarInfo(name + '/')
                    info.type, info.mode, info.mtime = tarfile.DIRTYPE, 0o700, 0
                    tar.addfile(info)
                for entry in record['files']:
                    name, size = entry['path'], entry['bytes']
                    path = sources[name]
                    source_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    with os.fdopen(source_fd, 'rb') as stream:
                        need(public.identity(os.fstat(source_fd)) == before[name], 'original changed before streaming')
                        reader = DigestReader(stream)
                        info = tarfile.TarInfo(name)
                        info.size, info.mode, info.mtime = size, 0o600, 0
                        tar.addfile(info, reader)
                        need(reader.count == size and reader.digest.hexdigest() == entry['sha256'],
                             'original bytes changed during streaming')
                        need(public.identity(os.fstat(source_fd)) == before[name]
                             and public.identity(path.lstat()) == before[name], 'original identity changed during streaming')
        output.flush()
        os.fsync(output.fileno())
        need(output.tell() <= int(record['archiveBytesBound']), 'actual archive exceeds retained raw budget')
    need(all(public.identity(p.lstat()) == before[n] for n, p in sources.items()),
         'an earlier streamed original changed before completion')
    # New/removed paths cannot hide behind the retained catalog.
    again, _ = inspect_inputs(payload, old_package, old_pin, new_package, new_pin, phase)
    need(again == expected, 'public source membership changed while streaming')
    public.sync(archive.parent)


def main(argv):
    if argv and argv[0] in ('capacity-accept', 'capacity-set', 'phase-budget'):
        parser = argparse.ArgumentParser()
        action = argv[0]
        names = {'capacity-accept': ('request', 'receipt', 'binding'),
                 'capacity-set': ('directory', 'bindings', 'output'),
                 'phase-budget': ('catalog', 'capacity', 'bindings', 'phase')}[action]
        for field in names: parser.add_argument('--' + field, required=True)
        if action == 'phase-budget': parser.add_argument('--bridge', choices=('0', '1'), required=True)
        args = parser.parse_args(argv[1:])
        if action == 'capacity-accept': capacity_accept(args.request, args.receipt, args.binding)
        elif action == 'capacity-set': capacity_set(args.directory, args.bindings, args.output)
        else: capacity_set(args.capacity, args.bindings, record=public.decode(public.read(Path(args.catalog), 8 * MIB)[1]), phase=args.phase, bridge_mode=args.bridge == '1')
        return
    if len(argv) == 3 and argv[:2] == ['capacity-size', '--directory']:
        print(capacity_size(argv[2]))
        return
    if argv and argv[0] == 'capacity-request':
        parser = argparse.ArgumentParser()
        for field in ('catalog', 'binding', 'output'):
            parser.add_argument('--' + field, required=True)
        parser.add_argument('--bridge', choices=('0', '1'), required=True)
        args = parser.parse_args(argv[1:])
        capacity_request(args.catalog, args.binding, args.output, args.bridge == '1')
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('inspect', 'pack'))
    for field in ('payload', 'old-package', 'old-pin', 'new-package', 'new-pin', 'phase', 'catalog'):
        parser.add_argument('--' + field, required=True)
    parser.add_argument('--archive')
    args = parser.parse_args(argv)
    values = (args.payload, args.old_package, args.old_pin, args.new_package, args.new_pin, args.phase)
    if args.action == 'inspect':
        need(args.archive is None, 'inspect takes no output archive')
        record, _ = inspect_inputs(*values)
        durable(args.catalog, encode(record))
    else:
        need(args.archive is not None, 'exclusive archive required')
        pack(*values, args.catalog, args.archive)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print('operator transition public payload refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
