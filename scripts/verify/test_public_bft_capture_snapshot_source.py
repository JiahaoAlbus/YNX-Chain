#!/usr/bin/env python3
"""Original capture/reader controls; process observations are explicit doubles.

No host service, native database, account, key or remote endpoint is accessed.
The real final-snapshot --prepare CLI consumes the produced original record.
These synthetic public bytes do not qualify an actual ledger or native Root.
"""
import argparse
import ast
from contextlib import redirect_stdout
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


REPO = Path(__file__).resolve().parents[2]
PRODUCER = REPO / 'scripts/ops/remote/public-bft-capture-snapshot-source.py'
NATIVE = REPO / 'scripts/ops/remote/public-bft-native-identity.py'
FINAL = REPO / 'scripts/ops/remote/public-bft-final-snapshot.sh'
spec = importlib.util.spec_from_file_location('snapshot_source_capture_controls', PRODUCER)
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    raw = value if type(value) is bytes else (json.dumps(value, separators=(',', ':')) + '\n').encode()
    with path.open('xb') as out:
        out.write(raw)
    path.chmod(0o600)


def original_reader():
    # Keep the unchanged real reader functions. Exclude only the shell wrapper
    # and top-level main invocation so check_source can be tested without export.
    body = FINAL.read_text().split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
    tree = ast.parse(body, filename=str(FINAL))
    tree.body = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef))]
    namespace = {}
    exec(compile(tree, str(FINAL), 'exec'), namespace)
    return namespace


class Observations:
    def __init__(self, fixture):
        self.fixture = fixture
        self.exe, self.binary, self.inode = '/original/native/bin/ynx-chaind', 'e' * 64, '2049:1234'
        self.env = dict(YNX_DATA_DIR=str(fixture.state.parent), YNX_MUTATION_FREEZE_FILE=str(fixture.freeze_marker),
                        YNX_BLOCK_PRODUCTION_PAUSE_FILE=str(fixture.pause_marker))
        self.unit = dict(ActiveState='active', SubState='running', MainPID='123',
            FragmentPath='/etc/systemd/system/ynx-chaind.service', DropInPaths='',
            EnvironmentFiles='/etc/ynx/ynx-chaind.env (ignore_errors=no)',
            ExecStart='{ path=' + self.exe + ' ; argv[]=' + self.exe + ' ; ignore_errors=no ; pid=123 ; status=0/0 }')
        self.payload = dict(chainId=6423, nativeCurrencySymbol='YNXT', height=100, latestBlockHash='0x' + 'a' * 64,
            build=dict(commit=fixture.full[:12], release=fixture.native), nodeIdentity=dict(
                replicationMode='authoritative_producer', blockProductionEnabled=True, validatorAddress='ynx_validator_primary'))
        self.status_reads, self.process_reads = 0, []
        self.change_at = None
        self.process_race = False
        self.shows = 0

    def show(self):
        self.shows += 1
        result = self.unit.copy()
        if self.process_race and self.shows >= 3:
            result['MainPID'] = '456'
        return result

    def executable(self, pid):
        return self.exe, self.binary, self.inode

    def listener(self):
        return {'123'}

    def canonical(self, filename):
        return filename

    def status(self):
        self.status_reads += 1
        value = copy.deepcopy(self.payload)
        if self.change_at is not None and self.status_reads >= self.change_at:
            value['height'] += 1
        return value

    def read(self, filename, maximum, proc=False):
        self.process_reads.append(filename)
        if filename.endswith('/cmdline'):
            return (self.exe + '\0').encode()
        if filename.endswith('/environ'):
            return b'\0'.join((k + '=' + v).encode() for k, v in self.env.items()) + b'\0PRIVATE_NOT_EMITTED=\xff\0'
        if filename.endswith('/stat'):
            return b'123 (ynx-chaind) S ' + b'0 ' * 18 + b'456 0'
        if filename == '/etc/ynx/ynx-chaind.env':
            return ('\n'.join(k + '=' + v for k, v in self.env.items()) + '\n').encode()
        if filename == '/etc/systemd/system/ynx-chaind.service':
            return b'original unit fixture bytes\n'
        raise AssertionError('unexpected original-process read')


class Fixture:
    def __init__(self, parent, name):
        self.root = parent / name
        self.root.mkdir(mode=0o700)
        self.evidence = self.root / 'primary'
        self.evidence.mkdir(mode=0o700)
        data = self.root / 'original'
        data.mkdir(mode=0o700)
        self.state = data / 'devnet-state.json'
        self.integrity = data / 'devnet-state.integrity-version'
        self.pause_marker, self.freeze_marker = self.root / 'pause.json', self.root / 'freeze.json'
        self.full = '65efa82e06158f9616172144c3c9efdd8088f227'
        self.candidate_full = 'abcdef012345' + 'a' * 28
        self.commit, self.tx = self.candidate_full[:12], 'native-capture-' + name
        self.native = 'ynx-network-surgical-' + self.full[:12]
        self.release = 'ynx-bft-gateway-' + self.commit
        self.paths = dict(statePath=str(self.state), integrityMarkerPath=str(self.integrity),
                          pauseMarkerPath=str(self.pause_marker), mutationMarkerPath=str(self.freeze_marker))
        common = dict(transactionId=self.tx, commit=self.commit, bftRelease=self.release,
                      authoritativeCommit=self.full, authoritativeRelease=self.native)
        write(self.state, b'opaque original checkpoint bytes; never decoded/exported\n')
        write(self.integrity, b'3\n')
        write(self.pause_marker, dict(common, pausedAt='2026-10-24T00:00:00Z'))
        write(self.freeze_marker, dict(common, role='primary', frozenAt='2026-10-24T00:00:00Z'))
        self.pause_path, self.freeze_path = self.evidence / 'primary-pause-authoritative.json', self.evidence / 'primary-freeze.json'
        self.pause = dict(common, operation='pause', pauseMarker=str(self.pause_marker), markerSha256=digest(self.pause_marker),
            heightBefore=100, heightAfter=100, readsOnline=True, productionStateVerified=True, reused=False)
        self.freeze = dict(common, role='primary', operation='freeze', markerPath=str(self.freeze_marker),
            markerSha256=digest(self.freeze_marker), readStatus=200, readEvm=200, mutationStateVerified=True, reused=False)
        write(self.pause_path, self.pause)
        write(self.freeze_path, self.freeze)
        self.approval_path = self.root / 'preparation-approval.json'
        self.approval = dict(custodyProfile='single-app-gateway/v1', schemaVersion=1, action='ynx-public-bft-cutover',
            approved=True, approvalId='independent-native-preparation', approver='original approver',
            custodyReviewer='independent custody', custodyEvidence='sha256:' + '1' * 64, owner='original owner',
            ownerHandoverReviewer='handover reviewer', ownerHandoverInventoryDigest='sha256:' + '2' * 64,
            ownerHandoverInventoryEvidence='sha256:' + '3' * 64, ownerHandoverReceiptEvidence='sha256:' + '4' * 64,
            commit=self.commit, release=self.release, authoritativeCommit=self.full, authoritativeRelease=self.native,
            authoritativeBinarySha256='e' * 64, authoritativeSource=self.paths, preparationOnly=True,
            publicCutoverAuthorized=True, automaticRollbackRequired=True, validatorKeyRecoveryVerified=True,
            ownerHandoverVerified=True, rotationProcedureVerified=True, validatorManifestSha256='5' * 64,
            operatorPreparationPlanSha256='6' * 64, runtimeManifestSha256='7' * 64, exporterManifestSha256='8' * 64,
            expiresAt=(datetime.now(timezone.utc) + timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))
        write(self.approval_path, self.approval)
        self.args = argparse.Namespace(transaction_id=self.tx, preparation_approval=str(self.approval_path),
            preparation_approval_sha256=digest(self.approval_path), primary_evidence_dir=str(self.evidence),
            primary_pause_sha256=digest(self.pause_path), primary_freeze_sha256=digest(self.freeze_path),
            native_identity_sha256=digest(NATIVE), output_dir=str(self.root / 'capture'), observation_seconds=1)
        self.process = Observations(self)

    def replace(self, path, value, pin_name=None):
        path.write_bytes((json.dumps(value, separators=(',', ':')) + '\n').encode())
        if pin_name:
            setattr(self.args, pin_name, digest(path))

    def run(self, sleeper=lambda _: None):
        return capture.capture(self.args, process=self.process, sleeper=sleeper)


class CaptureSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ynx-capture-source-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.reader = original_reader()

    def fixture(self, name='control'):
        return Fixture(self.root, name)

    def test_normal_entry_and_real_existing_reader(self):
        f = self.fixture('normal')
        original = {p: p.read_bytes() for p in (f.state, f.integrity, f.pause_marker, f.freeze_marker,
                    f.pause_path, f.freeze_path, f.approval_path)}
        original_loader = capture.native_tool
        def observed_tool(expected):
            tool = original_loader(expected)
            tool['OriginalProcess'] = lambda: f.process
            return tool
        argv = []
        for key, value in vars(f.args).items():
            argv.extend(['--' + key.replace('_', '-'), str(value)])
        output = io.StringIO()
        with mock.patch.object(capture, 'native_tool', side_effect=observed_tool), redirect_stdout(output):
            # The normal argument parser and capture entry run, with only OS
            # process observations substituted; no CLI bypass flag exists.
            with mock.patch.object(capture.time, 'sleep'):
                capture.main(argv)
        receipt = json.loads(output.getvalue())
        source_path = Path(receipt['snapshotSourcePath'])
        self.assertEqual(receipt['snapshotSourceSHA256'], digest(source_path))
        self.assertEqual(receipt['snapshotSourceBytes'], source_path.stat().st_size)
        self.assertEqual(receipt['preparationApprovalSHA256'], digest(f.approval_path))
        self.assertIs(receipt['nativeRootAuthorized'], False)
        self.assertIs(receipt['finalApproval'], False)
        self.assertIs(receipt['exported'], False)
        self.assertNotIn('PRIVATE', output.getvalue())
        value = json.loads(source_path.read_bytes())
        self.assertEqual(len(value), 19)
        self.assertEqual(value['height'], '100')
        self.assertEqual(value['blockHash'], f.process.payload['latestBlockHash'])
        self.assertNotIn('appHash', value)
        identity = {k: f.approval[k] for k in ('authoritativeCommit', 'authoritativeBinarySha256', 'authoritativeSource')}
        consumed, raw = self.reader['source_record'](source_path, digest(source_path), f.tx, f.commit, f.native, f.release, identity)
        self.assertEqual(raw, source_path.read_bytes())
        self.reader['check_source'](consumed, f.tx, f.commit, f.release, identity)
        tools = f.root / 'offline-tools'
        tools.mkdir(mode=0o700)
        binaries = {}
        for name in ('ynx-chaind', 'ynx-consensus-package'):
            write(tools / name, b'PUBLIC OFFLINE TOOL DOUBLE; --prepare never executes this\n')
            binaries[name] = dict(bytes=(tools / name).stat().st_size, sha256=digest(tools / name))
        write(tools / 'SOURCE.json', dict(version='YNX-PQ-OFFLINE-MIGRATION-TOOLS/v1', commit=f.candidate_full,
            runId='123', platform='linux/amd64', purpose='offline copied-state validation; not installed or activated', binaries=binaries))
        prepared = f.root / 'prepared'
        args = ['bash', str(FINAL), '--prepare', str(source_path), str(tools), f.candidate_full, digest(source_path),
            digest(tools / 'SOURCE.json'), f.tx, f.commit, f.native, f.release, str(prepared), f.full, 'e' * 64, json.dumps(f.paths)]
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual((prepared / 'snapshot-source.json').read_bytes(), source_path.read_bytes())
        self.assertEqual({p.name for p in Path(f.args.output_dir).iterdir()}, {'intent.json', 'snapshot-source.json', 'receipt.json'})
        for path in Path(f.args.output_dir).iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(Path(f.args.output_dir).stat().st_mode), 0o700)
        for path, before in original.items():
            self.assertEqual(path.read_bytes(), before)
        with self.assertRaisesRegex(ValueError, 'EXISTING_OUTPUT_OR_UNKNOWN'):
            f.run()
        # This is the original reader's marker verification, not our own JSON
        # expectation: tampering after capture must invalidate the real input.
        f.freeze_marker.write_bytes(b'foreign checkpoint marker\n')
        with self.assertRaisesRegex(ValueError, 'source/marker hash mismatch'):
            self.reader['check_source'](consumed, f.tx, f.commit, f.release, identity)

    def test_preparation_and_independent_tool_pins_fail_before_reservation(self):
        for name in ('approval-pin', 'tool-pin', 'future-source', 'future-plan', 'expired', 'not-preparation', 'role-conflict', 'duplicate'):
            with self.subTest(name=name):
                f = self.fixture(name)
                if name == 'approval-pin': f.args.preparation_approval_sha256 = '9' * 64
                elif name == 'tool-pin': f.args.native_identity_sha256 = '9' * 64
                elif name == 'duplicate':
                    raw = f.approval_path.read_bytes().rstrip()[:-1] + b',"approved":true}\n'
                    f.approval_path.write_bytes(raw)
                    f.args.preparation_approval_sha256 = digest(f.approval_path)
                else:
                    value = f.approval.copy()
                    if name == 'future-source': value['snapshotSourceSha256'] = 'a' * 64
                    elif name == 'future-plan': value['operatorPlanSha256'] = 'a' * 64
                    elif name == 'expired': value['expiresAt'] = '2020-01-01T00:00:00Z'
                    elif name == 'not-preparation': value['preparationOnly'] = False
                    elif name == 'role-conflict': value['custodyReviewer'] = value['approver']
                    f.replace(f.approval_path, value, 'preparation_approval_sha256')
                with self.assertRaises((ValueError, FileNotFoundError)):
                    f.run()
                self.assertFalse(Path(f.args.output_dir).exists())
                self.assertEqual(f.process.status_reads, 0)

    def test_pause_freeze_source_and_process_failures_retain_unknown(self):
        names = ('missing-pause', 'missing-freeze', 'pause-partial', 'freeze-unknown', 'unverified-pause', 'unverified-freeze', 'foreign-tx', 'wrong-primary',
            'marker-pin', 'marker-missing', 'integrity', 'state-symlink', 'state-hardlink', 'status-height',
            'status-hash', 'wrong-binary', 'wrong-native-build', 'wrong-path', 'native-process-race')
        for name in names:
            with self.subTest(name=name):
                f = self.fixture(name)
                if name == 'missing-pause': f.pause_path.rename(f.pause_path.with_suffix('.retained'))
                elif name == 'missing-freeze': f.freeze_path.rename(f.freeze_path.with_suffix('.retained'))
                elif name == 'pause-partial': write(Path(str(f.pause_path) + '.partial'), b'ORIGINAL UNKNOWN pause\n')
                elif name == 'freeze-unknown': write(Path(str(f.freeze_marker) + '.UNKNOWN'), b'ORIGINAL UNKNOWN freeze\n')
                elif name in ('unverified-pause', 'foreign-tx'):
                    v = f.pause.copy()
                    v['productionStateVerified' if name == 'unverified-pause' else 'transactionId'] = False if name == 'unverified-pause' else 'foreign-native-transaction'
                    f.replace(f.pause_path, v, 'primary_pause_sha256')
                elif name in ('unverified-freeze', 'wrong-primary'):
                    v = f.freeze.copy()
                    v['mutationStateVerified' if name == 'unverified-freeze' else 'role'] = False if name == 'unverified-freeze' else 'seoul'
                    f.replace(f.freeze_path, v, 'primary_freeze_sha256')
                elif name == 'marker-pin': f.freeze_marker.write_bytes(b'{"transactionId":"foreign-native-transaction"}\n')
                elif name == 'marker-missing': f.pause_marker.rename(f.pause_marker.with_suffix('.retained'))
                elif name == 'integrity': f.integrity.write_bytes(b'4\n')
                elif name == 'state-symlink':
                    target = f.state.with_suffix('.retained'); f.state.rename(target); f.state.symlink_to(target)
                elif name == 'state-hardlink': os.link(f.state, f.state.with_suffix('.retained'))
                elif name == 'status-height': f.process.payload['height'] = 101
                elif name == 'status-hash': f.process.payload['latestBlockHash'] = '0' * 64
                elif name == 'wrong-binary': f.process.binary = 'f' * 64
                elif name == 'wrong-native-build': f.process.payload['build']['commit'] = f.commit
                elif name == 'wrong-path': f.process.env['YNX_DATA_DIR'] = '/other/original'
                elif name == 'native-process-race': f.process.process_race = True
                saved = {p: p.read_bytes() for p in (f.pause_path, f.freeze_path, f.pause_marker, f.freeze_marker) if p.exists()}
                with self.assertRaises((ValueError, FileNotFoundError)):
                    f.run()
                output = Path(f.args.output_dir)
                self.assertTrue((output / 'intent.json').exists())
                self.assertFalse((output / 'receipt.json').exists())
                self.assertFalse((output / 'snapshot-source.json').exists())
                self.assertEqual(json.loads((output / 'intent.json').read_bytes())['status'], 'unknown')
                count = f.process.status_reads
                with self.assertRaisesRegex(ValueError, 'EXISTING_OUTPUT_OR_UNKNOWN'):
                    f.run()
                self.assertEqual(f.process.status_reads, count)
                for p, raw in saved.items(): self.assertEqual(p.read_bytes(), raw)

    def test_checkpoint_and_same_size_source_changes_during_observation(self):
        for name in ('height-drift', 'state-drift', 'state-inode', 'pause-drift', 'freeze-evidence-drift'):
            with self.subTest(name=name):
                f = self.fixture(name)
                def change(_):
                    if name == 'height-drift': f.process.payload['height'] += 1
                    elif name == 'state-drift':
                        raw = f.state.read_bytes(); f.state.write_bytes(b'X' + raw[1:])
                    elif name == 'state-inode':
                        replacement = f.state.with_suffix('.external-writer')
                        write(replacement, f.state.read_bytes())
                        os.replace(replacement, f.state)
                    elif name == 'pause-drift': f.pause_marker.write_bytes(f.pause_marker.read_bytes() + b' ')
                    else: f.freeze_path.write_bytes(f.freeze_path.read_bytes() + b' ')
                with self.assertRaises(ValueError):
                    f.run(change)
                output = Path(f.args.output_dir)
                self.assertTrue((output / 'intent.json').exists())
                self.assertFalse((output / 'receipt.json').exists())
                self.assertFalse((output / 'snapshot-source.json').exists())

    def test_multichunk_state_is_hashed_and_original_reader_consumes_it(self):
        f = self.fixture('streamed-state')
        f.state.write_bytes(b'opaque public streaming checkpoint\n' * 65536)
        receipt = f.run()
        source_path = Path(receipt['snapshotSourcePath'])
        identity = {k: f.approval[k] for k in ('authoritativeCommit', 'authoritativeBinarySha256', 'authoritativeSource')}
        value, _ = self.reader['source_record'](source_path, digest(source_path), f.tx, f.commit, f.native, f.release, identity)
        self.assertEqual(value['stateBytes'], str(f.state.stat().st_size))
        self.assertEqual(value['stateSHA256'], digest(f.state))
        self.reader['check_source'](value, f.tx, f.commit, f.release, identity)
        self.assertLess(source_path.stat().st_size, 16384)
        self.assertFalse(any('devnet-state' in path for path in f.process.process_reads))

    def test_exclusive_partial_write_and_permission_boundaries(self):
        for name in ('existing-dir', 'dangling-output', 'partial-output', 'public-parent', 'public-approval', 'receipt-write'):
            with self.subTest(name=name):
                f = self.fixture(name)
                output = Path(f.args.output_dir)
                if name == 'existing-dir':
                    output.mkdir(mode=0o700); write(output / 'intent.json', b'ORIGINAL UNKNOWN\n')
                elif name == 'dangling-output': output.symlink_to(f.root / 'missing-original')
                elif name == 'partial-output': write(Path(str(output) + '.partial'), b'ORIGINAL UNKNOWN capture\n')
                elif name == 'public-parent': f.root.chmod(0o755)
                elif name == 'public-approval': f.approval_path.chmod(0o644)
                def failing_write(path, value):
                    if path.name == 'receipt.json':
                        with path.open('xb') as out: out.write(b'UNKNOWN partial original receipt\n')
                        path.chmod(0o600)
                        raise OSError('injected fsync/write uncertainty')
                    return durable(path, value)
                durable = capture.durable
                with mock.patch.object(capture, 'durable', side_effect=failing_write if name == 'receipt-write' else durable):
                    with self.assertRaises((ValueError, OSError)):
                        f.run()
                if name == 'receipt-write':
                    self.assertTrue((output / 'snapshot-source.json').exists())
                    prior = {p: p.read_bytes() for p in output.iterdir()}
                    with self.assertRaisesRegex(ValueError, 'EXISTING_OUTPUT_OR_UNKNOWN'): f.run()
                    self.assertEqual({p: p.read_bytes() for p in output.iterdir()}, prior)
                elif name == 'existing-dir': self.assertEqual((output / 'intent.json').read_bytes(), b'ORIGINAL UNKNOWN\n')
                elif name == 'dangling-output': self.assertTrue(output.is_symlink())
                elif name == 'partial-output': self.assertEqual(Path(str(output) + '.partial').read_bytes(), b'ORIGINAL UNKNOWN capture\n')
                else: self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
