#!/usr/bin/env python3
"""Synthetic filesystem controls, not a valid operator package or host capacity."""
import hashlib
import copy
import importlib.util
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
import subprocess
from unittest import mock

spec = importlib.util.spec_from_file_location('transition_payload', Path(__file__).with_name('public-bft-transition-payload.py'))
payload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(payload)


class TransitionPayloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='transition-public-payload-')
        self.root = Path(self.temp.name).resolve()
        self.stage = self.root / 'stage'
        self.old = self.root / 'old'
        self.stage.mkdir(mode=0o700)
        self.old.mkdir(mode=0o700)
        for name in ('helper.sh', 'approval.json', 'old-SOURCE.json', 'SOURCE.json'):
            self.write(self.stage / name, b'PUBLIC synthetic stage\n')
        self.write(self.stage / 'SOURCE.json', payload.encode({'binaries': {
            name: {'bytes': 17, 'sha256': hashlib.sha256(b'PUBLIC ELF standin').hexdigest()}
            for name in ('ynx-comet', 'ynx-consensus-package', 'ynx-consensus-keycheck')}}))
        for role in payload.ROLES:
            self.write(self.stage / ('freeze-markers/' + role + '.json'), b'PUBLIC freeze DATA\n')
        self.plan = b'{"syntheticOnly":true}\n'
        self.plan_pin = hashlib.sha256(self.plan).hexdigest()
        self.write(self.old / 'common/operator-plan.json', self.plan)
        self.write(self.old / 'package-manifest.json', b'{"syntheticOnly":true}\n')
        self.migration = b'PUBLIC synthetic migration with all copies\n' * 8193
        for name in payload.MIGRATIONS:
            self.write(self.old / name, self.migration)
        self.catalog = self.root / 'catalog.json'
        self.archive = self.root / 'source.tar.gz'
        self.values = (self.stage, self.old, self.plan_pin, '-', '-', 'quiesce')

    def tearDown(self):
        self.temp.cleanup()

    def write(self, path, raw):
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.write_bytes(raw)
        path.chmod(0o600)

    def inspect(self):
        record, sources = payload.inspect_inputs(*self.values)
        payload.durable(self.catalog, payload.encode(record))
        return record, sources

    def test_five_full_single_link_originals_stream_without_staging_copy(self):
        record, sources = self.inspect()
        identities = {name: payload.public.identity(path.stat()) for name, path in sources.items()}
        payload.pack(*self.values, self.catalog, self.archive)
        self.assertFalse((self.stage / 'old-package').exists())
        self.assertGreaterEqual(int(record['localPackageCopyBytesAvoided']), 5 * len(self.migration))
        self.assertEqual(len({(self.old / n).stat().st_ino for n in payload.MIGRATIONS}), 5)
        self.assertTrue(all((self.old / n).stat().st_nlink == 1 for n in payload.MIGRATIONS))
        with tarfile.open(self.archive, 'r:gz') as archive:
            members = archive.getmembers()
            self.assertEqual({m.name for m in members if m.isfile()}, set(sources))
            self.assertTrue(archive.getmember('bin').isdir())
            for member in members:
                if member.isdir(): continue
                self.assertTrue(member.isfile())
                self.assertEqual(archive.extractfile(member).read(), sources[member.name].read_bytes())
        self.assertEqual(identities, {name: payload.public.identity(path.stat()) for name, path in sources.items()})

    def test_before_and_during_stream_changes_keep_failed_partial(self):
        self.inspect()
        changed = self.old / payload.MIGRATIONS[0]
        original = changed.read_bytes()
        changed.write_bytes(b'x' + original[1:])
        with self.assertRaisesRegex(ValueError, 'equal migrations|catalog changed'):
            payload.pack(*self.values, self.catalog, self.archive)
        self.assertFalse(self.archive.exists())
        changed.write_bytes(original)
        real_read = payload.DigestReader.read
        changed_once = []
        def read_then_change(reader, size):
            raw = real_read(reader, size)
            if not changed_once:
                changed_once.append(True)
                with changed.open('r+b') as out:
                    out.write(b'x')
            return raw
        with mock.patch.object(payload.DigestReader, 'read', read_then_change):
            with self.assertRaisesRegex(ValueError, 'changed'):
                payload.pack(*self.values, self.catalog, self.archive)
        self.assertTrue(self.archive.is_file())
        with self.assertRaises((FileExistsError, ValueError)):
            payload.pack(*self.values, self.catalog, self.archive)

    def test_alias_unknown_and_missing_members_refuse(self):
        for kind in ('symlink', 'hardlink', 'private-member', 'missing-copy', 'foreign-stage', 'wrong-pin'):
            with self.subTest(kind=kind):
                target = self.old / payload.MIGRATIONS[-1]
                saved = target.read_bytes()
                added = None
                try:
                    if kind == 'symlink':
                        target.unlink(); target.symlink_to(self.old / payload.MIGRATIONS[0])
                    elif kind == 'hardlink':
                        target.unlink(); os.link(self.old / payload.MIGRATIONS[0], target)
                    elif kind == 'missing-copy':
                        target.unlink()
                    elif kind == 'private-member':
                        added = self.old / 'secret-key.json'; self.write(added, b'FORBIDDEN synthetic sentinel')
                    elif kind == 'foreign-stage':
                        added = self.stage / 'arbitrary.json'; self.write(added, b'PUBLIC but unapproved')
                    args = list(self.values)
                    if kind == 'wrong-pin': args[2] = 'a' * 64
                    with self.assertRaises((ValueError, FileNotFoundError)):
                        payload.inspect_inputs(*args)
                finally:
                    if added is not None: added.unlink()
                    if kind in ('symlink', 'hardlink', 'missing-copy'):
                        if target.exists() or target.is_symlink(): target.unlink()
                        self.write(target, saved)

    def test_no_compression_or_future_package_ready_assumption(self):
        record, _ = self.inspect()
        expected = 5 * len(self.migration) + 6 * (96 << 20) + (64 << 20)
        self.assertEqual(int(record['futurePackageBytesBound']), expected)
        self.assertGreater(int(record['stageBytesBound']), int(record['rawBytes']))
        self.assertEqual(int(record['phaseFreeBytesRequired']), 2 * int(record['stageBytesBound']) + (1 << 30))
        self.assertGreater(int(record['futureStageBytesBound']), expected + 5 * len(self.migration))
        self.assertFalse(record['privateBackupBudgetSupplied'])
        self.assertFalse(record['remoteCapacityQualified'])
        self.assertIsNone(record['nextOperatorPlanSHA256'])
        with self.assertRaises(FileExistsError): payload.durable(self.catalog, b'{}')

    def test_archive_bound_failure_retains_output_and_no_success(self):
        record, _ = self.inspect()
        # A deliberately too-small recorded bound is rejected by equality,
        # rather than trusting a caller-edited budget to waive a real write.
        record['archiveBytesBound'] = '1'
        self.catalog.write_bytes(payload.encode(record))
        with self.assertRaisesRegex(ValueError, 'catalog changed'):
            payload.pack(*self.values, self.catalog, self.archive)
        self.assertFalse(self.archive.exists())

    def test_every_host_failure_is_retained_before_any_freeze(self):
        caller = Path(__file__).with_name('public-bft-operator-transition.sh')
        for failed in payload.ROLES:
            with self.subTest(failed=failed):
                phase = self.root / failed
                phase.mkdir(mode=0o700)
                observed = phase / 'observed'
                script = r'''
source "$1"
phase_root="$2"; payload="$2/payload"
PRIMARY_NODE_USER=u; PRIMARY_NODE_HOST=h; PRIMARY_NODE_SSH_KEY=k
SG_NODE_USER=u; SG_NODE_HOST=h; SG_NODE_SSH_KEY=k
SILICON_VALLEY_NODE_USER=u; SILICON_VALLEY_NODE_HOST=h; SILICON_VALLEY_NODE_SSH_KEY=k
SEOUL_NODE_USER=u; SEOUL_NODE_HOST=h; SEOUL_NODE_SSH_KEY=k
bad="$3"; observed="$4"
operator_transition_capacity_role() { printf '%s\n' "$1" >>"$observed"; [[ "$1" != "$bad" ]]; }
if operator_transition_capacity_all; then printf 'FREEZE\n' >>"$observed"; exit 91; else code=$?; [[ "$code" == 1 ]]; fi
'''
                result = subprocess.run(['/bin/bash', '-c', script, 'control', str(caller), str(phase), failed, str(observed)],
                                        capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 0, 'pure barrier refused to preserve failure')
                self.assertEqual(observed.read_text().splitlines(), list(payload.ROLES))
                self.assertFalse((phase / 'payload').exists())

    def test_bridge_bins_counted_and_receipt_slots_do_not_change_preflight_bound(self):
        initial, _ = payload.inspect_inputs(*self.values)
        for name in payload.CAPACITY_RECEIPTS:
            self.write(self.stage / name, b'{"syntheticOnly":true}\n')
        after, _ = payload.inspect_inputs(*self.values)
        self.assertEqual(initial['stageBytesBound'], after['stageBytesBound'])
        self.assertGreater(int(initial['stageBytesBound']), 5 * len(self.migration) + 3 * payload.ALLOCATION)
        (self.stage / next(iter(payload.CAPACITY_RECEIPTS))).unlink()
        with self.assertRaisesRegex(ValueError, 'four capacity receipts'):
            payload.inspect_inputs(*self.values)

    def capacity_fixture(self, role='primary'):
        record, _ = payload.inspect_inputs(*self.values)
        binding = {'phase': 'quiesce', 'transitionId': 'synthetic-transition', 'role': role,
                   'approvalSHA256': 'a' * 64, 'oldOperatorPlanSHA256': self.plan_pin,
                   'oldRuntimeCommit': '1' * 40, 'oldRuntimeManifestSHA256': 'b' * 64,
                   'runtimeCommit': '2' * 40, 'runtimeManifestSHA256': 'c' * 64,
                   'oldCometSHA256': 'd' * 64}
        root = self.root / 'capacity' / role
        root.mkdir(mode=0o700, parents=True)
        self.write(root / 'catalog.json', payload.encode(record))
        self.write(root / 'binding.json', payload.encode(binding))
        payload.capacity_request(root / 'catalog.json', root / 'binding.json', root / 'request.json', True)
        request_raw = (root / 'request.json').read_bytes()
        request = payload.public.decode(request_raw)
        public_bound = 2 * int(request['quiesceStageBytesBound']) + 4 * int(request['futureStageBytesBound']) + 3 * payload.GIB
        groups = {kind: {'rawBytes': '1', 'files': '1', 'directories': '1', 'tarBytesBound': '10240', 'archiveBytesBound': '20480'}
                  for kind in ('committed', 'launch')}
        receipt = {'version': 'YNX-OPERATOR-TRANSITION-CAPACITY/v1', **{k: request[k] for k in payload.CAPACITY_IDENTITIES},
                   'requestSHA256': payload.public.sha(request_raw),
                   'process': {'mainPid': '123', 'startTicks': '456', 'runningExecutableSHA256': binding['oldCometSHA256']},
                   'groups': groups,
                   'bounds': {'publicStagesBytesBound': str(public_bound), 'backupBytesBound': '40960',
                              'installationBytesBound': str(len(self.migration)), 'heightHaltBytesBound': '1', 'bridgeBytesBound': '1', 'metadataReserveBytes': str(16 * payload.MIB)},
                   'filesystems': [{'device': '1', 'availableBytes': str(100 * payload.GIB), 'requiredBytes': str(public_bound + 40962 + len(self.migration) + 16 * payload.MIB)}],
                   'capacityAvailable': True, 'sampleOnly': True, 'growthReserved': False,
                   'requiresRemeasure': True, 'sourceGrant': False, 'firstNativeImport': False}
        return root, record, binding, request_raw, receipt

    def test_closed_capacity_and_every_missing_budget_or_authority_rejected(self):
        root, record, binding, raw, receipt = self.capacity_fixture()
        payload.validate_capacity(raw, payload.encode(receipt), binding)
        mutations = {
            'extra-private-path': lambda r: r.update({'privatePath': '/unapproved'}),
            'capacity-false': lambda r: r.update({'capacityAvailable': False}),
            'source-grant': lambda r: r.update({'sourceGrant': True}),
            'native-first-import': lambda r: r.update({'firstNativeImport': True}),
            'growth-assumption': lambda r: r.update({'growthReserved': True}),
            'wrong-process': lambda r: r['process'].update({'runningExecutableSHA256': 'e' * 64}),
            'wrong-request': lambda r: r.update({'requestSHA256': 'e' * 64}),
            'wrong-role': lambda r: r.update({'role': 'seoul'}),
            'missing-backup': lambda r: r['groups'].pop('committed'),
            'compressed-backup': lambda r: r['groups']['committed'].update({'archiveBytesBound': '1'}),
            'omitted-retained-phase': lambda r: r['bounds'].update({'publicStagesBytesBound': '1'}),
            'omitted-backup': lambda r: r['bounds'].update({'backupBytesBound': '1'}),
            'omitted-installation': lambda r: r['bounds'].update({'installationBytesBound': '1'}),
            'omitted-bridge': lambda r: r['bounds'].update({'bridgeBytesBound': '0'}),
            'omitted-target-budget': lambda r: r['filesystems'][0].update({'requiredBytes': '1'}),
            'noncanonical-bytes': lambda r: r['filesystems'][0].update({'availableBytes': '01'}),
            'exact-margin': lambda r: r['filesystems'][0].update({'availableBytes': r['filesystems'][0]['requiredBytes']}),
            'wrong-numeric-type': lambda r: r['filesystems'][0].update({'requiredBytes': 1}),
            'duplicate-filesystem': lambda r: r['filesystems'].append(copy.deepcopy(r['filesystems'][0])),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                changed = copy.deepcopy(receipt); mutate(changed)
                with self.assertRaises((ValueError, KeyError)):
                    payload.validate_capacity(raw, payload.encode(changed), binding)
        later = dict(binding, phase='install', approvalSHA256='e' * 64)
        payload.validate_capacity(raw, payload.encode(receipt), later)
        with self.assertRaisesRegex(ValueError, 'source/role'):
            payload.validate_capacity(raw, payload.encode(receipt), dict(later, runtimeCommit='3' * 40))

    def test_four_original_raw_receipts_and_later_phase_bounded(self):
        bindings = self.root / 'bindings'
        bindings.mkdir(mode=0o700)
        for role in payload.ROLES:
            root, record, binding, raw, receipt = self.capacity_fixture(role)
            self.write(root / 'source/request.json', raw)
            self.write(root / 'receipt.json', payload.encode(receipt))
            self.write(bindings / (role + '.binding.json'), payload.encode(binding))
        result = payload.capacity_set(self.root / 'capacity', bindings)
        self.assertEqual(set(result['roles']), set(payload.ROLES))
        for role in payload.ROLES:
            root = self.root / 'capacity' / role
            self.assertEqual(result['roles'][role]['requestSHA256'], payload.public.sha((root / 'source/request.json').read_bytes()))
            binding = payload.public.decode((bindings / (role + '.binding.json')).read_bytes())
            binding.update(phase='install', approvalSHA256='e' * 64)
            self.write(bindings / (role + '.binding.json'), payload.encode(binding))
        record['phase'] = 'install'
        payload.capacity_set(self.root / 'capacity', bindings, record=record, phase='install', bridge_mode=True)
        with self.assertRaisesRegex(ValueError, 'later phase'):
            payload.capacity_set(self.root / 'capacity', bindings, record=record, phase='install', bridge_mode=False)
        record['stageBytesBound'] = str(int(record['futureStageBytesBound']) + 1)
        with self.assertRaisesRegex(ValueError, 'later phase'):
            payload.capacity_set(self.root / 'capacity', bindings, record=record, phase='install', bridge_mode=True)

    def test_actual_remote_numeric_producer_receipt_consumed(self):
        # The original remote owner's real metadata walker is exercised on
        # its PUBLIC synthetic fixture. Only fstatvfs/ynx UID are test inputs;
        # no SSH, Node, secret body, or real host-capacity claim is involved.
        source = Path(__file__).with_name('test_public_bft_transition_capacity.py')
        spec = importlib.util.spec_from_file_location('actual_transition_capacity_fixture', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        fixture = module.Fixture(self.root / 'joint-callee')
        receipt = fixture.measure()
        payload.validate_capacity(module.raw(fixture.r), module.raw(receipt), fixture.b)
        rejected = fixture.measure(available=1)
        with self.assertRaisesRegex(ValueError, 'lacks cumulative'):
            payload.validate_capacity(module.raw(fixture.r), module.raw(rejected), fixture.b)


if __name__ == '__main__':
    unittest.main()
