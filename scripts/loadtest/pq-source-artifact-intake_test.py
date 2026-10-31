#!/usr/bin/env python3
"""Pure DATA controls; no downloads, Go, signatures, nodes or approvals."""
import base64
import copy
from contextlib import ExitStack, contextmanager, redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import warnings
import zipfile


SCRIPT = Path(__file__).with_name('pq-source-artifact-intake.py')
SPEC = importlib.util.spec_from_file_location('pq_source_artifact_intake', SCRIPT)
intake = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(intake)

FDC = 'fdc08527514587d5756264e43ab63588791e189a'
TOOLS8 = 'b6a0cab84f5985f647972209b3c389f2892b44e7'
OLD_SHA = 'b1ebf76cbb3bf3819e4f111ec48ac640e84ff5dc3d5279b6a53220303446ccd1'
ORIGINAL_CASES = ['H%d-K%d' % (h, k) for h in (0, 64, 256, 512) for k in (1, 16)]
MULTI_CASES = ['H%d-W%d-K1' % (h, w) for h in (0, 512) for w in (1, 16)]
PREFIX = 'pq-baseline-e9xos8tl/public/'


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def metadata():
    return {'id': 13042588614, 'name': 'pq-current-baseline-fdc-41202295972-1',
            'size_in_bytes': 139140942, 'digest': 'sha256:' + OLD_SHA, 'expired': False,
            'workflow_run': {'id': 41202295972, 'repository_id': 1285041796,
                             'head_repository_id': 1285041796, 'head_sha': TOOLS8}}


def expectation():
    return {'artifactId': 13042588614, 'runId': 41202295972,
            'name': 'pq-current-baseline-fdc-41202295972-1',
            'digest': OLD_SHA, 'size': 139140942, 'workflowCommit': TOOLS8}


def public_files(profile):
    """Small structural fixtures, explicitly not cryptographic evidence."""
    cases = ORIGINAL_CASES if profile == 'original' else MULTI_CASES
    count = 512 if profile == 'original' else 528
    history = [base64.b64encode(('UNIT-CONTROL-PUBLIC-DATA-%04d' % i).encode()).decode()
               for i in range(count)]
    bundle = {'schema': 'YNX-PQ-BASELINE-PUBLIC-INPUT/v1', 'migration': {}, 'initial': {},
              'history': history, 'cases': {name: history[i] for i, name in enumerate(cases)}}
    if profile == 'multi-whole':
        bundle.update(schema='YNX-PQ-MULTI-WHOLE-PUBLIC-INPUT/v1', cases={},
                      candidateCases={'H%d-W%d-K1' % (h, w): history[h:h + w]
                                      for h in (0, 512) for w in (1, 16)})
    original = encoded(bundle)
    bound = digest(original)
    receipt = {'schema': 'YNX-CURRENT-SOURCE-BASELINE-RUN/v1', 'sourceCommit': FDC,
               'sourceTree': '883069d6f4c123d55dea797044186e6b7de2ad0e',
               'profile': profile, 'sourceMatrixComplete': True, 'cleanupComplete': True,
               'testExitCode': 0, 'firstCause': None, 'originalOwnerDirtyExcluded': '',
               'expectedCases': list(cases), 'completedCases': list(cases),
               'inputSha256': bound, 'fullChainBaselineReady': False,
               'stableFinalTPS': 'UNMEASURED', 'P95FinalConfirmation': 'UNMEASURED'}
    files = {'baseline-input.json': original, 'receipt.json': encoded(receipt),
             'compile-baseline.log': b'UNIT DATA: no compiler was run\n',
             'actual-baseline.log': b'UNIT DATA: no signed source probe was run\n'}
    for name in cases:
        state = {'unitControlDataOnly': True, 'case': name}
        files[name + '-after.json'] = encoded(state)
        files[name + '-measure.json'] = encoded({'case': name, 'inputSha256': bound,
            'architecture': 'amd64', 'goVersion': 'go1.26.10', 'gomaxprocs': 1,
            'committedCanonicalJSONSha256': digest(files[name + '-after.json'])})
    if profile == 'multi-whole':
        files['HOST-MACHINE.json'] = encoded({'unitControlDataOnly': True})
        files['SOURCE-COMPARE-CONTROLLER.json'] = encoded({'unitControlDataOnly': True})
    return files


def write_public(parent, profile):
    parent.mkdir(mode=0o700)
    for name, raw in public_files(profile).items():
        (parent / name).write_bytes(raw)
    return parent


def write_zip(path, profile='original', *, change=None, extra=(), mode=stat.S_IFREG | 0o600,
              compression=zipfile.ZIP_DEFLATED):
    files = public_files(profile)
    if change is not None:
        change(files)
    prefix = PREFIX if profile == 'original' else ''
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        with zipfile.ZipFile(path, 'x', compression=compression) as out:
            for name, raw in list(files.items()) + list(extra):
                info = zipfile.ZipInfo(prefix + name)
                info.create_system = 3
                info.external_attr = mode << 16
                info.compress_type = compression
                out.writestr(info, raw)
    return path


@contextmanager
def command_wiring(scope, cleanup=True):
    """Unit-only caller harness; never a real Window or source measurement."""
    with tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
        base = Path(temporary).resolve(strict=True)
        runner, workspace, go_root = (base / name for name in ('runner-temp', 'workspace', 'setup-go'))
        for path in (runner, workspace, go_root / 'bin'):
            path.mkdir(parents=True)
        go_binary = go_root / 'bin/go'
        go_binary.write_bytes(b'UNIT COMMAND WIRING: this is not an executable\n')
        tools, owner, controller = (workspace / name for name in ('tools', 'owner', 'controller'))
        for path in (tools, owner, controller):
            path.mkdir()
        operation = runner / 'operation'
        output = workspace / 'GITHUB_OUTPUT'
        output.write_bytes(b'')
        workflow_sha = '1234567890abcdef1234567890abcdef12345678'
        run_id = '41210000000'
        pin = '3' * 64
        env = dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted', GITHUB_RUN_ATTEMPT='1',
                   GITHUB_WORKSPACE=str(workspace), RUNNER_TEMP=str(runner), GITHUB_SHA=workflow_sha,
                   GITHUB_RUN_ID=run_id, GITHUB_JOB='UNIT_COMMAND_WIRING', GITHUB_OUTPUT=str(output),
                   GH_TOKEN='UNIT-ONLY-not-a-token', GITHUB_TOKEN='UNIT-ONLY-not-a-token',
                   MULTI_BEFORE_ARTIFACT_ID='13099999999', MULTI_BEFORE_RUN_ID=run_id,
                   MULTI_BEFORE_ARTIFACT_NAME='pq-source-multi-before-' + run_id,
                   MULTI_BEFORE_ARTIFACT_DIGEST='sha256:' + '4' * 64,
                   MULTI_BEFORE_INPUT_SHA256=pin)
        state = dict(scope=scope, commands=[], downloads=[], validations=[], samples=0, cleanupCalls=0,
                     runner=runner, workspace=workspace, goRoot=go_root, operation=operation,
                     tools=tools, owner=owner, controller=controller, output=output, env=env)

        class FakeWindow:
            def __init__(self, source, work, additional_storage=()):
                self.source, self.work = source, work
                self.storage_roots = [work, *additional_storage]
                self.env = dict(os.environ)
                self.started = intake.time.monotonic()
                self.peak_rss = self.peak_bytes = 0
                self.samples = [{'unitCommandWiringOnly': True}]
                self.retired_samples = []
                state['window'] = self

            def sample(self):
                state['samples'] += 1

            def launch(self, name, command):
                state['commands'].append((name, list(command)))
                return SimpleNamespace(name=name, command=list(command))

            def wait(self, process):
                command = process.command
                if process.name == 'prepare-original-source':
                    prepared = Path(command[command.index('--output') + 1])
                    prepared.mkdir(mode=0o700)
                    (prepared / 'prepared.json').write_bytes(b'{}\n')
                elif process.name == 'original-source-entry':
                    # Match the actual original runner's fixed child shape.
                    public = operation / 'pq-baseline-fixture/public'
                    public.mkdir(parents=True)
                    profile = 'original' if scope == 'b8' else 'multi-whole'
                    for name, raw in public_files(profile).items():
                        if name not in ('HOST-MACHINE.json', 'SOURCE-COMPARE-CONTROLLER.json'):
                            (public / name).write_bytes(raw)
                    (operation / 'public/original-source-entry.log').write_bytes(
                        encoded({'publicArtifacts': str(public), 'unitCommandWiringOnly': True}))
                    state['public'] = public
                elif process.name == 'original-full-state-compare':
                    Path(command[command.index('--output') + 1]).write_bytes(encoded({'unitCommandWiringOnly': True}))
                else:
                    raise AssertionError('unexpected command in unit harness: ' + process.name)
                return 0

            def stop(self):
                state['cleanupCalls'] += 1
                return cleanup

            def process_receipt(self):
                return [{'unitCommandWiringOnly': True, 'name': name} for name, _ in state['commands']]

        caps = dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4 << 30, newBytes=8 << 30,
                    initialMemoryBytes=6 << 30, initialDiskBytes=16 << 30, logBytes=4 << 20, cpus=2)
        lab = SimpleNamespace(CAPS=caps, Window=FakeWindow, check_source=mock.Mock(), admit=mock.Mock(),
                              heavy_processes=mock.Mock(return_value=[]),
                              guard=SimpleNamespace(proc_inventory=mock.Mock(return_value=({}, [])),
                                                    memory_available=mock.Mock(return_value=8 << 30)))
        state['lab'] = lab
        machine = ArtifactIntakeControls.machine()

        def fake_git(source, *arguments):
            self_path = Path(source)
            if self_path != controller:
                raise AssertionError('unexpected unmapped git inspection')
            if arguments == ('rev-parse', 'HEAD'):
                return workflow_sha
            if arguments == ('status', '--porcelain', '--untracked-files=normal'):
                return ''
            raise AssertionError('unexpected git argv')

        def fake_download(expected, destination, profile, sample):
            state['downloads'].append((copy.deepcopy(expected), Path(destination), profile))
            sample()
            before = Path(destination) / 'extracted/public'
            before.mkdir(parents=True)
            # Complete mock transport contract only; actual ZIP/metadata/CRC
            # controls are exercised independently above, never by this fake.
            (Path(destination) / 'metadata.json').write_bytes(encoded({
                'id': expected['artifactId'], 'name': expected['name'],
                'size_in_bytes': expected['size'] or 100,
                'digest': 'sha256:' + intake.normalize_digest(expected['digest'])}))
            (Path(destination) / 'intake.json').write_bytes(encoded({
                'artifactId': expected['artifactId'], 'runId': expected['runId'],
                'zipBytes': expected['size'] or 100,
                'zipSHA256': intake.normalize_digest(expected['digest']),
                'CRCClosedPublic': True, 'public': str(before), 'unitCommandWiringOnly': True}))
            (before / 'baseline-input.json').write_bytes(b'UNIT DATA: validated separately\n')
            if profile == 'multi-whole':
                (before / 'HOST-MACHINE.json').write_bytes(encoded(machine))
                (before / 'SOURCE-COMPARE-CONTROLLER.json').write_bytes(encoded({
                    'scope': 'multi-before', 'toolsCommit': 'aa9447df2f5867542892f6fdbfbefbd116daed91',
                    'sourceCommit': FDC, 'cleanupComplete': True, 'firstCause': None,
                    'beforeRecord': True, 'workflowCommit': workflow_sha, 'runId': run_id,
                    'unitCommandWiringOnly': True}))
            return before

        def fake_validate(window, name, public, profile, source_commit, expected_input=None, raw_runner=False):
            state['validations'].append((name, Path(public), profile, source_commit, expected_input, raw_runner))
            return {'inputSha256': expected_input or pin, 'cases': [], 'receipt': {'unitMockedValidation': True}}

        patches = [mock.patch.dict(os.environ, env, clear=True), mock.patch.object(intake.sys, 'platform', 'linux'),
                   mock.patch.object(intake, 'original_lab', return_value=lab), mock.patch.object(intake, 'git', side_effect=fake_git),
                   mock.patch.object(intake, 'actual_machine', return_value=machine),
                   mock.patch.object(intake, 'validate_in_window', side_effect=fake_validate),
                   mock.patch.object(intake, 'download_artifact', side_effect=fake_download),
                   mock.patch.object(intake.os, 'sched_getaffinity', return_value={0, 1, 2, 3}, create=True),
                   mock.patch.object(intake.ctypes, 'CDLL', return_value=SimpleNamespace(prctl=mock.Mock(return_value=0))),
                   mock.patch.object(intake.shutil, 'which', return_value=str(go_binary)),
                   mock.patch.object(intake.shutil, 'disk_usage', return_value=SimpleNamespace(free=32 << 30)),
                   mock.patch.object(intake.subprocess, 'Popen', side_effect=AssertionError('unit wiring launched process')),
                   mock.patch.object(intake.subprocess, 'check_output', side_effect=AssertionError('unit wiring executed command')),
                   mock.patch.object(intake.urllib.request, 'urlopen', side_effect=AssertionError('unit wiring used network')),
                   redirect_stdout(io.StringIO())]
        state['originalLabMock'] = stack.enter_context(patches[2])
        for i, patch in enumerate(patches):
            if i != 2:
                stack.enter_context(patch)
        state['arguments'] = SimpleNamespace(scope=scope, tools=str(tools), owner=str(owner),
                                            controller=str(controller), operation=str(operation), execute=True)
        yield state


class ArtifactIntakeControls(unittest.TestCase):
    def test_digest_only_accepts_exact_nonzero_lowercase_sha256(self):
        self.assertEqual(intake.normalize_digest(OLD_SHA), OLD_SHA)
        self.assertEqual(intake.normalize_digest('sha256:' + OLD_SHA), OLD_SHA)
        for value in ('', '0' * 64, OLD_SHA.upper(), 'sha256:' + OLD_SHA.upper(),
                      'sha512:' + OLD_SHA, OLD_SHA + '\n', ' ' + OLD_SHA, None, 1):
            with self.subTest(value=value), self.assertRaises(intake.Refused):
                intake.normalize_digest(value)

    def test_artifact_metadata_exact_identity_and_independent_workflow_head(self):
        # The before's source is FDC; the artifact-producing workflow is TOOLS8.
        # Confusing these two identities must not be required for normal intake.
        intake.validate_artifact_metadata(metadata(), expectation())
        expected = expectation()
        expected['size'] = None
        intake.validate_artifact_metadata(metadata(), expected)

    def test_artifact_metadata_rejects_moved_expired_wrong_repo_or_changed_bytes(self):
        mutations = [lambda d: d.update(id=d['id'] + 1), lambda d: d.update(name=d['name'] + '-other'),
                     lambda d: d.update(size_in_bytes=139140941), lambda d: d.update(size_in_bytes=0),
                     lambda d: d.update(size_in_bytes=(1 << 30) + 1), lambda d: d.update(digest='sha256:' + '1' * 64),
                     lambda d: d.update(expired=True), lambda d: d['workflow_run'].update(id=1),
                     lambda d: d['workflow_run'].update(repository_id=1),
                     lambda d: d['workflow_run'].update(head_repository_id=1),
                     lambda d: d['workflow_run'].update(head_sha='1' * 40)]
        for mutate in mutations:
            value = metadata()
            mutate(value)
            with self.subTest(value=value), self.assertRaises(intake.Refused):
                intake.validate_artifact_metadata(value, expectation())

    def test_artifact_dynamic_size_does_not_remove_maximum_or_type_checks(self):
        expected = expectation()
        expected['size'] = None
        for size in (-1, 0, True, '139140942', (1 << 30) + 1):
            value = metadata()
            value['size_in_bytes'] = size
            with self.subTest(size=size), self.assertRaises(intake.Refused):
                intake.validate_artifact_metadata(value, expected)

    def test_original_closed_public_zip_preserves_all_eight_full_states(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            archive = write_zip(parent / 'original.zip')
            calls = []
            public = intake.safe_extract(archive, parent / 'unpacked', 'original', lambda: calls.append(True))
            self.assertEqual(public, parent / 'unpacked' / PREFIX.rstrip('/'))
            self.assertEqual({p.name for p in public.iterdir()}, set(public_files('original')))
            self.assertEqual(len(list(public.glob('*-after.json'))), 8)
            self.assertEqual((public / 'receipt.json').read_bytes(), public_files('original')['receipt.json'])
            self.assertTrue(calls, 'download/extraction sampling cannot be silently omitted')

    def test_multi_closed_public_zip_is_separate_four_case_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            public = intake.safe_extract(write_zip(parent / 'multi.zip', 'multi-whole'), parent / 'out', 'multi-whole')
            self.assertEqual(public, parent / 'out')
            self.assertEqual({p.name for p in public.iterdir()}, set(public_files('multi-whole')))
            self.assertEqual(len(list(public.glob('*-after.json'))), 4)

    def test_existing_destination_and_unknown_files_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            archive = write_zip(parent / 'original.zip')
            destination = parent / 'kept'
            destination.mkdir()
            sentinel = destination / 'UNKNOWN'
            sentinel.write_bytes(b'original unknown')
            before = sentinel.stat()
            with self.assertRaises((intake.Refused, FileExistsError)):
                intake.safe_extract(archive, destination, 'original')
            self.assertEqual(sentinel.read_bytes(), b'original unknown')
            self.assertEqual((sentinel.stat().st_ino, sentinel.stat().st_mtime_ns), (before.st_ino, before.st_mtime_ns))

    def test_missing_full_state_or_undeclared_secret_leaf_is_rejected(self):
        changes = [lambda d: d.pop('H512-K16-after.json'),
                   lambda d: d.update({'seed.bin': b'not a permitted public leaf'}),
                   lambda d: d.update({'.private/custody.json': b'{}'}),
                   lambda d: d.update({'unexpected.json': b'{}'})]
        for change in changes:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
                parent = Path(temporary)
                with self.assertRaises(intake.Refused):
                    intake.safe_extract(write_zip(parent / 'x.zip', change=change), parent / 'out', 'original')

    def test_path_escape_alias_absolute_and_backslash_are_rejected(self):
        for name in ('../escape', '/absolute', 'nested/../../escape', 'nested\\escape', './receipt.json',
                     'subdir//receipt.json', 'subdir/../receipt.json'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                parent = Path(temporary)
                with self.assertRaises(intake.Refused):
                    intake.safe_extract(write_zip(parent / 'x.zip', extra=[(name, b'not allowed')]), parent / 'out', 'original')
                self.assertFalse((parent / 'escape').exists())

    def test_duplicate_public_leaf_and_symlink_mode_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            archive = write_zip(parent / 'duplicate.zip', extra=[('receipt.json', b'{}')])
            with self.assertRaises(intake.Refused):
                intake.safe_extract(archive, parent / 'duplicate', 'original')
            archive = write_zip(parent / 'symlink.zip', mode=stat.S_IFLNK | 0o777)
            with self.assertRaises(intake.Refused):
                intake.safe_extract(archive, parent / 'symlink', 'original')

    def test_wrong_prefix_cannot_relabel_old_eight_as_new_four(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            with self.assertRaises(intake.Refused):
                intake.safe_extract(write_zip(parent / 'old.zip'), parent / 'new', 'multi-whole')
            with self.assertRaises(intake.Refused):
                intake.safe_extract(write_zip(parent / 'new.zip', 'multi-whole'), parent / 'old', 'original')

    def test_crc_tampering_and_declared_zip_bomb_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            archive = write_zip(parent / 'crc.zip', compression=zipfile.ZIP_STORED)
            raw = bytearray(archive.read_bytes())
            name_length, extra_length = struct.unpack_from('<HH', raw, 26)
            raw[30 + name_length + extra_length] ^= 1
            archive.write_bytes(raw)
            with self.assertRaises((intake.Refused, zipfile.BadZipFile)):
                intake.safe_extract(archive, parent / 'crc', 'original')
            archive = write_zip(parent / 'bomb.zip')
            raw = bytearray(archive.read_bytes())
            central = raw.index(b'PK\x01\x02')
            struct.pack_into('<I', raw, central + 24, 0xffffffff)
            archive.write_bytes(raw)
            with self.assertRaises((intake.Refused, zipfile.BadZipFile)):
                intake.safe_extract(archive, parent / 'bomb', 'original')

    def test_github_style_streaming_data_descriptors_are_validated_and_accepted(self):
        class ForwardOnly(io.BytesIO):
            def seek(self, *arguments):
                raise OSError('unit control intentionally has no backwards seek')
        stream = ForwardOnly()
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as writer:
            for name, raw in public_files('original').items():
                info = zipfile.ZipInfo(PREFIX + name)
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                writer.writestr(info, raw)
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            archive = parent / 'streaming.zip'
            archive.write_bytes(stream.getvalue())
            with zipfile.ZipFile(archive) as reader:
                self.assertTrue(all(info.flag_bits & 8 for info in reader.infolist()))
            public = intake.safe_extract(archive, parent / 'public', 'original')
            self.assertEqual((public / 'receipt.json').read_bytes(), public_files('original')['receipt.json'])

    def test_prepended_trailing_comment_or_local_central_name_drift_is_rejected(self):
        for mutation in ('prepend', 'trailer', 'comment', 'local-name'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                parent = Path(temporary)
                archive = write_zip(parent / 'original.zip')
                raw = bytearray(archive.read_bytes())
                if mutation == 'prepend': raw = bytearray(b'UNINDEXED') + raw
                elif mutation == 'trailer': raw += b'UNINDEXED'
                elif mutation == 'comment':
                    with zipfile.ZipFile(archive, 'a') as writer:
                        writer.comment = b'undeclared trailer'
                    raw = bytearray(archive.read_bytes())
                else: raw[30] ^= 1
                archive.write_bytes(raw)
                with self.assertRaises((intake.Refused, zipfile.BadZipFile)):
                    intake.safe_extract(archive, parent / 'out', 'original')

    def test_aggregate_expansion_budget_is_checked_before_extracting_any_leaf(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            archive = write_zip(parent / 'aggregate.zip')
            with zipfile.ZipFile(archive) as reader:
                infos = reader.infolist()
                central = reader.start_dir
            raw = bytearray(archive.read_bytes())
            for info in infos[:5]:
                struct.pack_into('<I', raw, info.header_offset + 22, 512 << 20)
                struct.pack_into('<I', raw, central + 24, 512 << 20)
                name, extra, comment = struct.unpack_from('<HHH', raw, central + 28)
                central += 46 + name + extra + comment
            archive.write_bytes(raw)
            destination = parent / 'out'
            with self.assertRaises(intake.Refused):
                intake.safe_extract(archive, destination, 'original')
            self.assertFalse(destination.exists(), 'aggregate bomb must fail before materialization')

    def test_encrypted_or_other_compression_is_not_a_public_artifact_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            archive = write_zip(parent / 'encrypted.zip')
            raw = bytearray(archive.read_bytes())
            central = raw.index(b'PK\x01\x02')
            struct.pack_into('<H', raw, 6, struct.unpack_from('<H', raw, 6)[0] | 1)
            struct.pack_into('<H', raw, central + 8, struct.unpack_from('<H', raw, central + 8)[0] | 1)
            archive.write_bytes(raw)
            with self.assertRaises(intake.Refused):
                intake.safe_extract(archive, parent / 'encrypted', 'original')
            archive = write_zip(parent / 'other.zip', compression=zipfile.ZIP_BZIP2)
            with self.assertRaises(intake.Refused):
                intake.safe_extract(archive, parent / 'other', 'original')

    def test_complete_original_public_receipt_and_input_binding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = write_public(Path(temporary) / 'public', 'original')
            expected = digest((root / 'baseline-input.json').read_bytes())
            value = intake.validate_public(root, 'original', FDC, expected)
            self.assertEqual(value['inputSha256'], expected)
            self.assertEqual(value['cases'], ORIGINAL_CASES)
            self.assertEqual(value['receipt']['sourceCommit'], FDC)

    def test_dirty_incomplete_failed_or_wrong_source_receipt_cannot_be_before(self):
        changes = [lambda d: d.update(sourceCommit='1' * 40), lambda d: d.update(sourceMatrixComplete=False),
                   lambda d: d.update(cleanupComplete=False), lambda d: d.update(testExitCode=1),
                   lambda d: d.update(firstCause='actual probe failure'),
                   lambda d: d.update(originalOwnerDirtyExcluded=' M internal/consensus/state.go'),
                   lambda d: d.update(completedCases=ORIGINAL_CASES[:-1]),
                   lambda d: d.update(expectedCases=list(reversed(ORIGINAL_CASES)))]
        for mutate in changes:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory() as temporary:
                root = write_public(Path(temporary) / 'public', 'original')
                receipt = json.loads((root / 'receipt.json').read_bytes())
                mutate(receipt)
                (root / 'receipt.json').write_bytes(encoded(receipt))
                with self.assertRaises(intake.Refused):
                    intake.validate_public(root, 'original', FDC)

    def test_original_input_sha_and_measure_binding_must_all_match(self):
        for mutation in ('expected-pin', 'input-file', 'measure-binding', 'missing-after'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                root = write_public(Path(temporary) / 'public', 'original')
                expected = digest((root / 'baseline-input.json').read_bytes())
                if mutation == 'expected-pin':
                    expected = '1' * 64
                elif mutation == 'input-file':
                    with (root / 'baseline-input.json').open('ab') as out:
                        out.write(b' ')
                elif mutation == 'measure-binding':
                    path = root / 'H256-K16-measure.json'
                    value = json.loads(path.read_bytes())
                    value['inputSha256'] = '1' * 64
                    path.write_bytes(encoded(value))
                else:
                    (root / 'H512-K16-after.json').unlink()
                with self.assertRaises(intake.Refused):
                    intake.validate_public(root, 'original', FDC, expected)

    def test_multi_input_is_real_separate_528_denominator_and_four_history_slices(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = write_public(Path(temporary) / 'public', 'multi-whole')
            value = intake.validate_public(root, 'multi-whole', FDC)
            self.assertEqual(value['cases'], MULTI_CASES)
            self.assertEqual(len(json.loads((root / 'baseline-input.json').read_bytes())['history']), 528)

    def test_multi_rejects_old512_duplicate_signed_inputs_or_detached_candidate(self):
        for mutation in ('old-schema', '512', 'duplicate', 'empty-entry', 'old-cases', 'wrong-slice', 'missing-case'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                root = write_public(Path(temporary) / 'public', 'multi-whole')
                path = root / 'baseline-input.json'
                bundle = json.loads(path.read_bytes())
                if mutation == 'old-schema': bundle['schema'] = 'YNX-PQ-BASELINE-PUBLIC-INPUT/v1'
                elif mutation == '512': bundle['history'] = bundle['history'][:512]
                elif mutation == 'duplicate': bundle['history'][527] = bundle['history'][0]
                elif mutation == 'empty-entry': bundle['history'][527] = ''
                elif mutation == 'old-cases': bundle['cases'] = {'H0-K16': bundle['history'][0]}
                elif mutation == 'wrong-slice': bundle['candidateCases']['H512-W16-K1'] = bundle['history'][:16]
                else: bundle['candidateCases'].pop('H0-W16-K1')
                path.write_bytes(encoded(bundle))
                # Keep receipt/measures bound to the changed bytes, so this
                # reaches the actual denominator/slice controls, not SHA alone.
                changed = digest(path.read_bytes())
                for leaf in ['receipt.json'] + [name + '-measure.json' for name in MULTI_CASES]:
                    value = json.loads((root / leaf).read_bytes())
                    value['inputSha256'] = changed
                    (root / leaf).write_bytes(encoded(value))
                with self.assertRaises(intake.Refused):
                    intake.validate_public(root, 'multi-whole', FDC)

    def test_duplicate_json_key_is_not_a_second_source_or_cleanup_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = write_public(Path(temporary) / 'public', 'original')
            raw = (root / 'receipt.json').read_bytes().rstrip()
            (root / 'receipt.json').write_bytes(raw[:-1] + b',"cleanupComplete":false}\n')
            with self.assertRaises(intake.Refused):
                intake.validate_public(root, 'original', FDC)

    def test_public_readback_rejects_any_symlink_including_full_states_and_logs(self):
        for leaf in ('H0-K1-after.json', 'compile-baseline.log', 'baseline-input.json'):
            with self.subTest(leaf=leaf), tempfile.TemporaryDirectory() as temporary:
                parent = Path(temporary)
                root = write_public(parent / 'public', 'original')
                original = (root / leaf).read_bytes()
                outside = parent / 'outside-public'
                outside.write_bytes(original)
                (root / leaf).unlink()
                (root / leaf).symlink_to(outside)
                with self.assertRaises(intake.Refused):
                    intake.validate_public(root, 'original', FDC)

    @staticmethod
    def machine():
        return {'cpuModels': ['UNIT-CONTROL CPU MODEL'], 'cpuVendors': ['UNIT-CONTROL VENDOR'],
                'architecture': 'amd64', 'logicalCPUs': 4, 'memoryTotalBytes': 16 << 30,
                'imageOS': 'ubuntu24', 'imageVersion': 'UNIT-CONTROL IMAGE',
                'goVersion': 'go1.26.10', 'affinityCount': 2, 'probeGOMAXPROCS': 1, 'kernel': 'unit-kernel'}

    def test_same_machine_configuration_never_claims_same_physical_host(self):
        result = intake.hardware_qualification(self.machine(), copy.deepcopy(self.machine()))
        self.assertIs(result['performanceComparisonQualified'], True)
        self.assertIs(result['samePhysicalHostClaim'], False)

    def test_original_before_missing_hardware_retains_functional_only_qualification(self):
        result = intake.hardware_qualification(None, self.machine(), allow_missing=True)
        self.assertIs(result['performanceComparisonQualified'], False)
        self.assertIs(result['samePhysicalHostClaim'], False)
        self.assertEqual(result['reason'], 'original-before-hardware-NOT_SUPPLIED')
        with self.assertRaises(intake.Refused):
            intake.hardware_qualification(None, self.machine())

    def test_actual_hardware_or_execution_configuration_mismatch_is_rejected(self):
        changes = {'cpuModels': ['ANOTHER MODEL'], 'cpuVendors': ['ANOTHER VENDOR'],
                   'architecture': 'arm64', 'logicalCPUs': 8, 'memoryTotalBytes': 32 << 30,
                   'imageOS': 'ubuntu22', 'imageVersion': 'ANOTHER IMAGE',
                   'goVersion': 'go1.25.7', 'affinityCount': 1, 'probeGOMAXPROCS': 2, 'kernel': 'different-kernel'}
        for key, value in changes.items():
            after = self.machine()
            after[key] = value
            with self.subTest(key=key):
                if key in ('architecture', 'goVersion', 'affinityCount', 'probeGOMAXPROCS'):
                    with self.assertRaises(intake.Refused):
                        intake.hardware_qualification(self.machine(), after)
                else:
                    result = intake.hardware_qualification(self.machine(), after)
                    self.assertIs(result['performanceComparisonQualified'], False)
                    self.assertIs(result['samePhysicalHostClaim'], False)
                    self.assertEqual(result['differentFields'], [key])
                    self.assertEqual(result['reason'], 'actual-runner-hardware-or-image-differs')
        missing = self.machine()
        missing.pop('cpuModels')
        with self.assertRaises(intake.Refused):
            intake.hardware_qualification(missing, self.machine())
        missing = self.machine()
        missing.pop('kernel')
        with self.assertRaises(intake.Refused):
            intake.hardware_qualification(missing, self.machine())

    def test_unknown_or_untyped_matching_hardware_is_not_physical_measurement_evidence(self):
        for key, value in (('cpuModels', []), ('cpuVendors', []), ('logicalCPUs', True),
                           ('memoryTotalBytes', 0), ('probeGOMAXPROCS', True),
                           ('affinityCount', 2.0), ('architecture', 'unknown')):
            before = self.machine()
            before[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(intake.Refused):
                intake.hardware_qualification(before, copy.deepcopy(before))

    @staticmethod
    def cli_arguments(scope='b8'):
        return ['--scope', scope, '--tools', '/UNIT-NOT-EXISTING/tools',
                '--owner', '/UNIT-NOT-EXISTING/owner', '--controller', '/UNIT-NOT-EXISTING/controller',
                '--operation', '/UNIT-NOT-EXISTING/operation']

    def test_default_cli_prepared_only_never_invokes_scope_host_or_any_effect(self):
        fixed = {
            'b8': [TOOLS8, 'b2120f6a0dc65666145cc9976b9f13d8b175f34d', 'original'],
            'multi-before': ['aa9447df2f5867542892f6fdbfbefbd116daed91', FDC, 'multi-whole'],
            'multi-a': ['aa9447df2f5867542892f6fdbfbefbd116daed91',
                        'b77a3df453d880ab31aca99ce94fc9a7feb4fffb', 'multi-whole'],
            'multi-b': ['aa9447df2f5867542892f6fdbfbefbd116daed91',
                        'b2120f6a0dc65666145cc9976b9f13d8b175f34d', 'multi-whole'],
        }
        for scope in fixed:
            stdout = io.StringIO()
            with self.subTest(scope=scope), mock.patch.dict(os.environ, {}, clear=True), \
                 mock.patch.object(intake, 'run_scope') as run, \
                 mock.patch.object(intake, 'actual_machine') as machine, \
                 mock.patch.object(intake.Path, 'mkdir', side_effect=AssertionError('prepared-only created directory')), \
                 mock.patch.object(intake.urllib.request, 'urlopen', side_effect=AssertionError('prepared-only network')), \
                 mock.patch.object(intake.subprocess, 'Popen', side_effect=AssertionError('prepared-only process')), \
                 mock.patch.object(intake.subprocess, 'check_output', side_effect=AssertionError('prepared-only command')), \
                 redirect_stdout(stdout):
                self.assertEqual(intake.main(self.cli_arguments(scope)), 0)
                run.assert_not_called()
                machine.assert_not_called()
            self.assertEqual(json.loads(stdout.getvalue()), {'status': 'prepared-only', 'scope': scope,
                             'fixed': fixed[scope], 'sourceComparisonExecuted': False})

    def test_unknown_scope_unknown_flag_abbreviation_and_missing_argv_are_refused(self):
        for argv in (self.cli_arguments('other-scope'), self.cli_arguments() + ['--provider', 'replacement'],
                     self.cli_arguments() + ['--exec'], [], self.cli_arguments()[:-2]):
            with self.subTest(argv=argv), mock.patch.object(intake, 'run_scope') as run, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as failure:
                    intake.main(argv)
                self.assertEqual(failure.exception.code, 2)
                run.assert_not_called()

    def test_actions_token_is_environment_header_only_without_network_or_child(self):
        token = 'UNIT-ONLY-actions-read-token'
        path = '/repos/JiahaoAlbus/YNX-Chain/actions/artifacts/13042588614'
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {'GH_TOKEN': token}, clear=True), \
             mock.patch.object(intake.urllib.request, 'urlopen') as network, \
             mock.patch.object(intake.subprocess, 'Popen') as child, \
             redirect_stdout(stdout), redirect_stderr(stderr):
            request = intake.api_request(path)
            network.assert_not_called()
            child.assert_not_called()
        self.assertEqual(request.full_url, 'https://api.github.com' + path)
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + token)
        self.assertEqual(request.get_method(), 'GET')
        self.assertNotIn(token, request.full_url)
        self.assertEqual((stdout.getvalue(), stderr.getvalue()), ('', ''))

    def test_actions_api_requires_normal_token_and_refuses_other_repository_or_host(self):
        allowed = '/repos/JiahaoAlbus/YNX-Chain/actions/artifacts/13042588614'
        for token in ('', 'UNIT\rTOKEN', 'UNIT\nTOKEN'):
            with self.subTest(token=token), mock.patch.dict(os.environ, {'GH_TOKEN': token}, clear=True), \
                 self.assertRaises(intake.Refused):
                intake.api_request(allowed)
        for path in ('/repos/other/project/actions/artifacts/1',
                     'https://evil.invalid/repos/JiahaoAlbus/YNX-Chain/actions/artifacts/1',
                     '//api.github.com/repos/JiahaoAlbus/YNX-Chain/actions/artifacts/1',
                     '/repos/JiahaoAlbus/YNX-Chain/issues',
                     '/repos/JiahaoAlbus/YNX-Chain/actions/artifacts/1/../../secrets',
                     '/repos/JiahaoAlbus/YNX-Chain/actions/runs/1'):
            with self.subTest(path=path), mock.patch.dict(os.environ, {'GH_TOKEN': 'UNIT-ONLY-token'}, clear=True), \
                 self.assertRaises(intake.Refused):
                intake.api_request(path)

    def test_normal_scope_command_wiring_uses_fixed_source_and_original_entrypoints(self):
        # Mock-only wiring, not real measurement or comparison qualification.
        expected = {'b8': (TOOLS8, 'b2120f6a0dc65666145cc9976b9f13d8b175f34d', 'original'),
                    'multi-before': ('aa9447df2f5867542892f6fdbfbefbd116daed91', FDC, 'multi-whole'),
                    'multi-a': ('aa9447df2f5867542892f6fdbfbefbd116daed91',
                                'b77a3df453d880ab31aca99ce94fc9a7feb4fffb', 'multi-whole'),
                    'multi-b': ('aa9447df2f5867542892f6fdbfbefbd116daed91',
                                'b2120f6a0dc65666145cc9976b9f13d8b175f34d', 'multi-whole')}
        for scope, (tools_commit, owner_commit, profile) in expected.items():
            with self.subTest(scope=scope), command_wiring(scope) as state:
                record = intake.run_scope(state['arguments'])
                state['originalLabMock'].assert_called_once_with(state['tools'], tools_commit)
                state['lab'].check_source.assert_called_once_with(state['owner'], owner_commit)
                self.assertEqual((record['toolsCommit'], record['sourceCommit']), (tools_commit, owner_commit))
                commands = dict(state['commands'])
                prepared = state['operation'] / 'prepared'
                self.assertEqual(commands['prepare-original-source'], [intake.sys.executable, '-B',
                    str(state['tools'] / 'scripts/loadtest/prepare-pq-baseline.py'), '--owner', str(state['owner']),
                    '--commit', owner_commit, '--output', str(prepared)])
                self.assertFalse(state['tools'].exists())
                self.assertFalse(state['owner'].exists())
                self.assertTrue((prepared / '.inputs/tools').is_dir())
                self.assertTrue((prepared / '.inputs/owner').is_dir())
                run = commands['original-source-entry']
                self.assertEqual(run[:3], [intake.sys.executable, '-B',
                    str(prepared / '.inputs/tools/scripts/loadtest/run-pq-baseline.py')])
                self.assertEqual(run[run.index('--prepared') + 1], str(prepared / 'prepared.json'))
                self.assertEqual(run[-1], '--execute')
                self.assertEqual(run[run.index('--mode') + 1], 'record' if scope == 'multi-before' else 'replay')
                if scope == 'b8':
                    self.assertNotIn('--profile', run, 'old b6 runner must not receive new profile flag')
                    self.assertEqual(run[run.index('--input-sha256') + 1],
                                     'c819fb976a422b855d3fc3e6939338995fa380556e642bda2ab59dcc66353401')
                    self.assertEqual(state['downloads'][0][0], intake.OLD_ARTIFACT)
                else:
                    self.assertEqual(run[run.index('--profile') + 1], 'multi-whole')
                if scope == 'multi-before':
                    self.assertEqual(state['downloads'], [])
                    self.assertNotIn('--input', run)
                    self.assertNotIn('original-full-state-compare', commands)
                    self.assertIs(record['beforeRecord'], True)
                    self.assertIs(record['comparisonComplete'], False)
                else:
                    self.assertEqual(len(state['downloads']), 1)
                    download, destination, downloaded_profile = state['downloads'][0]
                    self.assertEqual(downloaded_profile, profile)
                    before = destination / 'extracted/public'
                    self.assertEqual(run[run.index('--input') + 1], str(before / 'baseline-input.json'))
                    compare = commands['original-full-state-compare']
                    self.assertEqual(compare[:3], [intake.sys.executable, '-B',
                        str(prepared / '.inputs/tools/scripts/loadtest/compare-pq-baseline.py')])
                    self.assertEqual(compare[compare.index('--before') + 1], str(before))
                    self.assertEqual(compare[compare.index('--after') + 1], str(state['public']))
                    self.assertEqual(Path(compare[compare.index('--output') + 1]).name,
                                     'B8-complete-differential.json' if scope == 'b8' else 'MULTI-complete-differential.json')
                    self.assertIs(record['comparisonComplete'], True)
                    self.assertIs(record['beforeRecord'], False)
                    if scope != 'b8':
                        self.assertEqual(download, {'artifactId': 13099999999, 'runId': 41210000000,
                            'name': 'pq-source-multi-before-41210000000', 'digest': '4' * 64, 'size': None,
                            'workflowCommit': state['env']['GITHUB_SHA']})
                        self.assertEqual(run[run.index('--input-sha256') + 1], state['env']['MULTI_BEFORE_INPUT_SHA256'])
                self.assertEqual(state['validations'][-1][2:4], (profile, owner_commit))
                self.assertIs(state['validations'][-1][-1], True, 'raw original output must use owned verifier child')
                outputs = dict(line.split('=', 1) for line in state['output'].read_text().splitlines())
                self.assertEqual(outputs['public'], str(state['public']))
                self.assertEqual(outputs['run_id'], state['env']['GITHUB_RUN_ID'])
                self.assertIn('input_sha256', outputs)

    def test_scope_storage_accounts_workspace_temporary_setup_go_and_folds_nested_roots(self):
        for scope in ('b8', 'multi-before', 'multi-a', 'multi-b'):
            with self.subTest(scope=scope), command_wiring(scope) as state:
                record = intake.run_scope(state['arguments'])
                roots = [Path(path) for path in record['storageRoots']]
                self.assertEqual(set(roots), {state['runner'], state['workspace'], state['goRoot']})
                self.assertEqual(len(roots), 3)
                self.assertTrue(any(root in state['operation'].parents for root in roots))
                self.assertTrue(all(not (left in right.parents or right in left.parents)
                                    for i, left in enumerate(roots) for right in roots[i + 1:]))
                self.assertNotIn('GH_TOKEN', state['window'].env)
                self.assertNotIn('GITHUB_TOKEN', state['window'].env)
                self.assertEqual(state['window'].env['RUNNER_TEMP'], str(state['operation']))
                self.assertEqual(state['window'].env['GOMAXPROCS'], '1')
                self.assertEqual(record['caps'], {'totalSeconds': 900, 'cleanupSeconds': 15, 'rssBytes': 4 << 30,
                    'newBytes': 8 << 30, 'initialMemoryBytes': 6 << 30, 'initialDiskBytes': 16 << 30,
                    'logBytes': 4 << 20, 'cpus': 2})
                self.assertEqual(state['cleanupCalls'], 1)

    def test_failed_cleanup_preserves_diagnostics_and_cannot_promote_ready_outputs(self):
        with command_wiring('b8', cleanup=False) as state:
            with self.assertRaises(intake.Refused):
                intake.run_scope(state['arguments'])
            outputs = dict(line.split('=', 1) for line in state['output'].read_text().splitlines())
            self.assertIn('diagnostics', outputs)
            self.assertIn('public', outputs)
            self.assertNotIn('input_sha256', outputs)
            self.assertNotIn('run_id', outputs)
            controller = json.loads((state['public'] / 'SOURCE-COMPARE-CONTROLLER.json').read_bytes())
            self.assertIs(controller['cleanupComplete'], False)
            self.assertEqual(state['cleanupCalls'], 1)

    def test_execute_dispatch_and_hosted_attempt_fences_precede_normal_scope_effects(self):
        with mock.patch.object(intake, 'run_scope') as run:
            self.assertEqual(intake.main(self.cli_arguments('multi-a') + ['--execute']), 0)
            self.assertIs(run.call_args.args[0].execute, True)
            self.assertEqual(run.call_args.args[0].scope, 'multi-a')
        for change in ({'GITHUB_ACTIONS': 'false'}, {'RUNNER_ENVIRONMENT': 'self-hosted'},
                       {'GITHUB_RUN_ATTEMPT': '2'}):
            environment = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'GITHUB_RUN_ATTEMPT': '1'}
            environment.update(change)
            with self.subTest(change=change), mock.patch.dict(os.environ, environment, clear=True), \
                 mock.patch.object(intake.sys, 'platform', 'linux'), mock.patch.object(intake, 'original_lab') as lab, \
                 mock.patch.object(intake.subprocess, 'Popen', side_effect=AssertionError('fenced scope process')), \
                 mock.patch.object(intake.urllib.request, 'urlopen', side_effect=AssertionError('fenced scope network')):
                with self.assertRaises(intake.Refused):
                    intake.run_scope(SimpleNamespace(scope='b8'))
                lab.assert_not_called()


if __name__ == '__main__':
    unittest.main()
