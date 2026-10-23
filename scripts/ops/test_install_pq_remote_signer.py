#!/usr/bin/env python3
"""Original installer/render controls with explicit host-observation doubles.

The real unchanged v2 bundle parser reads inert ELF/header controls and original
three templates. No ELF, systemctl, service, network, real custody or key runs.
These DATA tests cannot qualify an installed signer, Root or signing session.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
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
        self.provider_ready, self.existing_unit = True, False
        self.drift_on_second = None
        self.observations = 0
        self.fail_owner_at = None

    def command(self, argv, accepted=(0,)):
        raise AssertionError('no real systemctl/findmnt/service command is allowed in these fixtures')

    def account(self):
        return os.getuid(), os.getgid()

    def observe(self, provider):
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
        role = dict(home='/original/engine-home', abciState='/original/engine-state', legacyKeyPath=str(self.legacy),
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
        replacements = {'CHECKPOINT_PROVIDER_UNIT': config['checkpointProviderUnit'], 'CHECKPOINT_DIRECTORY': config['checkpointDirectory'],
            'OPERATOR_INPUTS_DIRECTORY': str(self.public), 'ORIGINAL_VAULT': config['vault'], 'ORIGINAL_LEGACY_KEY': config['legacyKey'],
            'ORIGINAL_TRANSPORT_KEY': config['transportKey'], 'ORIGINAL_PQ_HRS_DIRECTORY': str(pq_state.parent),
            'ORIGINAL_LEGACY_HRS_DIRECTORY': str(legacy_state.parent), 'MEASURED_TARGET_MEMORY_MAX_BYTES': config['memoryMaxBytes']}
        self.expected_unit = self.templates[installer.DAEMON + '.service.in']
        for key, value in replacements.items():
            self.expected_unit = self.expected_unit.replace(('@' + key + '@').encode(), value.encode())
        self.args.unit_sha256 = sha(self.expected_unit)
        self.host = HostObservations(self)
        self.forbidden = {str(p) for p in (self.legacy, self.transport, self.vault, pq_state, legacy_state, state)}

    def run(self):
        original_open = os.open
        def guarded_open(filename, flags, *args, **kwargs):
            if str(filename) in self.forbidden:
                raise AssertionError('installer opened original private/history/checkpoint body')
            return original_open(filename, flags, *args, **kwargs)
        with mock.patch.object(installer.os, 'open', side_effect=guarded_open):
            return installer.run(self.args, host=self.host)


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


if __name__ == '__main__':
    unittest.main()
