#!/usr/bin/env python3
"""Read-only qualification of an independently approved original native process.

No service operation, environment evaluation, state decoding, key read or write.
The release is a build label; it never selects an executable/install directory.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys


def require(ok, message):
    if not ok:
        raise ValueError(message)


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate public source field')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda _: require(False, 'invalid JSON constant'))


def path(value):
    require(type(value) is str and re.fullmatch('/[A-Za-z0-9._/-]+', value)
            and str(Path(value)) == value and '..' not in Path(value).parts,
            'canonical original absolute path required')
    return value


def sha(value):
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value)
            and value != '0' * 64, 'independent nonzero SHA256 required')
    return value


def source_identity(value, full_commit, release, binary_pin, tx, candidate):
    require(re.fullmatch('[0-9a-f]{40}', full_commit) and full_commit != '0' * 40,
            'original full native commit required')
    require(release in ('ynx-chain-' + full_commit[:12], 'ynx-network-surgical-' + full_commit[:12]),
            'original native release/commit mismatch')
    sha(binary_pin)
    require(re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', tx)
            and re.fullmatch('[0-9a-f]{12}', candidate), 'invalid candidate transaction identity')
    fields = {'statePath', 'integrityMarkerPath', 'pauseMarkerPath', 'mutationMarkerPath'}
    require(type(value) is dict and set(value) == fields, 'closed original native source record required')
    for name in ('statePath', 'integrityMarkerPath', 'pauseMarkerPath', 'mutationMarkerPath'):
        path(value[name])
    state = Path(value['statePath'])
    require(state.name == 'devnet-state.json'
            and value['integrityMarkerPath'] == str(state.parent / 'devnet-state.integrity-version'),
            'original native state/integrity paths differ')
    require(len(set(value.values())) == len(fields), 'original source/marker paths conflict')
    return value


class OriginalProcess:
    environment = {'PATH': '/usr/bin:/bin'}

    def command(self, argv, maximum=65536):
        # Neither redirect nor caller-supplied endpoint/program is accepted.
        result = subprocess.run(argv, env=self.environment, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=15, check=True)
        require(len(result.stdout) <= maximum, 'original process observation exceeds bound')
        return result.stdout

    def show(self):
        names = ('ActiveState', 'SubState', 'MainPID', 'FragmentPath', 'DropInPaths', 'ExecStart', 'EnvironmentFiles')
        raw = self.command(['systemctl', 'show', 'ynx-chaind.service']
                           + ['--property=' + name for name in names]).decode('utf-8')
        pairs = [line.split('=', 1) for line in raw.splitlines()]
        value = unique(pairs)
        require(set(value) == set(names), 'incomplete loaded native unit observation')
        return value

    def read(self, filename, maximum, proc=False):
        if not proc:
            require(os.path.realpath(filename) == filename, 'symlink in original source/configuration path')
        with open(filename, 'rb') as stream:
            before = os.fstat(stream.fileno())
            require(stat.S_ISREG(before.st_mode), 'original regular file required')
            if not proc:
                require(before.st_nlink == 1 and not before.st_mode & 0o022, 'unsafe original file metadata')
            raw = stream.read(maximum + 1)
            after = os.fstat(stream.fileno())
        require(len(raw) <= maximum and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'original file changed or exceeds bound')
        return raw

    def executable(self, pid):
        filename = '/proc/' + pid + '/exe'
        target = os.readlink(filename)
        path(target)
        require(os.path.realpath(target) == target, 'running original executable path changed/deleted')
        raw = self.read(filename, 128 << 20, proc=True)
        info = os.stat(filename)
        require(info.st_nlink == 1 and not info.st_mode & 0o022, 'unsafe running original executable')
        return target, hashlib.sha256(raw).hexdigest(), str(info.st_dev) + ':' + str(info.st_ino)

    def canonical(self, filename):
        return os.path.realpath(filename)

    def status(self):
        return decode(self.command(['curl', '--disable', '--noproxy', '*', '--request', 'GET',
            '--connect-timeout', '5', '--max-time', '10', '--max-redirs', '0', '--max-filesize', '65536',
            '--fail', '--silent', '--show-error', 'http://127.0.0.1:6420/status']))

    def listener(self):
        raw = self.command(['ss', '-H', '-ltnp', 'sport = :6420']).decode('utf-8')
        rows = raw.splitlines()
        require(rows and all('pid=' in row for row in rows), 'native RPC listener process is unobservable')
        return set(re.findall(r'pid=([1-9][0-9]*)', raw))


def inspect(source, full_commit, release, binary_pin, role, process):
    require(role in ('primary', 'singapore', 'silicon-valley', 'seoul'), 'invalid original role')
    selected = ('YNX_DATA_DIR', 'YNX_MUTATION_FREEZE_FILE', 'YNX_BLOCK_PRODUCTION_PAUSE_FILE')
    unit = process.show()
    require(unit['ActiveState'] == 'active' and unit['SubState'] == 'running'
            and re.fullmatch('[1-9][0-9]*', unit['MainPID']) and int(unit['MainPID']) > 1,
            'original native unit has no active MainPID')
    require(unit['FragmentPath'] == '/etc/systemd/system/ynx-chaind.service' and unit['DropInPaths'] == '',
            'unsupported original native unit/drop-in identity')
    require(unit['EnvironmentFiles'] == '/etc/ynx/ynx-chaind.env (ignore_errors=no)',
            'loaded original native environment differs')
    pid = unit['MainPID']
    def observation():
        require(process.listener() == {pid}, 'native RPC listener is not the approved unit MainPID')
        executable = process.executable(pid)
        require(executable[1] == binary_pin, 'running original native executable differs from approved SHA256')
        prefix = '/proc/' + pid + '/'
        command = process.read(prefix + 'cmdline', 65536, proc=True)
        environment = process.read(prefix + 'environ', 262144, proc=True)
        raw_stat = process.read(prefix + 'stat', 65536, proc=True)
        parts = raw_stat.rsplit(b') ', 1)
        require(len(parts) == 2 and len(parts[1].split()) >= 20, 'invalid original process start identity')
        return executable, command, environment, parts[1].split()[19]
    before = observation()
    argv = before[1].decode('utf-8').split('\0')
    require(argv[-1] == '', 'invalid original process argv')
    argv.pop()
    require(argv and process.canonical(path(argv[0])) == before[0][0], 'loaded native argv/executable mismatch')
    match = re.fullmatch(r'\{ path=([^ ;]+) ; argv\[\]=([^;]+) ; ignore_errors=no ; [^{}]*\}', unit['ExecStart'])
    require(match and match[1] == argv[0] and shlex.split(match[2].strip()) == argv,
            'loaded native ExecStart does not describe the actual process')
    # Only these nonsecret values are decoded; no complete env/command/body is
    # logged or returned. Never source/eval the original EnvironmentFile.
    env = {}
    for entry in before[2].split(b'\0'):
        key, sep, value = entry.partition(b'=')
        if sep and key in tuple(name.encode() for name in selected):
            name = key.decode()
            require(name not in env, 'duplicate original process configuration')
            env[name] = value.decode('utf-8')
    configured = {}
    for line in process.read('/etc/ynx/ynx-chaind.env', 262144).splitlines():
        key, sep, value = line.partition(b'=')
        if sep and key in tuple(name.encode() for name in selected):
            key = key.decode('utf-8')
            require(key not in configured, 'duplicate native environment configuration')
            configured[key] = value.decode('utf-8')
    require(all(configured.get(name) == env.get(name) and name in env for name in selected),
            'loaded native environment differs from original configured paths')
    # Go flag accepts one or two leading hyphens. Only these known path
    # overrides are supported here; unknown flags/positionals are refused
    # rather than guessing where the original parser stopped consuming flags.
    options, index = {}, 1
    while index < len(argv):
        arg = argv[index]
        if arg == '--':
            require(index == len(argv) - 1, 'unsupported native positional arguments')
            break
        require(arg.startswith('-'), 'unsupported native positional argument')
        name, equal, value = arg.lstrip('-').partition('=')
        require(not arg.startswith('---'), 'unsupported native flag spelling')
        require(name in ('data-dir', 'block-production-pause-file') and name not in options,
                'unsupported or duplicate native option')
        if not equal:
            index += 1
            require(index < len(argv), 'missing native option value')
            value = argv[index]
        options[name] = value
        index += 1
    data = options.get('data-dir', env['YNX_DATA_DIR'])
    pause = options.get('block-production-pause-file', env['YNX_BLOCK_PRODUCTION_PAUSE_FILE'])
    require(path(data) == str(Path(source['statePath']).parent)
            and process.canonical(data) == data
            and pause == source['pauseMarkerPath']
            and env['YNX_MUTATION_FREEZE_FILE'] == source['mutationMarkerPath'],
            'running original native data/marker paths differ from pinned source')
    def status():
        value = process.status()
        mode = 'authoritative_producer' if role == 'primary' else 'authoritative_follower'
        validator = {'primary': 'ynx_validator_primary', 'singapore': 'ynx_validator_singapore',
                     'silicon-valley': 'ynx_validator_silicon_valley', 'seoul': 'ynx_validator_seoul'}[role]
        require(value.get('chainId') == 6423 and value.get('nativeCurrencySymbol') == 'YNXT'
                and value.get('build', {}).get('commit') == full_commit[:12]
                and value.get('build', {}).get('release') == release
                and value.get('nodeIdentity', {}).get('replicationMode') == mode
                and value.get('nodeIdentity', {}).get('validatorAddress') == validator
                and value.get('nodeIdentity', {}).get('blockProductionEnabled') is (role == 'primary'),
                'original native status build/chain/role differs from approval')
    status()
    unit_raw = process.read(unit['FragmentPath'], 1 << 20)
    status()
    require(process.show() == unit and observation() == before, 'original native process changed during qualification')
    return dict(version='YNX-PUBLIC-BFT-NATIVE-IDENTITY/v1', role=role, authoritativeCommit=full_commit,
        authoritativeRelease=release, authoritativeBinarySha256=binary_pin, mainPid=pid,
        runningExecutablePath=before[0][0], runningExecutableDeviceInode=before[0][2],
        unitSHA256=hashlib.sha256(unit_raw).hexdigest(), dataPath=data,
        pauseMarkerPath=pause, mutationMarkerPath=source['mutationMarkerPath'],
        readOnly=True, deployment=False, nativeRootAuthorized=False)


def main(args):
    require(len(args) == 10, 'exact approved native identity/stable paths/transaction/role inputs required')
    full, release, binary, tx, candidate, role, state, integrity, pause, mutation = args
    process = OriginalProcess()
    # These paths are already projected from the protected approval. They have
    # no future H, hash or marker bytes: qualification can precede freeze/pause.
    source = source_identity(dict(statePath=state, integrityMarkerPath=integrity,
        pauseMarkerPath=pause, mutationMarkerPath=mutation), full, release, binary, tx, candidate)
    result = inspect(source, full, release, binary, role, process)
    result['transactionId'] = tx
    result['commit'] = candidate
    print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        # No failed subprocess output or secret-bearing environment is emitted.
        print('original native identity refused; retain original source/UNKNOWN: ' + type(error).__name__ + ': ' + str(error), file=sys.stderr)
        sys.exit(1)
