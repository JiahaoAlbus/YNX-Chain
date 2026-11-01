"""Consume Core's original private two-slot live CLI; never a publisher.

Source qualification is deliberately absent until Core freezes the matching
normal source, module and tagged CI build. Contract controls are not live data.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

VERSION = 'YNX-OPERATOR-LIVE-WIRE/v1'
BUILD_TAG = 'ynx_live_wire_observation'
NORMAL_LIVE_SOURCE_QUALIFICATION = None
LIMIT = 128 << 10


def require(value, message):
    if not value:
        raise RuntimeError(message)


def qualify(identity):
    # No caller override, ancestor inference or migration of the 896 init grant.
    q = NORMAL_LIVE_SOURCE_QUALIFICATION
    require(q is not None, 'normal live source/module/tagged CI qualification not supplied')
    require(all(identity[k] == q[k] for k in ('commit', 'tree', 'forkTree')) and
            q['buildTag'] == BUILD_TAG and q['ciEvidenceSHA256'],
            'exact normal live source profile required')
    return dict(q)


def fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def private_read(directory, name, limit, expected_directory=None):
    require('/' not in name and name not in ('.', '..'), 'exact private slot name required')
    parent = os.open(directory, os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY)
    fd = None
    try:
        original = os.fstat(parent)
        require(stat.S_IMODE(original.st_mode) == 0o700 and original.st_uid == os.getuid() and
                (expected_directory is None or (original.st_dev, original.st_ino) == expected_directory),
                'original private control directory required')
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode) == 0o600 and
                before.st_uid == os.getuid() and before.st_nlink == 1 and before.st_size <= limit,
                'original single-link private file required')
        raw = bytearray()
        while len(raw) <= limit:
            part = os.read(fd, min(65536, limit + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
        require(len(raw) <= limit and len(raw) == before.st_size and
                fingerprint(before) == fingerprint(os.fstat(fd)) == fingerprint(os.stat(name, dir_fd=parent, follow_symlinks=False)),
                'original private slot changed during read')
        current = directory.lstat()
        require(directory.resolve() == directory and
                (current.st_dev, current.st_ino, current.st_mode, current.st_uid) ==
                (original.st_dev, original.st_ino, original.st_mode, original.st_uid),
                'original control directory changed during read')
        return bytes(raw)
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent)


class NormalLiveReader:
    def __init__(self, ceremony, lab):
        self.c, self.w, self.lab = ceremony, ceremony.w, lab
        self.slots = {}
        self.evidence = []
        spec = importlib.util.spec_from_file_location('normal_live_frozen_hook', Path(__file__).with_name('pq-network-window.py'))
        hook = importlib.util.module_from_spec(spec); spec.loader.exec_module(hook)
        self.layers = hook.frozen_module('network-layer-accounting.py')

    def startup_arguments(self, phase, index):
        if phase != 'pq':
            return []
        name = 'pq-node-%d' % index
        require(type(index) is int and 0 <= index < 4 and name not in self.slots,
                'one fresh original PQ control per node')
        directory = self.w.work / '.private' / ('network-live-' + name)
        directory.mkdir(mode=0o700)
        info = directory.lstat()
        require(directory.resolve() == directory and stat.S_IMODE(info.st_mode) == 0o700 and
                info.st_uid == os.getuid(), 'original private control directory required')
        self.slots[name] = dict(directory=directory, identity=(info.st_dev, info.st_ino),
                                next=0, retired=False, observed=False)
        return ['--wire-observation-live-control', str(directory)]

    def owned(self, node, slot):
        matches = [c for c in self.w.children if c['name'] == node['name']]
        require(len(matches) == 1, 'one original registered node required')
        child = matches[0]
        require(child['persistent'] and child['process'].pid == node['pid'] and
                str(child['startTicks']) == node['startTicks'] and child['process'].poll() is None,
                'original live Popen identity differs')
        current = self.lab.guard.parse_stat(self.lab.guard.bounded(
            Path('/proc') / str(node['pid']) / 'stat'), node['pid'])
        require(str(current['startTicks']) == node['startTicks'] and current['state'] != 'Z',
                'original kernel process identity differs')
        directory = slot['directory']
        info = directory.lstat()
        require(directory.resolve() == directory and stat.S_ISDIR(info.st_mode) and
                stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.getuid() and
                (info.st_dev, info.st_ino) == slot['identity'], 'original control directory changed')

    def retain(self, slot, phase, event):
        # Copy only this non-secret observation contract, never custody files.
        directory = self.w.work / 'public' / 'network-live-originals'
        directory.mkdir(mode=0o700, exist_ok=True)
        files = []
        self.evidence.append(event)
        for name, limit in [('producer.json', 4096), (phase + '.request', 128),
                            (phase + '.raw.json', LIMIT), (phase + '.result.json', 4096)]:
            try:
                info = slot['directory'].lstat()
                require(slot['directory'].resolve() == slot['directory'] and
                        (info.st_dev, info.st_ino) == slot['identity'] and
                        stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.getuid(),
                        'original control directory changed before retention')
                raw = private_read(slot['directory'], name, limit, slot['identity'])
                target = directory / (event['node'] + '-' + phase + '-' + name)
                with target.open('xb') as out:
                    os.chmod(target, 0o600)
                    out.write(raw)
                files.append(dict(path=str(target.relative_to(self.w.work / 'public')),
                                  bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()))
            except FileNotFoundError:
                continue
            except Exception as error:
                files.append(dict(slot=name, retentionErrorType=type(error).__name__))
        event['originalFiles'] = files
        if event['status'] == 'OBSERVED':
            require(len(files) == 4 and all('sha256' in row for row in files),
                    'observed read original-file retention incomplete')
        self.lab.write_new(self.w.work / 'public' / (event['node'] + '-live-' + phase + '-read.json'), event)

    def __call__(self, node):
        require(node['name'] in self.slots, 'original startup control missing')
        slot = self.slots[node['name']]
        require(not slot['retired'] and slot['next'] < 2, 'live read retired; UNKNOWN is never retried')
        phase = ('before', 'after')[slot['next']]
        require(phase == 'before' or slot['observed'], 'after requires original observed before')
        slot['next'] += 1  # Consume before any I/O or launch, including failure.
        event = dict(node=node['name'], pid=node['pid'], startTicks=node['startTicks'], phase=phase,
                     status='UNKNOWN', noRetry=True, readStartMonotonicNs=str(time.clock_gettime_ns(time.CLOCK_MONOTONIC)))
        proc = None
        try:
            self.owned(node, slot)
            producer = private_read(slot['directory'], 'producer.json', 4096, slot['identity'])
            expected = dict(pid=str(node['pid']), startTicks=node['startTicks'])
            require(json.loads(producer) == dict(version=VERSION, identity=expected),
                    'producer does not match independently owned Popen')
            name = node['name'] + '-live-' + phase
            proc = self.w.launch(name, [str(self.c.bins / 'ynx-comet'), 'request-wire-observation',
                                      '--control', str(slot['directory']), '--phase', phase], thread_safe=True)
            until = min(self.w.started + self.lab.CAPS['totalSeconds'] - self.lab.CAPS['cleanupSeconds'],
                        time.monotonic() + 4)
            while proc.poll() is None:
                self.w.sample()
                require(time.monotonic() < until, 'bounded original live reader deadline; UNKNOWN retained')
                time.sleep(.01)
            self.w.wait(proc)
            self.owned(node, slot)
            raw = private_read(slot['directory'], phase + '.raw.json', LIMIT, slot['identity'])
            receipt = json.loads(private_read(slot['directory'], phase + '.result.json', 4096, slot['identity']))
            require(receipt.get('version') == VERSION and receipt.get('phase') == phase and
                    receipt.get('status') == 'OBSERVED' and receipt.get('reason') == '' and
                    receipt.get('identity') == expected and receipt.get('syntheticOnly') is True and
                    receipt.get('authorityGranted') is False and
                    receipt.get('rawSHA256') == hashlib.sha256(raw).hexdigest(),
                    'original observed receipt/raw binding differs')
            require(private_read(slot['directory'], 'producer.json', 4096, slot['identity']) == producer,
                    'original producer changed during read')
            require(self.lab.guard.bounded(self.w.work / 'public' / (name + '.log'), LIMIT) == raw,
                    'normal CLI output differs from original raw bytes')
            parent_end = time.clock_gettime_ns(time.CLOCK_MONOTONIC)
            checked = self.layers.original_live_node_capture(node=node, raw=raw.decode('utf-8'),
                sha256=hashlib.sha256(raw).hexdigest(), start_monotonic_ns=int(event['readStartMonotonicNs']),
                end_monotonic_ns=parent_end)
            require(checked['liveStatus'] == 'OBSERVED', 'original live raw validation failed: ' + str(checked['liveReason']))
            value = json.loads(raw)
            def decimal_ns(v):
                require(type(v) is str and v.isascii() and v.isdecimal() and
                        str(int(v)) == v and 0 < int(v) < 1 << 64,
                        'original receipt clock must be canonical uint64 decimal string')
                return int(v)
            receipt_start = decimal_ns(receipt.get('startMonotonicNs'))
            receipt_end = decimal_ns(receipt.get('endMonotonicNs'))
            # Core records the getter's OUTER call bracket; raw contains its
            # INNER sample. Preserve both original clocks without equating them.
            require(int(event['readStartMonotonicNs']) <= receipt_start <= int(value['startMonotonicNs']) <=
                    int(value['endMonotonicNs']) <= receipt_end <= parent_end and
                    receipt_end - receipt_start <= 2_000_000_000,
                    'original receipt clock does not contain raw inside parent bounded read')
            slot['observed'] = True
            event.update(status='OBSERVED', rawSHA256=hashlib.sha256(raw).hexdigest())
            return raw
        except BaseException as error:
            slot['retired'] = True
            event['errorType'] = type(error).__name__
            event['errorReason'] = str(error)[:512]
            raise
        finally:
            active_error = sys.exc_info()[0]
            if proc is not None and proc.poll() is None:
                # Only our registered requester; original node and slots remain.
                try:
                    proc.send_signal(signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    proc.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    event['requesterCleanupComplete'] = False
                else:
                    event['requesterCleanupComplete'] = True
            event['readEndMonotonicNs'] = str(time.clock_gettime_ns(time.CLOCK_MONOTONIC))
            try:
                self.retain(slot, phase, event)
            except BaseException as error:
                slot['retired'] = True
                event.update(status='UNKNOWN', retentionErrorType=type(error).__name__)
                if active_error is None:
                    raise
