#!/usr/bin/env python3
"""Isolated data/parser/filesystem regressions; never operates a real service."""
import argparse
from contextlib import ExitStack
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('ynx_testnet_assets', ROOT / 'remote/public-bft-prepare-testnet-assets.py')
assets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(assets)
CAPTURE_PIN = hashlib.sha256((ROOT / 'remote/public-bft-capture-snapshot-source.py').read_bytes()).hexdigest()
CAPTURE = assets.load_capture_tool(CAPTURE_PIN)


def snapshot():
    return dict(version=2, config=dict(name='YNX Testnet', slug='testnet', chainId=6423,
                nativeCoinName='YNXT', nativeCurrencySymbol='YNXT', chainIdConflictCheck='test-only-fixture',
                isPublicNet=True, decimals=18), blocks=[dict(height=0, hash='a' * 64,
                parentHash='', time='2026-01-01T00:00:00Z', validator='fixture-original-0', transactions=None),
                dict(height=1, hash='b' * 64, transactions=[])],
                validators=[dict(address='fixture-original-' + str(i), votingPower=1,
                    moniker='test-only-original-' + str(i), active=True, peerReady=False) for i in range(4)],
                accounts={'test-only-account': {'balance': 7, 'nonce': 3}},
                contracts={}, pending=[])


class GuardedStream(io.BytesIO):
    def read(self, maximum=-1):
        if not 0 <= maximum <= 65536:
            raise AssertionError('an unbounded/full-history read was attempted')
        return super().read(maximum)


class ParserTests(unittest.TestCase):
    def parse(self, raw):
        stream = GuardedStream(raw)
        reader = assets.PublicSnapshotReader(stream)
        public = reader.public_values(CAPTURE['decode'])
        self.assertEqual(reader.size, len(raw))
        self.assertEqual(reader.digest.hexdigest(), hashlib.sha256(raw).hexdigest())
        return public

    def test_extracts_exact_public_values_with_cross_chunk_strings(self):
        value = snapshot()
        value['unselected-before'] = ('A' * 65520 + 'quoted \\" { [ ] } 中文 😀 \u1234 ')*5
        value['blocks'].extend(dict(height=i, memo='irrelevant history {"x":[1]}') for i in range(2, 2000))
        value = {'unselected-first': value.pop('unselected-before'), **value}
        raw = json.dumps(value, ensure_ascii=False).encode()
        public = self.parse(raw)
        self.assertEqual(set(public), {'version', 'config', 'genesis', 'validators'})
        self.assertEqual(public['config'], value['config'])
        self.assertEqual(public['genesis'], value['blocks'][0])
        self.assertEqual(public['validators'], value['validators'])
        self.assertNotIn('accounts', public)

    def test_duplicate_missing_truncated_and_bad_escapes_refuse(self):
        raw = json.dumps(snapshot(), separators=(',', ':')).encode()
        cases = [raw.replace(b'"version":2', b'"version":2,"version":2', 1),
                 raw.replace(b'"chainId":6423', b'"chainId":6423,"chainId":6423', 1),
                 raw[:-1], raw + b'{}', raw[:-1] + b',}',
                 raw.replace(b'"config":{', b'"unselected":"bad\\u00XZ","config":{', 1)]
        missing = snapshot(); del missing['validators']; cases.append(json.dumps(missing).encode())
        missing = snapshot(); missing['blocks'] = []; cases.append(json.dumps(missing).encode())
        for index, case in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.parse(case)

    def test_selected_public_value_bound_is_enforced(self):
        value = snapshot(); value['blocks'][0]['memo'] = 'x' * 65536
        with self.assertRaisesRegex(ValueError, 'PUBLIC_VALUE_OVER_BOUND'):
            self.parse(json.dumps(value).encode())

    def test_normal_capture_callee_must_match_independent_pin(self):
        with self.assertRaisesRegex(ValueError, 'CAPTURE_TOOL_PIN_MISMATCH'):
            assets.load_capture_tool('f' * 64)


class RuntimeObservationTests(unittest.TestCase):
    def state(self, **overrides):
        result = dict(ActiveState='inactive', SubState='dead', MainPID='0', ControlGroup='',
                      UnitFileState='disabled', ExecMainPID='0')
        result.update(overrides)
        return subprocess.CompletedProcess([], 0, ''.join(k + '=' + v + '\n' for k, v in result.items()).encode(), b'')

    def test_archive_requires_actual_stopped_disabled_observation(self):
        for accepted in ('disabled', 'masked'):
            with mock.patch.object(assets.subprocess, 'run', return_value=self.state(UnitFileState=accepted)) as command, mock.patch.object(assets.Path, 'exists', return_value=False):
                self.assertEqual(assets.service_stopped('123456789')['MainPID'], '0')
                self.assertEqual(command.call_args.args[0][0:3], ['/usr/bin/systemctl', 'show', 'ynx-chaind.service'])
        for values in (dict(ActiveState='active'), dict(SubState='running'), dict(MainPID='123'),
                       dict(UnitFileState='enabled'), dict(UnitFileState='masked-runtime')):
            with self.subTest(values=values), mock.patch.object(assets.subprocess, 'run', return_value=self.state(**values)), self.assertRaises(ValueError):
                assets.service_stopped('123456789')
        with mock.patch.object(assets.subprocess, 'run', return_value=self.state()), mock.patch.object(assets.Path, 'exists', return_value=True), self.assertRaisesRegex(ValueError, 'ORIGINAL_PID'):
            assets.service_stopped('123456789')

    def test_fuser_live_holder_or_error_is_not_quiescence(self):
        for code, stderr in ((0, b''), (2, b'error'), (1, b'observation refused')):
            result = subprocess.CompletedProcess([], code, b'', stderr)
            with self.subTest(code=code, stderr=stderr), mock.patch.object(assets.subprocess, 'run', return_value=result), self.assertRaises(ValueError):
                assets.no_open_holders([Path('/test-only/fixture/devnet-state.json')])
        with mock.patch.object(assets.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'')) as command:
            assets.no_open_holders([Path('/test-only/fixture/devnet-state.json')])
            self.assertEqual(command.call_args.args[0], ['/usr/bin/fuser', '-s', '--', '/test-only/fixture/devnet-state.json'])


class FilesystemTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='ynx-testnet-assets-unit-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        os.chmod(self.root, 0o700)
        self.data = self.root / 'testnet'; self.data.mkdir(mode=0o755)
        self.ops = self.root / 'normal-transaction'; self.ops.mkdir(mode=0o700)
        self.tx, self.commit = 'test-only-transaction-0001', 'b777232db170'
        self.value = snapshot()
        self.state = self.write(self.data / assets.NAMES[0], json.dumps(self.value).encode())
        self.write(self.data / assets.NAMES[1], b'2\n')
        self.write(self.data / assets.NAMES[2], b'')
        self.write(self.data / assets.NAMES[3], b'')
        self.sentinels = {
            'priv_validator_key.json': b'test-only-key-sentinel-not-a-key',
            'priv_validator_state.json': b'test-only-HRS-sentinel',
            'validator-vault.json': b'test-only-vault-sentinel',
            'unrelated-product-file': b'test-only-product-sentinel'}
        for name, raw in self.sentinels.items(): self.write(self.data / name, raw)
        self.pause = self.write(self.root / 'block-production-pause.json', b'{"testOnly":true}')
        self.freeze = self.write(self.root / 'mutation-freeze.json', b'{"testOnly":true}')
        self.source = dict(version='YNX-PUBLIC-BFT-SNAPSHOT-SOURCE/v1', transactionId=self.tx,
             commit=self.commit, authoritativeRelease='ynx-network-surgical-65efa82e0615',
             bftRelease='ynx-bft-gateway-' + self.commit,
             statePath=str(self.state), stateBytes=str(self.state.stat().st_size), stateSHA256=self.sha(self.state),
             integrityMarkerPath=str(self.data / assets.NAMES[1]), integrityMarkerBytes='2',
             integrityMarkerSHA256=self.sha(self.data / assets.NAMES[1]), pauseMarkerPath=str(self.pause),
             pauseMarkerSHA256=self.sha(self.pause), mutationMarkerPath=str(self.freeze), mutationMarkerSHA256=self.sha(self.freeze),
             height='1', blockHash='b'*64, authoritativeCommit='65efa82e06158f9616172144c3c9efdd8088f227',
             authoritativeBinarySha256='c79a0e0b60f44bc42b8b1a9d4af302c370389cb609a82e6d0f9073b0ca0c3587')
        common = {k:self.source[k] for k in ('transactionId', 'commit', 'authoritativeRelease', 'authoritativeCommit', 'bftRelease')}
        self.freeze_record = self.write_json(self.ops / 'primary-freeze.json', dict(common, role='primary', operation='freeze', mutationStateVerified=True, markerSha256=self.sha(self.freeze)))
        self.pause_record = self.write_json(self.ops / 'primary-pause-authoritative.json', dict(common, operation='pause', productionStateVerified=True, heightBefore=1, heightAfter=1, markerSha256=self.sha(self.pause)))
        self.source_record = self.write_json(self.ops / 'snapshot-source.json', self.source)
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        self.stack.enter_context(mock.patch.object(assets, 'DATA', self.data))
        self.stack.enter_context(mock.patch.object(assets, 'DIRECTORY_IDENTITY', (self.data.stat().st_dev, self.data.stat().st_ino)))
        self.stack.enter_context(mock.patch.object(assets, 'NATIVE_UID', os.geteuid()))
        self.stack.enter_context(mock.patch.object(assets, 'NATIVE_GID', os.getegid()))
        # These injected boundaries are unit fixtures, not server authority.
        self.stack.enter_context(mock.patch.object(assets, 'privileged_execution', return_value=None))
        self.stopped = self.stack.enter_context(mock.patch.object(assets, 'service_stopped', return_value={'MainPID':'0', 'testOnly':True}))
        self.holders = self.stack.enter_context(mock.patch.object(assets, 'no_open_holders', return_value=None))

    def write(self, path, raw):
        path.write_bytes(raw); os.chmod(path, 0o600); return path

    def write_json(self, path, value):
        return self.write(path, (json.dumps(value, separators=(',', ':')) + '\n').encode())

    def sha(self, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def args(self, phase='extract-public-identity'):
        return argparse.Namespace(phase=phase, transaction_id=self.tx, commit=self.commit,
            capture_helper_sha256=CAPTURE_PIN, snapshot_source=str(self.source_record),
            snapshot_source_sha256=self.sha(self.source_record), primary_freeze=str(self.freeze_record),
            primary_freeze_sha256=self.sha(self.freeze_record), primary_pause=str(self.pause_record),
            primary_pause_sha256=self.sha(self.pause_record), output_dir=str(self.ops / phase),
            public_identity=None, public_identity_sha256=None, original_pid=None)

    def archive_args(self):
        assets.run(self.args())
        result = self.args('archive-original-assets')
        result.public_identity = str(self.ops / 'extract-public-identity/public-identity.json')
        result.public_identity_sha256 = self.sha(Path(result.public_identity))
        result.original_pid = '123456789'
        return result

    def unchanged(self):
        self.assertEqual(json.loads(self.state.read_bytes()), self.value)
        for name, raw in self.sentinels.items(): self.assertEqual((self.data / name).read_bytes(), raw)
        for name in assets.NAMES: self.assertTrue((self.data / name).exists())

    def test_extract_is_readonly_and_never_authorizes_pq_or_initializes(self):
        assets.run(self.args())
        public = json.loads((self.ops / 'extract-public-identity/public-identity.json').read_bytes())
        self.assertEqual(public['config'], self.value['config'])
        self.assertEqual(public['genesisBlock'], self.value['blocks'][0])
        self.assertEqual(public['validators'], self.value['validators'])
        self.assertFalse(public['nativeGenesisIndependentlyTrusted'])
        self.assertFalse(public['pqCustodyOrBindingAuthorized'])
        self.stopped.assert_not_called(); self.holders.assert_not_called()
        self.unchanged()

    def test_wrong_pin_metadata_network_and_absent_freeze_refuse(self):
        args = self.args(); args.snapshot_source_sha256 = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'PUBLIC_INPUT_PIN_MISMATCH'): assets.run(args)
        self.unchanged()
        os.chmod(self.state, 0o644)
        with self.assertRaisesRegex(ValueError, 'ORIGINAL_SNAPSHOT_METADATA_MISMATCH'): assets.run(self.args())
        os.chmod(self.state, 0o600); self.unchanged()
        args = self.args(); self.freeze_record.unlink()
        with self.assertRaises(FileNotFoundError): assets.run(args)
        self.unchanged()

    def test_wrong_original_directory_identity_refuses_without_touching_assets(self):
        with mock.patch.object(assets, 'DIRECTORY_IDENTITY', (0, 0)), self.assertRaisesRegex(ValueError, 'ORIGINAL_DIRECTORY_IDENTITY_MISMATCH'):
            assets.run(self.args())
        self.unchanged()

    def test_wrong_network_is_not_an_allowed_reset_target(self):
        self.value['config']['chainId'] = 6420
        self.write(self.state, json.dumps(self.value).encode())
        self.source.update(stateBytes=str(self.state.stat().st_size), stateSHA256=self.sha(self.state))
        self.write_json(self.source_record, self.source)
        with self.assertRaisesRegex(ValueError, 'ONLY_ORIGINAL_LEGACY_TESTNET_SUPPORTED'): assets.run(self.args())
        self.unchanged()

    def test_live_runtime_and_writer_refuse_before_any_rename(self):
        args = self.archive_args()
        self.stopped.side_effect = ValueError('ORIGINAL_SERVICE_NOT_STOPPED_DISABLED')
        with self.assertRaisesRegex(ValueError, 'STOPPED_DISABLED'): assets.run(args)
        self.unchanged()
        self.stopped.side_effect = None
        self.holders.side_effect = ValueError('ORIGINAL_ASSET_HAS_OPEN_HOLDER_OR_OBSERVATION_FAILED')
        with self.assertRaisesRegex(ValueError, 'OPEN_HOLDER'): assets.run(args)
        self.unchanged()

    def test_existing_unknown_archive_is_retained_and_originals_unchanged(self):
        args = self.archive_args()
        archive = self.root / ('testnet-assets-retained-' + self.tx); archive.mkdir(mode=0o700)
        sentinel = self.write(archive / 'UNKNOWN', b'test-only-original-unknown')
        with self.assertRaisesRegex(ValueError, 'EXISTING_ARCHIVE_OR_UNKNOWN'): assets.run(args)
        self.assertEqual(sentinel.read_bytes(), b'test-only-original-unknown'); self.unchanged()

    def test_positive_archive_moves_only_four_original_basenames_and_cannot_replay(self):
        args = self.archive_args()
        before = {name:(self.data / name).read_bytes() for name in assets.NAMES}
        assets.run(args)
        archive = self.root / ('testnet-assets-retained-' + self.tx)
        for name, raw in before.items():
            self.assertFalse((self.data / name).exists())
            self.assertEqual((archive / name).read_bytes(), raw)
        for name, raw in self.sentinels.items(): self.assertEqual((self.data / name).read_bytes(), raw)
        public = json.loads((archive / 'public-identity.json').read_bytes())
        self.assertEqual(public['genesisBlock'], self.value['blocks'][0])
        self.assertEqual(public['validators'], self.value['validators'])
        receipt = json.loads((self.ops / 'archive-original-assets/receipt.json').read_bytes())
        self.assertTrue(receipt['originalAssetsArchived']); self.assertFalse(receipt['replacementStateCreated'])
        self.assertFalse(receipt['nodeStarted']); self.assertFalse(receipt['activated'])
        with self.assertRaises(FileNotFoundError): assets.run(args)
        for name, raw in before.items(): self.assertEqual((archive / name).read_bytes(), raw)


if __name__ == '__main__':
    unittest.main()
