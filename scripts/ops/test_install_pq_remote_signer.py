#!/usr/bin/env python3
"""Original installer/render controls with explicit host-observation doubles.

The real unchanged v2 bundle parser reads inert ELF/header controls and original
three templates. No ELF, systemctl, service, network, real custody or key runs.
These DATA tests cannot qualify an installed signer, Root or signing session.
"""
import argparse
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
FILE = Path(__file__).with_name('install-pq-remote-signer.py')
spec = importlib.util.spec_from_file_location('normal_signer_install_controls', FILE)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write(path, raw, mode=0o600):
    if type(raw) is not bytes:
        raw = (json.dumps(raw, separators=(',', ':')) + '\n').encode()
    with path.open('xb') as out:
        out.write(raw)
    path.chmod(mode)
    return raw


class HostObservations(installer.LocalHost):
    """Only tests can inject this factory; CLI has no host/test/env override."""
    def __init__(self, fixture):
        self.fixture = fixture
        self.events, self.owners = [], []
        self.private_observations = []
        self.provider_ready, self.existing_unit = True, False
        self.drift_on_second = None
        self.observations = 0
        self.fail_owner_at = None

    def command(self, argv, accepted=(0,)):
        raise AssertionError('no real systemctl/findmnt/service command is allowed in these fixtures')

    def account(self):
        return os.getuid(), os.getgid()

    def engine_account(self):
        return 65533 if os.getuid() != 65533 else 65532

    def observe(self, provider, checkpoint_directory=None):
        self.observations += 1
        self.events.append(('read-only-host-observation', provider))
        installer.need(self.provider_ready, 'EXISTING_REAL_CHECKPOINT_PROVIDER_REQUIRED')
        installer.need(not self.existing_unit, 'EXISTING_SIGNER_UNIT_OR_PROCESS_MUST_BE_RETAINED')
        if self.observations == 2 and self.drift_on_second:
            self.drift_on_second()

    def destination(self, filename):
        return self.fixture.host_root / filename.lstrip('/')

    def root(self):
        return True  # Synthetic privileged installer only, never native Root.

    def chown(self, filename, uid, gid):
        self.owners.append((str(filename), uid, gid))
        if len(self.owners) == self.fail_owner_at:
            raise OSError('injected ownership/fsync uncertainty')

    def private_stat(self, filename, maximum, uid, minimum=1):
        # The real host supplies root/service ownership. A public fixture has
        # just its CI UID and substitutes that metadata observation only.
        self.private_observations.append((str(filename), uid))
        return installer.regular(filename, maximum, os.getuid(), minimum)

    def installed_metadata(self, filename, uid, gid, mode):
        installer.need((str(filename), uid, gid) in self.owners and filename.stat().st_mode & 0o777 == mode,
                       'fixture installed owner/mode mismatch')

    def trusted(self, directory, uid):
        directory = Path(directory)
        installer.need(directory.resolve(strict=True) == directory and directory.is_relative_to(self.fixture.root),
                       'fixture escaped its synthetic host')
        while directory != self.fixture.root:
            installer.need(not directory.stat().st_mode & 0o022, 'ORIGINAL_TRUSTED_PARENT_REQUIRED')
            directory = directory.parent


class Fixture:
    def __init__(self, parent, name):
        self.root = parent / name
        self.root.mkdir(mode=0o700)
        self.host_root = self.root / 'host'
        self.host_root.mkdir(mode=0o700)
        for target in list(installer.TARGETS.values()) + [installer.CREDENTIAL]:
            directory = self.host_root / Path(target).parent.relative_to('/')
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.bundle = self.root / 'runtime'
        self.bundle.mkdir(mode=0o700)
        operator = self.bundle / 'operator'
        operator.mkdir(mode=0o700)
        names = ('ynx-abci', 'ynx-comet', 'ynx-bft-gatewayd', installer.DAEMON, 'ynx-consensus-pq-key-init',
                 'ynx-consensus-proof-verify', 'ynx-consensus-package', 'ynx-consensus-keycheck')
        binary = bytearray(b'A' * ((1 << 20) + 64))
        binary[:7] = b'\x7fELF\x02\x01\x01'
        binary[16:24] = b'\x02\0\x3e\0\x01\0\0\0'
        binaries = {}
        for index, item in enumerate(names):
            binary[64] = index
            raw = write(self.bundle / item, bytes(binary), 0o644)
            binaries[item] = dict(bytes=len(raw), sha256=sha(raw))
        self.templates, templates = {}, {}
        for item in installer.TEMPLATES:
            raw = write(operator / item, (ROOT / 'scripts/ops' / item).read_bytes())
            templates[item] = dict(bytes=len(raw), sha256=sha(raw))
            self.templates[item] = raw
        source_pin = dict(bytes=3, sha256=sha(b'pub'))
        self.commit = 'a' * 40
        source = dict(version='YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2', commit=self.commit, runId='12345',
            platform='linux/amd64', cometForkTree='b' * 40, goMod=source_pin, goSum=source_pin,
            proofVerifierContract='YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1', proofVerifierSources={key: source_pin for key in (
                'internal/consensus/pq_light_proof.go', 'cmd/ynx-consensus-proof-verify/main.go', 'cmd/ynx-consensus-proof-verify/trust.go')},
            binaries=binaries, operator=templates, runtimeStarted=False, publicDeployment=False, pqActivation=False,
            purpose='normal entrypoint binaries and operator configuration only; no keys, credentials, ledger or signing history')
        source_raw = write(self.bundle / 'SOURCE.json', source)
        self.public = self.root / 'public'
        self.public.mkdir(mode=0o700)
        self.private = self.root / 'original-private'
        self.private.mkdir(mode=0o700)
        self.histories = []
        for name in ('pq-history', 'ed-history', 'live-source'):
            directory = self.root / name
            directory.mkdir(mode=0o700)
            self.histories.append(directory)
        pq_state, legacy_state, state = [p / 'original-state' for p in self.histories]
        for filename in (pq_state, legacy_state, state):
            write(filename, b'ORIGINAL PRIVATE HISTORY OR CHECKPOINT; NOT OPENED\n')
        self.legacy, self.transport, self.vault = [self.private / key for key in ('ed-key', 'transport-key', 'vault')]
        for filename in (self.legacy, self.transport, self.vault):
            write(filename, b'PRIVATE BODY MUST NOT BE OPENED\n')
        genesis, migration, schedule, binding, peer, budget = [self.public / x for x in ('genesis.json', 'migration.json', 'schedule.json', 'binding.json', 'engine-peer.pub', 'memory-measurement.json')]
        self.genesis = write(genesis, b'original public genesis\n')
        write(migration, b'original public migration\n')
        self.schedule = write(schedule, b'original public canonical schedule\n')
        self.binding = dict(Policy=dict(ChainID='ynx_6423-1', Version='original-public-policy', GenesisID='cHVibGlj', ActivationHeight=100),
            ValidatorAddress='cHVibGlj', Epoch=1, MLDSA87PublicKey='cHVibGlj', SLHDSASHA2256fPublicKey='cHVibGlj', SignerStatePath=str(pq_state))
        binding_raw = write(binding, self.binding)
        peer_raw = write(peer, ('d' * 64 + '\n').encode())
        budget_raw = write(budget, b'owner measurement DATA; not a capacity proof\n')
        credential = self.host_root / installer.CREDENTIAL.lstrip('/')
        credential_raw = write(credential, b'opaque EXISTING ENCRYPTED systemd credential blob\n')
        config = json.loads(self.templates[installer.DAEMON + '.conf.in'])
        for key in installer.CHECKPOINT_ACCESS_FIELDS:
            config.pop(key)
        config.update(abciState=str(state), binary=installer.TARGETS['binary'], binarySHA256=binaries[installer.DAEMON]['sha256'],
            binding=str(binding), bindingSHA256=sha(binding_raw), checkpointDirectory=str(state.parent),
            checkpointFormat='atomic-committed-json-v1', checkpointProviderUnit='actual-original-source.mount',
            cometGenesisSHA256=sha(self.genesis), enginePeerPin=str(peer), enginePeerPublicKey='d' * 64, genesis=str(genesis),
            goMemoryLimitBytes='1073741824', legacyKey=str(self.legacy), legacyKeySHA256='1' * 64, legacyState=str(legacy_state),
            listen='tcp://127.0.0.1:27701', memoryBudgetEvidence=str(budget), memoryBudgetEvidenceSHA256=sha(budget_raw),
            memoryMaxBytes='2147483648', migration=str(migration), migrationStateHash='2' * 64, originalGenesisHash='3' * 64,
            pqState=str(pq_state), schedule=str(schedule), scheduleHash='4' * 64, transportKey=str(self.transport),
            transportKeySHA256='5' * 64, vault=str(self.vault), vaultSHA256='6' * 64)
        self.config = config
        self.config_path = self.root / 'operator-config.json'
        config_raw = write(self.config_path, config)
        role = dict(home='/original/engine-home', abciState=str(state), legacyKeyPath=str(self.legacy),
            legacyStatePath=str(legacy_state), nodeKeyPath='/original/p2p-key', hostBinding=self.binding,
            remoteSigner=config['listen'], transportKeyPath='/original/engine-transport-key', signerPeerPublicKey='e' * 64,
            remoteTimeout='5s')
        self.plan = dict(version='YNX-PRODUCTION-OPERATOR/v1', chainId='ynx_6423-1', validatorManifestSHA256='7' * 64,
            consensusGenesis=base64.b64encode(self.genesis).decode(), consensusGenesisSHA256=sha(self.genesis),
            originalGenesisHash=config['originalGenesisHash'], migrationStateHash=config['migrationStateHash'], stateLayout='atomic-json',
            runtimePlan='', runtimePlanHash='', pqSchedule=base64.b64encode(self.schedule).decode(), pqScheduleHash=config['scheduleHash'],
            roles=[dict(role, role=x) for x in ('primary', 'singapore', 'silicon-valley', 'seoul')])
        self.plan_path = self.root / 'operator-plan.json'
        plan_raw = write(self.plan_path, self.plan)
        self.args = argparse.Namespace(runtime_bundle=str(self.bundle), runtime_commit=self.commit, runtime_source_sha256=sha(source_raw),
            operator_plan=str(self.plan_path), operator_plan_sha256=sha(plan_raw), role='primary', config=str(self.config_path),
            config_sha256=sha(config_raw), unit_sha256='', operator_inputs_directory=str(self.public), credential_sha256=sha(credential_raw),
            install=False, output_dir=str(self.root / 'install-attempt'))
        replacements = {'CHECKPOINT_PROVIDER_UNIT': config['checkpointProviderUnit'], 'SIGNER_STARTUP_CONFIGURATION': 'Type=exec',
            'CHECKPOINT_SOURCE_ACCESS': 'BindReadOnlyPaths=' + config['checkpointDirectory'],
            'OPERATOR_INPUTS_DIRECTORY': str(self.public), 'ORIGINAL_VAULT': config['vault'], 'ORIGINAL_LEGACY_KEY': config['legacyKey'],
            'ORIGINAL_TRANSPORT_KEY': config['transportKey'], 'ORIGINAL_PQ_HRS_DIRECTORY': str(pq_state.parent),
            'ORIGINAL_LEGACY_HRS_DIRECTORY': str(legacy_state.parent), 'MEASURED_TARGET_MEMORY_MAX_BYTES': config['memoryMaxBytes']}
        self.expected_unit = self.templates[installer.DAEMON + '.service.in']
        for key, value in replacements.items():
            self.expected_unit = self.expected_unit.replace(('@' + key + '@').encode(), value.encode())
        self.args.unit_sha256 = sha(self.expected_unit)
        self.host = HostObservations(self)
        self.forbidden = {str(p) for p in (self.legacy, self.transport, self.vault, pq_state, legacy_state, state)}

    def provider(self, value):
        self.config['checkpointProviderUnit'] = value
        self.config_path.write_bytes((json.dumps(self.config, separators=(',', ':')) + '\n').encode())
        self.args.config_sha256 = sha(self.config_path.read_bytes())
        self.expected_unit = self.templates[installer.DAEMON + '.service.in']
        uses_fd = 'checkpointAccessMode' in self.config
        replacements = {'CHECKPOINT_PROVIDER_UNIT': value,
            'SIGNER_STARTUP_CONFIGURATION': ('Type=notify\nNotifyAccess=main\nTimeoutStartSec=' + self.config['checkpointStartupTimeoutSeconds'] + 's') if uses_fd else 'Type=exec',
            'CHECKPOINT_SOURCE_ACCESS': ('InaccessiblePaths=' if uses_fd else 'BindReadOnlyPaths=') + self.config['checkpointDirectory'],
            'OPERATOR_INPUTS_DIRECTORY': str(self.public), 'ORIGINAL_VAULT': self.config['vault'], 'ORIGINAL_LEGACY_KEY': self.config['legacyKey'],
            'ORIGINAL_TRANSPORT_KEY': self.config['transportKey'], 'ORIGINAL_PQ_HRS_DIRECTORY': str(Path(self.config['pqState']).parent),
            'ORIGINAL_LEGACY_HRS_DIRECTORY': str(Path(self.config['legacyState']).parent), 'MEASURED_TARGET_MEMORY_MAX_BYTES': self.config['memoryMaxBytes']}
        for key, replacement in replacements.items():
            self.expected_unit = self.expected_unit.replace(('@' + key + '@').encode(), replacement.encode())
        self.args.unit_sha256 = sha(self.expected_unit)

    def unix_fd(self):
        engine = self.host.engine_account()
        self.config.update(checkpointAccessMode='unix-fd-v1', checkpointAccessSocket='@ynx-pq-checkpoint-original-primary',
            checkpointEngineUID=str(engine), checkpointSignerUID=str(os.getuid()), checkpointAccessTimeoutSeconds='5',
            checkpointStartupTimeoutSeconds='120')
        # The public fixture substitutes ownership metadata; real two-UID
        # Linux EACCES/SCM_RIGHTS evidence belongs to the separate Go control.
        if os.getuid() == 0:
            self.config['checkpointSignerUID'] = '65534'
            self.host.account = lambda: (65534, 65534)
        access = {key: self.config[field] for key, field in (
            ('mode', 'checkpointAccessMode'), ('socket', 'checkpointAccessSocket'), ('engineUID', 'checkpointEngineUID'),
            ('signerUID', 'checkpointSignerUID'), ('timeoutSeconds', 'checkpointAccessTimeoutSeconds'),
            ('startupTimeoutSeconds', 'checkpointStartupTimeoutSeconds'))}
        self.plan['roles'][0]['checkpointAccess'] = access
        self.plan_path.write_bytes((json.dumps(self.plan, separators=(',', ':')) + '\n').encode())
        self.args.operator_plan_sha256 = sha(self.plan_path.read_bytes())
        self.provider(self.config['checkpointProviderUnit'])

    def run(self, module=installer):
        original_open = os.open
        def guarded_open(filename, flags, *args, **kwargs):
            if str(filename) in self.forbidden:
                raise AssertionError('installer opened original private/history/checkpoint body')
            return original_open(filename, flags, *args, **kwargs)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(installer.os, 'open', side_effect=guarded_open))
            if os.getuid() == 0 and 'checkpointAccessMode' in self.config:
                # Metadata-only fixture remains usable under a root test
                # runner. This is NOT the two-real-UID permission experiment.
                original_lstat = Path.lstat
                def observed_lstat(filename, *args, **kwargs):
                    info = original_lstat(filename, *args, **kwargs)
                    if filename in self.histories[:2]:
                        fields = {key: getattr(info, key) for key in dir(info) if key.startswith('st_')}
                        fields.update(st_uid=int(self.config['checkpointSignerUID']))
                        return SimpleNamespace(**fields)
                    return info
                stack.enter_context(mock.patch.object(Path, 'lstat', observed_lstat))
            return module.run(self.args, host=self.host)


class RootMountObservations(HostObservations):
    """Real LocalHost policy, with explicit systemd/findmnt metadata fixtures."""
    def __init__(self, fixture):
        super().__init__(fixture)
        self.unit = dict(Id='-.mount', LoadState='loaded', ActiveState='active', Where='/', What='/dev/vda2',
                         FragmentPath='/run/systemd/generator/-.mount', SourcePath='/etc/fstab')
        device = fixture.root.stat().st_dev
        self.mount = {'target': '/', 'source': '/dev/vda2', 'fstype': 'ext4',
                      'maj:min': str(os.major(device)) + ':' + str(os.minor(device)), 'fsroot': '/', 'id': 30}
        self.namespace = 'mnt:[4026531841]'
        self.commands, self.mount_reads = [], 0
        self.on_mount = None
        self.extra_filesystem = False

    def observe(self, provider, checkpoint_directory=None):
        self.observations += 1
        self.events.append(('read-only-host-observation', provider))
        return installer.LocalHost.observe(self, provider, checkpoint_directory)

    def command(self, argv, accepted=(0,)):
        self.commands.append(list(argv))
        if argv == ['/usr/bin/systemctl', 'show', '--property=Version', '--value']:
            return '255.4-1ubuntu8.12'
        properties = ('Id', 'LoadState', 'ActiveState', 'Where', 'What', 'FragmentPath', 'SourcePath')
        if argv == ['/usr/bin/systemctl', 'show', *['--property=' + key for key in properties], '--', '-.mount']:
            return '\n'.join(key + '=' + value for key, value in self.unit.items())
        if argv == ['/usr/bin/systemctl', 'show', '--property=LoadState', '--property=ActiveState', '--property=DropInPaths', '--', installer.SERVICE]:
            return 'LoadState=not-found\nActiveState=inactive\nDropInPaths='
        if argv == ['/usr/bin/findmnt', '--json', '--target', self.fixture.config['checkpointDirectory'],
                    '--output', 'TARGET,SOURCE,FSTYPE,MAJ:MIN,FSROOT,ID']:
            self.mount_reads += 1
            if self.on_mount:
                self.on_mount(self.mount_reads)
            return json.dumps({'filesystems': [self.mount] * (2 if self.extra_filesystem else 1)})
        raise AssertionError('unexpected host command: ' + repr(argv))

    @contextlib.contextmanager
    def metadata(self):
        # Keep real fixture canonical paths/directory identity. Substitute only
        # the root-device and namespace observations, not services/mounts.
        # No host mount, /proc or privileged operation is used by this fixture.
        lstat = Path.lstat
        root = Path('/').lstat()
        root = SimpleNamespace(st_dev=self.fixture.root.stat().st_dev, st_ino=root.st_ino,
            st_mode=root.st_mode, st_uid=root.st_uid, st_gid=root.st_gid)
        def observed_lstat(value, *args, **kwargs):
            return root if value == Path('/') else lstat(value, *args, **kwargs)
        readlink = os.readlink
        def namespace(filename, *args, **kwargs):
            if filename in ('/proc/self/ns/mnt', '/proc/1/ns/mnt'):
                return self.namespace
            if str(filename).startswith(str(self.fixture.root) + '/'):
                return readlink(filename, *args, **kwargs)
            raise AssertionError('unexpected readlink: ' + str(filename))
        with mock.patch.object(Path, 'lstat', observed_lstat), mock.patch.object(installer.os, 'readlink', side_effect=namespace):
            yield


class SignerInstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ynx-signer-install-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def fixture(self, name):
        return Fixture(self.root, name)

    def test_original_templates_render_and_default_is_data_only(self):
        f = self.fixture('data-only')
        before = {p: p.read_bytes() for p in f.root.rglob('*') if p.is_file()}
        result = f.run()
        self.assertIs(result['installed'], False)
        self.assertIs(result['runtimeStarted'], False)
        self.assertIs(result['privateKeyCheckPerformed'], False)
        self.assertIs(result['sandboxReadonlyValidated'], False)
        self.assertIs(result['freshnessVerified'], False)
        self.assertEqual(result['unitSHA256'], sha(f.expected_unit))
        self.assertFalse(Path(f.args.output_dir).exists())
        self.assertEqual(f.host.owners, [])
        for p, raw in before.items(): self.assertEqual(p.read_bytes(), raw)
        for target in installer.TARGETS.values(): self.assertFalse(f.host.destination(target).exists())

    def test_unix_fd_profile_preserves_private_source_and_custody_and_requires_actual_notify_startup(self):
        f = self.fixture('unix-fd')
        f.unix_fd(); f.args.install = True
        before = {Path(p): (Path(p).read_bytes(), installer.ident(Path(p).lstat())) for p in f.forbidden}
        result = f.run()
        self.assertIs(result['installed'], True)
        self.assertIs(result['runtimeStarted'], False)
        self.assertIs(result['privateKeyCheckPerformed'], False)
        self.assertIs(result['freshnessVerified'], False)
        unit = f.host.destination(installer.TARGETS['unit']).read_bytes()
        self.assertIn(b'Type=notify\nNotifyAccess=main\nTimeoutStartSec=120s\n', unit)
        self.assertIn(('InaccessiblePaths=' + f.config['checkpointDirectory'] + '\n').encode(), unit)
        self.assertNotIn(b'BindReadOnlyPaths=', unit)
        self.assertIn((f.config['abciState'], int(f.config['checkpointEngineUID'])), f.host.private_observations)
        self.assertIn((str(f.legacy), int(f.config['checkpointSignerUID'])), f.host.private_observations)
        for filename, (raw, identity) in before.items():
            self.assertEqual(filename.read_bytes(), raw)
            self.assertEqual(installer.ident(filename.lstat()), identity)
        self.assertTrue(all(event[0] == 'read-only-host-observation' for event in f.host.events))

    def test_unix_fd_group_is_complete_explicit_bounded_and_not_a_file_permission_fallback(self):
        f = self.fixture('unix-fd-group')
        f.unix_fd()
        original = dict(f.config)
        cases = [(key, None) for key in sorted(installer.CHECKPOINT_ACCESS_FIELDS)]
        cases += [('checkpointAccessMode', 'file-v1'), ('checkpointAccessSocket', '/tmp/source.sock'),
                  ('checkpointAccessSocket', '@foreign-source'), ('checkpointEngineUID', '0'),
                  ('checkpointEngineUID', '01'), ('checkpointEngineUID', '4294967296'),
                  ('checkpointSignerUID', original['checkpointEngineUID']), ('checkpointSignerUID', 123),
                  ('checkpointAccessTimeoutSeconds', '0'), ('checkpointAccessTimeoutSeconds', '61'),
                  ('checkpointStartupTimeoutSeconds', ''), ('checkpointStartupTimeoutSeconds', '601'),
                  ('checkpointStartupTimeoutSeconds', '0120')]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                f.config = dict(original)
                if value is None: del f.config[key]
                else: f.config[key] = value
                f.config_path.write_bytes((json.dumps(f.config) + '\n').encode())
                f.args.config_sha256 = sha(f.config_path.read_bytes())
                with self.assertRaises(ValueError): f.run()
                self.assertFalse(Path(f.args.output_dir).exists())
                self.assertEqual(f.host.owners, [])
        f.config = original
        f.provider(f.config['checkpointProviderUnit'])
        f.host.engine_account = lambda: int(original['checkpointEngineUID']) - 1
        with self.assertRaisesRegex(ValueError, 'ORIGINAL_ENGINE_AND_SIGNER_UID_PIN_MISMATCH'): f.run()
        self.assertEqual(f.host.private_observations, [])

    def test_unix_fd_plan_group_cannot_drift_from_either_normal_caller(self):
        f = self.fixture('unix-fd-plan')
        f.unix_fd()
        original = dict(f.plan['roles'][0]['checkpointAccess'])
        for key in ('mode', 'socket', 'engineUID', 'signerUID', 'timeoutSeconds', 'startupTimeoutSeconds', 'missing'):
            with self.subTest(key=key):
                access = dict(original)
                if key == 'missing': f.plan['roles'][0].pop('checkpointAccess', None)
                else:
                    access[key] = 'different'
                    f.plan['roles'][0]['checkpointAccess'] = access
                f.plan_path.write_bytes((json.dumps(f.plan) + '\n').encode())
                f.args.operator_plan_sha256 = sha(f.plan_path.read_bytes())
                with self.assertRaisesRegex(ValueError, 'ORIGINAL_PLAN_CHECKPOINT_ACCESS_MISMATCH'): f.run()
                self.assertEqual(f.host.owners, [])
        f.plan['roles'][0]['checkpointAccess'] = original
        f.config = {key: value for key, value in f.config.items() if key not in installer.CHECKPOINT_ACCESS_FIELDS}
        f.provider(f.config['checkpointProviderUnit'])
        f.plan_path.write_bytes((json.dumps(f.plan) + '\n').encode())
        f.args.operator_plan_sha256 = sha(f.plan_path.read_bytes())
        with self.assertRaisesRegex(ValueError, 'ORIGINAL_PLAN_CHECKPOINT_ACCESS_MISMATCH'): f.run()

    def test_unix_fd_does_not_accept_an_old_pinned_runtime_template(self):
        f = self.fixture('unix-fd-old-runtime')
        f.unix_fd()
        source, _, templates = installer.runtime_inputs(f.args)
        config_template = installer.decode(templates[installer.DAEMON + '.conf.in'])
        templates[installer.DAEMON + '.conf.in'] = json.dumps({key: value for key, value in config_template.items()
            if key not in installer.CHECKPOINT_ACCESS_FIELDS}).encode()
        with self.assertRaisesRegex(ValueError, 'ORIGINAL_CLOSED_CONFIG_REQUIRED'):
            installer.rendered(f.args, source, templates)
        self.assertEqual(f.host.events, [])

    def test_actual_launcher_unix_fd_branch_never_opens_source_and_passes_exact_uid_and_timeout_flags(self):
        f = self.fixture('unix-fd-launcher')
        f.unix_fd()
        launcher = f.templates[installer.DAEMON + '-launch.sh'].decode()
        start = launcher.index('if [[ $access_mode == unix-fd-v1 ]]; then\n')
        branch = launcher[start:launcher.index('\nsystemctl is-active --quiet -- "$provider"', start)]
        start = launcher.index('if [[ $access_mode == unix-fd-v1 ]]; then\n', launcher.index('  --recovery-fd 3)'))
        flag_branch = launcher[start:launcher.index('\nif [[ -n $runtime_plan ]]', start)]
        scaffold = '''set -euo pipefail
fail() { printf '%s\\n' "$1" >&2; exit 78; }
config_json=$1; checkpoint_directory=$2; state=$3; access_mode=unix-fd-v1
field() { /usr/bin/jq -er --arg name "$1" '.[$name]' <<<"$config_json"; }
id() { [[ $# == 2 && $1 == -u && $2 == ynx ]] || exit 95; field checkpointEngineUID; }
systemctl() {
  case "$*" in
    'show --property=NotifyAccess --value -- ynx-consensus-pq-remote-signer.service') printf '%s\\n' main ;;
    'show --property=Type --value -- ynx-consensus-pq-remote-signer.service') printf '%s\\n' notify ;;
    *) exit 96 ;;
  esac
}
canonical_path() { exit 97; }; trusted_parents() { exit 97; }
readonly_mount() { exit 97; }; checkpoint_source() { exit 97; }
NOTIFY_SOCKET=/run/systemd/notify
'''
        body = scaffold + branch + '\nargs=(--recovery-fd 3)\n' + flag_branch + '\nprintf "%s\\n" "${args[@]}"\n'
        config = dict(f.config, checkpointDirectory='/no-direct-source-read', abciState='/no-direct-source-read/state')
        result = installer.subprocess.run(['/bin/bash', '-c', body, 'actual-launcher-uid-control', json.dumps(config),
            config['checkpointDirectory'], config['abciState']], env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'},
            stdout=installer.subprocess.PIPE, stderr=installer.subprocess.PIPE, timeout=10, check=False)
        if os.getuid() == 0:
            self.assertEqual(result.returncode, 78)  # Root is never the signer.
        else:
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(result.stdout.decode().splitlines(), ['--recovery-fd', '3', '--checkpoint-access-socket',
                config['checkpointAccessSocket'], '--checkpoint-engine-uid', config['checkpointEngineUID'],
                '--checkpoint-signer-uid', config['checkpointSignerUID'], '--checkpoint-access-timeout', '5s',
                '--checkpoint-startup-timeout', '120s'])
            for old, replacement, reason in (
                ('NOTIFY_SOCKET=/run/systemd/notify', 'NOTIFY_SOCKET=/run/foreign', 'real systemd notification socket is required'),
                ("printf '%s\\n' main ;;", "printf '%s\\n' all ;;", 'loaded service must wait for the actual signer readiness notification'),
                ("printf '%s\\n' notify ;;", "printf '%s\\n' exec ;;", 'loaded service must wait for the actual signer readiness notification')):
                with self.subTest(observation=replacement):
                    self.assertEqual(body.count(old), 1)
                    denied = installer.subprocess.run(['/bin/bash', '-c', body.replace(old, replacement, 1),
                        'actual-launcher-observation-refusal', json.dumps(config), config['checkpointDirectory'], config['abciState']],
                        env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, stdout=installer.subprocess.PIPE,
                        stderr=installer.subprocess.PIPE, timeout=10, check=False)
                    self.assertEqual(denied.returncode, 78)
                    self.assertEqual(denied.stdout, b'')
                    self.assertIn(reason.encode(), denied.stderr)
        self.assertIn('notify_environment=(NOTIFY_SOCKET="$NOTIFY_SOCKET")', launcher)
        self.assertIn('GOGC=50 "${notify_environment[@]}"', launcher)
        # The full production JSON gate, not a copied mode parser, rejects
        # partial groups, fake source modes and duplicate-UID aliases.
        filter_body = launcher.split("jq -e '\n", 1)[1].split("\n' <<<\"$config_json\"", 1)[0]
        cases = [dict(config)]
        for key in sorted(installer.CHECKPOINT_ACCESS_FIELDS):
            changed = dict(config); del changed[key]; cases.append(changed)
        changed = dict(config, checkpointSignerUID=config['checkpointEngineUID']); cases.append(changed)
        changed = dict(config, checkpointAccessMode='file-v1'); cases.append(changed)
        for index, value in enumerate(cases):
            observed = installer.subprocess.run(['/usr/bin/jq', '-e', filter_body], input=json.dumps(value).encode(),
                env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, stdout=installer.subprocess.PIPE,
                stderr=installer.subprocess.PIPE, timeout=5, check=False)
            self.assertEqual(observed.returncode == 0, index == 0)

    def test_root_mount_uses_actual_directory_and_normal_unit_without_service_mutation(self):
        f = self.fixture('root-provider')
        f.provider('-.mount')
        f.host = RootMountObservations(f)
        f.args.install = True
        original_path = f.config['abciState']
        before = {Path(p): Path(p).read_bytes() for p in f.forbidden}
        with f.host.metadata():
            result = f.run()
        self.assertIs(result['installed'], True)
        self.assertIs(result['runtimeStarted'], False)
        self.assertIs(result['freshnessVerified'], False)
        self.assertIs(result['sandboxReadonlyValidated'], False)
        self.assertEqual(f.config['abciState'], original_path)
        self.assertEqual(f.host.observations, 2)
        self.assertEqual(f.host.mount_reads, 6)
        unit = f.host.destination(installer.TARGETS['unit']).read_bytes()
        self.assertIn(b'Requires=-.mount\n', unit)
        self.assertIn(b'After=network-online.target -.mount\n', unit)
        self.assertIn(('BindReadOnlyPaths=' + f.config['checkpointDirectory'] + '\n').encode(), unit)
        for command in f.host.commands:
            if command[0] == '/usr/bin/systemctl':
                self.assertEqual(command[1], 'show')
                if '--property=Version' not in command:
                    self.assertIn('--', command)
            else:
                self.assertEqual(command[0], '/usr/bin/findmnt')
        for filename, raw in before.items():
            self.assertEqual(filename.read_bytes(), raw)

    def test_only_exact_root_mount_exception_and_original_provider_names_are_accepted(self):
        f = self.fixture('provider-name')
        for provider in ('-.mount', 'original-provider.mount', 'original-provider.service'):
            with self.subTest(provider=provider):
                f.provider(provider)
                self.assertIs(f.run()['installed'], False)
        for provider in ('-.service', '-other.mount', '--runtime.mount', '.', '', ' -.mount', '-.mount ',
                         '-.mount\n', '../-.mount', installer.SERVICE):
            with self.subTest(provider=provider):
                f.provider(provider)
                with self.assertRaisesRegex(ValueError, 'EXPLICIT_ORIGINAL_PROVIDER_REQUIRED'):
                    f.run()
        self.assertEqual(f.host.owners, [])

    def test_real_host_root_policy_rejects_submount_device_alias_and_incomplete_observations(self):
        f = self.fixture('mount-observation')
        f.provider('-.mount')
        for name in ('inactive', 'wrong-unit', 'where', 'what', 'fragment', 'extra-unit', 'submount', 'bind-fsroot',
                     'device', 'missing-id', 'multiple', 'extra-mount', 'mount-id-drift', 'namespace', 'symlink', 'absent'):
            with self.subTest(name=name):
                host = RootMountObservations(f)
                checkpoint = f.config['checkpointDirectory']
                if name == 'inactive': host.unit['ActiveState'] = 'inactive'
                elif name == 'wrong-unit': host.unit['Id'] = 'alias.mount'
                elif name == 'where': host.unit['Where'] = '/var/lib'
                elif name == 'what': host.unit['What'] = '/dev/foreign'
                elif name == 'fragment': host.unit['FragmentPath'] = ''
                elif name == 'extra-unit': host.unit['Unexpected'] = 'yes'
                elif name == 'submount': host.mount['target'] = checkpoint
                elif name == 'bind-fsroot': host.mount['fsroot'] = '/some-original-alias'
                elif name == 'device': host.mount['maj:min'] = '253:999'
                elif name == 'missing-id': del host.mount['id']
                elif name == 'multiple': host.extra_filesystem = True
                elif name == 'extra-mount': host.mount['children'] = []
                elif name == 'mount-id-drift':
                    host.on_mount = lambda count: host.mount.update(id=31) if count == 2 else None
                elif name == 'namespace': host.namespace = 'unknown'
                elif name == 'symlink':
                    alias = f.root / 'alias'; alias.symlink_to(checkpoint, target_is_directory=True)
                    checkpoint = str(alias)
                elif name == 'absent': checkpoint = str(f.root / 'absent')
                with host.metadata(), self.assertRaises((ValueError, FileNotFoundError)):
                    host.observe('-.mount', checkpoint)
                self.assertEqual(host.owners, [])
                self.assertFalse(Path(f.args.output_dir).exists())

    def test_root_mount_directory_times_can_change_but_identity_or_mount_change_retains_unknown(self):
        f = self.fixture('root-live-commit')
        f.provider('-.mount'); f.args.install = True; f.host = RootMountObservations(f)
        def commit_times(count):
            directory = Path(f.config['checkpointDirectory'])
            info = directory.stat()
            os.utime(directory, ns=(info.st_atime_ns, info.st_mtime_ns + 1))
            if count == 3:
                replacement = directory / 'normal-writer-commit'
                write(replacement, b'ACTUAL WRITER CAN REPLACE ITS ORIGINAL STATE; no freshness assertion\n')
                os.replace(replacement, f.config['abciState'])
        f.host.on_mount = commit_times
        with f.host.metadata():
            self.assertIs(f.run()['installed'], True)
        for name, changed_at in (('before-write', 3), ('after-write', 5)):
            with self.subTest(name=name):
                f = self.fixture(name)
                f.provider('-.mount'); f.args.install = True; f.host = RootMountObservations(f)
                f.host.on_mount = lambda count: f.host.mount.update(id=31) if count == changed_at else None
                with f.host.metadata(), self.assertRaisesRegex(ValueError, 'ORIGINAL_CHECKPOINT_PROVIDER_CHANGED_'):
                    f.run()
                self.assertTrue((Path(f.args.output_dir) / 'intent.json').exists())
                self.assertFalse((Path(f.args.output_dir) / 'receipt.json').exists())
                self.assertEqual(bool(f.host.owners and len(f.host.owners) > 1), name == 'after-write')
        f = self.fixture('directory-replaced')
        f.provider('-.mount'); host = RootMountObservations(f)
        directory = Path(f.config['checkpointDirectory'])
        def replace_directory(count):
            if count == 1:
                directory.rename(directory.with_name('retained-original-directory'))
                directory.mkdir(mode=0o700)
        host.on_mount = replace_directory
        with host.metadata(), self.assertRaisesRegex(ValueError, 'ORIGINAL_ROOT_MOUNT_DIRECTORY_OR_NAMESPACE_CHANGED'):
            host.observe('-.mount', str(directory))
        self.assertTrue((directory.with_name('retained-original-directory') / 'original-state').exists())
        self.assertFalse(Path(f.args.output_dir).exists())

    def test_localhost_existing_provider_commands_use_option_terminator(self):
        host = installer.LocalHost()
        replies = ['255.4-1ubuntu8.12', 'LoadState=loaded\nActiveState=active',
                   'LoadState=not-found\nActiveState=inactive\nDropInPaths=']
        with mock.patch.object(host, 'command', side_effect=replies) as command:
            self.assertIsNone(host.observe('original-source.mount', '/original/checkpoint'))
        self.assertEqual(command.call_args_list[1].args[0], ['/usr/bin/systemctl', 'show', '--property=LoadState',
                          '--property=ActiveState', '--', 'original-source.mount'])
        self.assertEqual(command.call_args_list[2].args[0], ['/usr/bin/systemctl', 'show', '--property=LoadState',
                          '--property=ActiveState', '--property=DropInPaths', '--', installer.SERVICE])

    def test_actual_launcher_config_filter_allows_only_exact_root_exception_without_weakening_readonly_checks(self):
        f = self.fixture('launcher-root-config')
        launcher = f.templates[installer.DAEMON + '-launch.sh'].decode()
        start = "jq -e '\n"
        end = "\n' <<<\"$config_json\" >/dev/null 2>&1 || fail 'unsupported or incomplete operator configuration'"
        self.assertEqual(launcher.count(start), 1)
        filter_body = launcher.split(start, 1)[1].split(end, 1)[0]
        self.assertIn(end, launcher)
        for provider in ('-.mount', 'original.mount', 'original.service', '-.service', '-other.mount', installer.SERVICE):
            f.config['checkpointProviderUnit'] = provider
            result = installer.subprocess.run(['/usr/bin/jq', '-e', filter_body],
                input=json.dumps(f.config).encode(), stdout=installer.subprocess.PIPE, stderr=installer.subprocess.PIPE,
                env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, check=False, timeout=5)
            self.assertEqual(result.returncode == 0, provider in ('-.mount', 'original.mount', 'original.service'))
        self.assertIn('readonly_mount "$checkpoint_directory"', launcher)
        self.assertIn('checkpoint_source "$state" "$(field checkpointFormat)"', launcher)
        self.assertIn('systemctl is-active --quiet -- "$provider"', launcher)
        self.assertIn('systemctl show --property=MemoryMax --value -- ynx-consensus-pq-remote-signer.service', launcher)

    def test_explicit_install_exact_original_bytes_no_service_or_custody_changes(self):
        f = self.fixture('installed')
        before = {Path(p): Path(p).read_bytes() for p in f.forbidden}
        f.args.install = True
        result = f.run()
        self.assertIs(result['installed'], True)
        self.assertIs(result['nativeRootAuthorized'], False)
        self.assertIs(result['pqActivation'], False)
        self.assertIs(result['publicDeployment'], False)
        self.assertEqual(f.host.destination(installer.TARGETS['unit']).read_bytes(), f.expected_unit)
        self.assertEqual(f.host.destination(installer.TARGETS['binary']).read_bytes(), (f.bundle / installer.DAEMON).read_bytes())
        self.assertEqual(f.host.destination(installer.TARGETS['launcher']).read_bytes(), f.templates[installer.DAEMON + '-launch.sh'])
        raw = f.host.destination(installer.TARGETS['config']).read_bytes()
        self.assertEqual(raw, (json.dumps(f.config, sort_keys=True, separators=(',', ':')) + '\n').encode())
        self.assertEqual({p.name for p in Path(f.args.output_dir).iterdir()}, {'intent.json', 'receipt.json'})
        self.assertTrue(all(event[0] == 'read-only-host-observation' for event in f.host.events))
        self.assertEqual(f.host.destination(installer.TARGETS['config']).stat().st_mode & 0o777, 0o640)
        self.assertIn((str(f.host.destination(installer.TARGETS['config'])), 0, os.getgid()), f.host.owners)
        for p, raw in before.items(): self.assertEqual(p.read_bytes(), raw)
        saved = {p: p.read_bytes() for p in f.host_root.rglob('*') if p.is_file()}
        with self.assertRaisesRegex(ValueError, 'EXISTING_INSTALL_OR_UNKNOWN'): f.run()
        for p, raw in saved.items(): self.assertEqual(p.read_bytes(), raw)

    def test_bad_pins_plan_endpoint_and_original_dependencies_refuse(self):
        for name in ('runtime-pin', 'commit', 'config-pin', 'unit-pin', 'plan-pin', 'credential-pin',
                     'plan-endpoint', 'reverse-engine-peer', 'provider', 'existing-unit', 'writable-history-alias', 'missing-hist', 'wide-key', 'symlink-key'):
            with self.subTest(name=name):
                f = self.fixture(name)
                f.args.install = True
                if name == 'runtime-pin': f.args.runtime_source_sha256 = 'f' * 64
                elif name == 'commit': f.args.runtime_commit = 'f' * 40
                elif name == 'config-pin': f.args.config_sha256 = 'f' * 64
                elif name == 'unit-pin': f.args.unit_sha256 = 'f' * 64
                elif name == 'plan-pin': f.args.operator_plan_sha256 = 'f' * 64
                elif name == 'credential-pin': f.args.credential_sha256 = 'f' * 64
                elif name == 'plan-endpoint':
                    f.plan['roles'][0]['remoteSigner'] = 'tcp://127.0.0.1:27702'
                    f.plan_path.write_bytes(json.dumps(f.plan).encode()); f.args.operator_plan_sha256 = sha(f.plan_path.read_bytes())
                elif name == 'reverse-engine-peer': Path(f.config['enginePeerPin']).write_bytes(('e' * 64 + '\n').encode())
                elif name == 'provider': f.host.provider_ready = False
                elif name == 'existing-unit': f.host.existing_unit = True
                elif name == 'writable-history-alias':
                    filename = Path(f.config['pqState']).parent / 'genesis.json'
                    write(filename, f.genesis)
                    f.config['genesis'] = str(filename)
                    f.config_path.write_bytes(json.dumps(f.config).encode()); f.args.config_sha256 = sha(f.config_path.read_bytes())
                elif name == 'missing-hist': Path(f.config['pqState']).rename(Path(f.config['pqState'] + '.retained'))
                elif name == 'wide-key': f.legacy.chmod(0o644)
                elif name == 'symlink-key':
                    target = f.legacy.with_suffix('.retained'); f.legacy.rename(target); f.legacy.symlink_to(target)
                with self.assertRaises((ValueError, FileNotFoundError)): f.run()
                self.assertFalse(Path(f.args.output_dir).exists())
                for target in installer.TARGETS.values(): self.assertFalse(f.host.destination(target).exists())

    def test_live_checkpoint_replacement_preserves_directory_binding_without_freshness_claim(self):
        f = self.fixture('live-replace')
        f.args.install = True
        def committed_replacement():
            replacement = Path(f.config['abciState'] + '.writer-committed')
            write(replacement, b'NEW ORIGINAL WRITER COMMIT; installer only observes metadata\n')
            os.replace(replacement, f.config['abciState'])
        f.host.drift_on_second = committed_replacement
        result = f.run()
        self.assertIs(result['installed'], True)
        self.assertIs(result['freshnessVerified'], False)
        self.assertIs(result['sandboxReadonlyValidated'], False)
        self.assertIn(('BindReadOnlyPaths=' + f.config['checkpointDirectory']).encode(),
                      f.host.destination(installer.TARGETS['unit']).read_bytes())

    def test_unit_paths_reject_specifiers_controls_and_tokenization_even_with_matching_pin(self):
        for index, suffix in enumerate(('%n', '\nInjected=yes', ' extra-path', '\\escape')):
            with self.subTest(suffix=suffix):
                f = self.fixture('unit-value-' + str(index))
                f.args.operator_inputs_directory = str(f.public) + suffix
                # A matching public unit digest cannot authorize a value that
                # systemd would interpret differently from the stat path.
                raw = f.expected_unit.replace(str(f.public).encode(), f.args.operator_inputs_directory.encode())
                f.args.unit_sha256 = sha(raw)
                with self.assertRaisesRegex(ValueError, 'CANONICAL_ORIGINAL_PATH_REQUIRED'): f.run()
                self.assertEqual(f.host.events, [])
                self.assertEqual(f.host.owners, [])

    def test_existing_targets_and_unknowns_are_retained(self):
        for name in ('target', 'target-link', 'target-partial', 'attempt', 'attempt-unknown'):
            with self.subTest(name=name):
                f = self.fixture(name)
                f.args.install = True
                target = f.host.destination(installer.TARGETS['unit'])
                if name == 'target': retained = target; write(retained, b'ORIGINAL UNIT\n')
                elif name == 'target-link': retained = target; target.symlink_to(f.root / 'absent')
                elif name == 'target-partial': retained = Path(str(target) + '.partial'); write(retained, b'ORIGINAL UNKNOWN\n')
                elif name == 'attempt':
                    retained = Path(f.args.output_dir); retained.mkdir(mode=0o700); write(retained / 'intent.json', b'ORIGINAL UNKNOWN\n')
                else: retained = Path(f.args.output_dir + '.UNKNOWN'); write(retained, b'ORIGINAL UNKNOWN\n')
                with self.assertRaises(ValueError): f.run()
                self.assertTrue(os.path.lexists(retained))
                self.assertEqual(f.host.owners, [])

    def test_mid_install_failure_and_late_source_drift_preserve_unknown(self):
        for name in ('partial', 'hrs-drift'):
            with self.subTest(name=name):
                f = self.fixture(name)
                f.args.install = True
                if name == 'partial': f.host.fail_owner_at = 3  # intent+binary then launcher partial
                else:
                    def drift():
                        filename = Path(f.config['pqState'])
                        info = filename.stat()
                        os.utime(filename, ns=(info.st_atime_ns, info.st_mtime_ns + 1))
                    f.host.drift_on_second = drift
                with self.assertRaises((ValueError, OSError)): f.run()
                evidence = Path(f.args.output_dir)
                self.assertTrue((evidence / 'intent.json').exists())
                self.assertFalse((evidence / 'receipt.json').exists())
                saved = {p: p.read_bytes() for p in f.host_root.rglob('*') if p.is_file()}
                owners = list(f.host.owners)
                with self.assertRaises(ValueError): f.run()
                self.assertEqual(f.host.owners, owners)
                for p, raw in saved.items(): self.assertEqual(p.read_bytes(), raw)
                if name == 'partial': self.assertTrue(f.host.destination(installer.TARGETS['launcher']).exists())


class SignerInstallerCLIControls(unittest.TestCase):
    """Real main parsers with an explicit non-executing run-boundary sentinel."""
    values = {
        'runtime-bundle': '/synthetic/normal-runtime', 'runtime-commit': 'a' * 40,
        'runtime-source-sha256': '1' * 64, 'operator-plan': '/synthetic/operator-plan.json',
        'operator-plan-sha256': '2' * 64, 'role': 'primary', 'config': '/synthetic/config.json',
        'config-sha256': '3' * 64, 'unit-sha256': '4' * 64,
        'operator-inputs-directory': '/synthetic/public-inputs', 'credential-sha256': '5' * 64,
    }

    class RunBoundary(RuntimeError):
        pass

    def argv(self, values=None, equals=False):
        values = self.values if values is None else values
        return [arg for name, value in values.items()
                for arg in (['--'+name+'='+value] if equals else ['--'+name,value])]

    @contextlib.contextmanager
    def boundary(self, module):
        # No installer, service/account observation, parser subprocess or file
        # reader can run while testing either original or fixed entrypoints.
        with contextlib.ExitStack() as stack:
            functions = {}
            for name in ('LocalHost','read','regular','runtime_inputs','rendered','original_inputs'):
                functions[name] = stack.enter_context(mock.patch.object(module,name))
            functions['subprocess'] = stack.enter_context(mock.patch.object(installer.subprocess,'run',side_effect=AssertionError('CLI attempted host command')))
            functions['open'] = stack.enter_context(mock.patch.object(installer.os,'open',side_effect=AssertionError('CLI attempted file open')))
            run = stack.enter_context(mock.patch.object(module,'run',side_effect=self.RunBoundary))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            yield run, functions, output
            for function in functions.values():
                function.assert_not_called()

    def original(self):
        # Reconstruct the complete reachable 0e67 Git callee by reversing only
        # this entrypoint repair, then require its independent whole-file pin.
        # No copied historical implementation or shallow-Git/network reliance.
        current = FILE.read_bytes()
        # Reverse this later capability acquisition change first. Require the
        # independently frozen whole d2bf source before earlier historical REDs;
        # do not relabel an updated implementation as the old caller.
        begin = current.index(b'CHECKPOINT_ACCESS_FIELDS = ')
        current = current[:begin] + b'\n\n' + current[current.index(b'def need(ok, code):\n', begin):]
        begin = current.index(b'    def engine_account(self):\n')
        current = current[:begin] + current[current.index(b'    def observe(self, provider, checkpoint_directory=None):\n', begin):]
        changed = b'''    need(type(config) is dict and set(config) in (set(template) - CHECKPOINT_ACCESS_FIELDS, set(template))
         and config.get('schema') == template.get('schema')
         and config['schema'] == 'ynx-pq-remote-service-v1', 'ORIGINAL_CLOSED_CONFIG_REQUIRED')
    uses_fd = checkpoint_access(config)
    need(not uses_fd or CHECKPOINT_ACCESS_FIELDS <= set(template), 'PINNED_RUNTIME_UNIX_FD_TEMPLATE_REQUIRED')
'''
        previous = b'''    need(type(config) is dict and set(config) == set(template) and config.get('schema') == template.get('schema')
         and config['schema'] == 'ynx-pq-remote-service-v1', 'ORIGINAL_CLOSED_CONFIG_REQUIRED')
'''
        self.assertEqual(current.count(changed), 1)
        current = current.replace(changed, previous, 1)
        changes = (
            (b"('@' not in v or k == 'checkpointAccessSocket')", b"'@' not in v"),
            (b"    replacements = {'CHECKPOINT_PROVIDER_UNIT': provider,\n", b"    replacements = {'CHECKPOINT_PROVIDER_UNIT': provider, 'CHECKPOINT_DIRECTORY': config['checkpointDirectory'],\n"),
            (b'    source_uid = checkpoint_owner(config, host, uid)\n', b''),
            (b"source_uid if key == 'abciState' else uid)", b'uid)'),
            (b'        info = host.private_stat(filename, 65536, source_uid, 0)\n', b'        info = host.private_stat(filename, 65536, uid, 0)\n'),
            (b"        owner = source_uid if filename == Path(config['abciState']) else (uid if filename != actual else 0)\n        host.trusted(filename.parent, owner)\n",
             b'        host.trusted(filename.parent, uid if filename != actual else 0)\n'),
            (b'    uid = checkpoint_owner(config, host, uid)\n', b''),
        )
        for changed, previous in changes:
            self.assertEqual(current.count(changed), 1)
            current = current.replace(changed, previous, 1)
        begin = current.index(b"    if 'CHECKPOINT_DIRECTORY' in tokens:\n")
        current = current[:begin] + current[current.index(b'    need(tokens == set(replacements)', begin):]
        begin = current.index(b'    if checkpoint_access(config):\n        expected_access = ')
        current = current[:begin] + current[current.index(b"    need(role['remoteSigner']", begin):]
        begin = current.index(b'    if checkpoint_access(config):\n        need(not any(')
        current = current[:begin] + current[current.index(b'    actual = host.destination(CREDENTIAL)\n', begin):]
        self.assertEqual(len(current), 29340)
        self.assertEqual(sha(current), '1e8c11e41ff5627ee08dbfc649c7e281ba49cf2566fb14cbbf2fdc1a5380b3b2')
        # First reverse only the later root-filesystem admission/path repair.
        # The entire pre-repair module must remain exact 4e74 source, then the
        # earlier CLI reverse patch below proves exact original 0e67 identity.
        start = b'    def observe(self, provider, checkpoint_directory=None):\n'
        end = b'    def destination(self, filename):\n'
        self.assertEqual(current.count(start), 1)
        previous_observe = b'''    def observe(self, provider):
        version = self.command(['/usr/bin/systemctl', 'show', '--property=Version', '--value'])
        need(re.fullmatch(r'[0-9]+[^\\n]*', version) and int(re.match('[0-9]+', version)[0]) >= 250,
             'EXISTING_SYSTEMD_250_REQUIRED')
        provider_state = self.command(['/usr/bin/systemctl', 'show', provider, '--property=LoadState', '--property=ActiveState'])
        need(unique(line.split('=', 1) for line in provider_state.splitlines()) == {'LoadState': 'loaded', 'ActiveState': 'active'},
             'EXISTING_REAL_CHECKPOINT_PROVIDER_REQUIRED')
        active = self.command(['/usr/bin/systemctl', 'show', SERVICE, '--property=LoadState', '--property=ActiveState', '--property=DropInPaths'], (0, 4))
        need(unique(line.split('=', 1) for line in active.splitlines()) == {'LoadState': 'not-found', 'ActiveState': 'inactive', 'DropInPaths': ''},
             'EXISTING_SIGNER_UNIT_OR_PROCESS_MUST_BE_RETAINED')

'''
        at = current.index(start)
        current = current[:at] + previous_observe + current[current.index(end, at):]
        replacements = (
            (b"(provider == '-.mount' or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\\.(service|mount)', provider))",
             b"re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\\.(service|mount)', provider)"),
            (b"    need(role['abciState'] == config['abciState'], 'ORIGINAL_PLAN_CHECKPOINT_PATH_MISMATCH')\n", b''),
            (b"    provider_observation = host.observe(config['checkpointProviderUnit'], config['checkpointDirectory'])\n",
             b"    host.observe(config['checkpointProviderUnit'])\n"),
            (b"    need(host.observe(config['checkpointProviderUnit'], config['checkpointDirectory']) == provider_observation,\n         'ORIGINAL_CHECKPOINT_PROVIDER_CHANGED_BEFORE_INSTALL')\n",
             b"    host.observe(config['checkpointProviderUnit'])\n"),
            (b"    if config['checkpointProviderUnit'] == '-.mount':\n        need(host.root_provider_snapshot(config['checkpointDirectory']) == provider_observation\n             and host.root_provider_snapshot(config['checkpointDirectory']) == provider_observation,\n             'ORIGINAL_CHECKPOINT_PROVIDER_CHANGED_DURING_INSTALL')\n", b''),
        )
        for changed, previous in replacements:
            self.assertEqual(current.count(changed), 1)
            current = current.replace(changed, previous, 1)
        self.assertEqual(len(current), 24691)
        self.assertEqual(sha(current), '07a36fd0becf6040472d36dd3efecd651131cfb20532a482a92e86d0b4c45495')
        changed = b'''    required = ('runtime-bundle', 'runtime-commit', 'runtime-source-sha256', 'operator-plan', 'operator-plan-sha256',
                'role', 'config', 'config-sha256', 'unit-sha256', 'operator-inputs-directory', 'credential-sha256')
    for name in required:
'''
        previous = b'''    for name in ('runtime-bundle', 'runtime-commit', 'runtime-source-sha256', 'operator-plan', 'operator-plan-sha256',
                 'role', 'config', 'config-sha256', 'unit-sha256', 'operator-inputs-directory', 'credential-sha256'):
'''
        guard = b'''    for name in (*required, 'install', 'output-dir'):
        need(sum(item.split('=', 1)[0] == '--' + name for item in argv) <= 1,
             'DUPLICATE_INSTALLER_OPTION_REFUSED')
'''
        self.assertEqual(current.count(changed),1)
        self.assertEqual(current.count(guard),1)
        raw = current.replace(changed,previous,1).replace(guard,b'',1)
        self.assertEqual(len(raw),24485)
        self.assertEqual(sha(raw),'710ec9ed5ec82c455fe6b385f5a4254f37551ada9b4d1ee670f0da4f2a878b28')
        module = type(installer)('signer_installer_original_0e67')
        module.__file__ = str(FILE)
        exec(compile(raw,str(FILE),'exec'),module.__dict__)
        return module

    def test_original_same_config_different_engine_checkpoint_was_accepted_now_refused(self):
        original = self.original()
        with tempfile.TemporaryDirectory(prefix='ynx-signer-original-source-') as temporary:
            f = Fixture(Path(temporary).resolve(), 'checkpoint-mismatch')
            f.plan['roles'][0]['abciState'] = '/original/different-engine-state'
            f.plan_path.write_bytes((json.dumps(f.plan, separators=(',', ':')) + '\n').encode())
            f.args.operator_plan_sha256 = sha(f.plan_path.read_bytes())
            # Current runtime templates have explicit access-mode tokens. The
            # exact historical input callee itself still accepts the wrong
            # original App path; no synthetic old runtime is substituted.
            original.original_inputs(f.args, f.config, f.host, os.getuid())
            with self.assertRaisesRegex(ValueError, 'ORIGINAL_PLAN_CHECKPOINT_PATH_MISMATCH'):
                installer.original_inputs(f.args, f.config, f.host, os.getuid())
            self.assertFalse(Path(f.args.output_dir).exists())
            self.assertEqual(f.host.owners, [])

    def test_actual_original_0e67_last_wins_then_fixed_refuses_same_security_inputs(self):
        original = self.original()
        for name, replacement in [('operator-plan-sha256','f'*64),('config','/synthetic/replaced-config.json'),
                                  ('credential-sha256','e'*64)]:
            for style in ('separate','equals','mixed'):
                # All forms use the original caller's complete required argv.
                # Only run's boundary is observed, never an installation result.
                args = self.argv(equals=style=='mixed')
                args += ['--'+name+'='+replacement] if style in ('equals','mixed') else ['--'+name,replacement]
                with self.subTest(name=name,style=style),self.boundary(original) as (run,_,out):
                    with self.assertRaises(self.RunBoundary): original.main(args)
                    self.assertEqual(getattr(run.call_args.args[0],name.replace('-','_')),replacement)
                    self.assertEqual(run.call_count,1);self.assertEqual(out.getvalue(),'')
                with self.boundary(installer) as (run,_,out):
                    with self.assertRaisesRegex(ValueError,'DUPLICATE_INSTALLER_OPTION_REFUSED'):installer.main(args)
                    run.assert_not_called();self.assertEqual(out.getvalue(),'')
        print('REMOTE_SIGNER_CLI_ORIGINAL_0E67_LAST_WINS_RED_FIXED_DUPLICATE_REFUSED_DATA_ONLY')

    def test_every_supported_option_duplicate_refuses_before_parse_io_host_or_run(self):
        options = dict(self.values, **{'output-dir':'/synthetic/install-attempt'})
        for name in (*options,'install'):
            for style in ('separate','equals','mixed','reverse-mixed'):
                values = {key:value for key,value in self.values.items() if key != name}
                args = self.argv(values)
                if name == 'install': extra = ['--install','--install']
                else:
                    old = options[name]; new = '/synthetic/replacement' if old.startswith('/') else 'replaced'
                    first = ['--'+name,old] if style in ('separate','mixed') else ['--'+name+'='+old]
                    second = ['--'+name,new] if style in ('separate','reverse-mixed') else ['--'+name+'='+new]
                    extra = first+second
                with self.subTest(name=name,style=style),self.boundary(installer) as (run,_,out), \
                        mock.patch.object(installer.argparse.ArgumentParser,'parse_args') as parse:
                    with self.assertRaisesRegex(ValueError,'DUPLICATE_INSTALLER_OPTION_REFUSED'):installer.main(args+extra)
                    parse.assert_not_called();run.assert_not_called();self.assertEqual(out.getvalue(),'')

    def test_legal_single_options_keep_default_data_and_explicit_install_run_boundary(self):
        for equals in (False,True):
            for install, output in ((False,None),(False,'/synthetic/data-output'),(True,'/synthetic/install-attempt')):
                values = dict(self.values)
                if output is not None: values['output-dir'] = output
                args = self.argv(values,equals)
                if install:args.append('--install')
                with self.subTest(equals=equals,install=install,output=output),self.boundary(installer) as (run,_,out):
                    with self.assertRaises(self.RunBoundary):installer.main(args)
                    namespace = run.call_args.args[0]
                    self.assertEqual(vars(namespace),{**{name.replace('-','_'):value for name,value in self.values.items()},
                                                      'install':install,'output_dir':output})
                    self.assertEqual(run.call_count,1);self.assertEqual(out.getvalue(),'')

    def test_unknown_abbreviated_and_positional_options_still_refuse_before_run(self):
        for extra in (['--operator-plan-sha','f'*64],['--conf','/synthetic/foreign'],['--start'],
                      ['--install=true'],['unexpected']):
            with self.subTest(extra=extra),self.boundary(installer) as (run,_,out):
                with self.assertRaises(SystemExit) as stopped:installer.main(self.argv()+extra)
                self.assertEqual(stopped.exception.code,2);run.assert_not_called();self.assertEqual(out.getvalue(),'')


if __name__ == '__main__':
    unittest.main()
