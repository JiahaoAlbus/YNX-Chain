#!/usr/bin/env python3
"""Normal embedded handoff callee; synthetic host and inert custody only.

Filesystem/locks/no-replace rename/fsync are real. UID/systemd/keycheck are
explicit controls, not a Linux service, cryptographic or deployment result.
"""
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest

SOURCE = Path(__file__).with_name('remote') / 'public-bft-operator-transition.sh'


def module():
    text = SOURCE.read_text()
    body = text.split("<<'PYCUSTODY'\n", 1)[1].split('\nPYCUSTODY\n', 1)[0]
    m = types.ModuleType('cold_custody_source_control')
    exec(compile(body, str(SOURCE) + ':PYCUSTODY', 'exec'), m.__dict__)
    return m


def raw(value):
    return json.dumps(value, separators=(',', ':')).encode() + b'\n'


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = value if isinstance(value, bytes) else raw(value)
    with path.open('xb') as out:
        out.write(data)
    path.chmod(0o600)
    return hashlib.sha256(data).hexdigest()


class Fixture:
    def __init__(self, temporary):
        self.root = Path(temporary).resolve()
        self.m = module()
        self.remap = lambda path: self.root / str(path).lstrip('/') if str(path).startswith('/etc/ynx/') else Path(path)
        self.m.P = self.remap  # test-only physical namespace; no production CLI override
        base = '/etc/ynx/consensus-candidate/primary'
        self.b = dict(phase='install', role='primary', transitionId='original-transition',
                      oldOperatorPlanSHA256='a' * 64, nextOperatorPlanSHA256='b' * 64,
                      runtimeCommit='c' * 40, runtimeManifestSHA256='d' * 64,
                      approvalSHA256='e' * 64, keycheckSHA256='f' * 64,
                      originalRole=dict(legacyKeyPath=base + '/priv_validator_key.json',
                                        legacyStatePath=base + '/priv_validator_state.json',
                                        nodeKeyPath=base + '/node_key.json', abciState='/etc/ynx/consensus-app/primary/state',
                                        home='/etc/ynx/consensus-home/primary'),
                      custodyHandoff=dict(version=self.m.VERSION,
                          legacyKeyPath='/etc/ynx/consensus-pq-legacy/primary/priv_validator_key.json',
                          nodeKeyPath='/etc/ynx/consensus-pq-engine/primary/node_key.json',
                          legacyStatePath=base + '/priv_validator_state.json'))
        old = self.b['originalRole']
        self.key, self.state, self.node = [self.remap(old[k]) for k in ('legacyKeyPath', 'legacyStatePath', 'nodeKeyPath')]
        self.lock = Path(str(self.state) + '.writer.lock')
        self.applock = self.remap(old['abciState'] + '.writer.lock')
        self.target = self.remap(self.b['custodyHandoff']['legacyKeyPath'])
        self.nextnode = self.remap(self.b['custodyHandoff']['nodeKeyPath'])
        for directory in (self.target.parent.parent, self.nextnode.parent.parent):
            directory.mkdir(parents=True, mode=0o700, exist_ok=True)
            directory.chmod(0o755)
        write(self.key, b'INERT ORIGINAL ED FILE; NOT A KEY\n')
        write(self.state, dict(height='991', round=2, step=3, signature='INERT HISTORY'))
        write(self.node, b'INERT ORIGINAL P2P IDENTITY\n')
        write(self.lock, b'')
        write(self.applock, b'')
        self.originals = {p: (p.read_bytes(), p.stat().st_ino) for p in (self.key, self.state, self.node, self.lock)}
        self.q = self.root / 'quiesce-attempt'
        self.install = self.root / 'install-attempt'
        self.q.mkdir(mode=0o700)
        self.install.mkdir(mode=0o700)
        process = dict(mainPid='100', startTicks='200', runningExecutableSHA256='1' * 64)
        process_pin = write(self.q / 'original-process.json', process)
        write(self.q / 'halt-incarnation.json', dict(mainPid='100', startTicks='200', invocationId='2' * 32,
              execMainStartTimestampMonotonic='2000000', originalProcessSHA256=process_pin))
        archive = self.q / 'committed-source.tar.gz'
        with tarfile.open(archive, 'w:gz') as out:
            for p in (self.key, self.state, self.node):
                out.add(p, arcname=str(p).lstrip('/'), recursive=False)
        archive.chmod(0o600)
        self.b['backupSHA256'] = write(self.q / 'backup-manifest.json', dict(
            committedSourceConsistent=True, files={'committed-source.tar.gz': hashlib.sha256(archive.read_bytes()).hexdigest(),
                                                   'original-launch.tar.gz': '3' * 64}))
        write(self.install / 'binding.json', self.b)
        self.binary = self.root / 'inert-keycheck'
        self.oldmanifest = self.root / 'old-package/role-manifest.json'
        self.newmanifest = self.root / 'next-package/role-manifest.json'
        self.config = self.remap(old['home']) / 'config/config.toml'
        self.oldconfig = b'INERT NORMAL OLD COMET CONFIG\n'
        self.newconfig = b'INERT NORMAL NEXT COMET CONFIG\n'
        write(self.config, self.oldconfig)
        write(self.oldmanifest.parent / 'config/config.toml', self.oldconfig)
        write(self.newmanifest.parent / 'config/config.toml', self.newconfig)
        self.host = self.Host(self)

    class Host:
        def __init__(self, fixture):
            self.f = fixture
            self.checks = []
            self.changes = []
            self.fail_chown = False
            self.bad_terminal = False

        def owners(self):
            # Real test filesystem has one UID. This does not simulate a
            # successful two-service namespace/install; expected calls are
            # checked separately from real fchown-to-self and flock behavior.
            return os.getuid(), os.getgid(), os.getuid(), os.getgid()

        def stopped(self, incarnation):
            if self.bad_terminal:
                raise ValueError('original bootstrap process incarnation is not stopped')
            return dict(incarnation)

        def inactive(self):
            if self.bad_terminal:
                raise ValueError('competing original unit is not stopped')
            return True

        def trusted(self, parent):
            assert parent.resolve(strict=True) == parent and parent.is_relative_to(self.f.root)
            assert parent.stat().st_mode & 0o022 == 0

        def keycheck(self, binary, manifest, key, node, pin):
            assert key.read_bytes() == self.f.originals[self.f.key][0]
            assert node.read_bytes() == self.f.originals[self.f.node][0]
            self.checks.append((str(manifest), str(key), str(node)))

        def chown(self, fd, uid, gid):
            # Independent open descriptions must remain unable to acquire
            # either original writer lease through every ownership operation.
            for path in (self.f.lock, self.f.applock):
                other = os.open(path, os.O_RDWR)
                try:
                    try:
                        fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        pass
                    else:
                        raise AssertionError('normal writer lease escaped during handoff')
                finally:
                    os.close(other)
            if self.fail_chown and not self.f.key.exists():
                raise OSError('injected original post-rename owner failure')
            self.changes.append((os.fstat(fd).st_ino, uid, gid))
            os.fchown(fd, uid, gid)

    def transfer(self):
        self.m.transfer(self.b, self.q, self.install, self.binary, self.oldmanifest, self.newmanifest, self.host)

    def verify(self):
        b = dict(self.b, phase='start', approvalSHA256='9' * 64)
        self.m.verify(b, self.q, self.install, self.binary, self.newmanifest, self.host)


class OriginalColdCustodyTests(unittest.TestCase):
    def fixture(self):
        temporary = tempfile.TemporaryDirectory(prefix='cold-custody-control-')
        self.addCleanup(temporary.cleanup)
        return Fixture(temporary.name)

    def test_actual_same_inode_rename_two_locks_and_readonly_start_verification(self):
        f = self.fixture()
        f.transfer()
        self.assertFalse(f.key.exists())
        self.assertEqual(f.target.stat().st_ino, f.originals[f.key][1])
        for path in (f.state, f.lock, f.node):
            self.assertEqual((path.read_bytes(), path.stat().st_ino), f.originals[path])
        self.assertEqual(f.nextnode.read_bytes(), f.node.read_bytes())
        self.assertEqual(len(f.host.checks), 3)
        self.assertEqual(len(f.host.changes), 8)
        self.assertEqual(f.config.read_bytes(), f.newconfig)
        self.assertEqual(f.config.with_name('config.toml.retained-custody-original-transition').read_bytes(), f.oldconfig)
        f.verify()
        with self.assertRaisesRegex(ValueError, 'UNKNOWN exists'):
            f.transfer()
        result = json.loads((f.install / 'custody-handoff/result.json').read_bytes())
        self.assertFalse(result['legacyHRSMoved'])
        self.assertFalse(result['legacyHRSCopied'])
        self.assertFalse(result['signingKeyCopied'])

    def test_post_rename_failure_retains_original_lock_history_and_no_retry(self):
        f = self.fixture()
        f.host.fail_chown = True
        with self.assertRaisesRegex(OSError, 'post-rename'):
            f.transfer()
        self.assertFalse(f.key.exists())
        self.assertEqual(f.target.stat().st_ino, f.originals[f.key][1])
        self.assertEqual((f.state.read_bytes(), f.state.stat().st_ino), f.originals[f.state])
        self.assertTrue((f.install / 'custody-handoff/intent.json').exists())
        self.assertFalse((f.install / 'custody-handoff/result.json').exists())
        with self.assertRaisesRegex(ValueError, 'UNKNOWN exists'):
            f.transfer()
        with self.assertRaises(FileNotFoundError):
            f.verify()

    def test_normal_fixed_namespaces_and_partial_config_publication_keep_old_launch_ineligible(self):
        f = self.fixture()
        for namespace in (f.target.parent.parent, f.nextnode.parent.parent):
            namespace.rmdir()
        old_umask = os.umask(0o077)
        try: f.transfer()
        finally: os.umask(old_umask)
        for namespace in (f.target.parent.parent, f.nextnode.parent.parent):
            self.assertEqual(namespace.stat().st_mode & 0o777, 0o755)
        f.verify()
        # A crash after retaining the old Home config cannot restore the old
        # key path or turn a partial handoff into a successful start receipt.
        f = self.fixture()
        rename = f.m.rename_exclusive
        def stop_before_new_config(source, target):
            if target == f.config:
                raise OSError('injected config publication loss')
            return rename(source, target)
        f.m.rename_exclusive = stop_before_new_config
        with self.assertRaisesRegex(OSError, 'publication loss'): f.transfer()
        self.assertFalse(f.key.exists())
        self.assertFalse(f.config.exists())
        self.assertEqual(f.target.stat().st_ino, f.originals[f.key][1])
        self.assertEqual((f.state.read_bytes(), f.state.stat().st_ino), f.originals[f.state])
        self.assertEqual(f.config.with_name('config.toml.retained-custody-original-transition').read_bytes(), f.oldconfig)
        self.assertTrue(f.config.with_name('config.toml.custody-original-transition.new').exists())
        self.assertFalse((f.install / 'custody-handoff/result.json').exists())
        with self.assertRaisesRegex(ValueError, 'UNKNOWN exists'): f.transfer()
        with self.assertRaises(FileNotFoundError): f.verify()

    def test_original_busy_app_or_hrs_lock_refuses_before_any_intent(self):
        for which in ('applock', 'lock'):
            with self.subTest(which=which):
                f = self.fixture()
                fd = os.open(getattr(f, which), os.O_RDWR)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    with self.assertRaises(BlockingIOError):
                        f.transfer()
                finally:
                    os.close(fd)
                self.assertFalse((f.install / 'custody-handoff').exists())
                self.assertEqual(f.key.stat().st_ino, f.originals[f.key][1])

    def test_archive_replacement_after_sha_cannot_rebind_original_history(self):
        f = self.fixture()
        original_tar_open = f.m.tarfile.open
        archive = f.q / 'committed-source.tar.gz'
        original_archive = archive.read_bytes()
        malicious = f.q / 'inert-replacement.tar.gz'
        original_hrs = f.state.read_bytes()
        f.state.write_bytes(b'INERT ALTERED HISTORY AFTER ORIGINAL BACKUP')
        with original_tar_open(malicious, 'w:gz') as out:
            for p in (f.key, f.state, f.node):
                out.add(p, arcname=str(p).lstrip('/'), recursive=False)
        altered_hrs = f.state.read_bytes()
        f.state.write_bytes(original_hrs)
        calls = []
        def replace_at_tar_read(*args, **kwargs):
            calls.append(True)
            archive.rename(f.q / 'retained-original-archive')
            malicious.rename(archive)
            f.state.write_bytes(altered_hrs)
            return original_tar_open(*args, **kwargs)
        f.m.tarfile.open = replace_at_tar_read
        try:
            with self.assertRaises(ValueError): f.transfer()
        finally:
            f.m.tarfile.open = original_tar_open
        self.assertEqual(len(calls), 1)
        self.assertFalse((f.install / 'custody-handoff').exists())
        self.assertEqual((f.q / 'retained-original-archive').read_bytes(), original_archive)
        self.assertTrue(f.key.exists())
        self.assertFalse(f.target.exists())

    def test_original_terminal_backup_changed_hrs_and_unknown_entries_refuse(self):
        for kind in ('terminal', 'backup', 'hrs', 'extra', 'destination', 'symlink', 'mode', 'home-config', 'namespace'):
            with self.subTest(kind=kind):
                f = self.fixture()
                if kind == 'terminal': f.host.bad_terminal = True
                if kind == 'backup': (f.q / 'backup-manifest.json').write_bytes(b'{}')
                if kind == 'hrs': f.state.write_bytes(b'changed original HRS')
                if kind == 'extra': write(f.state.parent / 'UNKNOWN', b'keep')
                if kind == 'destination': f.target.parent.mkdir(mode=0o700)
                if kind == 'symlink':
                    original = f.key.with_name('original-private')
                    f.key.rename(original)
                    f.key.symlink_to(original)
                if kind == 'mode': f.key.chmod(0o640)
                if kind == 'home-config': f.config.write_bytes(b'wrong original config')
                if kind == 'namespace': f.target.parent.parent.chmod(0o700)
                with self.assertRaises((ValueError, FileNotFoundError, KeyError)):
                    f.transfer()
                self.assertFalse((f.install / 'custody-handoff').exists())

    def test_completed_receipt_changed_or_obsolete_key_reappears_refuses_start(self):
        for kind in ('result', 'original-key', 'hrs', 'next-plan', 'lock-replaced', 'home-config', 'retained-config'):
            with self.subTest(kind=kind):
                f = self.fixture()
                f.transfer()
                if kind == 'result':
                    p = f.install / 'custody-handoff/result.json'
                    d = json.loads(p.read_bytes()); d['signingKeyCopied'] = True; p.write_bytes(raw(d))
                if kind == 'original-key': write(f.key, f.target.read_bytes())
                if kind == 'hrs': f.state.write_bytes(b'changed')
                if kind == 'next-plan': f.b['nextOperatorPlanSHA256'] = '1' * 64
                if kind == 'lock-replaced':
                    f.lock.rename(f.lock.with_name('old-lock'))
                    write(f.lock, b'')
                if kind == 'home-config': f.config.write_bytes(f.oldconfig)
                if kind == 'retained-config': f.config.with_name('config.toml.retained-custody-original-transition').write_bytes(b'changed')
                with self.assertRaises(ValueError): f.verify()

    def test_exact_fixed_destinations_no_handoff_for_unchanged_profile(self):
        m = module()
        self.assertIsNone(m.descriptor({'role': 'primary'}))
        f = self.fixture()
        self.assertEqual(m.descriptor(f.b), f.b['custodyHandoff'])
        for field in ('legacyKeyPath', 'legacyStatePath', 'nodeKeyPath'):
            b = copy.deepcopy(f.b); b['custodyHandoff'][field] += '-different'
            with self.assertRaises(ValueError): m.descriptor(b)
        b = copy.deepcopy(f.b); b['role'] = 'seoul'
        with self.assertRaises(ValueError): m.descriptor(b)

    def test_original_binding_requires_exact_approved_role_paths_and_keeps_legacy_branch(self):
        temporary = tempfile.TemporaryDirectory(prefix='cold-binding-control-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        original_check = SOURCE.parents[2] / 'verify/public-bft-operator-transition-check.sh'
        generator = original_check.read_text().split('python3 -B - "$tmp/meta" <<\'PY\'\n', 1)[1].split('\nPY\n', 1)[0]
        (root / 'meta').mkdir(mode=0o700)
        subprocess.run([sys.executable, '-B', '-', str(root / 'meta')], input=generator.encode(), check=True, timeout=10)
        root = root / 'meta'
        original = json.loads((root / 'old/common/operator-plan.json').read_bytes())
        target = json.loads((root / 'next/common/operator-plan.json').read_bytes())
        approval = json.loads((root / 'install.json').read_bytes())
        pins = json.loads((root / 'pins.json').read_bytes())

        def invoke(old, new, change=None):
            def update(path, value):
                path.write_bytes(raw(value)); return hashlib.sha256(path.read_bytes()).hexdigest()
            oldpin = update(root / 'old/common/operator-plan.json', old)
            newpin = update(root / 'next/common/operator-plan.json', new)
            a = dict(approval, oldOperatorPlanSHA256=oldpin, nextOperatorPlanSHA256=newpin)
            apin = update(root / 'install.json', a)
            if change: change()
            argv = ['bash', '-c', 'set -Eeuo pipefail; source "$1"; shift; operator_transition_binding "$@"',
                    '--', str(SOURCE), 'install', a['transitionId'], 'primary', str(root / 'install.json'), apin,
                    str(root / 'old'), oldpin, str(root / 'old-SOURCE.json'), 'a' * 40, pins['oldManifest'],
                    str(root / 'next'), newpin, str(root / 'SOURCE.json'), '8' * 40, pins['manifest']]
            return subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)

        same = invoke(original, target)
        self.assertEqual(same.returncode, 0, same.stderr)
        self.assertNotIn('custodyHandoff', json.loads(same.stdout))
        for old, new in zip(original['roles'], target['roles']):
            base = '/etc/ynx/consensus-candidate/' + old['role']
            old.update(legacyKeyPath=base + '/priv_validator_key.json', legacyStatePath=base + '/priv_validator_state.json', nodeKeyPath=base + '/node_key.json')
            new.update(legacyKeyPath='/etc/ynx/consensus-pq-legacy/' + old['role'] + '/priv_validator_key.json',
                       legacyStatePath=old['legacyStatePath'], nodeKeyPath='/etc/ynx/consensus-pq-engine/' + old['role'] + '/node_key.json')
        accepted = invoke(original, target)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertEqual(json.loads(accepted.stdout)['custodyHandoff']['version'], 'YNX-ORIGINAL-SIGNER-CUSTODY/v1')
        for field in ('legacyKeyPath', 'legacyStatePath', 'nodeKeyPath'):
            changed = copy.deepcopy(target); changed['roles'][0][field] += '-wrong'
            rejected = invoke(original, changed)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(rejected.stdout, b'')
        denied = invoke(original, target, lambda: (root / 'next/common/operator-plan.json').write_bytes(raw(original)))
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn(b'new plan pin mismatch', denied.stderr)


if __name__ == '__main__':
    unittest.main()
