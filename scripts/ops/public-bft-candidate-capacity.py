#!/usr/bin/env python3
"""Read-only per-role upload/extraction/installation capacity, not admission.

Inputs are this normal caller's already verified PUBLIC package and runtime.
No ledger, private key, HRS, backup, future package or future growth is inferred.
The generated command only stats original destination filesystems before the
caller reserves anything. Original archive/hash/install checks remain required.
"""
import argparse
import hashlib
import inspect
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import stat
import sys
import tarfile

MARGIN = 2 << 30  # Retain the normal production preflight's 2 GiB floor.
ROLES = ('primary', 'singapore', 'silicon-valley', 'seoul')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_nlink, s.st_size,
            s.st_mtime_ns, s.st_ctime_ns)


def original(path):
    path = Path(path)
    require(path.is_absolute() and path == path.resolve(strict=True), 'original canonical public path required')
    return path


def inventory(root):
    root = original(root)
    result = {}
    def visit(path):
        s = path.lstat()
        require(not path.is_symlink(), 'public stage link refused')
        name = path.relative_to(root).as_posix()
        require(len(name) <= 1024 and '\x00' not in name, 'public stage name bound')
        if stat.S_ISDIR(s.st_mode):
            result[name] = ('directory', 0, identity(s))
            for child in sorted(path.iterdir()):
                visit(child)
        else:
            require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and 0 <= s.st_size <= 64 << 30,
                    'public stage must contain original bounded regular files')
            result[name] = ('file', s.st_size, identity(s))
        require(len(result) <= 4096, 'public stage entry bound')
    visit(root)
    return result


def archive_inventory(archive, expected, stage):
    path = original(archive)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size > 0,
            'original archive required')
    require(re.fullmatch('[0-9a-f]{64}', expected), 'archive SHA256 required')
    entries = {}
    with path.open('rb') as f:
        require(identity(before) == identity(os.fstat(f.fileno())), 'archive changed before read')
        # The normal archive is already materialized: count its real members,
        # never assume compression savings or a historical migration length.
        with tarfile.open(fileobj=f, mode='r:gz') as tar:
            for member in tar:
                name = member.name
                if name.startswith('./'):
                    name = name[2:]
                name = name.rstrip('/') or '.'
                require(not name.startswith('/') and '..' not in PurePosixPath(name).parts
                        and name not in entries, 'archive path or duplicate refused')
                require(member.isdir() or member.isfile(), 'archive link/special refused')
                kind, size = ('directory' if member.isdir() else 'file'), member.size
                require(0 <= size <= 64 << 30 and len(entries) < 8192, 'archive member bound')
                if name in stage:
                    require(stage[name][:2] == (kind, size), 'archive/stage shape or byte count differs')
                # macOS tar may add regular AppleDouble metadata members. Count
                # ALL real archive entries, including these bytes; do not treat
                # them as new install inputs or silently omit their occupancy.
                entries[name] = (kind, size, None)
        f.seek(0)
        h = hashlib.sha256()
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
        digest = h.hexdigest()
        require(digest == expected and identity(before) == identity(os.fstat(f.fileno()))
                and identity(before) == identity(path.lstat()), 'archive changed or pin differs')
    require(set(stage) <= set(entries), 'archive/stage inventory differs')
    return before.st_size, entries


def build_plan(phase, role, release, stage, archive, archive_sha, source, source_sha, bridge):
    require(phase in ('initialize', 'deploy') and role in ROLES, 'fixed phase/role required')
    require(re.fullmatch('ynx-consensus-candidate-[0-9a-f]{12}', release), 'fixed release required')
    stage = original(stage)
    entries = inventory(stage)
    archive_bytes, extracted = archive_inventory(archive, archive_sha, entries)
    require(entries == inventory(stage), 'public stage changed during measurement')
    names = ('ynx-comet', 'ynx-consensus-package' if phase == 'initialize' else 'ynx-consensus-keycheck')
    if bridge:
        # Only missing remotely supplied binaries need SOURCE byte metadata.
        # Local binaries were already validated by the normal runtime caller;
        # count their ACTUAL archive bytes, not a second metadata estimate.
        source_path = original(source)
        before = source_path.lstat()
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                and 0 < before.st_size <= 128 << 10, 'original bounded SOURCE required')
        with source_path.open('rb') as f:
            raw = f.read((128 << 10) + 1)
            require(identity(before) == identity(os.fstat(f.fileno()))
                    and identity(before) == identity(source_path.lstat()), 'SOURCE changed during read')
        require(len(raw) <= 128 << 10 and re.fullmatch('[0-9a-f]{64}', source_sha)
                and hashlib.sha256(raw).hexdigest() == source_sha, 'independent original SOURCE pin differs')
        def unique(pairs):
            out = {}
            for k, v in pairs:
                require(k not in out, 'duplicate SOURCE field')
                out[k] = v
            return out
        source = json.loads(raw, object_pairs_hook=unique)
    for name in names:
        relative = name if phase == 'initialize' else 'bin/' + name
        if bridge:
            pin = source['binaries'][name]
            require(set(pin) == {'bytes', 'sha256'} and type(pin['bytes']) is int
                    and 1 << 20 < pin['bytes'] <= 128 << 20
                    and re.fullmatch('[0-9a-f]{64}', pin['sha256']), 'original binary byte bound differs')
            require(relative not in entries, 'bridge stage must not substitute a local binary')
            entries[relative] = ('file', pin['bytes'], None)
            extracted[relative] = entries[relative]
        else:
            require(relative in entries and entries[relative][0] == 'file'
                    and entries[relative][1] > 0, 'actual local runtime bytes absent')
    items = []
    def add(target, size, kind):
        items.append({'target': str(target), 'bytes': size, 'kind': kind})
    root = Path('/opt/ynx-chain') / ('consensus-initialization' if phase == 'initialize' else 'consensus-candidates') / release / role
    archive_name = release + ('-initialize-' if phase == 'initialize' else '-') + role + '.tar.gz'
    add('/tmp/' + archive_name, archive_bytes, 'file')
    # Count all retained upload and extracted originals, including directories.
    for name, (kind, size, _) in extracted.items():
        add(root if name == '.' else root / name, size, kind)
    for directory in (root.parent, root.parent.parent, root.parent.parent.parent):
        add(directory, 0, 'directory')
    if phase == 'deploy':
        installed = Path('/var/lib/ynx-chain/consensus-candidate')
        selected = {'bin/' + n: 'bin/' + n for n in names}
        selected.update({'role/role-manifest.json': 'role-manifest.json',
                         'role/scripts/start-operator.sh': 'scripts/start-operator.sh'})
        for name, value in entries.items():
            if name.startswith('role/config/'):
                require(value[0] == 'file' and len(PurePosixPath(name).parts) == 3,
                        'normal operator config must be flat regular files')
                selected[name] = name.removeprefix('role/')
        require(any(n.startswith('role/config/') for n in selected), 'operator config absent')
        for name, target in selected.items():
            require(name in entries and entries[name][0] == 'file', 'normal install input absent')
            add(installed / target, entries[name][1], 'file')
        for name in ('', 'bin', 'config', 'scripts'):
            add(installed / name, 0, 'directory')
        add(installed.parent, 0, 'directory')
        unit = 'role/systemd/ynx-consensus-operator-candidate.service'
        require(unit in entries and entries[unit][0] == 'file', 'normal operator unit absent')
        add('/etc/systemd/system/ynx-consensus-operator-candidate.service', entries[unit][1], 'file')
    if bridge:
        # stage-public has no inputs; its original operation_space(remote=True)
        # is 2 * 3 MiB output bound + 144 MiB retained operation allowance.
        # Actual binaries copied outside that journal are counted above.
        add('/var/tmp', 150 << 20, 'allowance')
    return {'version': 'YNX-CANDIDATE-STAGE-CAPACITY/v1', 'phase': phase, 'role': role,
            'release': release, 'archiveSHA256': archive_sha, 'marginBytes': MARGIN, 'items': items}


def existing_anchor(target):
    path = Path(target)
    require(path.is_absolute() and '..' not in path.parts, 'fixed absolute target required')
    anchor = Path('/')
    for component in path.parts[1:]:
        child = anchor / component
        try:
            s = child.lstat()
        except FileNotFoundError:
            break
        require(not stat.S_ISLNK(s.st_mode), 'target path link refused')
        require(stat.S_ISDIR(s.st_mode), 'target is already occupied; retain UNKNOWN')
        anchor = child
    fd = os.open(anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        require(identity(before) == identity(anchor.lstat()), 'target filesystem changed')
        v = os.fstatvfs(fd)
        require(v.f_frsize > 0 and v.f_bavail >= 0 and v.f_favail >= 0, 'filesystem capacity unavailable')
        return (before.st_dev, max(v.f_frsize, v.f_bsize), v.f_bavail * v.f_frsize, v.f_favail)
    finally:
        os.close(fd)


def measure(plan):
    groups = {}
    # Deliberately re-stat each target: existing mounted bin/config/unit paths
    # may belong to different filesystems, even below the same /var parent.
    for item in plan['items']:
        device, block, available, inodes = existing_anchor(item['target'])
        require(block > 0, 'filesystem allocation size unavailable')
        group = groups.setdefault(device, {'device': str(device), 'writeBytes': 0,
                                           'entries': 0, 'availableBytes': available, 'availableInodes': inodes})
        group['availableBytes'] = min(group['availableBytes'], available)
        group['availableInodes'] = min(group['availableInodes'], inodes)
        size = item['bytes']
        require(type(size) is int and size >= 0, 'invalid measured byte count')
        group['writeBytes'] += max(block, ((size + block - 1) // block) * block)
        group['entries'] += 1
    result = []
    for device in sorted(groups):
        group = groups[device]
        group['requiredBytes'] = group['writeBytes'] + plan['marginBytes']
        group['capacityAvailable'] = (group['availableBytes'] > group['requiredBytes']
                                      and group['availableInodes'] > group['entries'])
        result.append({k: v if type(v) is bool else str(v) for k, v in group.items()})
    return {'version': plan['version'], 'phase': plan['phase'], 'role': plan['role'],
            'archiveSHA256': plan['archiveSHA256'], 'filesystems': result,
            'capacityAvailable': all(g['capacityAvailable'] for g in result),
            'sampleOnly': True, 'futureGrowthReserved': False, 'sourceGrant': False}


def command(plan):
    body = 'import json,os,stat,sys\nfrom pathlib import Path\n'
    for function in (require, identity, existing_anchor, measure):
        body += inspect.getsource(function) + '\n'
    body += 'plan = json.loads(' + repr(json.dumps(plan, separators=(',', ':'))) + ')\n'
    body += "r=measure(plan)\nprint(json.dumps(r,separators=(',',':')),flush=True)\nsys.exit(0 if r['capacityAvailable'] else 73)\n"
    require(len(body.encode()) < 128 << 10, 'bounded remote capacity command exceeded')
    return 'sudo /usr/bin/python3 -c ' + shlex.quote(body)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('phase', choices=('initialize', 'deploy'))
    p.add_argument('role', choices=ROLES)
    for name in ('release', 'stage', 'archive', 'archive_sha', 'source', 'source_sha'):
        p.add_argument(name)
    p.add_argument('bridge', choices=('local', 'bridge'))
    a = p.parse_args()
    plan = build_plan(a.phase, a.role, a.release, a.stage, a.archive, a.archive_sha, a.source, a.source_sha, a.bridge == 'bridge')
    print(command(plan))


if __name__ == '__main__':
    main()
