"""Contract controls with fake process/file returns; no live network evidence."""
import hashlib
import importlib.util
import itertools
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


reader = module('normal_live_controls', 'pq-normal-live-reader.py')
normal = module('normal_live_flow_controls', 'pq-normal-process-lab.py')


def raw_sample(pid):
    at = str(time.clock_gettime_ns(time.CLOCK_MONOTONIC))
    fields = dict(messages=0, transactions=0, transactionBytes=0, reencodedProtoBytes=0)
    wire = dict(schema='YNX-MEMPOOL-WIRE-OBSERVATION/v1', attached=True, overflow=False,
                physicalBytesMeasured=False, sendAttempts=fields, sendQueued=fields,
                sendNotQueued=fields, received=fields)
    return dict(schema='YNX-MEMPOOL-LIVE-WIRE-OBSERVATION/v1', producerPID=str(pid),
        reactorLifetimeID='10', observerLifetimeID='20', lifecycleGeneration='1',
        clock='CLOCK_MONOTONIC', clockStatus='OBSERVED', clockError='', startMonotonicNs=at,
        endMonotonicNs=at, status='OBSERVED', reason='', complete=True,
        reactorRunningAtStart=True, reactorRunningAtEnd=True, nonAtomic=True,
        completedCallsOnly=True, inFlightExcluded=True, endpointOnly=True, physicalBytesMeasured=False,
        wire=wire, wireStatus=dict(status='OBSERVED', complete=True, attached=True, overflow=False),
        lossless=None, losslessStatus=dict(status='DISABLED', complete=False, reason='not_enabled'),
        proto=None, protoStatus=dict(status='UNKNOWN', complete=False, reason='not_supplied'))


class Fixture:
    def __init__(self, root):
        for name in ('.private', 'public'):
            (root / name).mkdir()
        self.node = dict(name='pq-node-0', pid=1234, startTicks='999')
        self.proc = SimpleNamespace(pid=1234, poll=lambda: None)
        self.child = dict(name='pq-node-0', process=self.proc, startTicks=999, persistent=True)
        self.w = SimpleNamespace(work=root, children=[self.child], started=time.monotonic(),
            launch=mock.Mock(side_effect=self.launch), wait=mock.Mock(), sample=mock.Mock())
        self.c = SimpleNamespace(w=self.w, bins=root / '.private/bin')
        guard = SimpleNamespace(parse_stat=mock.Mock(return_value=dict(startTicks=999, state='S')),
                                bounded=lambda path, *args: path.read_bytes() if path.is_file() else b'FAKE_KERNEL_STAT')
        self.lab = SimpleNamespace(guard=guard, CAPS=dict(totalSeconds=900, cleanupSeconds=15),
                                   write_new=lambda path, value: path.write_text(json.dumps(value)))
        self.r = reader.NormalLiveReader(self.c, self.lab)
        self.args = self.r.startup_arguments('pq', 0)
        self.directory = Path(self.args[1])
        self.identity = dict(pid='1234', startTicks='999')
        self.write('producer.json', json.dumps(dict(version=reader.VERSION, identity=self.identity)).encode())
        self.mutate = lambda value: None
        self.output = lambda raw: raw
        self.receipt_mutate = lambda value: None
        self.post_launch = lambda: None

    def write(self, name, raw):
        path = self.directory / name
        path.write_bytes(raw); path.chmod(0o600)

    def launch(self, name, command, **kwargs):
        phase = command[-1]
        getter_start = str(time.clock_gettime_ns(time.CLOCK_MONOTONIC))
        value = raw_sample(1234); self.mutate(value)
        raw = json.dumps(value, separators=(',', ':')).encode()
        receipt = dict(version=reader.VERSION, phase=phase, status='OBSERVED', reason='',
                       identity=self.identity, rawSHA256=hashlib.sha256(raw).hexdigest(),
                       startMonotonicNs=getter_start, endMonotonicNs=str(time.clock_gettime_ns(time.CLOCK_MONOTONIC)),
                       syntheticOnly=True, authorityGranted=False)
        self.receipt_mutate(receipt)
        self.write(phase + '.request', (reader.VERSION + ' ' + phase + '\n').encode())
        self.write(phase + '.raw.json', raw)
        self.write(phase + '.result.json', json.dumps(receipt).encode())
        (self.w.work / 'public' / (name + '.log')).write_bytes(self.output(raw))
        self.post_launch()
        return SimpleNamespace(poll=lambda: 0, returncode=0)


class NormalLiveReaderControls(unittest.TestCase):
    def fixture(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        return Fixture(Path(temporary.name).resolve())

    def test_two_original_reads_exact_raw_and_no_third_or_bootstrap_control(self):
        f = self.fixture()
        self.assertEqual(f.r.startup_arguments('bootstrap', 0), [])
        for phase in ('before', 'after'):
            raw = f.r(f.node)
            self.assertEqual(raw, (f.directory / (phase + '.raw.json')).read_bytes())
            self.assertEqual(f.r.evidence[-1]['status'], 'OBSERVED')
            self.assertEqual(len(f.r.evidence[-1]['originalFiles']), 4)
        with self.assertRaisesRegex(RuntimeError, 'never retried'): f.r(f.node)
        self.assertEqual(f.w.launch.call_count, 2)
        for call in f.w.launch.call_args_list:
            self.assertTrue(call.kwargs['thread_safe'])
            self.assertNotIn('--pid', call.args[1])

    def test_foreign_or_stopped_registered_identity_never_launches(self):
        for kind in ('pid', 'ticks', 'stopped', 'kernel-reused'):
            with self.subTest(kind=kind):
                f = self.fixture()
                if kind == 'pid': f.node['pid'] = 6789
                if kind == 'ticks': f.node['startTicks'] = '1000'
                if kind == 'stopped': f.proc.poll = lambda: 0
                if kind == 'kernel-reused': f.lab.guard.parse_stat.return_value['startTicks'] = 1000
                with self.assertRaisesRegex(RuntimeError, 'identity differs'): f.r(f.node)
                f.w.launch.assert_not_called()
                with self.assertRaisesRegex(RuntimeError, 'never retried'): f.r(f.node)

    def test_producer_file_cannot_self_authorize_foreign_pid(self):
        f = self.fixture(); f.identity['pid'] = '6789'
        f.write('producer.json', json.dumps(dict(version=reader.VERSION, identity=f.identity)).encode())
        with self.assertRaisesRegex(RuntimeError, 'independently owned'): f.r(f.node)
        f.w.launch.assert_not_called()

    def test_unknown_receipt_retires_session_and_preserves_originals(self):
        f = self.fixture(); f.receipt_mutate = lambda v: v.update(status='UNKNOWN', reason='busy')
        with self.assertRaisesRegex(RuntimeError, 'receipt/raw'): f.r(f.node)
        self.assertEqual(f.r.evidence[-1]['status'], 'UNKNOWN')
        self.assertEqual(len(f.r.evidence[-1]['originalFiles']), 4)
        with self.assertRaisesRegex(RuntimeError, 'never retried'): f.r(f.node)
        self.assertEqual(f.w.launch.call_count, 1)

    def test_successful_cli_cannot_substitute_other_bytes(self):
        f = self.fixture(); f.output = lambda raw: raw + b'\n'
        with self.assertRaisesRegex(RuntimeError, 'CLI output differs'): f.r(f.node)
        self.assertTrue(f.r.slots[f.node['name']]['retired'])

    def test_raw_hash_and_receipt_clock_are_independent_checks(self):
        for change in (dict(rawSHA256='0' * 64), dict(endMonotonicNs='1')):
            with self.subTest(change=change):
                f = self.fixture(); f.receipt_mutate = lambda v: v.update(change)
                with self.assertRaisesRegex(RuntimeError, 'receipt'): f.r(f.node)

    def test_outer_getter_clock_strictly_encloses_inner_raw_sample(self):
        f = self.fixture(); ticks = itertools.count(1_000_000_000, 1000)
        # Deliberately unequal contract times; host clock granularity may return equal ticks.
        with mock.patch.object(reader.time, 'clock_gettime_ns', side_effect=lambda clock: next(ticks)):
            raw = json.loads(f.r(f.node))
        receipt = json.loads((f.directory / 'before.result.json').read_bytes())
        self.assertLess(int(receipt['startMonotonicNs']), int(raw['startMonotonicNs']))
        self.assertGreater(int(receipt['endMonotonicNs']), int(raw['endMonotonicNs']))
        self.assertEqual(f.r.evidence[-1]['status'], 'OBSERVED')

    def test_receipt_clock_reverse_outside_and_noncanonical_retire_read(self):
        for kind in ('reverse', 'raw-outside', 'parent-outside', 'over2s', 'integer', 'leadingzero', 'overflow'):
            with self.subTest(kind=kind):
                f = self.fixture()
                def change(v):
                    if kind == 'reverse': v['endMonotonicNs'] = str(int(v['startMonotonicNs']) - 1)
                    if kind == 'raw-outside': v['startMonotonicNs'] = str(int(v['endMonotonicNs']) + 1)
                    if kind == 'parent-outside': v['endMonotonicNs'] = str(time.clock_gettime_ns(time.CLOCK_MONOTONIC) + 10_000_000_000)
                    if kind == 'over2s': v['startMonotonicNs'] = str(int(v['startMonotonicNs']) - 2_000_000_001)
                    if kind == 'integer': v['startMonotonicNs'] = int(v['startMonotonicNs'])
                    if kind == 'leadingzero': v['startMonotonicNs'] = '0' + v['startMonotonicNs']
                    if kind == 'overflow': v['endMonotonicNs'] = str(1 << 64)
                f.receipt_mutate = change
                with self.assertRaisesRegex(RuntimeError, 'receipt clock'): f.r(f.node)
                with self.assertRaisesRegex(RuntimeError, 'never retried'): f.r(f.node)

    def test_stale_unknown_and_overflow_raw_never_permit_after(self):
        for change in (dict(startMonotonicNs='1', endMonotonicNs='1'), dict(status='UNKNOWN', reason='busy'),
                       dict(reactorRunningAtEnd=False), dict(physicalBytesMeasured=True)):
            with self.subTest(change=change):
                f = self.fixture(); f.mutate = lambda v: v.update(change)
                with self.assertRaisesRegex(RuntimeError, 'raw validation failed'): f.r(f.node)
                with self.assertRaisesRegex(RuntimeError, 'never retried'): f.r(f.node)
                self.assertEqual(f.w.launch.call_count, 1)

    def test_process_or_directory_changed_during_request_is_unknown(self):
        for kind in ('process', 'directory'):
            with self.subTest(kind=kind):
                f = self.fixture()
                if kind == 'process': f.post_launch = lambda: setattr(f.proc, 'poll', lambda: 0)
                else: f.post_launch = lambda: f.directory.chmod(0o755)
                with self.assertRaises(RuntimeError): f.r(f.node)
                self.assertEqual(f.r.evidence[-1]['status'], 'UNKNOWN')

    def test_private_files_reject_symlink_multilink_permissions_and_oversize(self):
        for kind in ('symlink', 'multilink', 'permissions', 'oversize'):
            with self.subTest(kind=kind):
                f = self.fixture(); path = f.directory / 'producer.json'
                if kind == 'symlink':
                    path.rename(f.directory / 'saved'); path.symlink_to(f.directory / 'saved')
                if kind == 'multilink': os.link(path, f.directory / 'extra')
                if kind == 'permissions': path.chmod(0o644)
                if kind == 'oversize': path.write_bytes(b'x' * 4097)
                with self.assertRaises((RuntimeError, OSError)): f.r(f.node)
                f.w.launch.assert_not_called()

    def test_requester_deadline_kills_only_owned_requester_and_never_retries(self):
        f = self.fixture()
        requester = SimpleNamespace(poll=lambda: None, send_signal=mock.Mock(), wait=mock.Mock())
        f.w.launch.side_effect = None; f.w.launch.return_value = requester
        with mock.patch.object(reader.time, 'monotonic', side_effect=[100, 105]):
            with self.assertRaisesRegex(RuntimeError, 'deadline'): f.r(f.node)
        requester.send_signal.assert_called_once_with(reader.signal.SIGKILL)
        requester.wait.assert_called_once_with(timeout=1)
        self.assertIsNone(f.proc.poll())
        self.assertTrue(f.r.evidence[-1]['requesterCleanupComplete'])
        with self.assertRaisesRegex(RuntimeError, 'never retried'): f.r(f.node)
        self.assertEqual(f.w.launch.call_count, 1)

    def test_retention_failure_cannot_return_observed_or_overwrite_first_cause(self):
        f = self.fixture(); f.lab.write_new = mock.Mock(side_effect=OSError('public write unavailable'))
        with self.assertRaisesRegex(OSError, 'public write'): f.r(f.node)
        self.assertEqual(f.r.evidence[-1]['status'], 'UNKNOWN')
        with self.assertRaisesRegex(RuntimeError, 'never retried'): f.r(f.node)
        f = self.fixture(); f.lab.write_new = mock.Mock(side_effect=OSError('public write unavailable'))
        f.output = lambda raw: b'wrong output'
        with self.assertRaisesRegex(RuntimeError, 'CLI output differs'): f.r(f.node)

    def test_functional_network_bracket_precedes_stop_and_original_final_proof(self):
        f = self.fixture(); events = []
        c = object.__new__(normal.Ceremony)
        c.w = f.w; c.pin = 'a' * 64; c.mode = 'online'; c.next_workload = 4; c.pending_owners = set()
        state = f.w.work / 'state.json'; state.write_text('{}')
        c.plan = dict(nodes=[dict(statePath=str(state)) for _ in range(4)])
        c.nodes = [SimpleNamespace(pid=200+i, send_signal=lambda signal: events.append('stop')) for i in range(4)]
        f.w.children = [dict(process=p, persistent=True) for p in c.nodes]
        f.w.wait = lambda proc, **kw: events.append('wait')
        c.prepare_network = lambda: events.append('prepared') or {}
        def begin():
            events.append('network-before')
            return SimpleNamespace(finish=lambda count: events.append(('network-after', count)))
        c.begin_network_baseline = begin
        c.traffic = lambda name, owner: events.append('traffic') or dict(owner=owner)
        c.verify_stopped = lambda row: events.append('proof') or row
        with mock.patch.object(normal, 'network_baseline_result', return_value=dict(status='OBSERVED')):
            c.live_reader = None
            result = c.execute()
        self.assertEqual(events[:2], ['prepared', 'network-before'])
        self.assertEqual(events[2:6], ['traffic'] * 4)
        self.assertEqual(events[6], ('network-after', None))
        self.assertEqual(events[7:11], ['stop'] * 4)
        self.assertEqual(events[-4:], ['proof'] * 4)
        self.assertEqual(result['qualifiedFinalCount'], 4)
        self.assertEqual(result['fixedWindowResult'], 'UNMEASURED')

    def test_missing_source_qualification_blocks_before_build_or_key_actions(self):
        args = SimpleNamespace(source='/unused', commit='a' * 40, mode='online', live_network_baseline=True, execute=True)
        loader = SimpleNamespace(exec_module=lambda value: None)
        with mock.patch.object(reader, 'NORMAL_LIVE_SOURCE_QUALIFICATION', None), \
             mock.patch.object(normal.lab, 'check_source', return_value={}), mock.patch.object(normal.lab, 'git'), \
             mock.patch.object(normal.importlib.util, 'spec_from_file_location', return_value=SimpleNamespace(loader=loader)), \
             mock.patch.object(normal.importlib.util, 'module_from_spec', return_value=reader), \
             mock.patch.object(normal.lab, 'Window') as window:
            with self.assertRaisesRegex(RuntimeError, 'qualification not supplied'): normal.run(args)
            window.assert_not_called()


if __name__ == '__main__': unittest.main()
