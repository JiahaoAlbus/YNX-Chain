#!/usr/bin/env python3
"""Prepare private Caddy JSON ingress DATA from two independently pinned reads.

This never installs a configuration, starts/reloads a service, contacts the
admin API, changes ownership, or grants cutover authority. The original owner
must independently qualify and install the resulting baseline. Every reserved
bundle, including an incomplete attempt, is retained without automatic retry.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re
import stat
import sys


VERSION = 'YNX-CADDY-JSON-INGRESS-SOURCE/v1'
BASELINE_VERSION = 'YNX-CADDY-JSON-BASELINE/v1'
MAX_CONFIG = 16 << 20
UNIT = '/usr/lib/systemd/system/caddy.service'
ARGV = ['/usr/bin/caddy', 'run', '--environ', '--config', '/etc/caddy/Caddyfile']
CONFIG = '/etc/caddy/ynx-chain.json'
DROPIN = '/etc/systemd/system/caddy.service.d/ynx-chain-json.conf'
BINDING_FIELDS = set(('version transactionId commit operatorPlanSHA256 runtimeCommit '
    'runtimeSOURCEsha256 gatewaySHA256 source secondRead originalProcess originalUnit rpcUpstreams').split())
BASELINE_FIELDS = set('version source secondRead originalProcess originalUnit rpcUpstreams'.split())
WITNESS_FIELDS = set('uid gid mode nlink device inode mtimeNs ctimeNs'.split())


class Refusal(ValueError):
    pass


def require(ok, code):
    if not ok:
        raise Refusal(code)


def pin(value):
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value)
            and value != '0' * 64, 'INDEPENDENT_NONZERO_SHA256_REQUIRED')
    return value


def absolute(value):
    require(type(value) is str and value != '/' and re.fullmatch('/[A-Za-z0-9_./-]+', value)
            and str(Path(value)) == value and '..' not in Path(value).parts,
            'CANONICAL_ABSOLUTE_PATH_REQUIRED')
    return Path(value)


def decimal(value, minimum=0):
    require(type(value) is str and re.fullmatch('0|[1-9][0-9]*', value)
            and len(value) <= 24 and minimum <= int(value) < 1 << 64,
            'CANONICAL_METADATA_DECIMAL_REQUIRED')
    return int(value)


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def witness(info):
    return dict(uid=str(info.st_uid), gid=str(info.st_gid), mode=format(stat.S_IMODE(info.st_mode), 'o'),
                nlink=str(info.st_nlink), device=str(info.st_dev), inode=str(info.st_ino),
                mtimeNs=str(info.st_mtime_ns), ctimeNs=str(info.st_ctime_ns))


def private_directory(path, uid, gid=None):
    require(str(path.resolve(strict=True)) == str(path), 'PRIVATE_DIRECTORY_PATH_CHANGED')
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
            and info.st_uid == uid and (gid is None or info.st_gid == gid),
            'ORIGINAL_PRIVATE_DIRECTORY_REQUIRED')
    return identity(info)


def read_file(path, maximum, private=False):
    require(str(path.resolve(strict=True)) == str(path), 'ORIGINAL_PATH_CHANGED')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
            and not before.st_mode & 0o022 and 0 < before.st_size <= maximum,
            'BOUNDED_ORIGINAL_REGULAR_FILE_REQUIRED')
    if private:
        require(before.st_uid == os.geteuid() and stat.S_IMODE(before.st_mode) == 0o600,
                'PRIVATE_CALLER_OWNED_INPUT_REQUIRED')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    chunks, size, digest = [], 0, hashlib.sha256()
    with os.fdopen(fd, 'rb') as source:
        require(identity(before) == identity(os.fstat(source.fileno())), 'ORIGINAL_CHANGED_BEFORE_READ')
        while True:
            block = source.read(65536)
            if not block:
                break
            size += len(block)
            require(size <= maximum, 'ORIGINAL_GREW_BEYOND_BOUND')
            chunks.append(block)
            digest.update(block)
        require(size == before.st_size and identity(before) == identity(os.fstat(source.fileno()))
                and identity(before) == identity(path.lstat()), 'ORIGINAL_CHANGED_DURING_READ')
    return b''.join(chunks), digest.hexdigest(), identity(before), before


def load_helper(expected):
    # Fixed same-source sibling only. Compile the measured bytes rather than
    # reopening a swappable import path or searching PYTHONPATH/renderer input.
    path = Path(__file__).resolve().parent / 'remote/public-bft-caddy-json.py'
    raw, actual, ident, _ = read_file(path, 256 << 10)
    require(actual == pin(expected), 'CADDY_JSON_HELPER_PIN_MISMATCH')
    module = {'__name__': 'ynx_caddy_json_source_shared', '__file__': str(path)}
    exec(compile(raw, str(path), 'exec'), module)
    for name in ('parse_json', 'parse_config', 'semantic_hash', 'project_rpc_config', 'canonical_config', 'render_dropin'):
        require(callable(module.get(name)), 'CADDY_JSON_SHARED_API_REQUIRED')
    return module, path, ident


def validate_binding(value):
    require(type(value) is dict and ((value.get('version') == VERSION and set(value) == BINDING_FIELDS)
            or (value.get('version') == BASELINE_VERSION and set(value) == BASELINE_FIELDS)),
            'CLOSED_ORIGINAL_BINDING_REQUIRED')
    full = value['version'] == VERSION
    if full:
        require(type(value['transactionId']) is str
                and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', value['transactionId'])
                and type(value['commit']) is str and re.fullmatch('[0-9a-f]{12}', value['commit'])
                and value['commit'] != '0' * 12 and type(value['runtimeCommit']) is str
                and re.fullmatch('[0-9a-f]{40}', value['runtimeCommit'])
                and value['runtimeCommit'][:12] == value['commit'], 'INDEPENDENT_TRANSACTION_IDENTITY_REQUIRED')
        for key in ('operatorPlanSHA256', 'runtimeSOURCEsha256', 'gatewaySHA256'):
            pin(value[key])
    for key in ('source', 'secondRead'):
        source = value[key]
        require(type(source) is dict and set(source) == {'path', 'bytes', 'sha256', 'witness'},
                'CLOSED_ORIGINAL_SOURCE_REQUIRED')
        absolute(source['path']); pin(source['sha256'])
        require(decimal(source['bytes'], 1) <= MAX_CONFIG,
                'BOUNDED_ORIGINAL_SOURCE_REQUIRED')
        w = source['witness']
        require(type(w) is dict and set(w) == WITNESS_FIELDS, 'CLOSED_ORIGINAL_WITNESS_REQUIRED')
        for field in WITNESS_FIELDS - {'mode'}:
            decimal(w[field], 1 if field in ('nlink', 'inode', 'mtimeNs', 'ctimeNs') else 0)
        require(w['mode'] == '600' and w['nlink'] == '1', 'ORIGINAL_0600_SINGLE_LINK_REQUIRED')
    a, b = value['source'], value['secondRead']
    require(a['path'] != b['path'] and Path(a['path']).parent == Path(b['path']).parent
            and a['sha256'] == b['sha256'] and a['bytes'] == b['bytes']
            and a['witness']['uid'] == b['witness']['uid'] and a['witness']['gid'] == b['witness']['gid']
            and (a['witness']['device'], a['witness']['inode']) != (b['witness']['device'], b['witness']['inode']),
            'TWO_DISTINCT_ORIGINAL_EQUAL_READS_REQUIRED')
    process = value['originalProcess']
    require(type(process) is dict and set(process) == {'pid', 'startTicks', 'argv'},
            'CLOSED_ORIGINAL_PROCESS_REQUIRED')
    decimal(process['pid'], 2); decimal(process['startTicks'], 1)
    require(process['argv'] == ARGV, 'ORIGINAL_CADDYFILE_ARGV_REQUIRED')
    unit = value['originalUnit']
    require(type(unit) is dict and set(unit) == {'path', 'sha256'} and unit['path'] == UNIT,
            'FIXED_ORIGINAL_UNIT_REQUIRED')
    pin(unit['sha256'])
    require(type(value['rpcUpstreams']) is list and len(value['rpcUpstreams']) == 3,
            'THREE_EXPLICIT_RPC_UPSTREAMS_REQUIRED')
    return full


def read_original_source(value):
    path = absolute(value['path'])
    expected = value['witness']
    parent = private_directory(path.parent, decimal(expected['uid']), decimal(expected['gid']))
    raw, digest, ident, info = read_file(path, MAX_CONFIG)
    require(str(len(raw)) == value['bytes'] and digest == value['sha256'] and witness(info) == expected,
            'ORIGINAL_SOURCE_PIN_OR_WITNESS_MISMATCH')
    require(private_directory(path.parent, info.st_uid, info.st_gid) == parent,
            'ORIGINAL_SOURCE_DIRECTORY_CHANGED')
    return raw, ident, parent


def read_original_unit(value):
    raw, digest, ident, _ = read_file(Path(UNIT), 65536)
    require(digest == value['sha256'], 'ORIGINAL_UNIT_PIN_MISMATCH')
    # The independently pinned original fragment must still describe the
    # original Caddyfile startup. Installing the generated drop-in is separate.
    lines = raw.decode('utf-8').splitlines()
    observed, section = {}, ''
    for line in lines:
        line = line.strip()
        if line.startswith('[') and line.endswith(']'):
            section = line
        elif section == '[Service]' and '=' in line and not line.startswith(('#', ';')):
            key, val = line.split('=', 1)
            if key in ('User', 'Group', 'ExecStart', 'ExecReload'):
                observed.setdefault(key, []).append(val)
    expected = {'User': 'caddy', 'Group': 'caddy', 'ExecStart': ' '.join(ARGV),
                'ExecReload': '/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force'}
    require(all(observed.get(k) == [v] for k, v in expected.items()), 'ORIGINAL_UNIT_CADDYFILE_SEMANTICS_REQUIRED')
    return ident


def proc_bytes(path, maximum):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode), 'ORIGINAL_PROC_FILE_REQUIRED')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as source:
        require(identity(before) == identity(os.fstat(source.fileno())), 'ORIGINAL_PROCESS_CHANGED')
        raw = source.read(maximum + 1)
        require(len(raw) <= maximum and identity(before) == identity(os.fstat(source.fileno()))
                and identity(before) == identity(path.lstat()), 'ORIGINAL_PROCESS_CHANGED')
    return raw


def observe_process(expected, uid, gid):
    base = Path('/proc') / expected['pid']
    owner = base.lstat()
    require(stat.S_ISDIR(owner.st_mode), 'ORIGINAL_CADDY_PROCESS_DIRECTORY_REQUIRED')
    # /proc inode ownership can depend on dumpability/capabilities. Bind the
    # actual process credentials rather than treating procfs ownership as UID.
    status = proc_bytes(base / 'status', 65536).splitlines()
    for name, expected_id in ((b'Uid:', uid), (b'Gid:', gid)):
        values = [line.split()[1:] for line in status if line.startswith(name)]
        require(len(values) == 1 and len(values[0]) == 4
                and all(x.isdigit() and int(x) == expected_id for x in values[0]),
                'ORIGINAL_CADDY_PROCESS_OWNER_MISMATCH')
    start = proc_bytes(base / 'stat', 65536)
    require(start.startswith((expected['pid'] + ' (caddy) ').encode()), 'ORIGINAL_CADDY_PROCESS_NAME_MISMATCH')
    fields = start.rsplit(b') ', 1)[1].split()
    require(len(fields) > 19 and fields[19].decode('ascii') == expected['startTicks'],
            'ORIGINAL_CADDY_PROCESS_START_CHANGED')
    require(proc_bytes(base / 'cmdline', 65536) == b'\0'.join(x.encode() for x in ARGV) + b'\0',
            'ORIGINAL_CADDY_PROCESS_ARGV_CHANGED')
    require(os.readlink(base / 'exe') == '/usr/bin/caddy', 'ORIGINAL_CADDY_PROCESS_EXECUTABLE_CHANGED')
    live, disk = (base / 'exe').stat(), Path('/usr/bin/caddy').stat()
    require((live.st_dev, live.st_ino) == (disk.st_dev, disk.st_ino)
            and identity(owner) == identity(base.lstat()), 'ORIGINAL_CADDY_PROCESS_EXECUTABLE_CHANGED')


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable(path, raw, maximum):
    require(type(raw) is bytes and 0 < len(raw) <= maximum, 'OUTPUT_BOUND_REQUIRED')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    sync_directory(path.parent)
    observed, digest, _, _ = read_file(path, maximum, True)
    require(observed == raw, 'EXCLUSIVE_OUTPUT_READBACK_MISMATCH')
    return digest


def prepare(args):
    destination = absolute(args.output_dir)
    parent = destination.parent
    parent_identity = private_directory(parent, os.geteuid())
    require(not any(os.path.lexists(p) for p in (destination, Path(str(destination) + '.partial'),
                Path(str(destination) + '.UNKNOWN'))), 'EXISTING_OUTPUT_OR_UNKNOWN_MUST_BE_RETAINED')
    helper, helper_path, helper_identity = load_helper(args.json_helper_sha256)
    binding_path = absolute(args.binding)
    binding_raw, binding_digest, binding_identity, _ = read_file(binding_path, 65536, True)
    require(binding_digest == pin(args.binding_sha256), 'INDEPENDENT_BINDING_PIN_MISMATCH')
    binding = helper['parse_json'](binding_raw, 65536)
    full = validate_binding(binding)
    first, first_identity, source_parent = read_original_source(binding['source'])
    second, second_identity, second_parent = read_original_source(binding['secondRead'])
    require(first == second and source_parent == second_parent, 'ORIGINAL_TWO_READS_DIFFER')
    config = helper['parse_config'](first)
    candidate_config = helper['project_rpc_config'](config, binding['rpcUpstreams'])
    candidate = helper['canonical_config'](candidate_config)
    dropin = helper['render_dropin']()
    unit_identity = read_original_unit(binding['originalUnit'])
    uid, gid = (decimal(binding['source']['witness'][k]) for k in ('uid', 'gid'))
    observe_process(binding['originalProcess'], uid, gid)
    require(private_directory(parent, os.geteuid()) == parent_identity, 'OUTPUT_PARENT_CHANGED')
    os.mkdir(destination, 0o700)
    sync_directory(parent)
    private_directory(destination, os.geteuid())
    encode = helper['canonical_config']
    intent = dict(version=binding['version'], status='unknown', automaticRetry=False,
        bindingSHA256=binding_digest, jsonHelperSHA256=args.json_helper_sha256)
    if full:
        intent.update(transactionId=binding['transactionId'], commit=binding['commit'])
    durable(destination / 'intent.json', encode(intent), 65536)
    # No cleanup after reservation: all partial bytes and UNKNOWN are retained.
    original_sha = durable(destination / 'original.json', first, MAX_CONFIG)
    candidate_sha = durable(destination / 'candidate.json', candidate, MAX_CONFIG)
    dropin_sha = durable(destination / 'ynx-chain-json.conf', dropin, 65536)
    manifest = dict(binding)
    manifest['baseline'] = dict(configPath=CONFIG, configSHA256=original_sha,
        semanticSHA256=helper['semantic_hash'](config),
        candidateSemanticSHA256=helper['semantic_hash'](candidate_config),
        dropInPath=DROPIN, dropInSHA256=dropin_sha)
    manifest_raw = encode(manifest)
    manifest_sha = durable(destination / ('manifest.json' if full else 'BASELINE_DATA.json'), manifest_raw, 65536)
    # Re-read every original, including raw SHA and nanosecond metadata. Neither
    # a stable process nor two copied files claim a tested restart or rollback.
    for name, expected_raw, expected_identity in (('source', first, first_identity),
                                                ('secondRead', second, second_identity)):
        raw, ident, current_parent = read_original_source(binding[name])
        require(raw == expected_raw and ident == expected_identity and current_parent == source_parent,
                'ORIGINAL_SOURCE_CHANGED_AFTER_PREPARATION')
    require(read_original_unit(binding['originalUnit']) == unit_identity, 'ORIGINAL_UNIT_CHANGED_AFTER_PREPARATION')
    observe_process(binding['originalProcess'], uid, gid)
    raw, digest, ident, _ = read_file(binding_path, 65536, True)
    require(raw == binding_raw and digest == binding_digest and ident == binding_identity,
            'ORIGINAL_BINDING_CHANGED_AFTER_PREPARATION')
    _, digest, ident, _ = read_file(helper_path, 256 << 10)
    require(digest == args.json_helper_sha256 and ident == helper_identity,
            'CADDY_JSON_HELPER_CHANGED_AFTER_PREPARATION')
    receipt = dict(version='YNX-CADDY-JSON-INGRESS-PREPARATION/v1',
        status='source-data-prepared', bundlePath=str(destination),
        bindingSHA256=binding_digest, jsonHelperSHA256=args.json_helper_sha256,
        manifestSHA256=manifest_sha if full else None, baselineDataSHA256=None if full else manifest_sha,
        fullCutoverManifestProduced=full, originalSHA256=original_sha, candidateSHA256=candidate_sha,
        dropInSHA256=dropin_sha, publicDeployment=False, rootGrant=False, restartRecovery=False,
        rollbackVerified=False, installed=False, serviceCommandsPerformed=False, automaticRetry=False)
    if full:
        receipt.update(transactionId=binding['transactionId'], commit=binding['commit'])
    durable(destination / 'receipt.json', encode(receipt), 65536)
    return receipt


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('binding', 'binding-sha256', 'json-helper-sha256', 'output-dir'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args(argv)
    try:
        require(all(sum(x.split('=', 1)[0] == '--' + name for x in argv) == 1
                    for name in ('binding', 'binding-sha256', 'json-helper-sha256', 'output-dir')),
                'DUPLICATE_OPTION_REFUSED')
        receipt = prepare(args)
        # Only fixed receipt metadata is public stdout. Parser exceptions,
        # private configuration values and filesystem exception text stay out.
        import json
        print(json.dumps(receipt, sort_keys=True, separators=(',', ':')))
        return 0
    except Exception as error:
        print(str(error) if isinstance(error, Refusal) else 'CADDY_JSON_SOURCE_PREPARATION_REFUSED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
