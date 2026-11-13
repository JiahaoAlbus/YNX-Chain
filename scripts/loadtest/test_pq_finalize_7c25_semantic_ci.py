#!/usr/bin/env python3
"""Pure controls only: original PUBLIC bytes and simulated controller inputs.

No Go, binary replay, process sampling, signing, network or node is run here.
Synthetic output wrappers test qualification refusal, not Go semantic success.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location('finalize_semantic_controller', HERE / 'pq-finalize-7c25-semantic-ci.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PUBLIC = HERE / 'fixtures/finalize-1b-public'


def env():
    return dict(YNX_SEMANTIC_PROFILE=m.PROFILE, GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted', RUNNER_OS='Linux',
                GITHUB_REPOSITORY=m.REPOSITORY, GITHUB_REF=m.REF, GITHUB_WORKFLOW_REF=m.WORKFLOW,
                GITHUB_EVENT_NAME='workflow_dispatch', GITHUB_RUN_ATTEMPT='1', GITHUB_JOB='finalize-7c25-semantic',
                GITHUB_SHA='1'*40, GITHUB_WORKFLOW_SHA='1'*40)


def replay_wrapper():
    return dict(version='YNX-PQ-LAB-FINALIZE-REPLAY/v1', traceSHA256=m.TRACE_PIN, firstHeight='4', lastHeight='12',
                records=dict(name='replay.jsonl', bytes='4439710', sha256=m.FIXTURE['records.jsonl'][1]),
                finalState=dict(name='final-state.json', bytes='517890', sha256=m.FIXTURE['final-state.json'][1]),
                completeStateBytesReconstructed=True, fullResponsesCompared=True, normalizationApplied=False,
                sourceReadOnly=True, syntheticOnly=True, nodeStarted=False, authorityGranted=False, liveNetworkPairQualified=False)


def fake_outputs(work):
    for arm in ('before', 'after'):
        out = work / 'public' / (arm + '-replay')
        out.mkdir(parents=True)
        shutil.copyfile(PUBLIC / 'records.jsonl', out / 'replay.jsonl')
        shutil.copyfile(PUBLIC / 'final-state.json', out / 'final-state.json')
        (out / 'result.json').write_text(json.dumps(replay_wrapper(), separators=(',', ':')))
        (out / 'intent.json').write_text(json.dumps(dict(TraceSHA256=m.TRACE_PIN), separators=(',', ':')))


def assert_workflow(raw):
    events = raw.split('permissions:', 1)[0]
    if re.search(r'^  (push|pull_request|schedule):', events, re.M):
        raise AssertionError('no push/PR/schedule heavy execution')
    if '          - finalize-7c25-vs-f27\n' not in events:
        raise AssertionError('explicit new profile is dispatchable')
    legacy = "    if: github.event_name == 'workflow_dispatch' && inputs.profile == 'original-source-compare-v1' && github.run_attempt == 1\n"
    for job in ('intake-controls', 'b8-original-replay', 'multi-original-before', 'multi-a-replay', 'multi-b-replay'):
        if '  ' + job + ':\n' + legacy not in raw:
            raise AssertionError('old job must remain isolated from new profile')
    block = re.split(r'\n  [A-Za-z0-9_-]+:\n', raw.split('  finalize-7c25-semantic:\n', 1)[1], maxsplit=1)[0]
    guard = "    if: github.event_name == 'workflow_dispatch' && inputs.profile == 'finalize-7c25-vs-f27' && github.run_attempt == 1 && github.ref == '" + m.REF + "'\n"
    if not block.startswith(guard):
        raise AssertionError('fixed first attempt original ref required')
    for item in ("runs-on: ubuntu-24.04", "ref: " + m.AFTER, "go-version: '1.26.10'", "cache: false", "persist-credentials: false", "fetch-depth: 1", "--operation \"$RUNNER_TEMP/pq-finalize-7c25-semantic\" --execute", "if: always() && steps.semantic.outputs.public != ''", "path: ${{ steps.semantic.outputs.public }}/**", "include-hidden-files: false", "GH_TOKEN: ${{ github.token }}"):
        if item not in block:
            raise AssertionError('fixed normal flow missing: ' + item)
    for leaf in m.EVIDENCE_OVERLAY:
        if m.CARRIER_PREFIX + leaf['path'] not in block:
            raise AssertionError('fixed common Go evidence carrier missing')
    if 'scripts/loadtest/pq-semantic-height-state.py' not in block:
        raise AssertionError('exact height-state consumer missing')
    if block.count('--execute') != 1 or 'Node.Start' in block or 'baseline-input' in block or 'build ' in block:
        raise AssertionError('all builds/replays must remain in single original Window')
    if 'test_pq_finalize_7c25_semantic_ci.py" -v' not in block:
        raise AssertionError('pure controls must execute before Window')
    for item in ('ref: ' + m.TOOLS_COMMIT, 'path: tools', '--tools "$GITHUB_WORKSPACE/tools"'):
        if item not in block:
            raise AssertionError('exact qualified tools checkout required: ' + item)
    if '--operation "$RUNNER_TEMP/' + m.OPERATION_DIRECTORY + '" --execute' not in block:
        raise AssertionError('actual operation path must match the new script scope')


class FinalizeSemanticCIControls(unittest.TestCase):
    def test_operation_path_is_new_profile_fresh_and_preserves_existing_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();expected=root/m.OPERATION_DIRECTORY
            self.assertEqual(m.operation_path(root,expected),expected)
            with self.assertRaises(RuntimeError):m.operation_path(root,root/'pq-finalize-1b-semantic')
            expected.mkdir();(expected/'UNKNOWN').write_text('retain')
            with self.assertRaises(RuntimeError):m.operation_path(root,expected)
            self.assertEqual((expected/'UNKNOWN').read_text(),'retain')

    def test_exact_tools_head_tree_and_cleanliness_are_separate(self):
        good=[m.TOOLS_COMMIT.encode(),m.TOOLS_TREE.encode(),b'']
        with patch.object(m,'git',side_effect=good):m.validate_tools(Path('/UNIT-TOOLS'))
        for values in ([b'0'*40,*good[1:]],[good[0],b'0'*40,b''],[good[0],good[1],b' M source']):
            with self.subTest(values=values),patch.object(m,'git',side_effect=values),self.assertRaisesRegex(RuntimeError,'clean qualified tools'):
                m.validate_tools(Path('/UNIT-TOOLS'))

    def test_new_fork_cannot_inherit_old_source_fork_identity(self):
        good=[m.BEFORE_FORK_TREE.encode(),m.AFTER_FORK_TREE.encode()]
        with patch.object(m,'git',side_effect=good):m.validate_forks(Path('/UNIT-SOURCE'),m.BEFORE_TREE)
        for values in ([b'0'*40,good[1]],[good[0],good[0]]):
            with self.subTest(values=values),patch.object(m,'git',side_effect=values),self.assertRaisesRegex(RuntimeError,'fork tree differs'):
                m.validate_forks(Path('/UNIT-SOURCE'),m.BEFORE_TREE)

    def test_explicit_first_attempt_profile_and_identity_only(self):
        good = env()
        m.validate_identity(m.PROFILE, good, 'linux')
        for key, wrong in [('YNX_SEMANTIC_PROFILE', 'b8'), ('GITHUB_ACTIONS', 'false'), ('RUNNER_ENVIRONMENT', 'self-hosted'),
                           ('RUNNER_OS', 'macOS'), ('GITHUB_REPOSITORY', 'other/repo'), ('GITHUB_REF', 'refs/heads/main'),
                           ('GITHUB_WORKFLOW_REF', m.WORKFLOW + '-other'), ('GITHUB_EVENT_NAME', 'push'),
                           ('GITHUB_RUN_ATTEMPT', '2'), ('GITHUB_JOB', 'b8-original-replay'),
                           ('GITHUB_SHA', 'short'), ('GITHUB_WORKFLOW_SHA', '2'*40)]:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                m.validate_identity(m.PROFILE, dict(good, **{key: wrong}), 'linux')
        for profile, platform in [('legacy', 'linux'), (m.PROFILE, 'darwin')]:
            with self.assertRaises(RuntimeError):
                m.validate_identity(profile, good, platform)

    def test_no_execute_has_no_effect_and_duplicate_option_refused(self):
        args = ['--profile', m.PROFILE, '--controller', '/missing', '--after-source', '/missing-source', '--tools', '/missing-tools', '--operation', '/missing-output']
        with patch.object(m, 'run', side_effect=AssertionError('must not execute')), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(m.main(args), 0)
        self.assertIs(json.loads(output.getvalue())['semanticQualified'], False)
        with self.assertRaises(RuntimeError):
            m.main(args + ['--profile', m.PROFILE])

    def test_all_nine_original_public_files_and_height_coordinates(self):
        receipt = m.validate_fixture(PUBLIC)
        self.assertEqual((receipt['firstHeight'], receipt['lastHeight']), ('4', '12'))
        self.assertEqual(len(m.FIXTURE), 9)
        rows = [json.loads(row) for row in (PUBLIC / 'records.jsonl').read_bytes().splitlines()]
        self.assertEqual([row['height'] for row in rows], list(map(str, range(4, 13))))
        self.assertTrue(all(row['request'] and row['response'] and row['stateSHA256'] and row['stateBytes'] for row in rows))

    def test_original_missing_extra_tampered_and_alias_input_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'public'
            shutil.copytree(PUBLIC, root)
            original = (root / 'intent.json').read_bytes()
            (root / 'intent.json').write_bytes(original + b' ')
            with self.assertRaises(RuntimeError): m.validate_fixture(root)
            (root / 'intent.json').write_bytes(original)
            (root / 'extra.json').write_text('{}')
            with self.assertRaises(RuntimeError): m.validate_fixture(root)
            (root / 'extra.json').unlink()
            (root / 'intent.json').unlink()
            with self.assertRaises(RuntimeError): m.validate_fixture(root)
            (root / 'intent.json').symlink_to(PUBLIC / 'intent.json')
            with self.assertRaises(RuntimeError): m.validate_fixture(root)

    def test_git_modes_materialize_privately_without_changing_original_bytes_or_modes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); original = root / 'checkout'; shutil.copytree(PUBLIC, original)
            for p in original.iterdir(): os.chmod(p, 0o644)
            before = {p.name: (m.pin(p), stat.S_IMODE(p.stat().st_mode)) for p in original.iterdir()}
            (root / '.private').mkdir(); (root / 'public').mkdir()
            private = m.prepare_private_fixture(original, root)
            self.assertEqual(stat.S_IMODE(private.stat().st_mode), 0o700)
            for p in private.iterdir():
                self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
                self.assertEqual(m.pin(p), before[p.name][0])
            self.assertEqual(before, {p.name: (m.pin(p), stat.S_IMODE(p.stat().st_mode)) for p in original.iterdir()})
            receipt = m.read_json(root / 'public/FIXTURE-MATERIALIZATION.json')
            self.assertFalse(receipt['normalizationApplied'])
            self.assertEqual(len(receipt['files']), 9)
            (private / 'UNKNOWN').write_text('retain')
            with self.assertRaisesRegex(RuntimeError, 'fresh private trace required'):
                m.prepare_private_fixture(original, root)
            self.assertEqual((private / 'UNKNOWN').read_text(), 'retain')

    def test_same_complete_outputs_qualify_only_the_comparison_not_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake_outputs(root)
            result = m.compare_outputs(root, PUBLIC)
            self.assertTrue(result['allNineHeights'])
            self.assertFalse(result['onlyFinalBalancesCompared'])
            self.assertFalse(result['liveNetworkPairQualified'])
            self.assertFalse(result['throughputMeasured'])
            self.assertNotIn('semanticQualified', result)

    def test_matching_two_bad_arms_cannot_hide_original_log_or_state_changes(self):
        for name in ('replay.jsonl', 'final-state.json', 'result.json', 'intent.json'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); fake_outputs(root)
                for arm in ('before', 'after'):
                    p = root / 'public' / (arm + '-replay') / name
                    p.write_bytes(p.read_bytes() + b' ')
                with self.assertRaises(RuntimeError): m.compare_outputs(root, PUBLIC)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fake_outputs(root)
            p = root / 'public/after-replay/replay.jsonl'
            rows = p.read_bytes().splitlines()
            row = json.loads(rows[0]); row['stateSHA256'] = '0'*64
            rows[0] = json.dumps(row, separators=(',', ':')).encode()
            p.write_bytes(b'\n'.join(rows) + b'\n')
            with self.assertRaises(RuntimeError): m.compare_outputs(root, PUBLIC)

    def test_output_failure_extra_and_missing_never_qualify(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fake_outputs(root)
            p = root / 'public/after-replay/result.json'
            value = replay_wrapper(); value['fullResponsesCompared'] = False
            p.write_text(json.dumps(value, separators=(',', ':')))
            with self.assertRaises(RuntimeError): m.compare_outputs(root, PUBLIC)
            p.unlink()
            with self.assertRaises(RuntimeError): m.compare_outputs(root, PUBLIC)

    def frozen_window_tools(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        directory = root / 'scripts/loadtest'
        directory.mkdir(parents=True)
        # This controller's source pin and its test are both about the
        # original tools, independent of current performance branch changes.
        for name in m.GUARD_PINS:
            raw = subprocess.check_output(
                ['git', '-C', str(ROOT), 'show', f'{m.TOOLS_COMMIT}:scripts/loadtest/{name}'],
                timeout=15)
            (directory / name).write_bytes(raw)
        return root

    def test_original_window_caps_and_pid16_are_not_caller_selectable(self):
        lab = m.original_window(self.frozen_window_tools())
        self.assertEqual(lab.CAPS, m.CAPS)
        lab.admit(6 << 30, 16 << 30, [])
        for memory, disk, heavy in [((6 << 30)-1, 16 << 30, []), (6 << 30, (16 << 30)-1, []), (6 << 30, 16 << 30, [{'pid': 1}])]:
            with self.assertRaises(RuntimeError): lab.admit(memory, disk, heavy)
        guard = types.SimpleNamespace(proc_inventory=lambda: ({}, []), owned_set=lambda *a, **k: set(range(16)))
        fake = types.SimpleNamespace(guard=guard)
        m.enforce_pid_budget(fake, types.SimpleNamespace(known={}))
        guard.owned_set = lambda *a, **k: set(range(17))
        with self.assertRaises(RuntimeError): m.enforce_pid_budget(fake, types.SimpleNamespace(known={}))

    def test_guard_tamper_refused_before_import_or_host_effect(self):
        root = self.frozen_window_tools()
        m.original_window(root)
        p = root / 'scripts/loadtest/consensus-linux-cohort.py'
        p.write_bytes(p.read_bytes() + b'\n')
        with self.assertRaisesRegex(RuntimeError, 'original Window/guard pin differs'):
            m.original_window(root)

    def test_source_archive_rejects_escape_links_duplicates_and_existing_output(self):
        for kind in ('escape', 'link', 'duplicate', 'extra'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); archive = root / 'original.tar'; target = root / 'source'
                with tarfile.open(archive, 'w') as writer:
                    item = tarfile.TarInfo('../escape' if kind == 'escape' else 'unapproved/file' if kind == 'extra' else 'go.mod')
                    if kind == 'link':
                        item.type = tarfile.SYMTYPE; item.linkname = '/unapproved'
                    else:
                        item.size = 1
                    writer.addfile(item, io.BytesIO(b'x') if item.isfile() else None)
                    if kind == 'duplicate': writer.addfile(item, io.BytesIO(b'x'))
                with self.assertRaises(RuntimeError): m.extract_source(archive, target)
                self.assertFalse(target.exists())
                target.mkdir(); (target / 'UNKNOWN').write_text('retain')
                with self.assertRaises(RuntimeError): m.extract_source(archive, target)
                self.assertEqual((target / 'UNKNOWN').read_text(), 'retain')

    def test_private_index_exact_tree_and_distinct_after_main(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / '.private').mkdir(); (root / 'public').mkdir(); calls = []
            def git(repo, *args, env=None):
                calls.append((args, env))
                if args == ('rev-parse', 'HEAD'): return m.AFTER.encode()
                if args == ('rev-parse', 'HEAD^{tree}'): return m.AFTER_TREE.encode()
                if args[0] == 'rev-parse':
                    revision, path = args[1].split(':', 1); index = m.OVERLAY.index(path)
                    return (m.TRACE_BLOBS[index] if index < 4 else m.MAIN_BLOBS[0 if revision == m.CALLER else 1]).encode()
                if args[0] == 'write-tree': return b'0'*40
                return b''
            with patch.object(m, 'git', side_effect=git), self.assertRaisesRegex(RuntimeError, 'composed.*tree mismatch'):
                m.prepare_sources(root, root)
            self.assertEqual(calls[2][0], ('read-tree', m.BEFORE_BASE))
            edits = [(argv, environment) for argv, environment in calls if argv[0] == 'update-index']
            self.assertEqual(len(edits), 5)
            self.assertTrue(all(item[1]['GIT_INDEX_FILE'] == str(root / '.private/before-index') for item in edits))
            self.assertEqual([item[0][-1] for item in edits], list(m.OVERLAY))
            self.assertFalse(any(argv[0] in ('commit', 'checkout', 'branch', 'push', 'reset') for argv, _ in calls))
            self.assertNotEqual(*m.MAIN_BLOBS)

    def test_exact_after_go_test_command_and_fixture_environment_restore_original_failure(self):
        self.assertEqual(m.height_test_command(),['go','test','-mod=readonly','-json','-count=1','-p','1','-timeout=90s',
            '-run=^TestPQLabFinalizeTraceHeightEvidencePUBLIC(NineStatesAndCold|ColdRefusals)$','./internal/consensus'])
        for initial in ({},{'YNX_PUBLIC_REGISTERED_OBSERVER_TRACE':'retained-original-value'}):
            window=types.SimpleNamespace(env=dict(initial));original=RuntimeError('original Linux test failure')
            def call(name,command,source):
                self.assertEqual(name,'after-height-evidence-tests')
                self.assertEqual(command,m.height_test_command())
                self.assertEqual(window.env['YNX_PUBLIC_REGISTERED_OBSERVER_TRACE'],str(PUBLIC))
                raise original
            with self.assertRaises(RuntimeError) as observed:m.run_height_tests(window,call,Path('/unused-source'),PUBLIC,Path('/unused-output'))
            self.assertIs(observed.exception,original)
            self.assertEqual(window.env,initial)

    def test_canonical_roots_and_source_inventory_never_hide_alias_or_vcs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); child = root / 'child'; child.mkdir()
            self.assertEqual(m.counted_roots([child, root]), [root])
            alias = root / 'alias'; alias.symlink_to(child, target_is_directory=True)
            with self.assertRaises(RuntimeError): m.counted_roots([alias])
            alias.unlink(); (child / '.git').mkdir()
            with self.assertRaises(RuntimeError): m.source_inventory(root)

    def test_fixed_fetch_token_is_only_child_environment_and_cleared_on_failure(self):
        window = types.SimpleNamespace(env={'GOMAXPROCS': '2'})
        calls = []
        def call(name, argv, cwd):
            calls.append((name, argv, str(cwd)))
            self.assertEqual(argv[-2:], [m.BEFORE_BASE, m.CALLER])
            self.assertIn('--no-write-fetch-head', argv)
            self.assertNotIn('PUBLIC-TEST-TOKEN', str(argv))
            self.assertEqual(window.env['GIT_CONFIG_COUNT'], '1')
            self.assertEqual(window.env['GIT_CONFIG_KEY_0'], 'http.https://github.com/.extraheader')
            raise RuntimeError('original fetch failure')
        with self.assertRaisesRegex(RuntimeError, '^original fetch failure$'):
            m.fetch_original_objects(window, Path('/synthetic/after-source'), call, 'PUBLIC-TEST-TOKEN')
        self.assertEqual(len(calls), 1)
        self.assertEqual(window.env, {'GOMAXPROCS': '2'})
        for token in ('', 'bad\ntoken'):
            with self.assertRaises(RuntimeError): m.fetch_original_objects(window, Path('/unused'), call, token)
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    import sys
    if '--tools' in sys.argv:
        i = sys.argv.index('--tools')
        TOOLS_ROOT = Path(sys.argv[i + 1]).resolve(strict=True)
        del sys.argv[i:i + 2]
    if '--workflow' in sys.argv:
        i = sys.argv.index('--workflow')
        assert_workflow(Path(sys.argv[i + 1]).read_text())
        del sys.argv[i:i + 2]
    unittest.main()
