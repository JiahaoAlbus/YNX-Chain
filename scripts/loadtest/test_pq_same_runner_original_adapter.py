"""Original Python driver/Window boundary controls, never a Linux/Go/node run.

Source/host/resource replies in the pre-Window probe are explicit unit inputs.
No real source qualification is claimed. Only the isolated cleanup control
starts one tiny Python child; it never opens a socket, key, signer or node.
"""
from contextlib import ExitStack
import copy
import errno
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name+'.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


bridge = module('pq-same-runner-original-adapter')
original = module('pq-independent-load')
fixtures = module('test_pq_same_runner_pair_readback')
pair_controls = module('test_pq_same_runner_pair_producer')


class OriginalAdapterControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve(strict=True)
        self.source = self.root/'source'; self.source.mkdir()
        self.fixture = fixtures.PairFixture()
        self.record = self.fixture.get('before', 'FIRST100-HELD-CI.json')
        self.events = []
        self.work = self.root/'pq-independent-load-control1'
        self.Window = original.lab.Window

    def adapter(self, run, *, source_commit=None):
        record = copy.deepcopy(self.record)
        if source_commit:
            record['configuration']['source'] = source_commit
            record['configuration']['options']['commit'] = source_commit
        options = types.SimpleNamespace(**dict(record['configuration']['options'], source=str(self.source), execute=True))
        driver = types.SimpleNamespace(run=run, lab=original.lab)
        adapter = bridge.OriginalDriverAdapter(driver, options, record,
            verify_qualification=lambda: copy.deepcopy(record),
            admit=lambda roots: self.events.append(('admit', roots)), storage_roots=(self.source,))
        adapter.qualify(); adapter.admit((self.root,))
        return adapter

    def fresh(self):
        self.work.mkdir(); (self.work/'.private').mkdir(); (self.work/'public').mkdir()

    def register(self, work):
        self.assertEqual(work, self.work)
        self.assertEqual(list((work/'.private').iterdir()), [])
        bridge.producer.write_new(self.root/'REGISTERED.json', {'originalDirectory': str(work)})
        self.events.append('registered')

    def window_controls(self):
        stack = ExitStack()
        stack.enter_context(mock.patch.object(original.lab.os, 'sched_getaffinity', return_value={0}, create=True))
        stack.enter_context(mock.patch.object(original.lab.os, 'sched_setaffinity', create=True))
        stack.enter_context(mock.patch.object(original.lab.guard, 'proc_inventory', return_value=({}, None)))
        stack.enter_context(mock.patch.object(original.lab.guard, 'owned_set', return_value=set()))
        return stack

    def completed_control(self, args, *, change=None, stop=True):
        self.fresh()
        window = original.lab.Window(Path(args.source), self.work)
        self.assertTrue((self.root/'REGISTERED.json').exists())
        receipt = self.fixture.get('before', 'receipt.json')
        receipt['resourceObserverRetired'] = True
        receipt['firstCause'] = receipt['loadResult']['firstCause'] = None
        window.children = [dict(name=row['name'], startTicks=row['startTicks'], persistent=False,
            process=types.SimpleNamespace(pid=row['pid'], poll=lambda: 0, wait=lambda timeout: 0))
            for row in receipt['processes']]
        if stop:
            self.assertTrue(window.stop())
        if change:
            change(receipt, window)
        bridge.producer.write_new(self.work/'public/receipt.json', receipt)
        return receipt

    def test_unbound_source_refuses_before_factory_or_driver(self):
        factory = mock.Mock(side_effect=AssertionError('no loading or effects'))
        self.assertIsNone(bridge.QUALIFIED_PAIR_BINDING)
        with self.assertRaisesRegex(RuntimeError, 'NOT_SUPPLIED'):
            bridge.configured_adapters(factory)
        factory.assert_not_called()

    def test_options_and_qualification_cannot_inherit_another_source(self):
        run = mock.Mock()
        adapter = self.adapter(run)
        adapter.options.accounts = 499
        with self.assertRaisesRegex(RuntimeError, 'options differ'):
            adapter.qualify()
        adapter.options.accounts = 500
        adapter._verify = lambda: dict(adapter.qualification_record(), toolsCI={})
        with self.assertRaisesRegex(RuntimeError, 'qualification differs'):
            adapter.qualify()
        with self.assertRaisesRegex(RuntimeError, 'one qualified'):
            adapter.execute(self.register)
        run.assert_not_called()

    def test_admission_keeps_retained_roots_and_refusal_is_not_success(self):
        adapter = self.adapter(mock.Mock())
        self.assertEqual(adapter.retained_roots, (self.root,))
        adapter._admission = lambda roots: False
        with self.assertRaisesRegex(RuntimeError, 'must raise'):
            adapter.admit((self.root,))
        with self.assertRaisesRegex(RuntimeError, 'one qualified'):
            adapter.execute(self.register)
        adapter._run.assert_not_called()

    def test_changed_options_after_admission_refuse_before_driver(self):
        run = mock.Mock()
        adapter = self.adapter(run)
        adapter.options.tail_seconds = 31
        with self.assertRaisesRegex(RuntimeError, 'options differ'):
            adapter.execute(self.register)
        run.assert_not_called()

    def test_actual_driver_registration_directory_sync_failure_precedes_constructor_and_children(self):
        # Invoke the REAL driver.run body through the bridge. All preceding
        # platform/source/resource answers are explicitly synthetic unit DATA;
        # execution must stop at the real Window call, outside its business try.
        adapter = self.adapter(original.run, source_commit=original.HELD_TRIAL_SOURCE)
        source_reply = dict(commit=original.HELD_TRIAL_SOURCE, tree=original.HELD_TRIAL_TREE, forkTree='a'*40)
        trial = types.SimpleNamespace(SOURCE=original.HELD_TRIAL_SOURCE, TREE=original.HELD_TRIAL_TREE,
                                      qualification=lambda: {'unitControl': True})
        error = OSError(errno.EIO, 'CONTROL original REGISTERED directory sync')
        real_fsync = os.fsync
        seen = []

        def register(work):
            seen.append(work)
            def fail_directory(fd):
                if stat.S_ISDIR(os.fstat(fd).st_mode): raise error
                return real_fsync(fd)
            with mock.patch.object(bridge.producer.os, 'fsync', side_effect=fail_directory):
                bridge.producer.write_new(self.root/'REGISTERED.json', {'originalDirectory': str(work)})

        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(original, 'validate_options', return_value=500))
            stack.enter_context(mock.patch.object(original, 'sender_backend_kind', return_value='public-owner'))
            stack.enter_context(mock.patch.object(original, 'STARTUP_TIMING_ABI_SOURCES', (original.HELD_TRIAL_SOURCE,)))
            stack.enter_context(mock.patch.object(original, 'module', side_effect=lambda name, file: trial if file == 'pq-held-first100-source.py' else types.SimpleNamespace()))
            stack.enter_context(mock.patch.object(original.lab, 'check_source', return_value=source_reply))
            stack.enter_context(mock.patch.object(original.lab, 'git', return_value=''))
            stack.enter_context(mock.patch.object(original.subprocess, 'check_output', return_value=b'live-materials'))
            stack.enter_context(mock.patch.object(original, 'validate_escalation'))
            stack.enter_context(mock.patch.object(original.sys, 'platform', 'linux'))
            stack.enter_context(mock.patch.dict(os.environ, GITHUB_JOB='first100-held-public-owner', GITHUB_EVENT_NAME='workflow_dispatch',
                GITHUB_RUN_ATTEMPT='1', GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted', RUNNER_TEMP=str(self.root)))
            stack.enter_context(mock.patch.object(original.lab.guard, 'proc_inventory', return_value=({}, None)))
            stack.enter_context(mock.patch.object(original.lab.guard, 'memory_available', return_value=8 << 30))
            stack.enter_context(mock.patch.object(original.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=32 << 30)))
            stack.enter_context(mock.patch.object(original.lab, 'ports_available'))
            stack.enter_context(mock.patch.object(original.ctypes, 'CDLL', return_value=types.SimpleNamespace(prctl=lambda *args: 0)))
            constructor = stack.enter_context(mock.patch.object(self.Window, '__init__', side_effect=AssertionError('constructor before registration')))
            child = stack.enter_context(mock.patch.object(original.subprocess, 'Popen', side_effect=AssertionError('child before registration')))
            with self.assertRaises(OSError) as raised:
                adapter.execute(register)
            self.assertIs(raised.exception, error)
            constructor.assert_not_called(); child.assert_not_called()
        self.assertEqual(len(seen), 1)
        self.assertEqual(list((seen[0]/'.private').iterdir()), [])
        self.assertTrue((seen[0]/'public/fresh-resource-admission.json').exists())
        self.assertFalse((seen[0]/'public/receipt.json').exists())
        self.assertIs(original.lab.Window, self.Window)
        self.assertEqual(adapter.retire(), [])
        with self.assertRaisesRegex(RuntimeError, 'one qualified'):
            adapter.execute(register)

    def test_registration_keyboard_interrupt_propagates_and_never_constructs(self):
        def run(args):
            self.fresh(); original.lab.Window(Path(args.source), self.work)
            self.fail('business must remain unreachable')
        adapter = self.adapter(run)
        error = KeyboardInterrupt('CONTROL durable registration interrupted')
        with mock.patch.object(self.Window, '__init__') as constructor:
            with self.assertRaises(KeyboardInterrupt) as raised:
                adapter.execute(lambda work: (_ for _ in ()).throw(error))
        self.assertIs(raised.exception, error); constructor.assert_not_called()
        self.assertIs(original.lab.Window, self.Window)
        self.assertEqual(adapter.retire(), [])

    def test_original_window_registration_precedes_init_and_return_dict_cannot_forge_receipt(self):
        adapter = self.adapter(lambda args: self.completed_control(args))
        with self.window_controls():
            value = adapter.execute(self.register)
            self.assertEqual(adapter.window.storage_roots, [self.root])
            self.assertEqual(json.loads((self.work/'public/FIRST100-HELD-CI.json').read_bytes()), self.record)
            value['cleanupComplete'] = False  # On-disk original remains authority.
            children = adapter.retire()
        self.assertEqual(len(children), len(self.fixture.get('before', 'receipt.json')['processes']))
        self.assertTrue(adapter.retired)
        self.assertEqual(adapter.stop_results, [True])
        with self.assertRaisesRegex(RuntimeError, 'already consumed'):
            adapter.retire()

    def test_constructor_failure_retains_partial_window_and_original_error(self):
        def run(args):
            self.fresh(); original.lab.Window(Path(args.source), self.work)
        adapter = self.adapter(run)
        error = OSError(errno.EIO, 'CONTROL affinity failure after original cache allocation')
        with self.window_controls(), mock.patch.object(original.lab.os, 'sched_setaffinity', side_effect=error):
            with self.assertRaises(OSError) as raised:
                adapter.execute(self.register)
            self.assertIs(raised.exception, error)
            self.assertIsNotNone(adapter.window)
            with self.assertRaisesRegex(RuntimeError, 'receipt missing'):
                adapter.retire()
        self.assertEqual(adapter.stop_results, [True])
        self.assertTrue((self.work/'.private/cache').is_dir())

    def test_original_stop_reaps_only_real_low_cost_owned_child_after_driver_failure(self):
        owned = []
        error = ValueError('CONTROL driver failure before finally cleanup')
        def run(args):
            self.fresh(); window = original.lab.Window(Path(args.source), self.work)
            # An actual OS child owned by this test, not a node or fabricated
            # exit status. Original Window.stop performs killpg/wait on it.
            child = subprocess.Popen([sys.executable, '-I', '-c', 'import time; time.sleep(15)'],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True)
            owned.append(child)
            window.children.append(dict(name='python-cleanup-control', process=child, startTicks=None, persistent=False))
            raise error
        adapter = self.adapter(run)
        try:
            with self.window_controls():
                with self.assertRaises(ValueError) as raised:
                    adapter.execute(self.register)
                self.assertIs(raised.exception, error)
                with self.assertRaisesRegex(RuntimeError, 'receipt missing'):
                    adapter.retire()
            self.assertIsNotNone(owned[0].poll())
            self.assertEqual(adapter.stop_results, [True])
            self.assertIs(adapter.execution_error, error)
            self.assertFalse(adapter.retired)
        finally:
            for child in owned:
                if child.poll() is None: child.kill()
                child.wait(timeout=2)

    def test_missing_worker_observer_cleanup_or_live_process_never_readmits(self):
        changes = {
            'worker': lambda r, w: r['loadResult']['pipeline'].update(workerThreadsRetired=False),
            'observer': lambda r, w: r.update(resourceObserverRetired=False),
            'cleanup': lambda r, w: r.update(cleanupComplete=False),
            'debt': lambda r, w: r.update(normalHelperLifecycle=dict(cleanupDebt=['CONTROL pending'])),
            'live-handle': lambda r, w: setattr(w.children[0]['process'], 'poll', lambda: None),
        }
        for name, change in changes.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory(dir=self.root) as directory:
                old_root, old_work = self.root, self.work
                self.root = Path(directory); self.work = self.root/'pq-independent-load-control1'
                adapter = self.adapter(lambda args: self.completed_control(args, change=change))
                try:
                    with self.window_controls():
                        adapter.execute(self.register)
                        with self.assertRaises(RuntimeError): adapter.retire()
                    with self.assertRaisesRegex(RuntimeError, 'not fully retired'):
                        adapter.admit((self.root,))
                finally:
                    self.root, self.work = old_root, old_work

    def test_live_worker_rejects_even_if_receipt_claims_retired(self):
        finish = threading.Event(); workers = []
        def run(args):
            receipt = self.completed_control(args)
            worker = threading.Thread(target=finish.wait, name='pair-adapter-CONTROL-worker')
            worker.start(); workers.append(worker)
            return receipt
        adapter = self.adapter(run)
        try:
            with self.window_controls():
                adapter.execute(self.register)
                with self.assertRaisesRegex(RuntimeError, 'worker remains alive'):
                    adapter.retire()
        finally:
            finish.set()
            for worker in workers: worker.join(timeout=1)

    def test_original_stop_failure_is_retained_even_if_retry_cleans(self):
        adapter = self.adapter(lambda args: self.completed_control(args, stop=False))
        error = OSError(errno.EIO, 'CONTROL original cleanup failure')
        with self.window_controls():
            adapter.execute(self.register)
            with mock.patch.object(self.Window, 'stop', side_effect=error):
                with self.assertRaises(OSError) as raised: adapter.retire()
            self.assertIs(raised.exception, error)
            with self.assertRaisesRegex(RuntimeError, 'cleanup failed'):
                adapter.retire()
        self.assertFalse(adapter.retired)
        self.assertEqual(adapter.stop_errors, [error])
        self.assertEqual(adapter.stop_results, [True])

    def test_duplicate_window_is_refused_and_original_module_restored(self):
        def run(args):
            value = self.completed_control(args)
            original.lab.Window(Path(args.source), self.work)
            return value
        adapter = self.adapter(run)
        with self.window_controls():
            with self.assertRaisesRegex(RuntimeError, 'one original Window'):
                adapter.execute(self.register)
            adapter.retire()
        self.assertIs(original.lab.Window, self.Window)

    def pair_case(self, defect=None):
        """Full original producer + bridge + Window, synthetic PUBLIC contents."""
        case = pair_controls.Case(self.root)
        case.adapters = {}
        for arm in bridge.producer.reader.ARMS:
            record = case.fixture.get(arm, 'FIRST100-HELD-CI.json')
            options = types.SimpleNamespace(**dict(record['configuration']['options'], source=str(self.source), execute=True))
            def run(args, arm=arm):
                case.events.append(arm+':driver')
                work = self.root/case.fixture.markers[arm]['workDirectoryName']
                work.mkdir(); (work/'.private').mkdir(); (work/'public').mkdir()
                window = original.lab.Window(Path(args.source), work)
                case.events.append(arm+':after-registered-constructor')
                # Literal control state, never an actual key or operation.
                (work/'.private/CONTROL-UNKNOWN').write_bytes(b'control original pending nonce; preserve')
                prefix = case.fixture.prefixes[arm]
                for name, raw in case.fixture.files[arm].items():
                    if not name.startswith(prefix) or name.endswith('/FIRST100-HELD-CI.json'):
                        continue
                    path = work/'public'/name.removeprefix(prefix)
                    path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
                path = work/'public/receipt.json'
                receipt = json.loads(path.read_bytes())
                receipt['firstCause'] = receipt['loadResult']['firstCause'] = None
                receipt['resourceObserverRetired'] = True
                window.children = [dict(name=row['name'], startTicks=row['startTicks'], persistent=False,
                    process=types.SimpleNamespace(pid=row['pid'], poll=lambda: 0, wait=lambda timeout: 0))
                    for row in receipt['processes']]
                self.assertTrue(window.stop()); case.events.append(arm+':original-stopped')
                if arm == 'before' and defect:
                    defect(receipt)
                path.write_bytes(bridge.producer.encode(receipt))
                return receipt
            driver = types.SimpleNamespace(run=run, lab=original.lab)
            case.adapters[arm] = bridge.OriginalDriverAdapter(driver, options, record,
                verify_qualification=lambda record=record: copy.deepcopy(record),
                admit=lambda roots, arm=arm: case.events.append(arm+':admit'), storage_roots=(self.source,))
        return case

    def test_pair_coordinator_uses_bridge_and_stops_first_before_second_constructor(self):
        case = self.pair_case()
        with self.window_controls():
            report = case.run()
        self.assertEqual(report['status'], 'PAYLOADS_SEALED_AWAITING_ORIGINAL_ACTIONS_UPLOADS')
        self.assertLess(case.events.index('before:original-stopped'), case.events.index('after:driver'))
        self.assertTrue(all(adapter.retired for adapter in case.adapters.values()))
        for arm in ('before', 'after'):
            work = self.root/case.fixture.markers[arm]['workDirectoryName']
            self.assertTrue((work/'.private/CONTROL-UNKNOWN').exists())
        self.assertFalse(report['runtimeQualified'])

    def test_pair_registration_sync_failure_does_not_enter_first_constructor_or_second_arm(self):
        case = self.pair_case()
        error = OSError(errno.EIO, 'CONTROL REGISTERED original directory sync')
        writer, fsync = pair_controls.producer.write_new, os.fsync
        def write(path, value, **kwargs):
            if path.name != 'before-REGISTERED.json':
                return writer(path, value, **kwargs)
            def fail_directory(fd):
                if stat.S_ISDIR(os.fstat(fd).st_mode): raise error
                return fsync(fd)
            with mock.patch.object(os, 'fsync', side_effect=fail_directory):
                return writer(path, value, **kwargs)
        with self.window_controls(), mock.patch.object(pair_controls.producer, 'write_new', side_effect=write), \
                mock.patch.object(self.Window, '__init__', side_effect=AssertionError('constructor before fence')) as constructor:
            report = case.run()
        self.assertEqual(report['status'], 'INCOMPLETE')
        self.assertEqual(report['firstCause'], bridge.producer.failure(error))
        constructor.assert_not_called()
        self.assertNotIn('after:driver', case.events)
        self.assertNotIn('before:after-registered-constructor', case.events)
        self.assertEqual(list((case.adapters['before'].work/'.private').iterdir()), [])
        self.assertTrue((self.root/'producer/before-REGISTERED.json').exists())
        self.assertFalse((self.root/'producer/after-INTENT.json').exists())

    def test_pair_unretired_observer_preserves_originals_and_blocks_second_arm(self):
        case = self.pair_case(lambda receipt: receipt.update(resourceObserverRetired=False))
        with self.window_controls():
            report = case.run()
        self.assertEqual(report['status'], 'INCOMPLETE')
        self.assertNotIn('after:driver', case.events)
        self.assertFalse(case.adapters['before'].retired)
        self.assertTrue((case.adapters['before'].work/'.private/CONTROL-UNKNOWN').exists())
        self.assertFalse((self.root/'producer/after-INTENT.json').exists())


if __name__ == '__main__':
    unittest.main()
