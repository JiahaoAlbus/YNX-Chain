#!/usr/bin/env python3
"""Finance-only, fixed artifact deployment. Run as root only on the approved host.

No account requests; no Caddy/unit edits; no state restore/overwrite. Current and
candidate use byte-identical state codecs. Backups are recovery evidence, never
automatically copied over newer user state. The source archive remains immutable.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import stat
import subprocess
import tarfile
import time
import urllib.error
import urllib.request

RUN = 'finance-sdk-7a1d2aba-20260912T104700Z'
SOURCE = '7a1d2aba6e72e5567931f451a9f069a544f58783'
ARCHIVE = Path('/tmp/' + RUN + '.tar.gz')
ARCHIVE_SHA = '60e9703135f6a46f1f563d7ff5b2ae8419fae65c664f176d6fda0b8ca0b570fc'
BINARY_SHA = 'd0cc204f851afa0aace9bba06c3048a0bd1dc623b686eac56cab8ae6e0046c77'
STAGE = Path('/opt/ynx/stage/finance') / RUN
RELEASE = Path('/opt/ynx/releases/finance') / RUN
BACKUP = STAGE / 'rollback'
CURRENT = Path('/opt/ynx/finance-current')
OLD = '/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a'
ENV = Path('/etc/ynx/finance.env')
ENV_NEXT = Path('/etc/ynx/' + RUN + '.env')
LINK_NEXT = Path('/opt/ynx/' + RUN + '.next')
STATE = Path('/var/lib/ynx/finance/state.json')
UNIT = Path('/etc/systemd/system/ynx-finance.service')
CADDY = Path('/etc/caddy/Caddyfile')
EXPECTED_ENV = '854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252'
EXPECTED_UNIT = '2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b'
EXPECTED_CADDY = '077fe80ea9aab24a32d64ba1fab3584e8aab10304e200e58d976d2c33edfb39f'
DROPIN = Path('/etc/systemd/system/ynx-finance.service.d/actions.conf')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def receipt(path):
    p = Path(path)
    if not p.exists() and not p.is_symlink():
        return {'path': str(p), 'absent': True}
    s = p.lstat()
    value = {'path': str(p), 'device': s.st_dev, 'inode': s.st_ino,
             'uid': s.st_uid, 'gid': s.st_gid, 'mode': oct(stat.S_IMODE(s.st_mode)),
             'nlink': s.st_nlink, 'bytes': s.st_size}
    if stat.S_ISREG(s.st_mode):
        value.update(type='file', sha256=digest(p.read_bytes()))
    elif stat.S_ISDIR(s.st_mode):
        value.update(type='directory')
    elif stat.S_ISLNK(s.st_mode):
        value.update(type='symlink', target=os.readlink(p))
    else:
        raise AssertionError('unsupported object type')
    return value


def regular(p, sha=None, size=None):
    r = receipt(p)
    assert r.get('type') == 'file' and r['nlink'] == 1
    assert Path(p).resolve() == Path(p)
    if sha is not None:
        assert r['sha256'] == sha
    if size is not None:
        assert r['bytes'] == size
    return r


def absent(p):
    assert not Path(p).exists() and not Path(p).is_symlink()


def save_new(p, raw, mode=0o600, gid=0):
    with open(os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, mode), 'wb') as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
        os.fchmod(f.fileno(), mode)
        os.fchown(f.fileno(), 0, gid)
    return receipt(p)


def service():
    text = subprocess.check_output(['/usr/bin/systemctl', 'show', 'ynx-finance.service',
        '-p', 'MainPID', '-p', 'NRestarts', '-p', 'ActiveState', '-p', 'SubState',
        '-p', 'User', '-p', 'Group', '-p', 'WorkingDirectory'], text=True)
    return dict(line.split('=', 1) for line in text.splitlines())


def systemctl(action):
    subprocess.run(['/usr/bin/systemctl', action, 'ynx-finance.service'],
                   check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def http(url, status=200, sha=None, expected_source=None):
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity'})
    try:
        response = urllib.request.urlopen(request, timeout=12)
    except urllib.error.HTTPError as error:
        response = error
    with response as r:
        raw = r.read(2 * 1024 * 1024)
        result = {'url': url, 'status': r.status, 'bytes': len(raw), 'sha256': digest(raw),
                  'mime': r.headers.get('Content-Type'), 'cacheControl': r.headers.get('Cache-Control')}
        assert r.status == status
        if sha is not None:
            assert result['sha256'] == sha
        if expected_source:
            assert json.loads(raw)['commit'] == expected_source
        return result


def health(base, source):
    return [http(base + '/version', expected_source=source), http(base + '/health'), http(base + '/ready')]


def env_candidate(raw):
    lines = raw.splitlines(keepends=True)
    key = b'YNX_FINANCE_WEB_DIR='
    assert sum(line.startswith(key) for line in lines) == 1
    assert sum(line.startswith(b'YNX_FINANCE_AUTH_MODE=') for line in lines) == 0
    for i, line in enumerate(lines):
        if line.startswith(key):
            assert line.rstrip(b'\r\n') == key + (OLD + '/web').encode()
            lines[i] = key + str(RELEASE / 'web').encode() + b'\n'
    candidate = b''.join(lines)
    if not candidate.endswith(b'\n'):
        candidate += b'\n'
    return candidate + b'YNX_FINANCE_AUTH_MODE=product-session-v2\n'


def deploy():
    assert os.geteuid() == 0 and os.uname().machine == 'x86_64'
    user = pwd.getpwnam('ynx')
    assert (user.pw_uid, user.pw_gid) == (995, 986)
    for parent in [STAGE.parent, RELEASE.parent, ENV.parent, CURRENT.parent]:
        assert parent.resolve() == parent and parent.is_dir()
    for target in [STAGE, RELEASE, ENV_NEXT, LINK_NEXT]:
        absent(target)
    regular(ARCHIVE, ARCHIVE_SHA, 3996021)
    original_env = regular(ENV, EXPECTED_ENV)
    regular(UNIT, EXPECTED_UNIT)
    regular(CADDY, EXPECTED_CADDY)
    original_dropin = regular(DROPIN)
    old_service = service()
    assert old_service['ActiveState'] == 'active' and old_service['SubState'] == 'running'
    assert old_service['MainPID'] == '2818779' and old_service['NRestarts'] == '0'
    assert old_service['User'] == old_service['Group'] == 'ynx'
    assert old_service['WorkingDirectory'] == str(CURRENT)
    assert CURRENT.is_symlink() and os.readlink(CURRENT) == OLD and str(CURRENT.resolve()) == OLD
    regular(Path(OLD) / 'ynx-finance', '0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f')
    assert subprocess.check_output(['/usr/bin/pgrep', '-c', '-x', 'ynx-finance'], text=True).strip() == '1'
    old_http = []
    for base in ['http://127.0.0.1:6483', 'https://finance.ynxweb4.com']:
        old_http += health(base, '3b2383f5c18ab3eb5ce7f7f6a267d2cfe7c7e6a4')
        old_http.append(http(base + '/', sha='c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53'))
    old_env = ENV.read_bytes()
    candidate_env = env_candidate(old_env)
    # Effective service environment never leaves this process or host.
    effective = dict(piece.split(b'=', 1) for piece in Path('/proc/' + old_service['MainPID'] + '/environ').read_bytes().split(b'\0') if b'=' in piece)
    assert not effective.get(b'YNX_FINANCE_DATABASE_URL')
    initial_state = receipt(STATE)
    assert initial_state.get('absent') or initial_state.get('type') == 'file'
    evidence = {'run': RUN, 'source': SOURCE, 'before': {'service': old_service, 'env': original_env,
        'unit': receipt(UNIT), 'dropin': original_dropin, 'caddy': receipt(CADDY), 'state': initial_state,
        'current': receipt(CURRENT), 'http': old_http}, 'statePolicy': 'preserve newest state; identical old/new codecs; never restore snapshot'}
    phase, switched, stopped, proc = 'STAGING', False, False, None
    STAGE.mkdir(mode=0o750)
    os.chown(STAGE, 0, 986)
    BACKUP.mkdir(mode=0o700)
    save_new(BACKUP / 'finance.env', old_env, 0o600)
    save_new(BACKUP / 'service.unit', UNIT.read_bytes(), 0o600)
    save_new(BACKUP / 'actions.conf', DROPIN.read_bytes(), 0o600)
    save_new(BACKUP / 'Caddyfile', CADDY.read_bytes(), 0o600)
    try:
        phase = 'ARCHIVE_VALIDATE'
        with tarfile.open(ARCHIVE, 'r:gz') as archive:
            members = archive.getmembers()
            names = [member.name.rstrip('/') for member in members]
            expected_names = {'ynx-finance', 'web', 'manifest.json', 'web/index.html', 'web/app.js',
                'web/wallet-auth.js', 'web/read-sources.js', 'web/styles.css', 'web/manifest.webmanifest', 'web/ynx-logo.png'}
            assert set(names) == expected_names and len(names) == len(expected_names)
            assert all(not member.issym() and not member.islnk() and (member.isfile() or member.isdir()) for member in members)
            manifest = json.load(archive.extractfile('manifest.json'))
            assert manifest['sourceCommit'] == SOURCE
            RELEASE.mkdir(mode=0o750)
            os.chown(RELEASE, 0, 986)
            (RELEASE / 'web').mkdir(mode=0o755)
            for member in members:
                if member.isdir():
                    continue
                raw = archive.extractfile(member).read()
                mode = 0o755 if member.name == 'ynx-finance' else 0o644
                save_new(RELEASE / member.name, raw, mode, 986)
        for item in manifest['files']:
            regular(RELEASE / item['path'], item['sha256'], item['bytes'])
        regular(RELEASE / 'ynx-finance', BINARY_SHA, 8626360)
        elf = (RELEASE / 'ynx-finance').read_bytes()[:20]
        assert elf[:5] == b'\x7fELF\x02' and elf[18:20] == b'\x3e\x00'
        phase = 'YNX_USER_ACCESS'
        subprocess.run(['/usr/sbin/runuser', '-u', 'ynx', '--', '/bin/sh', '-c',
            'cd "$1" && test -x ./ynx-finance && test -r ./web/index.html && test -r ./web/wallet-auth.js',
            'finance-access', str(RELEASE)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        phase = 'ISOLATED_LINUX_START'
        isolated = STAGE / 'isolated'
        isolated.mkdir(mode=0o700)
        os.chown(isolated, 995, 986)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        probe_env = dict(effective)
        probe_env.update({b'YNX_FINANCE_LISTEN': ('127.0.0.1:' + str(port)).encode(),
            b'YNX_FINANCE_STATE_PATH': str(isolated / 'state.json').encode(),
            b'YNX_FINANCE_WEB_DIR': str(RELEASE / 'web').encode(), b'YNX_FINANCE_AUTH_MODE': b'product-session-v2'})
        proc = subprocess.Popen([str(RELEASE / 'ynx-finance')], cwd=RELEASE, env=probe_env,
            user=995, group=986, extra_groups=[986], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)
        assert proc.poll() is None
        evidence['isolatedLinux'] = health('http://127.0.0.1:' + str(port), SOURCE)
        for item in manifest['files']:
            if item['path'].startswith('web/'):
                evidence['isolatedLinux'].append(http('http://127.0.0.1:' + str(port) + '/' + item['path'][4:], sha=item['sha256']))
        proc.terminate()
        proc.wait(timeout=10)
        proc = None
        absent(isolated / 'state.json')
        isolated.rmdir()
        phase = 'BACKUP_PRE_SWITCH'
        assert service() == old_service
        regular(ENV, EXPECTED_ENV)
        regular(UNIT, EXPECTED_UNIT)
        regular(CADDY, EXPECTED_CADDY)
        assert regular(DROPIN) == original_dropin
        assert os.readlink(CURRENT) == OLD
        env_receipt = save_new(ENV_NEXT, candidate_env, 0o640, 986)
        systemctl('stop')
        stopped = True
        assert service()['MainPID'] == '0'
        state = receipt(STATE)
        assert state.get('absent') or (state.get('type') == 'file' and state['nlink'] == 1)
        if not state.get('absent'):
            save_new(BACKUP / 'state-before-switch.json', STATE.read_bytes(), 0o600)
        evidence['stoppedState'] = state
        phase = 'ATOMIC_SWITCH'
        assert receipt(ENV_NEXT) == env_receipt
        os.replace(ENV_NEXT, ENV)
        switched = True
        os.symlink(str(RELEASE), LINK_NEXT)
        os.replace(LINK_NEXT, CURRENT)
        systemctl('start')
        stopped = False
        time.sleep(1)
        phase = 'PUBLIC_VERIFY'
        candidate_service = service()
        assert candidate_service['ActiveState'] == 'active' and candidate_service['SubState'] == 'running'
        assert int(candidate_service['MainPID']) > 0 and candidate_service['MainPID'] != old_service['MainPID']
        assert candidate_service['NRestarts'] == '0'
        assert CURRENT.resolve() == RELEASE
        after_http = []
        for base in ['http://127.0.0.1:6483', 'https://finance.ynxweb4.com']:
            after_http += health(base, SOURCE)
            after_http.append(http(base + '/', sha=next(x['sha256'] for x in manifest['files'] if x['path'] == 'web/index.html')))
            for item in manifest['files']:
                if item['path'].startswith('web/'):
                    after_http.append(http(base + '/' + item['path'][4:], sha=item['sha256']))
        regular(UNIT, EXPECTED_UNIT)
        regular(CADDY, EXPECTED_CADDY)
        assert regular(DROPIN) == original_dropin
        evidence.update(status='DEPLOYED_SOURCE_BOUND_PUBLIC', deployCount=1, automaticRollbackCount=0,
            after={'service': candidate_service, 'current': receipt(CURRENT), 'env': receipt(ENV),
                'binary': receipt(RELEASE / 'ynx-finance'), 'state': receipt(STATE), 'http': after_http},
            rollback={'release': OLD, 'environmentBackup': str(BACKUP / 'finance.env'), 'stateRestore': False},
            forbiddenMutations={'caddy': False, 'unit': False, 'otherServices': False, 'wallet': False},
            retained={'release': str(RELEASE), 'rollback': str(BACKUP), 'archive': str(ARCHIVE)},
            installed=False, realAccountApproval=False, realSigning=False, realTransaction=False)
        save_new(STAGE / 'deployment-receipt.json', (json.dumps(evidence, indent=2) + '\n').encode(), 0o600)
        print(json.dumps(evidence), flush=True)
    except BaseException as error:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=10)
        rollback = False
        if switched or stopped:
            systemctl('stop')
            if switched:
                # Never restore state bytes: preserve all writes through the same
                # byte-identical state codec, including writes after deployment.
                absent(ENV_NEXT)
                save_new(ENV_NEXT, old_env, 0o640, 986)
                os.replace(ENV_NEXT, ENV)
                absent(LINK_NEXT)
                os.symlink(OLD, LINK_NEXT)
                os.replace(LINK_NEXT, CURRENT)
            systemctl('start')
            time.sleep(1)
            regular(ENV, EXPECTED_ENV)
            assert CURRENT.resolve() == Path(OLD)
            assert service()['ActiveState'] == 'active'
            for item in old_http:
                http(item['url'], sha=item['sha256'])
            rollback = True
        print(json.dumps({'status': 'FAILED_CLOSED', 'phase': phase, 'errorClass': type(error).__name__,
            'automaticRollback': rollback, 'current': receipt(CURRENT), 'service': service(),
            'state': receipt(STATE), 'retained': [str(STAGE), str(RELEASE), str(ARCHIVE)],
            'stateSnapshotRestored': False}), flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    deploy()
