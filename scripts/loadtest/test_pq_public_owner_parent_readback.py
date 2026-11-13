"""Parent-boundary controls. Synthetic cases are never benchmark evidence."""
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
import tempfile
import threading
import unittest
from types import SimpleNamespace


HERE = Path(__file__).resolve().parent
def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE/filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = module('parent_readback', 'pq-public-owner-parent-readback.py')


def row(phase='sign', owner=4):
    value = dict(ownerIndex=owner, operationId='a'*64, operation=phase,
                 code=next(iter(m.CODES[phase])))
    value.update(zip(m.BOUNDARIES, (100, 120, 150, 250, 260)))
    return value


def report(rows, omitted=0):
    return dict(schema=m.SCHEMA, clock='parent_monotonic_ns', attempted=len(rows)+omitted,
                retained=len(rows), omitted=omitted, records=rows, recordLimit=2048,
                automaticRetry=False, authorityGranted=False)


def read(value):
    raw = json.dumps(value).encode()
    return m.readback(raw, hashlib.sha256(raw).hexdigest())


class ParentBoundaryControls(unittest.TestCase):
    def test_complete_parent_phases_separate_queue_checkpoint_and_reply(self):
        result = read(report([row(), row('confirm'), row('recover'), row('close-owner')]))
        self.assertEqual(set(result['groups']), set(m.CODES))
        stages = result['records'][0]['stagesNs']
        self.assertEqual(stages, dict(requestToReturn=160, streamQueueWait=20,
                                     acquireToCommand=30, commandToReply=100, replyToReturn=10))
        self.assertEqual(result['groups']['sign']['stages']['commandToReply']['fullAttemptP95Ns'], 100)
        self.assertIsNone(result['finalConfirmationTPS'])
        self.assertEqual(set(result['finalConfirmationPercentilesMs'].values()), {None})
        self.assertFalse(result['stagesAdded'] or result['goCalleeTimeInferred'])

    def test_lost_ack_and_prewrite_cancel_do_not_become_zero_elapsed(self):
        lost = row(); del lost['replyReceivedMonotonicNs']; del lost['code']
        lost['errorType'] = 'EOFError'
        canceled = dict(ownerIndex=4, operationId='b'*64, operation='sign',
                        requestedMonotonicNs=100, returnedMonotonicNs=200,
                        errorType='RuntimeError')
        result = read(report([lost, canceled]))
        group = result['groups']['sign']['stages']
        self.assertEqual(group['streamQueueWait']['observed'], 1)
        self.assertEqual(group['streamQueueWait']['retainedMissing'], 1)
        self.assertIsNone(group['streamQueueWait']['fullAttemptP95Ns'])
        self.assertEqual(group['commandToReply']['observed'], 0)
        self.assertIsNone(group['commandToReply']['minNs'])
        self.assertTrue(all(v['outcomeUnknown'] for v in result['records']))

    def test_omitted_attempts_censor_all_phase_quantiles_without_guessing_phase(self):
        result = read(report([row()], omitted=3))
        self.assertEqual(result['unassignedOmittedAttempts'], 3)
        group = result['groups']['sign']
        self.assertFalse(group['phaseAttemptDenominatorKnown'])
        self.assertIsNone(group['stages']['requestToReturn']['fullAttemptP50Ns'])
        self.assertEqual(group['stages']['requestToReturn']['minNs'], 160)

    def test_prepared_ready_is_bound_to_go_bytes_and_precedes_load(self):
        controls = module('prepared_ready_controls', 'test_pq_public_owner_transport.py')
        ready = controls.ready_v2()
        raw = json.dumps(ready).encode() + b'\n'
        preparation = dict(sourceReply='load-public-owners-ready.json',
                           sourceReplySHA256=hashlib.sha256(raw).hexdigest(),
                           parentLaunchMonotonicNs=100, parentReadyReceivedMonotonicNs=250,
                           parentLaunchToReadyNs=150, calleeStartupElapsedNs=ready['startupElapsedNs'],
                           calleePreparationTimings=ready['preparationTimings'],
                           parentClock='parent_monotonic_ns', intervalsOverlap=True,
                           addedToPerCommand=False, checkpointValidated=False)
        pool = dict(readyMode='ORIGINAL_PUBLIC_STATIC_SOURCE_PREPARED', publicScopeReady=ready,
                    bootstrapLoaded=True, sourcePreparation=preparation, signed=False,
                    nonceReserved=False, loadClockStarted=False, sourceGrant=False,
                    coldValidationIncludedInFirstCommand=False)
        receipt = dict(senderPoolPreparation=pool, loadResult=dict(originMonotonicNs='275'))
        result = m.source_preparation(receipt, raw, [4, 5])
        self.assertEqual((result['parentLaunchToReadyNs'], result['calleeStartupElapsedNs'],
                          result['readyToLoadOriginNs']), (150, 100, 25))
        self.assertTrue(result['readinessBeforeLoadObserved'])
        self.assertFalse(result['businessQualified'])
        with tempfile.TemporaryDirectory() as temp:
            receipt_path, plan_path, ready_path = [Path(temp)/name for name in ('receipt', 'plan', 'ready')]
            plan_path.write_bytes(json.dumps(dict(accounts=[dict(ownerIndex=4), dict(ownerIndex=5)])).encode())
            receipt['planSHA256'] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            receipt_path.write_bytes(json.dumps(receipt).encode())
            ready_path.write_bytes(raw)
            output = subprocess.check_output([sys.executable, '-B', str(Path(m.__file__)),
                '--input', str(receipt_path), '--expected-sha256', hashlib.sha256(receipt_path.read_bytes()).hexdigest(),
                '--ready', str(ready_path), '--load-plan', str(plan_path)])
            self.assertEqual(json.loads(output), result)
        with self.assertRaisesRegex(RuntimeError, 'SHA256'):
            m.source_preparation(receipt, b' ' + raw, [4, 5])
        with self.assertRaisesRegex(RuntimeError, 'READY differs'):
            m.source_preparation(receipt, raw, [4, 6])
        with self.assertRaisesRegex(RuntimeError, 'after original load origin'):
            m.source_preparation(dict(receipt, loadResult=dict(originMonotonicNs='249')), raw, [4, 5])
        with self.assertRaisesRegex(RuntimeError, 'parent elapsed differs'):
            preparation['parentLaunchToReadyNs'] = 149
            m.source_preparation(receipt, raw, [4, 5])
        preparation['parentLaunchToReadyNs'] = 150
        result = m.source_preparation(dict(receipt, loadResult=None), raw, [4, 5])
        self.assertIsNone(result['readyToLoadOriginNs'])
        self.assertFalse(result['readinessBeforeLoadObserved'])
        self.assertEqual(m.source_preparation({}, None, []), dict(status='NOT_SUPPLIED'))

    def test_empty_report_has_no_fabricated_stage_or_success(self):
        result = read(report([]))
        self.assertEqual(result['groups'], {})
        self.assertEqual(result['retained'], 0)
        self.assertIsNone(result['businessQualified'])

    def test_bad_order_gaps_outcome_phase_and_identity_fail_closed(self):
        values = []
        changed = row(); changed['streamAcquiredMonotonicNs'] = 99; values.append(changed)
        changed = row(); del changed['commandRequestedMonotonicNs']; values.append(changed)
        changed = row(); changed['code'] = 'PROOF_CONFIRMED_DATA'; values.append(changed)
        changed = row(); changed['ownerIndex'] = True; values.append(changed)
        changed = row(); changed['operationId'] = ''; values.append(changed)
        changed = row(); changed['returnedMonotonicNs'] = True; values.append(changed)
        changed = row(); changed['callerSuppliedElapsed'] = 0; values.append(changed)
        changed = row(); del changed['code']; values.append(changed)
        for value in values:
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                read(report([value]))

    def test_counts_scope_hash_duplicates_and_partial_json_rejected(self):
        for key, value in [('attempted', 2), ('retained', 0), ('omitted', True),
                           ('authorityGranted', True), ('automaticRetry', True),
                           ('clock', 'wall_clock'), ('recordLimit', 10000)]:
            changed = report([row()]); changed[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError): read(changed)
        raw = json.dumps(report([row()])).encode()
        for body, pin in [(raw, '0'*64), (raw[:-1], hashlib.sha256(raw[:-1]).hexdigest()),
                          (b'{"attempted":0,"attempted":1}', hashlib.sha256(b'{"attempted":0,"attempted":1}').hexdigest())]:
            with self.assertRaises((RuntimeError, ValueError)):
                m.readback(body, pin)

    def test_real_transport_emits_readable_parent_boundaries_for_offline_go_fixture(self):
        # Replay the producer's saved JSONL through the existing consumer only.
        # No signer/node is launched, and observed durations are not Go timings.
        transport = module('parent_transport', 'pq-public-owner-transport.py')
        driver = module('parent_driver', 'pq-independent-load.py')
        normal = driver.normal
        Session = transport.session_class(driver.SenderSession, normal, driver.lab)
        session = Session.__new__(Session)
        session.ready = None; session.owners = (0, 1); session.offset = 0; session.partial = b''
        session.name = 'offline-original'; session.path = HERE/'fixtures/public-owner-original-go.jsonl'
        session.lock = threading.Lock(); session.trace_lock = threading.Lock()
        session.poisoned = False; session.traces = []; session.attempts = 0
        class Sink:
            def write(self, value): return len(value)
            def flush(self): pass
        session.proc = SimpleNamespace(stdin=Sink(), poll=lambda: None)
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp); (work/'public').mkdir()
            session.c = SimpleNamespace(w=SimpleNamespace(work=work),
                measurements=SimpleNamespace(record=lambda *a, **k: None))
            session.wait_ready(threading.Event(), None, lambda: None)
            request = dict(version='YNX-PQ-LAB-SENDER-REQUEST/v1', operationId='a'*64,
                           ownerIndex=0, firstNonce='2', members=1)
            session.exchange(normal.sender_command_data('sign', request, 1, 'b'*64),
                             work/'public/reply.json', threading.Event())
        result = read(session.transport_report())
        self.assertEqual(result['groups']['sign']['outcomes'], {'ORIGINAL_SAVED': 1})
        self.assertTrue(result['records'][0]['replyObserved'])
        self.assertFalse(result['goCalleeTimeInferred'])
        self.assertIsNone(result['finalConfirmationTPS'])


if __name__ == '__main__':
    unittest.main()
