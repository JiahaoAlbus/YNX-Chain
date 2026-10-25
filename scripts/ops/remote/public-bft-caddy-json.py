#!/usr/bin/env python3
"""Exact full-JSON Caddy projection. No service calls and no config body output."""
import argparse
import copy
import hashlib
import json
import os
import re
import stat
import sys

VERSION = 'YNX-CADDY-JSON-INGRESS-SOURCE/v1'
MAX_CONFIG_BYTES = 16 << 20
CONFIG_PATH = '/etc/caddy/ynx-chain.json'
DROP_IN_PATH = '/etc/systemd/system/caddy.service.d/ynx-chain-json.conf'
UNIT_PATH = '/usr/lib/systemd/system/caddy.service'
OLD_ARGV = ['/usr/bin/caddy', 'run', '--environ', '--config', '/etc/caddy/Caddyfile']
HOSTS = {'rpc-testnet.ynxweb4.com', 'rpc.ynxweb4.com', 'evm.ynxweb4.com'}


class SourceValidationError(ValueError):
    """Messages are fixed public diagnostics, never input values."""


def _reject(message):
    raise SourceValidationError(message)


def _unique(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            _reject('duplicate JSON field')
        out[key] = value
    return out


def _json(raw, maximum):
    if type(raw) is not bytes or not raw or len(raw) > maximum or b'\0' in raw:
        _reject('JSON size or encoding bound')
    return json.loads(raw.decode('utf-8'), object_pairs_hook=_unique,
                      parse_constant=lambda _: _reject('nonfinite JSON value'))


def parse_json(raw, maximum=65536):
    return _json(raw, maximum)


def parse_config(raw):
    value = _json(raw, MAX_CONFIG_BYTES)
    if type(value) is not dict or type(value.get('apps')) is not dict:
        _reject('Caddy full JSON object required')
    http = value['apps'].get('http')
    if type(http) is not dict or type(http.get('servers')) is not dict or not http['servers']:
        _reject('Caddy HTTP servers required')
    for server in http['servers'].values():
        if type(server) is not dict or type(server.get('routes')) is not list:
            _reject('Caddy server routes required')
    return value


def canonical_config(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                      allow_nan=False).encode() + b'\n'


def semantic_hash(value):
    return hashlib.sha256(canonical_config(value)[:-1]).hexdigest()


def render_dropin():
    return (b'[Service]\nExecStart=\n'
            b'ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/ynx-chain.json\n'
            b'ExecReload=\n'
            b'ExecReload=/usr/bin/caddy reload --config /etc/caddy/ynx-chain.json --force\n')


def _closed(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        _reject('closed JSON fields differ')


def _decimal(value, positive=False):
    if type(value) is not str or not re.fullmatch(r'0|[1-9][0-9]*', value):
        _reject('canonical decimal string required')
    number = int(value)
    if number > (1 << 64) - 1 or (positive and number == 0):
        _reject('decimal bound')
    return number


def _pin(value, width=64):
    if type(value) is not str or not re.fullmatch('[0-9a-f]{%d}' % width, value) or set(value) == {'0'}:
        _reject('independent nonzero lowercase pin required')
    return value


def _path(value):
    if type(value) is not str or not re.fullmatch(r'/[A-Za-z0-9._/-]+', value) or os.path.normpath(value) != value or '..' in value:
        _reject('canonical absolute safe path required')
    return value


def read_regular(path, maximum=MAX_CONFIG_BYTES, mode=None, owner=None):
    """Read a single original inode, never follow a path or file symlink."""
    _path(path)
    if os.path.realpath(path) != path:
        _reject('symlink path forbidden')
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= maximum:
        _reject('original bounded single-link regular file required')
    if mode is not None and stat.S_IMODE(before.st_mode) != mode:
        _reject('original file permission differs')
    if before.st_mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX):
        _reject('special file permissions forbidden')
    if owner is not None and before.st_uid != owner:
        _reject('original file owner differs')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        if _identity(opened) != _identity(before):
            _reject('original file changed before open')
        raw = b''
        while len(raw) <= maximum:
            part = os.read(fd, min(65536, maximum + 1 - len(raw)))
            if not part:
                break
            raw += part
        if _identity(os.fstat(fd)) != _identity(opened) or _identity(os.lstat(path)) != _identity(before) or len(raw) != before.st_size:
            _reject('original file changed during read')
        return raw, before
    finally:
        os.close(fd)


def _identity(info):
    # Reading can legitimately update atime; every identity/content witness
    # that another writer can change remains part of the comparison.
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def file_witness(info):
    return dict(uid=str(info.st_uid), gid=str(info.st_gid), mode=format(stat.S_IMODE(info.st_mode), 'o'),
                nlink=str(info.st_nlink), device=str(info.st_dev), inode=str(info.st_ino),
                mtimeNs=str(info.st_mtime_ns), ctimeNs=str(info.st_ctime_ns))


def project_rpc_config(value, rpc_upstreams):
    if type(rpc_upstreams) is not list or len(rpc_upstreams) != 3:
        _reject('exact three approved RPC and EVM upstreams required')
    candidate = copy.deepcopy(value)
    pointers, hosts = set(), set()
    for record in rpc_upstreams:
        _closed(record, ['pointer', 'host', 'from', 'to'])
        pointer, host = record['pointer'], record['host']
        if host not in HOSTS or host in hosts or record['from'] != '127.0.0.1:6420' or record['to'] != '127.0.0.1:27620':
            _reject('RPC host or approved upstream differs')
        if type(pointer) is not str or not re.fullmatch(r'/apps/http/servers/[A-Za-z0-9_-]+/routes/(0|[1-9][0-9]*)(?:/[A-Za-z0-9_-]+|/(?:0|[1-9][0-9]*))*/dial', pointer) or pointer in pointers:
            _reject('canonical exact RPC JSON pointer required')
        # All actual pointers use plain keys; escapes and alternate encodings
        # are refused rather than admitting multiple names for the same leaf.
        parts = pointer[1:].split('/')
        current = candidate
        ancestors = []
        for part in parts[:-1]:
            ancestors.append(current)
            if type(current) is list:
                if not re.fullmatch(r'0|[1-9][0-9]*', part) or int(part) >= len(current):
                    _reject('RPC pointer index absent')
                current = current[int(part)]
            elif type(current) is dict and part in current:
                current = current[part]
            else:
                _reject('RPC pointer absent')
        if type(current) is not dict or current.get('dial') != record['from'] or parts[-3] != 'upstreams' or not parts[-2].isdigit():
            _reject('RPC pointer is not the original upstream dial')
        handler = ancestors[-2] if len(ancestors) >= 2 else None
        if type(handler) is not dict or handler.get('handler') != 'reverse_proxy' or 'dynamic_upstreams' in handler:
            _reject('explicit reverse_proxy upstream required')
        scoped_hosts = []
        for ancestor in ancestors:
            if type(ancestor) is dict and 'match' in ancestor:
                matches = ancestor['match']
                if type(matches) is not list or not matches:
                    _reject('invalid ancestor match')
                if any(type(match) is dict and 'host' in match for match in matches) and any(type(match) is not dict or match.get('host') != [host] for match in matches):
                    _reject('ambiguous OR matcher RPC host scope')
                for match in matches:
                    if type(match) is not dict:
                        _reject('invalid ancestor match')
                    if 'host' in match:
                        if match['host'] != [host]:
                            _reject('mixed or different RPC host scope')
                        scoped_hosts.append(host)
        if not scoped_hosts:
            _reject('RPC pointer lacks explicit host scope')
        current['dial'] = record['to']
        pointers.add(pointer)
        hosts.add(host)
    if hosts != HOSTS:
        _reject('all three approved RPC and EVM hosts required')
    # A residual 6420 dial under either approved host would yield a partial
    # switch. Other hosts and 6433 routes remain exactly untouched.
    def scan(node, scoped=False, original=False):
        if type(node) is dict:
            matches = node.get('match', [])
            scoped = scoped or (type(matches) is list and any(type(m) is dict and type(m.get('host')) is list and HOSTS.intersection(m['host']) for m in matches))
            if scoped and (node.get('dial') == '127.0.0.1:6420' or 'dynamic_upstreams' in node):
                if not original or 'dynamic_upstreams' in node:
                    _reject('unprojected RPC or dynamic upstream remains')
            if original and scoped and node.get('dial') == '127.0.0.1:27620':
                _reject('pre-existing candidate upstream is not this attempt')
            for child in node.values():
                scan(child, scoped, original)
        elif type(node) is list:
            for child in node:
                scan(child, scoped, original)
    scan(value, original=True)
    scan(candidate)
    return candidate


def validate_manifest(raw, expected=None):
    value = _json(raw, 65536)
    _closed(value, ['version', 'transactionId', 'commit', 'operatorPlanSHA256', 'runtimeCommit',
                    'runtimeSOURCEsha256', 'gatewaySHA256', 'source', 'secondRead',
                    'originalProcess', 'originalUnit', 'baseline', 'rpcUpstreams'])
    if value['version'] != VERSION or type(value['transactionId']) is not str or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{7,127}', value['transactionId']):
        _reject('source version or transaction differs')
    _pin(value['commit'], 12)
    _pin(value['runtimeCommit'], 40)
    if not value['runtimeCommit'].startswith(value['commit']):
        _reject('runtime source commit differs')
    for name in ['operatorPlanSHA256', 'runtimeSOURCEsha256', 'gatewaySHA256']:
        _pin(value[name])
    if expected and any(value.get(key) != item for key, item in expected.items()):
        _reject('source differs from independent consumer pins')
    reads = []
    for name in ['source', 'secondRead']:
        item = value[name]
        _closed(item, ['path', 'bytes', 'sha256', 'witness'])
        _pin(item['sha256'])
        _decimal(item['bytes'], True)
        _closed(item['witness'], ['uid', 'gid', 'mode', 'nlink', 'device', 'inode', 'mtimeNs', 'ctimeNs'])
        for field, entry in item['witness'].items():
            _decimal(entry, field in ['nlink', 'inode'])
        if item['witness']['mode'] != '600' or item['witness']['nlink'] != '1':
            _reject('private original source witness required')
        parent = os.lstat(os.path.dirname(_path(item['path'])))
        if not stat.S_ISDIR(parent.st_mode) or stat.S_IMODE(parent.st_mode) != 0o700 or parent.st_uid != int(item['witness']['uid']) or parent.st_gid != int(item['witness']['gid']):
            _reject('private original source parent differs')
        body, info = read_regular(item['path'], mode=0o600)
        if file_witness(info) != item['witness'] or str(len(body)) != item['bytes'] or hashlib.sha256(body).hexdigest() != item['sha256']:
            _reject('original source witness or bytes differs')
        reads.append(body)
    if value['source']['path'] == value['secondRead']['path'] or reads[0] != reads[1]:
        _reject('two independent equal original reads required')
    if any(value['source']['witness'][key] != value['secondRead']['witness'][key] for key in ['uid', 'gid']):
        _reject('original retained source owners differ')
    process = value['originalProcess']
    _closed(process, ['pid', 'startTicks', 'argv'])
    if _decimal(process['pid'], True) < 2 or not _decimal(process['startTicks'], True) or process['argv'] != OLD_ARGV:
        _reject('original Caddy process identity differs')
    unit = value['originalUnit']
    _closed(unit, ['path', 'sha256'])
    if unit['path'] != UNIT_PATH:
        _reject('original unit path differs')
    _pin(unit['sha256'])
    baseline = value['baseline']
    _closed(baseline, ['configPath', 'configSHA256', 'semanticSHA256', 'candidateSemanticSHA256', 'dropInPath', 'dropInSHA256'])
    original = parse_config(reads[0])
    projected = project_rpc_config(original, value['rpcUpstreams'])
    if baseline != dict(configPath=CONFIG_PATH, configSHA256=hashlib.sha256(reads[0]).hexdigest(),
                        semanticSHA256=semantic_hash(original), candidateSemanticSHA256=semantic_hash(projected), dropInPath=DROP_IN_PATH,
                        dropInSHA256=hashlib.sha256(render_dropin()).hexdigest()):
        _reject('independent persistent JSON baseline differs')
    return value, reads[0], canonical_config(projected)


def _proc_start(path):
    with open(path, 'rb') as handle:
        raw = handle.read(65537)
    if len(raw) > 65536:
        _reject('process stat bound')
    fields = raw.rsplit(b') ', 1)[-1].split()
    if len(fields) < 20 or not fields[19].isdigit():
        _reject('process start unavailable')
    return fields[19].decode()


def validate_exec_observation(actual, argv):
    """Accept exactly one systemctl Exec command and bounded public metadata.

    Metadata describes an observation, not authority to alter the argv. Empty
    metadata is supported for source fixtures; real systemd may provide each
    of the five known fields once, in any order. No shell text is evaluated.
    """
    if (type(actual) is not str or len(actual) > 65536 or type(argv) is not list or not argv
            or any(type(arg) is not str or not arg or re.search(r'[\s;{}\x00-\x1f\x7f]', arg) for arg in argv)
            or any(ord(char) < 32 or ord(char) == 127 for char in actual)):
        _reject('invalid structured Exec observation')
    prefix = '{ path=' + argv[0] + ' ; argv[]=' + ' '.join(argv) + ' ; ignore_errors=no ; '
    if (not actual.startswith(prefix) or not actual.endswith('}')
            or actual.count('{') != 1 or actual.count('}') != 1):
        _reject('structured Exec command or closed tail differs')
    tail = actual[len(prefix):-1]
    if not tail:
        return
    if tail.endswith(' ; '):
        fields = tail[:-3]
    elif tail.endswith(' '):
        # systemctl commonly omits the final metadata semicolon; the older
        # source fixture includes it. Both still require the single brace.
        fields = tail[:-1]
    else:
        _reject('structured Exec metadata delimiter differs')
    values = {}
    timestamp = (r'\[(?:n/a|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [0-9]{4}-'
                 r'(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]) '
                 r'(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})? '
                 r'(?:[A-Za-z][A-Za-z0-9_+/-]{0,31}|[+-][0-9]{2}(?::?[0-9]{2})?))\]')
    patterns = dict(start_time=timestamp, stop_time=timestamp,
                    pid=r'(?:0|[1-9][0-9]{0,9})',
                    code=r'(?:\(null\)|exited|killed|dumped|trapped|stopped|continued)',
                    status=r'(?:0|[1-9][0-9]{0,9})/(?:0|[1-9][0-9]{0,9}|[A-Z][A-Z0-9_+-]{0,63})')
    for field in fields.split(' ; '):
        key, separator, value = field.partition('=')
        if (not separator or key not in patterns or key in values
                or re.fullmatch(patterns[key], value) is None):
            _reject('unknown duplicate or malformed structured Exec metadata')
        if key == 'pid' and int(value) > 0xffffffff:
            _reject('structured Exec metadata PID overflow')
        values[key] = value


def guard(value, original, candidate, phase, root, observed, loaded):
    """Read-only guard; observed systemd fields come from exact caller queries."""
    config = root + CONFIG_PATH
    dropin = root + DROP_IN_PATH
    unit = root + UNIT_PATH
    program = root + '/usr/bin/caddy'
    expected_raw = original if phase == 'original' else candidate
    for parent in [os.path.dirname(config), os.path.dirname(dropin)]:
        info = os.lstat(parent)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
            _reject('persistent JSON source parent is writable or foreign')
    raw, config_stat = read_regular(config, mode=0o600, owner=int(value['source']['witness']['uid']))
    if config_stat.st_gid != int(value['source']['witness']['gid']) or raw != expected_raw:
        _reject('persistent JSON config differs from pinned projection')
    drop_raw, _ = read_regular(dropin, 65536, 0o644, os.geteuid())
    unit_raw, _ = read_regular(unit, 65536, 0o644, os.geteuid())
    if drop_raw != render_dropin() or hashlib.sha256(unit_raw).hexdigest() != value['originalUnit']['sha256']:
        _reject('persistent JSON dropin or original unit differs')
    if observed['fragment'] != unit or observed['dropins'] != dropin or observed['user'] != 'caddy' or observed['group'] != 'caddy':
        _reject('loaded systemd source differs from persistent JSON source')
    for field, argv in [('start', [program, 'run', '--environ', '--config', config]),
                        ('reload', [program, 'reload', '--config', config, '--force'])]:
        validate_exec_observation(observed[field], argv)
    pid = observed['pid']
    if not re.fullmatch(r'[1-9][0-9]*', pid) or int(pid) < 2:
        _reject('Caddy running PID unavailable')
    proc = root + '/proc/' + pid
    start = _proc_start(proc + '/stat')
    executable = os.stat(proc + '/exe')
    fixed = os.stat(program)
    if (executable.st_dev, executable.st_ino) != (fixed.st_dev, fixed.st_ino):
        _reject('Caddy running executable differs')
    with open(proc + '/cmdline', 'rb') as handle:
        argv_raw = handle.read(65537)
    old = [root + item if item.startswith('/') else item for item in OLD_ARGV]
    new = [program, 'run', '--environ', '--config', config]
    encoded = lambda argv: b'\0'.join(item.encode() for item in argv) + b'\0'
    if argv_raw == encoded(old):
        if pid != value['originalProcess']['pid'] or start != value['originalProcess']['startTicks']:
            _reject('old Caddyfile argv is not original retained process')
    elif argv_raw != encoded(new):
        _reject('Caddy running argv differs from approved original or JSON source')
    if semantic_hash(parse_config(loaded)) != semantic_hash(parse_config(expected_raw)):
        _reject('whole loaded JSON differs from persistent projection')
    if (_proc_start(proc + '/stat') != start or _identity(os.stat(proc + '/exe')) != _identity(executable)
            or read_regular(config, mode=0o600)[0] != raw or read_regular(dropin, 65536, 0o644, os.geteuid())[0] != drop_raw
            or read_regular(unit, 65536, 0o644, os.geteuid())[0] != unit_raw):
        _reject('Caddy source changed during readback')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['guard', 'project', 'rollback-evidence'])
    for name in ['manifest', 'manifest-sha256', 'transaction-id', 'commit', 'operator-plan-sha256',
                 'runtime-commit', 'runtime-source-sha256', 'gateway-sha256']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--root', default='')
    parser.add_argument('--phase', choices=['original', 'candidate'], default='original')
    parser.add_argument('--output')
    parser.add_argument('--attempt')
    for name in ['fragment', 'dropins', 'user', 'group', 'start', 'reload', 'pid']:
        parser.add_argument('--' + name)
    args = parser.parse_args()
    root = args.root
    if root and (root == '/' or os.environ.get('PUBLIC_BFT_INGRESS_SOURCE_TEST_ONLY') != 'yes' or os.path.realpath(root) != root or not os.path.isdir(root)):
        _reject('alternate root is source-test-only')
    parent = os.lstat(os.path.dirname(_path(args.manifest)))
    if not stat.S_ISDIR(parent.st_mode) or stat.S_IMODE(parent.st_mode) != 0o700 or parent.st_uid != os.geteuid():
        _reject('original manifest requires private same-owner parent')
    raw, _ = read_regular(args.manifest, 65536, 0o600, os.geteuid())
    if hashlib.sha256(raw).hexdigest() != _pin(args.manifest_sha256):
        _reject('independent Caddy source manifest pin differs')
    expected = dict(transactionId=args.transaction_id, commit=args.commit, operatorPlanSHA256=args.operator_plan_sha256,
                    runtimeCommit=args.runtime_commit, runtimeSOURCEsha256=args.runtime_source_sha256, gatewaySHA256=args.gateway_sha256)
    value, original, candidate = validate_manifest(raw, expected)
    if args.action == 'guard':
        loaded = sys.stdin.buffer.read(MAX_CONFIG_BYTES + 1)
        guard(value, original, candidate, args.phase, root,
              {name: getattr(args, name) for name in ['fragment', 'dropins', 'user', 'group', 'start', 'reload', 'pid']}, loaded)
        validate_manifest(raw, expected)
        if read_regular(args.manifest, 65536, 0o600, os.geteuid())[0] != raw:
            _reject('independent source manifest changed during readback')
    elif args.action == 'project':
        if not args.output:
            _reject('exclusive projection output required')
        fd = os.open(_path(args.output), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(candidate)
            handle.flush()
            os.fsync(handle.fileno())
    else:
        receipt_raw, _ = read_regular(_path(args.attempt) + '/switch.json', 65536, 0o600, os.geteuid())
        receipt = _json(receipt_raw, 65536)
        binding = dict(expected, version='YNX-SINGLE-APP-GATEWAY-INGRESS/v1', mode='single-app-gateway-json', bftRelease='ynx-bft-gateway-'+args.commit,
                       caddySourceManifestSHA256=args.manifest_sha256, sourceSHA256=value['source']['sha256'],
                       baselineSemanticSHA256=value['baseline']['semanticSHA256'], candidateSemanticSHA256=semantic_hash(parse_config(candidate)),
                       dropInSHA256=value['baseline']['dropInSHA256'], ingress='bft', publicCutoverReady=True, rolledBack=False, rpcOnly=True,
                       sourceTestOnly=bool(root), publicIngressChanged=not bool(root), caddyRestartVerified=False, ecosystemContinuityVerified=False)
        if any(type(receipt.get(key)) != type(item) or receipt[key] != item for key, item in binding.items()):
            _reject('rollback is not original completed JSON switch')
        for name, body in [('backups/ynx-chain.json', original), ('candidates/ynx-chain.json', candidate)]:
            if read_regular(args.attempt + '/' + name, mode=0o600)[0] != body:
                _reject('original JSON attempt material differs')
        for name, key in [('backups/candidate.env', 'originalEnvironmentSHA256'), ('candidates/candidate.env', 'activatedEnvironmentSHA256')]:
            if hashlib.sha256(read_regular(args.attempt + '/' + name, 65536)[0]).hexdigest() != receipt.get(key):
                _reject('original gateway environment differs')
        for name, key, files in [('original-checksums.txt', 'authoritativeChecksumsSha256', ['backups/candidate.env', 'backups/ynx-chain.json']),
                                 ('candidate-checksums.txt', 'candidateChecksumsSha256', ['candidates/candidate.env', 'candidates/ynx-chain.json'])]:
            manifest_raw = read_regular(args.attempt + '/' + name, 65536)[0]
            exact = b''.join((hashlib.sha256(read_regular(args.attempt + '/' + item)[0]).hexdigest()+'  '+args.attempt+'/'+item+'\n').encode() for item in files)
            if hashlib.sha256(manifest_raw).hexdigest() != receipt.get(key) or manifest_raw != exact:
                _reject('original JSON checksum manifest differs')
    print(json.dumps(dict(sourceSHA256=value['source']['sha256'], baselineSemanticSHA256=value['baseline']['semanticSHA256'],
                          candidateSemanticSHA256=semantic_hash(parse_config(candidate)), dropInSHA256=value['baseline']['dropInSHA256']), separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except SourceValidationError as error:
        print('CADDY_JSON_SOURCE_VALIDATION_FAILED: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # Never print input JSON, potential TLS material, argv, file paths or
        # arbitrary decoder exception text. Preserve the public error class.
        print('CADDY_JSON_SOURCE_VALIDATION_FAILED: ' + type(error).__name__ +
              (' errno=' + str(error.errno) if isinstance(error, OSError) else ''), file=sys.stderr)
        sys.exit(1)
