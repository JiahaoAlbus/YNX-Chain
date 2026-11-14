"""Pure lifecycle/filesystem controls; no Linux/Go/node/Actions execution proof."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

import importlib.util


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name+'.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


producer = module('pq-same-runner-pair-producer')
fixtures = module('test_pq_same_runner_pair_readback')
reader = producer.reader


class ControlledAdapter:
    """Copies explicit synthetic original-format DATA; never runs a real callee."""
    def __init__(self, case, arm):
        self.case, self.arm = case, arm
        self.mode = None
        self.admissions = 0
        self.work = case.root/case.fixture.markers[arm]['workDirectoryName']
        self.retained = None

    def qualification_record(self):
        return self.case.fixture.get(self.arm, 'FIRST100-HELD-CI.json')

    def qualify(self):
        self.case.events.append(self.arm+':qualify')
        if self.mode == 'qualification': raise RuntimeError('original qualification failure')
        return self.qualification_record() if self.mode != 'false-qualification' else False

    def admit(self, retained):
        self.case.events.append(self.arm+':admit')
        self.admissions += 1
        self.retained = retained
        if self.mode == 'admission': raise RuntimeError('original unchanged resource floor')
        if self.mode == 'postcopy' and self.admissions == 2: raise RuntimeError('original retained-byte cap')
        if self.mode == 'false-admission': return False

    def execute(self, register):
        self.case.events.append(self.arm+':execute')
        self.work.mkdir(); (self.work/'.private').mkdir(); (self.work/'public').mkdir()
        if self.mode == 'old-state':
            (self.work/'.private/original-UNKNOWN').write_text('preserve me')
        register(self.work)
        prefix = self.case.fixture.prefixes[self.arm]
        for name, raw in self.case.fixture.files[self.arm].items():
            if not name.startswith(prefix): continue
            path = self.work/'public'/name.removeprefix(prefix)
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
        (self.work/'public/empty-original.log').write_bytes(b'')
        (self.work/'.private/original-UNKNOWN').write_bytes(b'CONTROL original nonce2 pending; not a key')
        receipt_path = self.work/'public/receipt.json'
        receipt = json.loads(receipt_path.read_bytes())
        receipt['firstCause'] = None
        receipt['loadResult']['firstCause'] = None
        receipt['resourceObserverRetired'] = True
        if self.mode == 'first-cause': receipt['firstCause'] = 'original public first cause'
        if self.mode == 'worker': receipt['loadResult']['pipeline']['workerThreadsRetired'] = False
        if self.mode == 'observer': receipt['resourceObserverRetired'] = False
        if self.mode == 'cleanup': receipt['cleanupComplete'] = False
        if self.mode == 'debt': receipt['normalHelperLifecycle']['cleanupDebt'] = ['CONTROL original debt']
        receipt_path.write_bytes(producer.encode(receipt))
        if self.mode == 'execute': raise ValueError('primary operation error')
        if self.mode == 'interrupt': raise KeyboardInterrupt('original interrupted operation')

    def retire(self):
        self.case.events.append(self.arm+':retire')
        if self.mode == 'execute': raise RuntimeError('secondary cleanup error')
        if not (self.work/'public/receipt.json').exists(): return []
        receipt = json.loads((self.work/'public/receipt.json').read_bytes())
        return [dict(pid=p['pid'], startTicks=p['startTicks'], process=types.SimpleNamespace(
            pid=p['pid'], poll=(lambda code=p['rawReturnCode']: None if self.mode == 'live-process' else code)))
            for p in receipt['processes']]


class Case:
    def __init__(self, root):
        root = root.resolve(strict=True)
        self.root, self.events, self.fixture = root, [], fixtures.PairFixture()
        self.pair = copy.deepcopy(self.fixture.pair)
        self.pair['arms'] = []
        self.adapters = {a: ControlledAdapter(self, a) for a in reader.ARMS}
        self.plans = {a: self.fixture.files[a]['pq-first100-held-plan.json'] for a in reader.ARMS}
        p = self.pair
        self.environment = dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
            GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain', GITHUB_EVENT_NAME='workflow_dispatch',
            GITHUB_JOB='first100-held-public-owner', GITHUB_REF='refs/heads/'+reader.BRANCH,
            GITHUB_RUN_ATTEMPT='1', GITHUB_SHA=p['controllerCommit'], GITHUB_WORKFLOW_SHA=p['controllerCommit'],
            GITHUB_RUN_ID=str(p['runID']), RUNNER_NAME=p['runnerName'], RUNNER_TEMP=str(root),
            GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/.github/workflows/pq-normal-process.yml@refs/heads/'+reader.BRANCH)

    def run(self):
        stamps = iter(self.fixture.markers[a][key] for a in reader.ARMS
                      for key in ('startedMonotonicNs', 'cleanupCompletedMonotonicNs'))
        with mock.patch.object(producer.sys, 'platform', 'linux'), \
                mock.patch.object(producer, 'identity', return_value=self.pair['clock']):
            return producer.run_pair(self.root/'producer', pair=self.pair, plans=self.plans,
                adapters=self.adapters, environment=self.environment, clock=lambda: next(stamps))

    def uploads(self):
        # These ZIPs stand in for explicit artifact metadata controls only.
        # A real workflow must supply the actual upload digests; no local ZIP
        # from the producer is described as an original Actions archive.
        _, metadata = self.fixture.package()
        raws = {}
        for arm in reader.ARMS:
            directory = self.root/'producer'/arm
            files = {p.relative_to(directory).as_posix(): p.read_bytes() for p in directory.rglob('*') if p.is_file()}
            raws[arm] = fixtures.archive(files)
            item = next(a for a in metadata[2]['artifacts'] if a['name'].endswith('-'+arm))
            item.update(digest='sha256:'+fixtures.sha(raws[arm]), size_in_bytes=len(raws[arm]))
        return raws, metadata


class SameRunnerProducerTests(unittest.TestCase):
    def test_sequential_producer_upload_seal_reader_round_trip_preserves_unknown_and_private(self):
        with tempfile.TemporaryDirectory() as name:
            case = Case(Path(name)); result = case.run()
            self.assertEqual(result['status'], 'PAYLOADS_SEALED_AWAITING_ORIGINAL_ACTIONS_UPLOADS')
            self.assertEqual(case.events, ['before:qualify', 'after:qualify', 'before:admit',
                'before:execute', 'before:retire', 'before:admit', 'after:admit', 'after:execute',
                'after:retire', 'after:admit'])
            self.assertIn(case.adapters['before'].work, case.adapters['after'].retained)
            self.assertIn(case.root/'producer', case.adapters['after'].retained)
            raws, metadata = case.uploads()
            manifest = producer.seal_manifest(case.root/'producer', metadata)
            raws['manifest'] = fixtures.archive({'same-runner-pair.json': producer.encode(manifest)})
            item = next(a for a in metadata[2]['artifacts'] if a['name'].endswith('-manifest'))
            item.update(digest='sha256:'+fixtures.sha(raws['manifest']), size_in_bytes=len(raws['manifest']))
            report = fixtures.read(raws, metadata, case.fixture.expected)
            self.assertTrue(report['sameReportedConditions'])
            self.assertFalse(report['pressureAuthorized'])
            for arm in reader.ARMS:
                self.assertEqual(report[arm]['originalLoadResult']['rows'][0]['status'], 'unknown')
                self.assertEqual(report[arm]['originalLoadResult']['accountState'][0]['nextNonce'], 2)
                self.assertTrue((case.adapters[arm].work/'.private/original-UNKNOWN').exists())
                self.assertFalse((case.adapters[arm].work/'public/SAME-RUNNER-ARM.json').exists())
                self.assertEqual((case.root/'producer'/arm/case.adapters[arm].work.name/'public/empty-original.log').read_bytes(), b'')
                self.assertFalse(any('.private' in p.parts for p in (case.root/'producer'/arm).rglob('*')))

    def test_all_cleanup_failures_stop_after_arm_and_preserve_originals(self):
        for mode in ('worker', 'observer', 'cleanup', 'debt', 'live-process', 'first-cause', 'postcopy'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as name:
                case = Case(Path(name)); case.adapters['before'].mode = mode; result = case.run()
                self.assertEqual(result['status'], 'INCOMPLETE')
                self.assertNotIn('after:admit', case.events)
                self.assertEqual(case.events.count('before:retire'), 1)
                self.assertTrue((case.adapters['before'].work/'.private/original-UNKNOWN').exists())
                self.assertTrue((case.root/'producer/before').exists())
                self.assertFalse((case.root/'producer/manifest').exists())
                if mode == 'first-cause': self.assertEqual(result['firstCause'], 'original public first cause')

    def test_primary_exception_survives_cleanup_exception_and_is_not_retried(self):
        with tempfile.TemporaryDirectory() as name:
            case = Case(Path(name)); case.adapters['before'].mode = 'execute'; result = case.run()
            self.assertEqual(result['firstCause']['errorType'], 'ValueError')
            self.assertEqual(result['secondaryFailures'][0]['errorType'], 'RuntimeError')
            self.assertNotIn('after:execute', case.events)
            events = list(case.events)
            with self.assertRaises(FileExistsError): case.run()
            self.assertEqual(events, case.events)

    def test_both_qualifications_precede_any_work_and_each_admission_is_fresh(self):
        for arm, mode in (('after', 'qualification'), ('after', 'false-qualification'),
                          ('before', 'admission'), ('after', 'admission'), ('after', 'false-admission')):
            with self.subTest(arm=arm, mode=mode), tempfile.TemporaryDirectory() as name:
                case = Case(Path(name)); case.adapters[arm].mode = mode; result = case.run()
                self.assertEqual(result['status'], 'INCOMPLETE')
                self.assertNotIn(arm+':execute', case.events)
                if 'qualification' in mode: self.assertNotIn('before:execute', case.events)

    def test_interrupt_and_live_thread_block_successor_without_killing_external_work(self):
        with tempfile.TemporaryDirectory() as name:
            case = Case(Path(name)); case.adapters['before'].mode = 'interrupt'
            result = case.run()
            self.assertEqual(result['firstCause']['errorType'], 'KeyboardInterrupt')
            self.assertNotIn('after:admit', case.events)
            self.assertIn('before:retire', case.events)
        class OriginalWorker:
            def is_alive(self): return True
        with tempfile.TemporaryDirectory() as name:
            case = Case(Path(name))
            with mock.patch.object(producer.threading, 'enumerate', side_effect=[[], [OriginalWorker()]]):
                result = case.run()
            self.assertEqual(result['firstCause']['errorSHA256'], fixtures.sha(
                b'new original worker remains alive; no second arm'))
            self.assertNotIn('after:admit', case.events)

    def test_old_account_or_operation_directory_is_never_reused(self):
        with tempfile.TemporaryDirectory() as name:
            case = Case(Path(name)); case.adapters['before'].mode = 'old-state'; result = case.run()
            self.assertEqual(result['status'], 'INCOMPLETE')
            self.assertNotIn('after:execute', case.events)
            self.assertEqual((case.adapters['before'].work/'.private/original-UNKNOWN').read_text(), 'preserve me')

    def test_wrong_host_and_real_condition_changes_refuse_before_intent(self):
        for key in ('rate', 'startup_timings', 'rssBytes', 'businessType'):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as name:
                case = Case(Path(name)); plan = json.loads(case.plans['after'])
                plan['configuration']['options'][key] = 'DIFFERENT'
                plan['configurationSHA256'] = fixtures.sha(producer.encode(plan['configuration']))
                case.plans['after'] = producer.encode(plan)
                with self.assertRaises(RuntimeError): case.run()
                self.assertFalse((case.root/'producer').exists())
                self.assertEqual(case.events, [])
        with tempfile.TemporaryDirectory() as name:
            case = Case(Path(name)); case.environment['GITHUB_RUN_ATTEMPT'] = '2'
            with self.assertRaises(RuntimeError): case.run()
            self.assertFalse((case.root/'producer').exists())

    def test_seal_requires_actual_upload_binding_and_unchanged_payload(self):
        for mode in ('digest', 'job', 'upload', 'changed', 'symlink'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as name:
                case = Case(Path(name)); case.run(); _, metadata = case.uploads()
                if mode == 'digest': metadata[2]['artifacts'][0]['digest'] = 'not-a-digest'
                elif mode == 'job': metadata[1]['id'] += 1
                elif mode == 'upload': metadata[1]['steps'][0]['conclusion'] = 'failure'
                elif mode == 'changed':
                    (case.root/'producer/before'/'pq-first100-held-plan.json').write_bytes(b'changed')
                else: (case.root/'producer/before/alias').symlink_to(case.root/'producer/PRODUCER.json')
                with self.assertRaises(RuntimeError): producer.seal_manifest(case.root/'producer', metadata)
                self.assertFalse((case.root/'producer/manifest').exists())
        with tempfile.TemporaryDirectory() as name:
            case = Case(Path(name)); case.adapters['after'].mode = 'postcopy'; result = case.run()
            self.assertEqual(len(result['arms']), 2)
            self.assertEqual(result['status'], 'INCOMPLETE')
            with self.assertRaisesRegex(RuntimeError, 'must be sealed'):
                producer.seal_manifest(case.root/'producer', [])

    def test_execution_cli_is_absent(self):
        with mock.patch.object(sys, 'stderr'), self.assertRaises(SystemExit):
            producer.main(['--execute'])


if __name__ == '__main__':
    unittest.main()
