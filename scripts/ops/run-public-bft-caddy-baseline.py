#!/usr/bin/env python3
"""One externally confirmed, bounded Caddy baseline DATA preparation only.

No installation, reload, restart, protocol executable or daemon is supported.
Default validation never contacts Caddy or starts a child. The fixed original
process guard is measured before its low-level definitions are compiled; none
of its old migration commands, profile limits or high-level controller is used.
"""
import argparse
import ctypes
import hashlib
import http.client
import json
import os
from pathlib import Path
import platform
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

VERSION = 'YNX-CADDY-BASELINE-DATA-WINDOW/v1'
CASE = '/var/tmp/ynx-caddy-baseline-fd-observation-20261023T2040Z'
COMMIT = '5591ad6ff59f5e495be01712286b1acd846f0cea'
TREE = '04b8b951a7c0ff0793e911549fc41471e833aebd'
RUN_ID = '40014651538'
ATTEMPT = 'data-prepare-attempt'
DESTINATION = 'prepared-baseline'
CALLER = 'control/run-public-bft-caddy-baseline.py'
GUARD = 'control/verify-original-native-copy.py'
SOURCE = 'source/SOURCE.json'
BINDING = 'BASELINE_BINDING_RPC_EVM.json'
PRODUCER = 'source/scripts/ops/prepare-public-bft-caddy-json-source.py'
HELPER = 'source/scripts/ops/remote/public-bft-caddy-json.py'
INSTALLER = 'source/scripts/ops/install-public-bft-caddy-json-baseline.py'
GUARD_SHA256 = 'f6f9b1da0289707e8e30cac545d3f557819bc7bd75f5d413ae08eb7ce8e9d11d'
GUARD_BYTES = '48804'
PYTHON_RUNTIME = dict(path='/usr/bin/python3', resolvedPath='/usr/bin/python3.12', bytes='8020928',
                      sha256='1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118')
PINNED = {
    SOURCE: {'bytes': '766', 'sha256': '3caa9ff2c340f758316550d1455618b7992a0e046e803817e105f39fbb025811'},
    BINDING: {'bytes': '2013', 'sha256': 'f296b0ce244425ff083edfeb75e8182a66287bb35d384ce738b4219cdda80cff'},
    PRODUCER: {'bytes': '18192', 'sha256': 'b3291e712232650c977c57ec1fec199371ab0e9aac9070abd5bdad875be8652e'},
    HELPER: {'bytes': '25071', 'sha256': 'c5989af8f9f8bfa8ae71191ee32f239699741d09f317589833de15fea8091b4d'},
    INSTALLER: {'bytes': '19313', 'sha256': '1c38ec975a73961207ac87481fdae65b4633d5d3d7e00916bca2365c9f5b6b9e'},
    'source.zip': {'bytes': '20437', 'sha256': '8a9241049cf3c5d4de93e6902f9d1351f7606f3a5313c1ce6e591c68d07b6279'},
}
DIRECTORIES = ('.', 'control', 'source', 'source/scripts', 'source/scripts/ops', 'source/scripts/ops/remote')
INPUT_NAMES = (*PINNED, GUARD, CALLER)
LIMITS = dict(activeSeconds=120, cleanupSeconds=15, totalSeconds=135,
              rssBytes=512 << 20, caseDeltaBytes=64 << 20,
              freshMemoryBytes=1 << 30, diskFloorBytes=1 << 30,
              stdoutBytes=256 << 10, stderrBytes=256 << 10, journalBytes=256 << 10,
              sampleMs=200, processes=8, threads=64)
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C',
               'PYTHONNOUSERSITE': '1', 'PYTHONDONTWRITEBYTECODE': '1'}


class Refused(RuntimeError):
    """Fixed public first cause; never private configuration or input bodies."""


def require(ok, code):
    if not ok:
        raise Refused(code)


def closed(value, fields):
    require(type(value) is dict and set(value) == set(fields), 'closed_fields_required')


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate_json_field')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(Refused('nonfinite_json')))


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def pin(value):
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value) and value != '0' * 64,
            'independent_sha256_required')
    return value


def decimal(value, minimum=0):
    require(type(value) is str and re.fullmatch('0|[1-9][0-9]{0,19}', value)
            and minimum <= int(value) < 1 << 64, 'canonical_decimal_required')
    return int(value)


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def validate_contract(value):
    closed(value, ('version', 'classification', 'casePath', 'controllerSHA256', 'pythonRuntime',
                   'limits', 'environment', 'mustBeEmptyProcessGroups', 'preparedInputWitness'))
    require(value['version'] == VERSION and value['classification'] == 'data' and value['casePath'] == CASE,
            'wrong_fixed_data_profile')
    pin(value['controllerSHA256'])
    runtime = value['pythonRuntime']
    closed(runtime, ('path', 'resolvedPath', 'bytes', 'sha256'))
    require(runtime['path'] == '/usr/bin/python3' and type(runtime['resolvedPath']) is str
            and re.fullmatch('/usr/bin/python3\.[0-9]{1,2}', runtime['resolvedPath']), 'fixed_system_python_required')
    require(decimal(runtime['bytes'], 1) <= 64 << 20, 'bounded_system_python_required')
    pin(runtime['sha256'])
    require(runtime == PYTHON_RUNTIME, 'independently_observed_normal_python_required')
    closed(value['limits'], LIMITS)
    require(all(type(value['limits'][key]) is int and value['limits'][key] == number for key, number in LIMITS.items()),
            'fixed_data_limits_required')
    require(value['environment'] == ENVIRONMENT, 'empty_service_environment_required')
    groups = value['mustBeEmptyProcessGroups']
    require(type(groups) is list and len(groups) <= 8, 'bounded_empty_owner_groups_required')
    seen = set()
    for group in groups:
        closed(group, ('pgid', 'leaderStartTicks'))
        pid = decimal(group['pgid'], 2)
        require(pid <= 0x7fffffff and pid not in seen, 'unique_owner_group_required')
        decimal(group['leaderStartTicks'], 1)
        seen.add(pid)
    witnesses = value['preparedInputWitness']
    closed(witnesses, (*DIRECTORIES, *INPUT_NAMES))
    for name, row in witnesses.items():
        directory = name in DIRECTORIES
        fields = ('uid', 'gid', 'mode', 'device', 'inode')
        closed(row, fields if directory else (*fields, 'bytes', 'nlink', 'mtimeNs', 'ctimeNs'))
        require(row['uid'] == '0' and row['gid'] == '0' and row['mode'] == ('700' if directory else '600'),
                'prepared_root_private_inputs_required')
        decimal(row['device']); decimal(row['inode'], 1)
        if not directory:
            require(row['nlink'] == '1', 'single_link_input_required')
            decimal(row['bytes'], 1); decimal(row['mtimeNs'], 1); decimal(row['ctimeNs'], 1)
            if name in PINNED:
                require(row['bytes'] == PINNED[name]['bytes'], 'fixed_source_input_size_required')
            if name == GUARD:
                require(row['bytes'] == GUARD_BYTES, 'fixed_guard_source_size_required')
    return value


def directory_witness(path):
    require(path.is_absolute() and str(path.resolve(strict=True)) == str(path), 'canonical_directory_required')
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
            and info.st_uid == 0 and info.st_gid == 0, 'root_0700_directory_required')
    return dict(uid=str(info.st_uid), gid=str(info.st_gid), mode='700', device=str(info.st_dev), inode=str(info.st_ino))


def read_private(path, expected=None, maximum=1 << 20, progress=lambda: None, runtime=False, owner=0):
    require(path.is_absolute() and str(path.resolve(strict=True)) == str(path), 'canonical_regular_input_required')
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == owner
            and info.st_gid == (0 if owner == 0 else os.getegid()) and stat.S_IMODE(info.st_mode) == (0o755 if runtime else 0o600)
            and 0 < info.st_size <= maximum, 'root_bounded_regular_input_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    chunks, count, sha = [], 0, hashlib.sha256()
    with os.fdopen(fd, 'rb') as stream:
        require(identity(os.fstat(stream.fileno())) == identity(info), 'input_open_identity_changed')
        while True:
            raw = stream.read(65536)
            if not raw:
                break
            count += len(raw)
            require(count <= maximum and count <= info.st_size, 'input_size_changed')
            chunks.append(raw); sha.update(raw); progress()
        require(identity(os.fstat(stream.fileno())) == identity(info) and identity(path.lstat()) == identity(info)
                and count == info.st_size, 'input_changed_during_read')
    measured = {'bytes': str(count), 'sha256': sha.hexdigest()}
    require(expected is None or measured == expected, 'independent_input_pin_mismatch')
    return b''.join(chunks), dict(pin=measured, identity=identity(info))


def file_witness(info):
    return dict(uid=str(info.st_uid), gid=str(info.st_gid), mode=format(stat.S_IMODE(info.st_mode), 'o'),
                device=str(info.st_dev), inode=str(info.st_ino), bytes=str(info.st_size), nlink=str(info.st_nlink),
                mtimeNs=str(info.st_mtime_ns), ctimeNs=str(info.st_ctime_ns))


def check_witness(contract):
    case = Path(CASE)
    for name in DIRECTORIES:
        require(directory_witness(case if name == '.' else case / name) == contract['preparedInputWitness'][name],
                'prepared_directory_identity_changed')
    for name in INPUT_NAMES:
        require(file_witness((case / name).lstat()) == contract['preparedInputWitness'][name],
                'prepared_file_identity_changed')
    # The normal Python producer puts its script directory on sys.path. No
    # undeclared module may shadow its standard-library imports or the helper.
    for base, expected_files, expected_dirs in [
            (case/'source', {SOURCE.removeprefix('source/'), *(name.removeprefix('source/') for name in (PRODUCER,HELPER,INSTALLER))},
             {'scripts','scripts/ops','scripts/ops/remote'}),
            (case/'control', {Path(GUARD).name,Path(CALLER).name}, set())]:
        files, directories = set(), set()
        for directory, names, entries in os.walk(base, followlinks=False):
            for name in names + entries:
                path=Path(directory)/name; info=path.lstat(); relative=str(path.relative_to(base))
                require(not stat.S_ISLNK(info.st_mode), 'staged_source_symlink_refused')
                if stat.S_ISDIR(info.st_mode): directories.add(relative)
                elif stat.S_ISREG(info.st_mode): files.add(relative)
                else: raise Refused('staged_source_special_file_refused')
        require(files == expected_files and directories == expected_dirs, 'closed_staged_python_sources_required')


def captured_module(raw, path, name):
    module = {'__name__': name, '__file__': str(path)}
    exec(compile(raw, str(path), 'exec'), module)
    return module


def load_process_guard(path):
    raw, measured = read_private(path, {'bytes':GUARD_BYTES,'sha256':GUARD_SHA256}, maximum=1 << 20)
    require(measured['pin']['sha256'] == GUARD_SHA256, 'original_process_guard_source_pin_mismatch')
    module = captured_module(raw, path, 'ynx_captured_original_proc_guard')
    require(all(callable(module.get(name)) for name in ('LinuxProc', 'Owned', 'cleanup_once', 'directory_bytes')),
            'original_process_guard_lowlevel_missing')
    return module, measured


def validate_source_index(value):
    closed(value, ('version', 'commit', 'tree', 'runId', 'runAttempt', 'producerJob', 'files',
                   'publicSourceOnly', 'deployed', 'servicesChanged', 'rootGrant'))
    require(value['version'] == 'YNX-CADDY-BASELINE-PUBLIC-SOURCE/v1' and value['commit'] == COMMIT
            and value['tree'] == TREE and value['runId'] == RUN_ID and value['runAttempt'] == '1'
            and value['producerJob'] == 'caddy-source' and value['publicSourceOnly'] is True
            and value['deployed'] is False and value['servicesChanged'] is False and value['rootGrant'] is False,
            'actual_fixed_ci_source_index_required')
    expected = [dict(path=name.removeprefix('source/'), bytes=int(PINNED[name]['bytes']), sha256=PINNED[name]['sha256'])
                for name in (PRODUCER, HELPER, INSTALLER)]
    require(type(value['files']) is list and value['files'] == expected, 'exact_three_normal_source_files_required')


def load_inputs(contract, progress):
    check_witness(contract)
    records, raw = {}, {}
    for name, expected in PINNED.items():
        raw[name], records[name] = read_private(Path(CASE) / name, expected, progress=progress)
    validate_source_index(decode(raw[SOURCE]))
    helper = captured_module(raw[HELPER], Path(CASE) / HELPER, 'ynx_caddy_data_captured_helper')
    producer = captured_module(raw[PRODUCER], Path(CASE) / PRODUCER, 'ynx_caddy_data_captured_producer')
    binding = helper['parse_json'](raw[BINDING])
    require(producer['validate_binding'](binding) is False, 'baseline_only_binding_required')
    require(binding['version'] == 'YNX-CADDY-JSON-BASELINE/v1', 'no_cutover_authority_in_data_window')
    # Pure projection validates all three approved hosts without changing any
    # raw retained input. The normal producer remains the only output writer.
    original, _, _ = producer['read_original_source'](binding['source'])
    helper['project_rpc_config'](helper['parse_config'](original), binding['rpcUpstreams'])
    check_witness(contract)
    return records, helper, producer, binding


def normal_command():
    return ['/usr/bin/python3', '-B', str(Path(CASE) / PRODUCER), '--binding', str(Path(CASE) / BINDING),
            '--binding-sha256', PINNED[BINDING]['sha256'], '--json-helper-sha256', PINNED[HELPER]['sha256'],
            '--output-dir', str(Path(CASE) / DESTINATION)]


def live_snapshot(producer, helper, binding, progress=lambda: None):
    progress()
    first, first_identity, first_parent = producer['read_original_source'](binding['source'])
    second, second_identity, second_parent = producer['read_original_source'](binding['secondRead'])
    require(first == second, 'two_original_config_reads_differ')
    unit = producer['read_original_unit'](binding['originalUnit'])
    uid, gid = int(binding['source']['witness']['uid']), int(binding['source']['witness']['gid'])
    producer['observe_process'](binding['originalProcess'], uid, gid)
    cgroup = producer['proc_bytes'](Path('/proc') / binding['originalProcess']['pid'] / 'cgroup', 65536)
    require(any(line.split(b':', 2)[-1] == b'/system.slice/caddy.service' for line in cgroup.splitlines()),
            'original_caddy_service_membership_changed')
    connection = http.client.HTTPConnection('127.0.0.1', 2019, timeout=5)
    try:
        connection.request('GET', '/config/', headers={'Connection': 'close'})
        response = connection.getresponse()
        require(response.status == 200 and response.getheader('Content-Encoding', 'identity') == 'identity',
                'original_caddy_admin_get_failed')
        loaded = response.read((16 << 20) + 1)
    finally:
        connection.close()
    require(0 < len(loaded) <= 16 << 20, 'original_loaded_config_bound')
    original = helper['parse_config'](first)
    live = helper['parse_config'](loaded)
    require(hashlib.sha256(loaded).hexdigest() == binding['source']['sha256']
            and helper['semantic_hash'](live) == helper['semantic_hash'](original), 'original_loaded_whole_config_changed')
    helper['project_rpc_config'](live, binding['rpcUpstreams'])  # exact three live original 6420 dials
    producer['observe_process'](binding['originalProcess'], uid, gid)
    require(producer['read_original_unit'](binding['originalUnit']) == unit
            and producer['read_original_source'](binding['source'])[1:] == (first_identity, first_parent)
            and producer['read_original_source'](binding['secondRead'])[1:] == (second_identity, second_parent),
            'original_caddy_inputs_changed_during_observation')
    progress()
    return dict(pid=binding['originalProcess']['pid'], startTicks=binding['originalProcess']['startTicks'],
                sourceSHA256=binding['source']['sha256'], loadedSHA256=hashlib.sha256(loaded).hexdigest(),
                semanticSHA256=helper['semantic_hash'](live), originalUnitSHA256=binding['originalUnit']['sha256'],
                firstIdentity=list(first_identity), secondIdentity=list(second_identity),
                firstParent=list(first_parent), secondParent=list(second_parent), unitIdentity=list(unit),
                threeLiveNativeUpstreams=True)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def exclusive(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(raw); out.flush(); os.fsync(out.fileno())
    sync_directory(path.parent)


def public_error(error):
    code = str(error)
    return code if isinstance(error, RuntimeError) and re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,127}', code) else type(error).__name__


class Controller:
    def __init__(self, contract, low, started=None):
        self.contract, self.low = contract, low
        self.started = time.monotonic() if started is None else started
        self.output = Path(CASE) / ATTEMPT
        self.proc = low['LinuxProc']()
        rows = self.proc.inventory()
        self.owned = low['Owned'](os.getpid(), rows)
        self.initial_bytes = low['directory_bytes'](Path(CASE))
        self.children, self.codes = [], []
        self.next_sample, self.samples, self.peak_rss, self.max_delta = 0.0, 0, 0, 0
        self.events, self.journal_bytes, self.first_cause = None, 0, None
        self.task_sample_failure, self.task_sample_journal_error = None, None
        self.log_bytes = {'stdout': 0, 'stderr': 0}

    def event(self, kind, detail):
        if self.events is not None:
            raw = encode(dict(event=kind, detail=detail))
            require(self.journal_bytes + len(raw) <= LIMITS['journalBytes'], 'journal_size_limit')
            self.events.write(raw); self.events.flush(); os.fsync(self.events.fileno())
            self.journal_bytes += len(raw)

    def capacity(self, fresh=False):
        now = time.monotonic()
        if not fresh and now < self.next_sample:
            return
        require(now - self.started <= LIMITS['activeSeconds'], 'active_time_limit')
        rows = self.proc.inventory()
        tasks = self.owned.update(rows)
        tasks[self.owned.controller] = rows[self.owned.controller]
        sampled = {}
        deadline = min(now + LIMITS['sampleMs'] / 1000, self.started + LIMITS['activeSeconds'])
        for pid, row in tasks.items():
            try:
                task = self.proc.sample_task(row, check_sockets=pid != self.owned.controller, observation_deadline=deadline)
            except Exception as original:
                detail = getattr(self.proc,'last_task_observation',None)
                if (type(detail) is dict and detail.get('pid') == pid and detail.get('expectedStartTicks') == row['startTicks']
                        and detail.get('resolution') == 'refused'):
                    self.task_sample_failure = detail
                    try: self.event('task_sample_refused',detail)
                    except Exception as secondary:
                        self.task_sample_journal_error = dict(errorClass=type(secondary).__name__,errno=getattr(secondary,'errno',None))
                raise original
            detail = getattr(self.proc,'last_task_observation',None)
            if type(detail) is dict and detail.get('pid') == pid and detail.get('expectedStartTicks') == row['startTicks']:
                self.event('task_sample_observed',detail)
            if task is not None:
                sampled[pid] = task
        blocked = {int(row['pgid']): int(row['leaderStartTicks']) for row in self.contract['mustBeEmptyProcessGroups']}
        require(not any(row['group'] in blocked or blocked.get(pid) == row['startTicks'] for pid, row in rows.items()),
                'original_owner_group_not_empty')
        available = self.proc.available_memory()
        disk = os.statvfs(CASE); free = disk.f_bavail * disk.f_frsize
        delta = max(0, self.low['directory_bytes'](Path(CASE)) - self.initial_bytes)
        rss = sum(row['rssBytes'] for row in sampled.values())
        require(available > 0 and (not fresh or available >= LIMITS['freshMemoryBytes']), 'fresh_memory_floor')
        require(free >= LIMITS['diskFloorBytes'], 'disk_floor')
        require(delta <= LIMITS['caseDeltaBytes'], 'case_delta_limit')
        require(rss <= LIMITS['rssBytes'], 'owned_rss_limit')
        require(len(sampled) <= LIMITS['processes'] and sum(row['threads'] for row in sampled.values()) <= LIMITS['threads'],
                'owned_task_limit')
        require(time.monotonic() - self.started <= LIMITS['activeSeconds'], 'active_time_limit')
        self.samples += 1; self.peak_rss = max(self.peak_rss, rss); self.max_delta = max(self.max_delta, delta)
        self.event('sample', dict(elapsedMs=int((time.monotonic()-self.started)*1000), ownedRSSBytes=rss,
                                 caseDeltaBytes=delta, freeDiskBytes=free, availableMemoryBytes=available,
                                 tasks=[{key: row[key] for key in ('pid','parent','group','session','startTicks','rssBytes','threads','state')}
                                        for row in sampled.values()]))
        self.next_sample = now + LIMITS['sampleMs'] / 1000

    def command(self, runtime_record):
        self.capacity(fresh=True)
        runtime_path = Path(self.contract['pythonRuntime']['resolvedPath'])
        _, measured = read_private(runtime_path, runtime_record['pin'], maximum=64 << 20,
                                   progress=self.capacity, runtime=True)
        require(measured == runtime_record and str(Path('/usr/bin/python3').resolve(strict=True)) == str(runtime_path),
                'normal_python_runtime_changed')
        executable = os.open(runtime_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        selector, logs, child = selectors.DefaultSelector(), {}, None
        try:
            require(identity(os.fstat(executable)) == runtime_record['identity'], 'normal_runtime_fd_changed')
            for name in ('stdout', 'stderr'):
                fd = os.open(self.output / ('prepare.'+name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                logs[name] = os.fdopen(fd, 'wb', buffering=0)
            self.capacity(fresh=True)
            check_witness(self.contract)
            child = subprocess.Popen(normal_command(), executable='/proc/self/fd/'+str(executable), pass_fds=(executable,),
                cwd=str(Path(CASE)), env=dict(ENVIRONMENT), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, start_new_session=True, close_fds=True)
            self.children.append(child)
            self.next_sample = 0; self.capacity()
            require(child.pid in self.owned.known, 'normal_child_birth_identity_missing')
            self.event('child_started', dict(pid=child.pid, startTicks=self.owned.known[child.pid]))
            for name, stream in (('stdout', child.stdout), ('stderr', child.stderr)):
                os.set_blocking(stream.fileno(), False); selector.register(stream, selectors.EVENT_READ, name)
            while True:
                self.capacity()
                for key, _ in selector.select(0.05):
                    raw = os.read(key.fileobj.fileno(), 65536)
                    if not raw:
                        selector.unregister(key.fileobj)
                    else:
                        self.log_bytes[key.data] += len(raw)
                        require(self.log_bytes[key.data] <= LIMITS[key.data+'Bytes'], 'prepare_'+key.data+'_limit')
                        logs[key.data].write(raw)
                if child.poll() is not None and not selector.get_map():
                    break
            self.codes.append(child.returncode)
            self.event('child_exited', dict(code=child.returncode))
            require(child.returncode == 0, 'normal_prepare_failed')
            self.next_sample = 0; self.capacity()
            require(not self.owned.update(self.proc.inventory()), 'normal_prepare_left_descendants')
            for out in logs.values():
                out.flush(); os.fsync(out.fileno())
        finally:
            selector.close()
            if child is not None:
                for stream in (child.stdout, child.stderr):
                    if stream is not None: stream.close()
            for out in logs.values(): out.close()
            os.close(executable)

    def cleanup(self):
        began = time.monotonic()
        deadline = min(began+LIMITS['cleanupSeconds'], self.started+LIMITS['totalSeconds'])
        empty, error = 0, None
        while time.monotonic() < deadline:
            try:
                def send(pid):
                    fd = os.pidfd_open(pid, 0)
                    try:
                        row = self.proc.one_or_gone(pid)
                        if row is None: return
                        require(row['startTicks'] == self.owned.known[pid], 'cleanup_pidfd_identity_changed')
                        signal.pidfd_send_signal(fd, signal.SIGKILL if time.monotonic()-began >= 2 else signal.SIGTERM)
                    finally:
                        os.close(fd)
                if self.low['cleanup_once'](self.proc, self.owned, self.children, send, os.waitpid):
                    empty += 1
                    if empty == 2: return error is None, error
                else:
                    empty = 0
            except ProcessLookupError:
                empty = 0
            except Exception as failure:
                error = error or public_error(failure); empty = 0
            time.sleep(0.1)
        return False, error or 'owned_cleanup_incomplete'


def qualify_output(helper, binding):
    destination = Path(CASE) / DESTINATION
    directory_witness(destination)
    expected = {'intent.json', 'original.json', 'candidate.json', 'ynx-chain-json.conf', 'BASELINE_DATA.json', 'receipt.json'}
    require({path.name for path in destination.iterdir()} == expected, 'closed_baseline_data_output_required')
    records, blobs = {}, {}
    for name in sorted(expected):
        blobs[name], records[name] = read_private(destination / name, maximum=16 << 20)
    baseline = helper['parse_json'](blobs['BASELINE_DATA.json'])
    require(set(baseline) == set(binding) | {'baseline'} and all(baseline[key] == val for key,val in binding.items()),
            'prepared_baseline_identity_differs')
    require(hashlib.sha256(blobs['original.json']).hexdigest() == binding['source']['sha256'], 'prepared_original_bytes_differ')
    projected = helper['canonical_config'](helper['project_rpc_config'](helper['parse_config'](blobs['original.json']), binding['rpcUpstreams']))
    require(blobs['candidate.json'] == projected and blobs['ynx-chain-json.conf'] == helper['render_dropin'](),
            'prepared_projection_or_dropin_differs')
    receipt = helper['parse_json'](blobs['receipt.json'])
    for field in ('publicDeployment','rootGrant','restartRecovery','rollbackVerified','installed','serviceCommandsPerformed','automaticRetry','fullCutoverManifestProduced'):
        require(receipt.get(field) is False, 'prepared_receipt_not_data_only')
    require(receipt.get('baselineDataSHA256') == records['BASELINE_DATA.json']['pin']['sha256']
            and receipt.get('manifestSHA256') is None and receipt.get('bindingSHA256') == PINNED[BINDING]['sha256']
            and receipt.get('jsonHelperSHA256') == PINNED[HELPER]['sha256'], 'prepared_receipt_source_pin_differs')
    return {name: record['pin'] for name, record in records.items()}


def run(contract, contract_pin, external_witnesses):
    require(sys.platform == 'linux' and platform.machine() == 'x86_64' and os.geteuid() == 0, 'root_linux_amd64_required')
    require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'identity_safe_cleanup_required')
    began = time.monotonic()
    directory_witness(Path(CASE))
    for name in (ATTEMPT, DESTINATION):
        require(not any(os.path.lexists(Path(CASE)/(name+suffix)) for suffix in ('','.partial','.UNKNOWN','.tmp')),
                'original_attempt_or_partial_retained')
    check_witness(contract)
    low, guard_record = load_process_guard(Path(CASE) / GUARD)
    controller = Controller(contract, low, began)
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    previous, confirmed = ctypes.c_int(), ctypes.c_int()
    require(libc.prctl(37, ctypes.cast(ctypes.pointer(previous), ctypes.c_void_p).value, 0, 0, 0) == 0
            and libc.prctl(36, 1, 0, 0, 0) == 0 and libc.prctl(37, ctypes.cast(ctypes.pointer(confirmed), ctypes.c_void_p).value, 0, 0, 0) == 0
            and confirmed.value == 1, 'owned_child_subreaper_required')
    controller.output.mkdir(mode=0o700); sync_directory(Path(CASE))
    exclusive(controller.output/'intent.json', encode(dict(version=VERSION, contractSHA256=contract_pin, status='unknown',
              automaticRetry=False, limits=LIMITS, rootGrant=False, installed=False, serviceCommandsPerformed=False)))
    fd = os.open(controller.output/'journal.jsonl', os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
    controller.events = os.fdopen(fd, 'wb')
    old_handlers, timer, cleanup_ok, cleanup_error = {}, False, False, None
    before = after = outputs = None
    try:
        require(signal.getitimer(signal.ITIMER_REAL) == (0.0,0.0), 'fresh_controller_timer_required')
        def interrupted(_sig, _frame): raise Refused('external_interruption')
        def timeout(_sig, _frame): raise Refused('active_time_limit')
        for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGALRM): old_handlers[sig] = signal.signal(sig,interrupted)
        signal.signal(signal.SIGALRM,timeout)
        signal.setitimer(signal.ITIMER_REAL,max(0.001,began+LIMITS['activeSeconds']-time.monotonic())); timer=True
        controller.capacity(fresh=True)
        records, helper, producer, binding = load_inputs(contract, controller.capacity)
        runtime = contract['pythonRuntime']
        require(str(Path('/usr/bin/python3').resolve(strict=True)) == runtime['resolvedPath'], 'normal_python_alias_changed')
        _, runtime_record = read_private(Path(runtime['resolvedPath']), {'bytes':runtime['bytes'],'sha256':runtime['sha256']},
                                         maximum=64 << 20, progress=controller.capacity, runtime=True)
        before = live_snapshot(producer,helper,binding,controller.capacity)
        controller.event('original_caddy_before',before)
        controller.command(runtime_record)
        outputs = qualify_output(helper,binding)
        _, runtime_after = read_private(Path(runtime['resolvedPath']),runtime_record['pin'],maximum=64 << 20,
                                        progress=controller.capacity,runtime=True)
        require(runtime_after == runtime_record and str(Path('/usr/bin/python3').resolve(strict=True)) == runtime['resolvedPath'],
                'normal_python_runtime_changed_after_prepare')
        after = live_snapshot(producer,helper,binding,controller.capacity)
        require(before == after, 'original_service_or_loaded_config_changed')
        controller.event('original_caddy_after',after)
        for name, original in records.items():
            _, current = read_private(Path(CASE)/name, original['pin'], progress=controller.capacity)
            require(current == original, 'original_staged_source_changed')
        _, current_guard = read_private(Path(CASE)/GUARD, guard_record['pin'], progress=controller.capacity)
        require(current_guard == guard_record, 'original_proc_guard_changed')
        for path, original in external_witnesses:
            _, current = read_private(path, original['pin'], progress=controller.capacity)
            require(current == original, 'contract_or_controller_changed')
        check_witness(contract)
        controller.next_sample=0; controller.capacity()
    except Exception as error:
        controller.first_cause = public_error(error)
    finally:
        if timer: signal.setitimer(signal.ITIMER_REAL,0)
        for sig in old_handlers: signal.signal(sig,signal.SIG_IGN)
        if timer:
            def cleanup_timeout(_sig,_frame): raise Refused('cleanup_time_limit')
            signal.signal(signal.SIGALRM,cleanup_timeout)
            signal.setitimer(signal.ITIMER_REAL,max(0.001,min(LIMITS['cleanupSeconds'],began+LIMITS['totalSeconds']-time.monotonic())))
        try:
            cleanup_ok,cleanup_error=controller.cleanup()
        except Exception as error:
            cleanup_ok,cleanup_error=False,public_error(error)
        if timer: signal.setitimer(signal.ITIMER_REAL,0)
        for sig, handler in old_handlers.items(): signal.signal(sig,handler)
        if libc.prctl(36,previous.value,0,0,0) != 0:
            cleanup_ok,cleanup_error=False,cleanup_error or 'subreaper_restore_failed'
        try: controller.events.close()
        except OSError: cleanup_ok,cleanup_error=False,cleanup_error or 'journal_persistence_failed'
    if not cleanup_ok: controller.first_cause=controller.first_cause or cleanup_error
    if time.monotonic()-began > LIMITS['totalSeconds']: controller.first_cause=controller.first_cause or 'total_time_limit'
    if controller.first_cause:
        try: exclusive(controller.output/'first-cause.json',encode(dict(code=controller.first_cause,
                       taskSample=controller.task_sample_failure,taskSampleJournalError=controller.task_sample_journal_error)))
        except Exception: pass
    success=controller.first_cause is None and cleanup_ok and controller.codes==[0] and before==after and outputs is not None
    receipt=dict(version=VERSION,classification='data',contractSHA256=contract_pin,executionStarted=True,dataPrepared=success,
        normalExitCodes=controller.codes,firstCause=controller.first_cause,cleanupComplete=cleanup_ok,cleanupError=cleanup_error,
        elapsedMs=int((time.monotonic()-began)*1000),sampleCount=controller.samples,peakOwnedRSSBytes=controller.peak_rss,
        maxCaseDeltaBytes=controller.max_delta,stdoutBytes=controller.log_bytes['stdout'],stderrBytes=controller.log_bytes['stderr'],
        originalInputsUnchanged=success,originalCaddyUnchanged=success,outputs=outputs if success else None,
        guardMode='sampled-proc-smaps-rollup-200ms',cgroupHardWall=False,rootGrant=False,installed=False,
        serviceCommandsPerformed=False,publicDeployment=False,pqActivation=False,authoritativeFinalCheckpoint=False,automaticRetry=False)
    exclusive(controller.output/'result.json',encode(receipt))
    return receipt


def main(argv=None):
    argv=sys.argv[1:] if argv is None else argv
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--contract',required=True); parser.add_argument('--contract-sha256',required=True)
    parser.add_argument('--execute',action='store_true'); parser.add_argument('--confirmed-contract-sha256')
    args=parser.parse_args(argv)
    try:
        for name in ('contract','contract-sha256','execute','confirmed-contract-sha256'):
            require(sum(item.split('=',1)[0]=='--'+name for item in argv)<=1,'duplicate_cli_option')
        pin(args.contract_sha256)
        raw,contract_record=read_private(Path(args.contract),maximum=65536,owner=os.geteuid())
        require(contract_record['pin']['sha256']==args.contract_sha256,'external_contract_pin_mismatch')
        contract=validate_contract(decode(raw))
        require(args.execute or args.confirmed_contract_sha256 is None,'confirmation_without_execution')
        if not args.execute:
            print(encode(dict(version=VERSION,classification='data',contractValidated=True,executionStarted=False,
                              rootGrant=False,installed=False,serviceCommandsPerformed=False)).decode(),end='')
            return 0
        require(args.confirmed_contract_sha256==args.contract_sha256,'later_exact_confirmation_required')
        caller=Path(__file__).resolve(strict=True)
        require(caller==Path(CASE)/CALLER,'fixed_normal_caller_path_required')
        _,caller_record=read_private(caller,maximum=1 << 20)
        require(caller_record['pin']['sha256']==contract['controllerSHA256'],'external_controller_source_pin_mismatch')
        result=run(contract,args.contract_sha256,[(Path(args.contract),contract_record),(caller,caller_record)])
        print(encode(result).decode(),end='')
        return 0 if result['dataPrepared'] else 1
    except Exception as error:
        print('YNX_CADDY_BASELINE_DATA_REFUSED '+public_error(error),file=sys.stderr)
        return 1


if __name__=='__main__':
    sys.exit(main())
