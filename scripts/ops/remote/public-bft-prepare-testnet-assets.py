#!/usr/bin/env python3
"""Explicit public-identity extraction or stopped native asset archival.

The normal production driver supplies independently pinned freeze/pause/source
records. Neither phase stops, starts, resets, or initializes a service. Archive
retains the four original files and the observed genesis/validator identities;
it never invokes an empty legacy constructor or creates a replacement identity.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


DATA = Path('/var/lib/ynx-chain/testnet')
NAMES = ('devnet-state.json', 'devnet-state.integrity-version',
         'devnet-state.json.tmp', 'devnet-state.integrity-version.tmp')
MAX_SOURCE = 1 << 30
MAX_PUBLIC = 16384
DIRECTORY_IDENTITY = (64770, 1322170)
NATIVE_UID, NATIVE_GID = 995, 986
SYNTAX = re.compile(rb'["{}\[\]]')
STRING_SYNTAX = re.compile(rb'["\\\x00-\x1f]')


def require(ok, code):
    if not ok:
        raise ValueError(code)


def privileged_execution():
    require(os.geteuid() == 0, 'ROOT_REQUIRED')


def file_identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def load_capture_tool(expected):
    # Same-source normal capture callee; compile only these measured bytes.
    path = Path(__file__).resolve().parent / 'public-bft-capture-snapshot-source.py'
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and not info.st_mode & 0o022 and info.st_size <= 65536, 'CAPTURE_TOOL_NOT_REGULAR')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as stream:
        raw = stream.read(65537)
        require(stream.tell() == info.st_size and file_identity(os.fstat(stream.fileno())) == file_identity(info)
                and file_identity(path.lstat()) == file_identity(info), 'CAPTURE_TOOL_CHANGED')
    require(hashlib.sha256(raw).hexdigest() == expected, 'CAPTURE_TOOL_PIN_MISMATCH')
    namespace = {'__name__': 'ynx_testnet_assets_capture', '__file__': str(path)}
    exec(compile(raw, str(path), 'exec'), namespace)
    return namespace


class PublicSnapshotReader:
    """One 64KiB streaming pass, retaining only three bounded public values.

    Unselected containers are structurally skipped. This is deliberately not a
    substitute for Go snapshot-integrity validation; the independently pinned
    original source bytes identify the DATA being observed.
    """
    def __init__(self, stream):
        self.stream, self.buffer, self.index = stream, b'', 0
        self.digest, self.size = hashlib.sha256(), 0

    def fill(self):
        if self.index < len(self.buffer):
            return True
        self.buffer = self.stream.read(65536)
        self.index = 0
        self.size += len(self.buffer)
        require(self.size <= MAX_SOURCE, 'SOURCE_OVER_1GIB')
        self.digest.update(self.buffer)
        return bool(self.buffer)

    def peek(self):
        while self.fill():
            if self.buffer[self.index] not in b' \t\r\n':
                return self.buffer[self.index]
            self.index += 1
        return None

    def take(self, byte):
        require(self.peek() == byte, 'PUBLIC_SOURCE_JSON_DELIMITER')
        self.index += 1

    def value(self, maximum=0, opened_array=False):
        chunks, retained = [], 0

        def accept(raw):
            nonlocal retained
            if maximum:
                retained += len(raw)
                require(retained <= maximum, 'PUBLIC_VALUE_OVER_BOUND')
                chunks.append(raw)

        first = self.peek()
        require(first is not None, 'SOURCE_UNEXPECTED_EOF')
        stack, in_string = [], False
        if opened_array:
            stack = [93]
        elif first in (123, 91):
            stack = [125 if first == 123 else 93]
            accept(bytes((first,)))
            self.index += 1
        elif first == 34:
            in_string = True
            accept(b'"')
            self.index += 1
        else:
            raw = bytearray()
            while self.fill() and self.buffer[self.index] not in b' \t\r\n,}]':
                raw.append(self.buffer[self.index]); self.index += 1
                require(len(raw) <= 128, 'JSON_PRIMITIVE_OVER_BOUND')
            require(re.fullmatch(rb'(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)', raw),
                    'INVALID_JSON_PRIMITIVE')
            accept(bytes(raw))
            return b''.join(chunks)
        while True:
            require(self.fill(), 'SOURCE_UNCLOSED_CONTAINER')
            matcher = STRING_SYNTAX if in_string else SYNTAX
            match = matcher.search(self.buffer, self.index)
            end = match.start() if match else len(self.buffer)
            accept(self.buffer[self.index:end]); self.index = end
            if match is None:
                continue
            token = self.buffer[self.index]; self.index += 1; accept(bytes((token,)))
            if in_string:
                if token == 92:
                    require(self.fill(), 'SOURCE_UNCLOSED_ESCAPE')
                    escaped = self.buffer[self.index]; self.index += 1; accept(bytes((escaped,)))
                    require(escaped in b'"\\/bfnrtu', 'INVALID_STRING_ESCAPE')
                    if escaped == 117:
                        for _ in range(4):
                            require(self.fill(), 'SOURCE_UNCLOSED_UNICODE')
                            escaped = self.buffer[self.index]; self.index += 1; accept(bytes((escaped,)))
                            require(escaped in b'0123456789abcdefABCDEF', 'INVALID_STRING_UNICODE')
                else:
                    require(token == 34, 'JSON_STRING_CONTROL_CHARACTER')
                    in_string = False
                    if not stack:
                        return b''.join(chunks)
            elif token == 34:
                in_string = True
            elif token in (123, 91):
                stack.append(125 if token == 123 else 93)
                require(len(stack) <= 128, 'SOURCE_JSON_DEPTH')
            else:
                require(stack and stack.pop() == token, 'SOURCE_CONTAINER_MISMATCH')
                if not stack:
                    return b''.join(chunks)

    def public_values(self, decode):
        result, seen = {}, set()
        self.take(123)
        while self.peek() != 125:
            require(len(seen) < 128, 'SOURCE_TOP_LEVEL_FIELD_BOUND')
            key = decode(self.value(256))
            require(type(key) is str and key not in seen, 'SOURCE_DUPLICATE_TOP_LEVEL')
            seen.add(key); self.take(58)
            if key in ('config', 'validators', 'version'):
                result[key] = decode(self.value(131072))
            elif key == 'blocks':
                self.take(91)
                require(self.peek() != 93, 'SOURCE_HAS_NO_GENESIS')
                result['genesis'] = decode(self.value(65536))
                self.value(opened_array=True)
            else:
                self.value()
            next_byte = self.peek()
            if next_byte == 125:
                break
            self.take(44)
            require(self.peek() != 125, 'SOURCE_TOP_LEVEL_TRAILING_COMMA')
        self.take(125)
        require(self.peek() is None and set(result) == {'version', 'config', 'validators', 'genesis'},
                'PUBLIC_SOURCE_FIELDS_OR_TRAILING_BYTES')
        return result


def service_stopped(original_pid):
    # Observation only. Operators stop and persistently disable the service through
    # its normal explicit operation; no helper attempts a stop or an auto-retry.
    names = ('ActiveState', 'SubState', 'MainPID', 'ControlGroup', 'UnitFileState', 'ExecMainPID')
    result = subprocess.run(['/usr/bin/systemctl', 'show', 'ynx-chaind.service'] +
                            ['--property=' + name for name in names], check=True,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5,
                            env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    require(len(result.stdout) <= 2048, 'SERVICE_OBSERVATION_OVER_BOUND')
    value = dict(line.split('=', 1) for line in result.stdout.decode('ascii').splitlines())
    require(set(value) == set(names) and value['ActiveState'] == 'inactive'
            and value['SubState'] == 'dead' and value['MainPID'] == '0'
            and value['UnitFileState'] in ('disabled', 'masked'), 'ORIGINAL_SERVICE_NOT_STOPPED_DISABLED')
    require(type(original_pid) is str and re.fullmatch('[1-9][0-9]{0,9}', original_pid),
            'ORIGINAL_PRESTOP_PID_REQUIRED')
    require(not Path('/proc/' + original_pid).exists(), 'ORIGINAL_PID_STILL_PRESENT_OR_REUSED')
    cgroup = value['ControlGroup']
    if cgroup:
        require(re.fullmatch(r'/system\.slice/ynx-chaind\.service', cgroup), 'UNEXPECTED_SERVICE_CGROUP')
        members = Path('/sys/fs/cgroup' + cgroup + '/cgroup.procs')
        if members.exists():
            with members.open('rb') as stream:
                require(stream.read(1) == b'', 'OWNED_WRITER_STILL_PRESENT')
    if value['ExecMainPID'] not in ('', '0'):
        require(value['ExecMainPID'].isdigit() and not Path('/proc/' + value['ExecMainPID']).exists(),
                'ORIGINAL_PID_STILL_PRESENT_OR_REUSED')
    return value


def no_open_holders(paths):
    # Check only these four exact files, not a whole mount or arbitrary process
    # argv. Refuse readers too: a held original FD is not a safe reset boundary.
    for path in paths:
        result = subprocess.run(['/usr/bin/fuser', '-s', '--', str(path)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=3, env={'PATH': '/usr/bin:/bin'})
        require(result.returncode == 1 and result.stdout == b'' and result.stderr == b'',
                'ORIGINAL_ASSET_HAS_OPEN_HOLDER_OR_OBSERVATION_FAILED')


def run(args):
    tool = load_capture_tool(args.capture_helper_sha256)
    read, decode, pin, identity = (tool[name] for name in ('read', 'decode', 'pin', 'identity'))
    durable, sync_dir = tool['durable'], tool['sync_dir']

    def pinned(filename, expected, maximum=MAX_PUBLIC):
        measured, raw, observed = read(tool['absolute'](filename), maximum, True, True)
        require(measured['sha256'] == pin(expected), 'PUBLIC_INPUT_PIN_MISMATCH')
        return decode(raw), observed

    privileged_execution()
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{7,127}', args.transaction_id), 'TRANSACTION_REQUIRED')
    require(re.fullmatch('[0-9a-f]{12}', args.commit), 'CANDIDATE_COMMIT_REQUIRED')
    source, _ = pinned(args.snapshot_source, args.snapshot_source_sha256)
    required = set(('version transactionId commit authoritativeRelease bftRelease statePath stateBytes '
                    'stateSHA256 integrityMarkerPath integrityMarkerBytes integrityMarkerSHA256 '
                    'pauseMarkerPath pauseMarkerSHA256 mutationMarkerPath mutationMarkerSHA256 '
                    'height blockHash authoritativeCommit authoritativeBinarySha256').split())
    require(set(source) == required and source['version'] == 'YNX-PUBLIC-BFT-SNAPSHOT-SOURCE/v1'
            and source['transactionId'] == args.transaction_id and source['commit'] == args.commit
            and source['statePath'] == str(DATA / NAMES[0])
            and source['integrityMarkerPath'] == str(DATA / NAMES[1])
            and source['pauseMarkerPath'] == str(DATA.parent / 'block-production-pause.json')
            and source['mutationMarkerPath'] == str(DATA.parent / 'mutation-freeze.json'), 'ORIGINAL_SOURCE_SCOPE_MISMATCH')
    require(source['authoritativeCommit'] == '65efa82e06158f9616172144c3c9efdd8088f227'
            and source['authoritativeRelease'] == 'ynx-network-surgical-65efa82e0615'
            and source['authoritativeBinarySha256'] == 'c79a0e0b60f44bc42b8b1a9d4af302c370389cb609a82e6d0f9073b0ca0c3587'
            and source['bftRelease'] == 'ynx-bft-gateway-' + args.commit, 'ORIGINAL_NATIVE_OR_CANDIDATE_VERSION_MISMATCH')
    for kind, filename, expected in (('freeze', args.primary_freeze, args.primary_freeze_sha256),
                                     ('pause', args.primary_pause, args.primary_pause_sha256)):
        value, _ = pinned(filename, expected)
        require(all(value.get(k) == source[k] for k in ('transactionId', 'commit', 'authoritativeRelease',
                    'authoritativeCommit', 'bftRelease')), 'NORMAL_FREEZE_PAUSE_TRANSACTION_MISMATCH')
        if kind == 'freeze':
            require(value.get('role') == 'primary' and value.get('operation') == 'freeze'
                    and value.get('mutationStateVerified') is True
                    and value.get('markerSha256') == source['mutationMarkerSHA256'], 'NORMAL_FREEZE_REQUIRED')
        else:
            require(value.get('operation') == 'pause' and value.get('productionStateVerified') is True
                    and str(value.get('heightBefore')) == source['height'] == str(value.get('heightAfter'))
                    and value.get('markerSha256') == source['pauseMarkerSHA256'], 'NORMAL_PAUSE_REQUIRED')
    for field in ('stateSHA256', 'integrityMarkerSHA256', 'pauseMarkerSHA256', 'mutationMarkerSHA256'):
        pin(source[field])
    require(str(DATA.resolve(strict=True)) == str(DATA) and DATA.is_dir(), 'ORIGINAL_DATA_DIRECTORY_CHANGED')
    directory_before = identity(DATA.lstat())
    require(directory_before[0:2] == DIRECTORY_IDENTITY
            and DATA.stat().st_uid == NATIVE_UID and DATA.stat().st_gid == NATIVE_GID, 'ORIGINAL_DIRECTORY_IDENTITY_MISMATCH')
    source_before = (DATA / NAMES[0]).lstat()
    require(stat.S_ISREG(source_before.st_mode) and source_before.st_nlink == 1
            and source_before.st_uid == NATIVE_UID and source_before.st_gid == NATIVE_GID
            and stat.S_IMODE(source_before.st_mode) == 0o600
            and source_before.st_size == int(source['stateBytes']) <= MAX_SOURCE, 'ORIGINAL_SNAPSHOT_METADATA_MISMATCH')
    for field in ('pauseMarker', 'mutationMarker', 'integrityMarker'):
        measured, _, _ = read(Path(source[field + 'Path']), MAX_PUBLIC)
        require(measured['sha256'] == source[field + 'SHA256'], 'ORIGINAL_MARKER_CHANGED')

    public = None
    if args.phase == 'extract-public-identity':
        require(args.public_identity is None and args.public_identity_sha256 is None
                and args.original_pid is None, 'EXTRACT_MUST_NOT_CONSUME_IDENTITY_OR_STOP_PID')
        fd = os.open(DATA / NAMES[0], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        with os.fdopen(fd, 'rb') as stream:
            require(identity(os.fstat(stream.fileno())) == identity(source_before), 'SOURCE_CHANGED_BEFORE_STREAM')
            scanner = PublicSnapshotReader(stream)
            public = scanner.public_values(decode)
            require(identity(os.fstat(stream.fileno())) == identity(source_before), 'SOURCE_CHANGED_DURING_STREAM')
        require(scanner.size == source_before.st_size and scanner.digest.hexdigest() == source['stateSHA256']
                and identity((DATA / NAMES[0]).lstat()) == identity(source_before), 'SOURCE_BYTES_OR_PATH_CHANGED')
        cfg, genesis, validators = (public[k] for k in ('config', 'genesis', 'validators'))
        require(type(public['version']) is int and public['version'] == 2 and type(cfg) is dict
                and set(cfg) == {'name', 'slug', 'chainId', 'nativeCoinName', 'nativeCurrencySymbol',
                                 'decimals', 'isPublicNet', 'chainIdConflictCheck'}
                and type(cfg.get('chainId')) is int and cfg['chainId'] == 6423
                and cfg.get('slug') == 'testnet' and cfg.get('isPublicNet') is True, 'ONLY_ORIGINAL_LEGACY_TESTNET_SUPPORTED')
        validator_fields = {'address', 'moniker', 'host', 'role', 'peerId', 'votingPower', 'active',
                            'peerReady', 'peerStatus', 'latestHeight', 'lastSeenAt', 'updatedAt', 'peerEvidence'}
        require(type(validators) is list and len(validators) == 4
                and all(type(v) is dict and set(v) <= validator_fields
                        and {'address', 'moniker', 'votingPower', 'active', 'peerReady'} <= set(v)
                        and type(v.get('address')) is str and v['address']
                        and type(v['votingPower']) is int and v['votingPower'] > 0
                        and type(v['active']) is bool and type(v['peerReady']) is bool for v in validators)
                and len({v['address'] for v in validators}) == 4, 'FOUR_ORIGINAL_VALIDATORS_REQUIRED')
        require(type(genesis) is dict and set(genesis) == {'height', 'hash', 'parentHash', 'time', 'validator', 'transactions'}
                and type(genesis.get('height')) is int and genesis['height'] == 0
                and re.fullmatch('[0-9a-f]{64}', genesis.get('hash', ''))
                and genesis.get('validator') in {v['address'] for v in validators}
                and not genesis.get('transactions'), 'ORIGINAL_GENESIS_RECORD_REQUIRED')
        payload = dict(version='YNX-ORIGINAL-TESTNET-PUBLIC-IDENTITY/v1', classification='data',
                       transactionId=args.transaction_id, snapshotSHA256=source['stateSHA256'],
                       snapshotBytes=source['stateBytes'], config=cfg, genesisBlock=genesis,
                       validators=validators, snapshotIntegrity='not-reimplemented',
                       nativeGenesisIndependentlyTrusted=False, pqCustodyOrBindingAuthorized=False)
    else:
        require(args.public_identity is not None and args.public_identity_sha256 is not None,
                'INDEPENDENT_EXTRACTED_IDENTITY_REQUIRED')
        payload, _ = pinned(args.public_identity, args.public_identity_sha256)
        require(payload.get('version') == 'YNX-ORIGINAL-TESTNET-PUBLIC-IDENTITY/v1'
                and payload.get('transactionId') == args.transaction_id
                and payload.get('snapshotSHA256') == source['stateSHA256']
                and payload.get('snapshotBytes') == source['stateBytes']
                and payload.get('config', {}).get('chainId') == 6423
                and payload.get('config', {}).get('slug') == 'testnet'
                and len(payload.get('validators', [])) == 4, 'EXTRACTED_ORIGINAL_IDENTITY_MISMATCH')
        service_stopped(args.original_pid)
        measured, _, _ = read(DATA / NAMES[0], MAX_SOURCE)
        require(measured['sha256'] == source['stateSHA256'], 'ARCHIVE_SOURCE_CHANGED')

    output = tool['absolute'](args.output_dir)
    require(str(output.parent.resolve(strict=True)) == str(output.parent)
            and stat.S_IMODE(output.parent.stat().st_mode) == 0o700
            and output.parent.stat().st_uid == os.geteuid(), 'PROTECTED_EXISTING_OUTPUT_PARENT_REQUIRED')
    output.mkdir(mode=0o700)
    public_raw = (json.dumps(payload, separators=(',', ':'), ensure_ascii=True) + '\n').encode()
    require(len(public_raw) <= MAX_PUBLIC, 'PUBLIC_IDENTITY_OUTPUT_OVER_BOUND')
    public_pin = durable(output / 'public-identity.json', payload)
    receipt = dict(version='YNX-TESTNET-ASSET-PREPARATION/v1', phase=args.phase,
                   transactionId=args.transaction_id, publicIdentity=public_pin,
                   snapshotSHA256=source['stateSHA256'], originalGenesisPreserved=True,
                   originalValidatorCount=4, originalAssetsArchived=False, replacementStateCreated=False,
                   nodeStarted=False, pqCustodyOrBindingAuthorized=False, activated=False)
    if args.phase == 'archive-original-assets':
        archive = DATA.parent / ('testnet-assets-retained-' + args.transaction_id)
        require(not os.path.lexists(archive), 'EXISTING_ARCHIVE_OR_UNKNOWN_MUST_BE_RETAINED')
        present = [DATA / name for name in NAMES if os.path.lexists(DATA / name)]
        observations = {}
        for path in present:
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                    and info.st_uid == NATIVE_UID and info.st_gid == NATIVE_GID
                    and stat.S_IMODE(info.st_mode) == 0o600, 'ORIGINAL_ASSET_NOT_PRIVATE_SINGLE_LINK_FILE')
            observations[path.name] = identity(info)
        no_open_holders(present)
        service_before = service_stopped(args.original_pid)
        require(identity((DATA / NAMES[0]).lstat()) == identity(source_before), 'SOURCE_CHANGED_BEFORE_ARCHIVE')
        archive.mkdir(mode=0o700)
        require(archive.stat().st_dev == DATA.stat().st_dev, 'ARCHIVE_MUST_SHARE_ORIGINAL_FILESYSTEM')
        durable(archive / 'public-identity.json', payload)
        durable(output / 'archive-intent.json', dict(transactionId=args.transaction_id,
                archive=str(archive), files={name:list(value) for name,value in observations.items()},
                service=service_before, retry=False))
        for path in present:
            require(identity(path.lstat()) == observations[path.name], 'ORIGINAL_ASSET_CHANGED_BEFORE_RENAME')
            require(not os.path.lexists(archive / path.name), 'ARCHIVE_DESTINATION_ALREADY_PRESENT')
            os.rename(path, archive / path.name)
            sync_dir(DATA); sync_dir(archive)
        require(not any(os.path.lexists(DATA / name) for name in NAMES), 'ORIGINAL_ASSET_PATH_REAPPEARED')
        service_stopped(args.original_pid)
        for name, observed in observations.items():
            # A rename may advance ctime. Content length, mtime, inode, owner,
            # links and permissions must retain the original values.
            require(identity((archive / name).lstat())[:-1] == observed[:-1], 'ARCHIVED_ORIGINAL_CHANGED')
        receipt.update(originalAssetsArchived=True, archive=str(archive), originalFiles=list(observations),
                       originalServiceStoppedAndDisabled=True, originalPIDVerifiedGone=args.original_pid,
                       noOpenHoldersVerified=True)
    else:
        require(identity(DATA.lstat()) == directory_before, 'SOURCE_DIRECTORY_CHANGED_DURING_EXTRACT')
    measured = durable(output / 'receipt.json', receipt)
    return dict(phase=args.phase, receipt=measured, output=str(output), nodeStarted=False, activated=False)


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False, description=__doc__)
    parser.add_argument('--phase', choices=('extract-public-identity', 'archive-original-assets'), required=True)
    for name in ('transaction-id', 'commit', 'capture-helper-sha256', 'snapshot-source', 'snapshot-source-sha256',
                 'primary-freeze', 'primary-freeze-sha256', 'primary-pause', 'primary-pause-sha256', 'output-dir'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--public-identity')
    parser.add_argument('--public-identity-sha256')
    parser.add_argument('--original-pid')
    print(json.dumps(run(parser.parse_args()), separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never expose file contents, raw process argv, environment, or secrets.
        # Every partial output/archive/UNKNOWN remains for original reconciliation.
        print('TESTNET_ASSET_PREPARATION_REFUSED:' + type(error).__name__ + ':' + str(error), file=sys.stderr)
        sys.exit(1)
