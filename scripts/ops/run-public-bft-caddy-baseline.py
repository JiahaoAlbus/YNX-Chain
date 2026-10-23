#!/usr/bin/env python3
"""Two separately confirmed, fixed Caddy baseline preparation/install profiles.

DATA cannot install. INSTALL only persists the original JSON startup source;
neither profile can reload/restart Caddy, reroute traffic or run protocol code.
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
import socket
import stat
import struct
import subprocess
import sys
import time

VERSION = 'YNX-CADDY-BASELINE-DATA-WINDOW/v1'
CASE = '/var/tmp/ynx-caddy-baseline-fd-observation-20261023T2040Z'
INSTALL_VERSION = 'YNX-CADDY-BASELINE-INSTALL-WINDOW/v1'
INSTALL_CASE = '/var/tmp/ynx-caddy-persistent-source-20261023T2100Z'
INSTALL_ATTEMPT = 'persistent-source-install-attempt'
INSTALL_DESTINATION = 'persistent-startup-install'
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
GUARD_SHA256 = '3474ec7304ac1a43270d49fb106450a3698e1130764b3bd3b885ad6b1aabc610'
GUARD_BYTES = '49677'
PYTHON_RUNTIME = dict(path='/usr/bin/python3', resolvedPath='/usr/bin/python3.12', bytes='8020928',
                      sha256='1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118')
SYSTEM_BINARIES = {
    'curl': dict(path='/usr/bin/curl', bytes='297288', sha256='ea43dc3e72aadac2d8820181a79af1ce94f0f713f7aef81f5ef0ed5881d1f5eb'),
    'systemctl': dict(path='/usr/bin/systemctl', bytes='1501304', sha256='d03995d5d2ce6a5dd1822854f80c40cdf3d92c7a008179d89e80e5ffcd1a9aa2'),
    'caddy': dict(path='/usr/bin/caddy', bytes='38845944', sha256='9681d054b6e5137d53f6d027188b349e0603fd12ea6334bd0d49da6755432f1b'),
}
CONFIG = '/etc/caddy/ynx-chain.json'
DROPIN = '/etc/systemd/system/caddy.service.d/ynx-chain-json.conf'
SHOW = ['/usr/bin/systemctl','show','caddy.service','--no-pager',
        '--property=ActiveState,SubState,MainPID,FragmentPath,DropInPaths,User,Group,ExecStart,ExecReload']
GET = ['/usr/bin/curl','--disable','--request','GET','--noproxy','*','--max-redirs','0',
       '--connect-timeout','5','--max-time','10','--max-filesize','16777216','--fail','--silent',
       '--show-error','--url','http://127.0.0.1:2019/config/']
VALIDATE = ['/usr/bin/caddy','validate','--config',CONFIG]
DAEMON_RELOAD = ['/usr/bin/systemctl','daemon-reload']
IPC_PEERS = ('/run/systemd/private', '/run/dbus/system_bus_socket')
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


def installing(contract):
    return contract.get('version') == INSTALL_VERSION


def case_path(contract):
    return Path(contract.get('casePath', CASE))


def output_names(contract):
    return (INSTALL_ATTEMPT, INSTALL_DESTINATION) if installing(contract) else (ATTEMPT, DESTINATION)


def validate_contract(value):
    require(type(value) is dict, 'closed_fields_required')
    install = installing(value)
    fields = ('version', 'classification', 'casePath', 'controllerSHA256', 'pythonRuntime',
              'limits', 'environment', 'mustBeEmptyProcessGroups', 'preparedInputWitness')
    closed(value, (*fields, 'systemBinaries') if install else fields)
    require(value['version'] == (INSTALL_VERSION if install else VERSION)
            and value['classification'] == ('install' if install else 'data')
            and value['casePath'] == (INSTALL_CASE if install else CASE),
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
    if install:
        closed(value['systemBinaries'], SYSTEM_BINARIES)
        for name, expected in SYSTEM_BINARIES.items():
            row = value['systemBinaries'][name]
            closed(row, ('path', 'bytes', 'sha256', 'witness'))
            require({key:row[key] for key in expected} == expected, 'fixed_install_system_binary_required')
            witness = row['witness']
            closed(witness, ('uid','gid','mode','device','inode','bytes','nlink','mtimeNs','ctimeNs'))
            require(witness['uid'] == witness['gid'] == '0' and witness['mode'] == '755'
                    and witness['nlink'] == '1' and witness['bytes'] == expected['bytes'], 'install_runtime_witness_required')
            for field in ('device','inode','mtimeNs','ctimeNs'): decimal(witness[field],1)
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
    case = case_path(contract)
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
        raw[name], records[name] = read_private(case_path(contract) / name, expected, progress=progress)
    validate_source_index(decode(raw[SOURCE]))
    helper = captured_module(raw[HELPER], case_path(contract) / HELPER, 'ynx_caddy_data_captured_helper')
    producer = captured_module(raw[PRODUCER], case_path(contract) / PRODUCER, 'ynx_caddy_data_captured_producer')
    binding = helper['parse_json'](raw[BINDING])
    require(producer['validate_binding'](binding) is False, 'baseline_only_binding_required')
    require(binding['version'] == 'YNX-CADDY-JSON-BASELINE/v1', 'no_cutover_authority_in_data_window')
    # Pure projection validates all three approved hosts without changing any
    # raw retained input. The normal producer remains the only output writer.
    original, _, _ = producer['read_original_source'](binding['source'])
    helper['project_rpc_config'](helper['parse_config'](original), binding['rpcUpstreams'])
    check_witness(contract)
    return records, helper, producer, binding


def normal_command(contract=None):
    contract = {} if contract is None else contract
    case = case_path(contract)
    if installing(contract):
        return ['/usr/bin/python3','-B',str(case/INSTALLER),'--binding',str(case/BINDING),
                '--binding-sha256',PINNED[BINDING]['sha256'],'--producer-sha256',PINNED[PRODUCER]['sha256'],
                '--json-helper-sha256',PINNED[HELPER]['sha256'],'--output-dir',str(case/INSTALL_DESTINATION),'--install']
    return ['/usr/bin/python3', '-B', str(case / PRODUCER), '--binding', str(case / BINDING),
            '--binding-sha256', PINNED[BINDING]['sha256'], '--json-helper-sha256', PINNED[HELPER]['sha256'],
            '--output-dir', str(case / DESTINATION)]


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


def parse_unix_diag(raw, sequence, port, inode):
    """One exact Linux unix_diag reply, never a socket-table dump.

    Linux uapi unix_diag.h: NAME=0, PEER=2, SHUTDOWN=6; an exact
    reply carries the requesting port id in its header. Kernel provenance
    comes from recvmsg's sender, not a guessed zero nlmsg_pid.
    """
    require(32 <= len(raw) <= 65536, 'unix_diag_reply_bound')
    length, kind, flags, seq, pid = struct.unpack_from('=IHHII', raw)
    require(length == len(raw) and flags == 0 and seq == sequence and pid == port,
            'unix_diag_header_mismatch')
    if kind == 2:
        require(length >= 36, 'unix_diag_error_incomplete')
        error = struct.unpack_from('=i', raw, 16)[0]
        if error == -2: raise FileNotFoundError(2, 'owned_socket_closed')
        raise Refused('unix_diag_kernel_error')
    require(kind == 20, 'unix_diag_reply_type')
    family, socktype, state, pad, observed, cookie0, cookie1 = struct.unpack_from('=BBBBIII', raw, 16)
    require(family == socket.AF_UNIX and pad == 0 and observed == inode, 'unix_diag_identity_mismatch')
    attrs, offset = {}, 32
    while offset < len(raw):
        require(offset + 4 <= len(raw), 'unix_diag_attribute_truncated')
        size, attr = struct.unpack_from('=HH', raw, offset)
        require(size >= 4 and offset + size <= len(raw) and attr in (0, 2, 6) and attr not in attrs,
                'unix_diag_attribute_invalid')
        attrs[attr] = raw[offset+4:offset+size]
        aligned = (size + 3) & ~3
        require(offset + aligned <= len(raw) and not any(raw[offset+size:offset+aligned]),
                'unix_diag_attribute_padding')
        offset += aligned
    require(6 in attrs and len(attrs[6]) == 1 and attrs[6][0] <= 3, 'unix_diag_shutdown_missing')
    peer = None
    if 2 in attrs:
        require(len(attrs[2]) == 4, 'unix_diag_peer_invalid')
        peer = struct.unpack('=I',attrs[2])[0]
        require(peer > 0, 'unix_diag_peer_invalid')
    name = None
    if 0 in attrs:
        name = attrs[0]
        require(0 < len(name) <= 108, 'unix_diag_name_invalid')
        if name.endswith(b'\0'): name = name[:-1]
    return dict(inode=inode, type=socktype, state=state, cookie=(cookie0,cookie1), peer=peer, name=name)


def unix_diag(inode, deadline, cookie=(0xffffffff, 0xffffffff)):
    require(type(inode) is int and 0 < inode <= 0xffffffff and time.monotonic() < deadline,
            'unix_diag_deadline_or_inode')
    # No dump flag, multicast, shell, service operation or network fallback.
    with socket.socket(socket.AF_NETLINK, socket.SOCK_RAW | socket.SOCK_CLOEXEC, 4) as channel:
        channel.bind((0,0))
        port = channel.getsockname()[0]
        sequence = 1
        request = struct.pack('=BBHIIIII',socket.AF_UNIX,0,0,0xffffffff,inode,5,*cookie)
        packet = struct.pack('=IHHII',16+len(request),20,1,sequence,port)+request
        channel.settimeout(max(0.000001,deadline-time.monotonic()))
        require(channel.sendto(packet,(0,0)) == len(packet), 'unix_diag_request_incomplete')
        raw, ancillary, flags, sender = channel.recvmsg(65536)
        require(sender == (0,0) and not ancillary and flags == 0, 'unix_diag_kernel_sender_required')
        require(time.monotonic() <= deadline, 'unix_diag_deadline_or_inode')
        return parse_unix_diag(raw,sequence,port,inode)


def verify_ipc_socket(inode, deadline):
    client = unix_diag(inode,deadline)
    require(client['type'] == 1 and client['state'] == 1 and client['peer'] is not None,
            'systemctl_connected_stream_required')
    peer = unix_diag(client['peer'],deadline)
    require(peer['type'] == 1 and peer['state'] == 1 and peer['peer'] == inode
            and peer['name'] in tuple(path.encode() for path in IPC_PEERS), 'systemctl_fixed_ipc_peer_required')
    # Cookie re-query binds the observation against inode reuse while the peer
    # was queried. A disappeared exact socket receives whole-FD resampling.
    require(unix_diag(inode,deadline,client['cookie']) == client, 'unix_diag_socket_changed')


def verify_curl_socket(raw, inode):
    require(0 < len(raw) <= 4 << 20, 'curl_tcp_observation_bound')
    found = []
    for line in raw.splitlines()[1:]:
        fields = line.split()
        require(len(fields) >= 10, 'curl_tcp_table_incomplete')
        if fields[9] == str(inode).encode(): found.append(fields)
    require(len(found) == 1, 'curl_exact_socket_not_observed')
    fields = found[0]
    require(re.fullmatch(rb'0100007F:[0-9A-F]{4}', fields[1]) and fields[1][-4:] != b'0000'
            and fields[2] == b'0100007F:07E3' and fields[3] in (b'01',b'02',b'04',b'05',b'08',b'09',b'0B'),
            'curl_fixed_loopback_admin_peer_required')


def load_system_binaries(contract, progress=lambda: None):
    records = {}
    for name, expected in SYSTEM_BINARIES.items():
        path = Path(expected['path'])
        _, measured = read_private(path,{key:expected[key] for key in ('bytes','sha256')},maximum=64 << 20,
                                   progress=progress,runtime=True)
        require(file_witness(path.lstat()) == contract['systemBinaries'][name]['witness'], 'install_runtime_identity_changed')
        records[name] = measured
    return records


def absent_install_targets():
    for name in (CONFIG, DROPIN, str(Path(DROPIN).parent)):
        require(not any(os.path.lexists(name+suffix) for suffix in ('','.partial','.UNKNOWN','.tmp')),
                'existing_install_target_or_unknown')


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
        self.output = case_path(contract) / output_names(contract)[0]
        self.proc = low['LinuxProc']()
        rows = self.proc.inventory()
        self.owned = low['Owned'](os.getpid(), rows)
        self.initial_bytes = low['directory_bytes'](case_path(contract))
        self.system_records = {}
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
                options = dict(check_sockets=pid != self.owned.controller,observation_deadline=deadline)
                if installing(self.contract) and pid != self.owned.controller:
                    options['socket_authorizer'] = self.authorize_socket
                task = self.proc.sample_task(row, **options)
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
        disk = os.statvfs(case_path(self.contract)); free = disk.f_bavail * disk.f_frsize
        delta = max(0, self.low['directory_bytes'](case_path(self.contract)) - self.initial_bytes)
        if installing(self.contract):
            self.check_install_logs()
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

    def check_install_logs(self):
        directory = case_path(self.contract)/INSTALL_DESTINATION/'commands'
        totals = dict(self.log_bytes)
        if os.path.lexists(directory):
            directory_witness(directory)
            for path in directory.iterdir():
                info = path.lstat()
                require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                        and info.st_uid == info.st_gid == 0 and info.st_nlink == 1,
                        'install_command_capture_identity')
                for stream in ('stdout','stderr'):
                    if path.name.endswith('.'+stream): totals[stream] += info.st_size
        for stream, total in totals.items():
            require(total <= LIMITS[stream+'Bytes'], 'install_'+stream+'_limit')
        return totals

    def authorize_socket(self, before, fd, inode, deadline):
        require(installing(self.contract) and self.owned.known.get(before['pid']) == before['startTicks']
                and before['pid'] != self.owned.controller, 'install_socket_owned_identity_required')
        pid = before['pid']; directory = Path('/proc')/str(pid)
        current = self.proc.one_or_gone(pid)
        require(current is not None and current['startTicks'] == before['startTicks'], 'install_socket_pid_changed')
        require(os.readlink(directory/'ns/net') == os.readlink('/proc/self/ns/net'), 'install_socket_network_namespace_changed')
        target = 'socket:['+str(inode)+']'
        require(os.readlink(directory/'fd'/str(fd)) == target, 'install_socket_fd_changed')
        actual_exe = os.readlink(directory/'exe')
        names = [name for name in SYSTEM_BINARIES if SYSTEM_BINARIES[name]['path'] == actual_exe]
        require(len(names) == 1 and names[0] in ('curl','systemctl'), 'install_socket_fixed_tool_required')
        name = names[0]
        record = self.system_records.get(name)
        require(record is not None and identity((directory/'exe').stat()) == record['identity']
                and file_witness(Path(actual_exe).lstat()) == self.contract['systemBinaries'][name]['witness'],
                'install_socket_executable_identity_changed')
        raw = self.proc.bounded(directory/'cmdline',65536)
        require(raw.endswith(b'\0'), 'install_socket_argv_incomplete')
        argv = raw[:-1].split(b'\0')
        expected = (GET,) if name == 'curl' else (SHOW,DAEMON_RELOAD)
        require(any(argv == [part.encode() for part in command] for command in expected), 'install_socket_fixed_argv_required')
        try:
            if name == 'curl': verify_curl_socket(self.proc.bounded(directory/'net/tcp',4 << 20),inode)
            else: verify_ipc_socket(inode,deadline)
        except Refused:
            # Preserve a real refusal; only actual FD disappearance is a churn
            # retry. Same-number reuse never turns the refusal into approval.
            require(os.readlink(directory/'fd'/str(fd)) == target, 'install_socket_fd_changed')
            raise
        require(os.readlink(directory/'fd'/str(fd)) == target, 'install_socket_fd_changed')
        after = self.proc.one_or_gone(pid)
        require(after is not None and after['startTicks'] == before['startTicks']
                and identity((directory/'exe').stat()) == record['identity'] and time.monotonic() <= deadline,
                'install_socket_observation_changed')
        return True

    def command(self, runtime_record):
        self.capacity(fresh=True)
        runtime_path = Path(self.contract['pythonRuntime']['resolvedPath'])
        _, measured = read_private(runtime_path, runtime_record['pin'], maximum=64 << 20,
                                   progress=self.capacity, runtime=True)
        require(measured == runtime_record and str(Path('/usr/bin/python3').resolve(strict=True)) == str(runtime_path),
                'normal_python_runtime_changed')
        if installing(self.contract):
            self.system_records = load_system_binaries(self.contract,self.capacity)
            absent_install_targets()
        executable = os.open(runtime_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        selector, logs, child = selectors.DefaultSelector(), {}, None
        try:
            require(identity(os.fstat(executable)) == runtime_record['identity'], 'normal_runtime_fd_changed')
            for name in ('stdout', 'stderr'):
                fd = os.open(self.output / ('prepare.'+name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                logs[name] = os.fdopen(fd, 'wb', buffering=0)
            self.capacity(fresh=True)
            check_witness(self.contract)
            child = subprocess.Popen(normal_command(self.contract), executable='/proc/self/fd/'+str(executable), pass_fds=(executable,),
                cwd=str(case_path(self.contract)), env=dict(ENVIRONMENT), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
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


def qualify_output(helper, binding, contract=None):
    contract = {} if contract is None else contract
    install = installing(contract)
    destination = case_path(contract) / output_names(contract)[1]
    directory_witness(destination)
    expected = {'intent.json', 'original.json', 'candidate.json', 'ynx-chain-json.conf', 'BASELINE_DATA.json', 'receipt.json'}
    extra = {'commands','baseline-install-intent.json','baseline-install-receipt.json'} if install else set()
    require({path.name for path in destination.iterdir()} == expected | extra, 'closed_baseline_data_output_required')
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
    if install:
        raw, _ = read_private(case_path(contract)/INSTALLER,PINNED[INSTALLER])
        installer = captured_module(raw,case_path(contract)/INSTALLER,'ynx_caddy_install_result_reader')
        commands = destination/'commands'; directory_witness(commands)
        command_names = ('before-unit','before-loaded','validate','pre-daemon-unit','pre-daemon-loaded',
                         'daemon-reload','after-unit','after-loaded')
        require({path.name for path in commands.iterdir()} ==
                {label+suffix for label in command_names for suffix in ('.json','.stdout','.stderr')},
                'closed_install_command_captures_required')
        for label in command_names:
            body, body_record = read_private(commands/(label+'.json'),maximum=65536)
            record = decode(body); closed(record,('returnCode','stdout','stderr'))
            require(type(record['returnCode']) is int and record['returnCode'] == 0, 'install_command_failed')
            streams = {}
            for stream in ('stdout','stderr'):
                item = record[stream]; closed(item,('file','bytes','sha256'))
                require(item['file'] == label+'.'+stream, 'install_command_capture_path_changed')
                decimal(item['bytes']); pin(item['sha256'])
                data = installer['read_capture'](commands/item['file'],LIMITS[stream+'Bytes'])
                require(str(len(data)) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'],
                        'install_command_capture_bytes_changed')
                streams[stream] = data
            if label.endswith('-loaded'):
                require(hashlib.sha256(streams['stdout']).hexdigest() == binding['source']['sha256'],
                        'install_loaded_config_changed')
            elif label.endswith('-unit'):
                installer['assert_unit_state'](installer['show_state'](streams['stdout']),binding,label=='after-unit',helper)
            records['commands/'+label+'.json'] = body_record
        for path, expected_raw, mode, uid, gid in (
                (Path(CONFIG),blobs['original.json'],0o600,int(binding['source']['witness']['uid']),int(binding['source']['witness']['gid'])),
                (Path(DROPIN),blobs['ynx-chain-json.conf'],0o644,0,0)):
            # The original config is Caddy-owned and the drop-in root0644;
            # producer's original protected reader accepts those exact owners.
            producer_raw,_ = read_private(case_path(contract)/PRODUCER,PINNED[PRODUCER])
            producer = captured_module(producer_raw,case_path(contract)/PRODUCER,'ynx_caddy_installed_reader')
            actual,sha,_,info = producer['read_file'](path,16 << 20)
            require(actual == expected_raw and stat.S_IMODE(info.st_mode) == mode and info.st_nlink == 1
                    and (info.st_uid,info.st_gid) == (uid,gid), 'installed_original_startup_source_mismatch')
            records[str(path)] = dict(pin=dict(bytes=str(len(actual)),sha256=sha))
        installer['assert_no_unknown_sources'](Path(CONFIG),Path(DROPIN),True)
        install_raw, install_record = read_private(destination/'baseline-install-receipt.json',maximum=65536)
        result = decode(install_raw)
        install_intent, intent_record = read_private(destination/'baseline-install-intent.json',maximum=65536)
        intent = decode(install_intent)
        expected_intent = dict(version='YNX-CADDY-JSON-BASELINE-INSTALL/v1',status='unknown',automaticRetry=False,
            bindingSHA256=PINNED[BINDING]['sha256'],producerSHA256=PINNED[PRODUCER]['sha256'],
            jsonHelperSHA256=PINNED[HELPER]['sha256'],baselineDataSHA256=records['BASELINE_DATA.json']['pin']['sha256'])
        require(intent == expected_intent, 'install_intent_source_changed')
        wanted = dict(expected_intent,status='persistent-startup-source-installed',persistentStartupSource=True,
            configPath=CONFIG,dropInPath=DROPIN,originalSHA256=binding['source']['sha256'],
            originalSemanticSHA256=helper['semantic_hash'](helper['parse_config'](blobs['original.json'])),
            originalPID=binding['originalProcess']['pid'],originalStartTicks=binding['originalProcess']['startTicks'],
            liveConfigUnchanged=True,daemonReloadOnly=True,caddyReloaded=False,caddyRestarted=False,routesChanged=False,
            restartRecovery=False,rollbackVerified=False,chainActivation=False,rootGrant=False,publicDeployment=False)
        require(result == wanted, 'install_receipt_not_fixed_startup_source')
        records['baseline-install-receipt.json'],records['baseline-install-intent.json'] = install_record,intent_record
    return {name: record['pin'] for name, record in records.items()}


def run(contract, contract_pin, external_witnesses):
    require(sys.platform == 'linux' and platform.machine() == 'x86_64' and os.geteuid() == 0, 'root_linux_amd64_required')
    require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'identity_safe_cleanup_required')
    began = time.monotonic()
    case = case_path(contract); install = installing(contract)
    directory_witness(case)
    for name in output_names(contract):
        require(not any(os.path.lexists(case/(name+suffix)) for suffix in ('','.partial','.UNKNOWN','.tmp')),
                'original_attempt_or_partial_retained')
    if install: absent_install_targets()
    check_witness(contract)
    low, guard_record = load_process_guard(case / GUARD)
    controller = Controller(contract, low, began)
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    previous, confirmed = ctypes.c_int(), ctypes.c_int()
    require(libc.prctl(37, ctypes.cast(ctypes.pointer(previous), ctypes.c_void_p).value, 0, 0, 0) == 0
            and libc.prctl(36, 1, 0, 0, 0) == 0 and libc.prctl(37, ctypes.cast(ctypes.pointer(confirmed), ctypes.c_void_p).value, 0, 0, 0) == 0
            and confirmed.value == 1, 'owned_child_subreaper_required')
    controller.output.mkdir(mode=0o700); sync_directory(case)
    exclusive(controller.output/'intent.json', encode(dict(version=contract['version'], contractSHA256=contract_pin, status='unknown',
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
        outputs = qualify_output(helper,binding,contract)
        if install:
            require(load_system_binaries(contract,controller.capacity) == controller.system_records,
                    'install_system_binary_changed')
        _, runtime_after = read_private(Path(runtime['resolvedPath']),runtime_record['pin'],maximum=64 << 20,
                                        progress=controller.capacity,runtime=True)
        require(runtime_after == runtime_record and str(Path('/usr/bin/python3').resolve(strict=True)) == runtime['resolvedPath'],
                'normal_python_runtime_changed_after_prepare')
        after = live_snapshot(producer,helper,binding,controller.capacity)
        require(before == after, 'original_service_or_loaded_config_changed')
        controller.event('original_caddy_after',after)
        for name, original in records.items():
            _, current = read_private(case/name, original['pin'], progress=controller.capacity)
            require(current == original, 'original_staged_source_changed')
        _, current_guard = read_private(case/GUARD, guard_record['pin'], progress=controller.capacity)
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
    capture_bytes = None
    if install:
        try: capture_bytes = controller.check_install_logs()
        except Exception as error: controller.first_cause = controller.first_cause or public_error(error)
    if controller.first_cause:
        try: exclusive(controller.output/'first-cause.json',encode(dict(code=controller.first_cause,
                       taskSample=controller.task_sample_failure,taskSampleJournalError=controller.task_sample_journal_error)))
        except Exception: pass
    success=controller.first_cause is None and cleanup_ok and controller.codes==[0] and before==after and outputs is not None
    receipt=dict(version=contract['version'],classification=contract['classification'],contractSHA256=contract_pin,executionStarted=True,
        dataPrepared=success and not install,
        normalExitCodes=controller.codes,firstCause=controller.first_cause,cleanupComplete=cleanup_ok,cleanupError=cleanup_error,
        elapsedMs=int((time.monotonic()-began)*1000),sampleCount=controller.samples,peakOwnedRSSBytes=controller.peak_rss,
        maxCaseDeltaBytes=controller.max_delta,stdoutBytes=controller.log_bytes['stdout'],stderrBytes=controller.log_bytes['stderr'],
        originalInputsUnchanged=success,originalCaddyUnchanged=success,outputs=outputs if success else None,
        guardMode='sampled-proc-smaps-rollup-200ms',cgroupHardWall=False,rootGrant=False,installed=success and install,
        serviceCommandsPerformed=(True if success else None) if install else False,
        publicDeployment=False,pqActivation=False,authoritativeFinalCheckpoint=False,automaticRetry=False)
    if install:
        receipt.update(persistentStartupSourceInstalled=success,daemonReloadOnly=success,
            caddyReloaded=False,caddyRestarted=False,routesChanged=False,restartRecovery=False,rollbackVerified=False,
            ownedSockets='sampled-fixed-tool-peer-verified',commandCaptureBytes=capture_bytes)
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
            print(encode(dict(version=contract['version'],classification=contract['classification'],contractValidated=True,executionStarted=False,
                              rootGrant=False,installed=False,serviceCommandsPerformed=False)).decode(),end='')
            return 0
        require(args.confirmed_contract_sha256==args.contract_sha256,'later_exact_confirmation_required')
        caller=Path(__file__).resolve(strict=True)
        require(caller==case_path(contract)/CALLER,'fixed_normal_caller_path_required')
        _,caller_record=read_private(caller,maximum=1 << 20)
        require(caller_record['pin']['sha256']==contract['controllerSHA256'],'external_controller_source_pin_mismatch')
        result=run(contract,args.contract_sha256,[(Path(args.contract),contract_record),(caller,caller_record)])
        print(encode(result).decode(),end='')
        success = result.get('persistentStartupSourceInstalled') if installing(contract) else result['dataPrepared']
        return 0 if success else 1
    except Exception as error:
        print('YNX_CADDY_BASELINE_DATA_REFUSED '+public_error(error),file=sys.stderr)
        return 1


if __name__=='__main__':
    sys.exit(main())
