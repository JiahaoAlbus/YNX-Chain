"""Offline regression for the directory response diagnostic allowlist."""

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = (Path(__file__).parent / 'qa-cdn-directory/successors/cache-observation/observe-headers.py')
SPEC = importlib.util.spec_from_file_location('cache_header_observer', SOURCE)
OBSERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OBSERVER)

RUN = 'qa-dir-' + '1' * 32


def frame(resource='basic', page=0, **overrides):
    payload = {
        'schema': OBSERVER.SCHEMA, 'runID': RUN, 'resource': resource, 'page': page,
        'status': 200, 'responseUtcUnixSeconds': 1794630747, 'responseElapsedMs': 120,
        'date': {'state': 'observed', 'value': 'Sat, 14 Nov 2026 04:32:27 GMT'},
        'ageSeconds': {'state': 'observed', 'value': 30},
        'cacheControl': {'state': 'observed', 'value': {
            **dict.fromkeys(OBSERVER.FLAGS, False), **dict.fromkeys(OBSERVER.DURATIONS, None),
            'public': True, 'maxAge': 60,
        }},
    }
    return dict(payload, **overrides)


def wire(*frames):
    return b''.join(OBSERVER.PREFIX + json.dumps(value).encode() + b'\n' for value in frames)


class TestDirectoryResponseObservation(unittest.TestCase):
    def read(self, data, complete=True):
        return OBSERVER.read_observations(data, RUN, terminal_capture_complete=complete)

    def test_records_only_known_fields_for_all_three_resources(self):
        records = self.read(wire(frame(), frame('basic', 1), frame('described'), frame('epoch', None))
                            + b'raw unrelated log is discarded\n')
        self.assertEqual([(x['resource'], x['page']) for x in records],
                         [('basic', 0), ('basic', 1), ('described', 0), ('epoch', None)])
        self.assertEqual(records[0]['dateUTC']['value'], '2026-11-14T04:32:27+00:00')
        self.assertEqual(records[0]['ageSeconds']['value'], 30)
        self.assertEqual(records[0]['cacheControl']['value']['maxAge'], 60)
        self.assertNotIn('runID', records[0])
        self.assertNotIn('raw unrelated log', json.dumps(records))

    def test_missing_invalid_and_mismatched_calendar_dates_are_distinct(self):
        records = self.read(wire(
            frame(date={'state': 'missing'}, ageSeconds={'state': 'invalid'}),
            frame('described', date={'state': 'observed', 'value': 'Mon, 14 Nov 2026 04:32:27 GMT'}),
            frame('epoch', None, date={'state': 'observed', 'value': 'Sat, 31 Feb 2026 04:32:27 GMT'})))
        self.assertEqual([x['dateUTC']['state'] for x in records], ['missing', 'invalid', 'invalid'])
        self.assertEqual(records[0]['ageSeconds'], {'state': 'invalid'})

    def test_bad_capture_does_not_emit(self):
        policy = copy.deepcopy(frame()['cacheControl'])
        policy['value']['secret'] = 'untrusted-value'
        for payload in (
            wire(frame(runID='qa-dir-' + '2' * 32)), wire(frame(), frame()),
            wire(frame(page=True)), wire(frame(), frame(page=2)), wire(frame('epoch', None)),
            wire(frame(cacheControl=policy)), wire(frame(), frame('described'))[:-1],
            wire(frame(resource=[])), wire(frame(ageSeconds={'state': 'observed', 'value': True})),
            wire(frame()).replace(b'"status": 200', b'"status": 200, "status": 200'),
            wire(frame(status=503), frame('described')),
        ):
            with self.subTest(payload=payload):
                self.assertIsNone(self.read(payload))
        self.assertEqual(self.read(b'unrelated log\n'), [])
        self.assertIsNone(self.read(wire(frame()), complete=False))

    def test_preserves_original_exit_and_discards_raw_capture(self):
        class Diagnostics:
            def public_body_failure(self, stderr, run_id, errors, *, terminal_capture_complete):
                return {'originalBodyFailure': errors[0]}

        def save(path, report):
            with path.open('x') as stream:
                json.dump(report, stream)

        observer = OBSERVER.TerminalHttpObservation(None, Diagnostics())
        with tempfile.TemporaryDirectory() as temporary:
            case = Path(temporary)
            work = case / 'once-fresh-directory'
            work.mkdir()
            receipt = work / 'receipt.json'
            original = {'scopeSHA256': 'fixture', 'binarySHA256': 'fixture', 'capturedEOF': ['stderr', 'stdout'],
                        'FDClosed': True, 'remainingOwned': [], 'cleanupFailure': None,
                        'childOutcomeRecordingFailure': None, 'processes': [{'pid': 123, 'exit': 1, 'reaped': True}]}
            save(receipt, original)
            blob = wire(frame(), frame('described'), frame('epoch', None)) + b'SECRET_FIXTURE_RAW\n'
            first = observer.public_body_failure(blob, RUN, ['qa-directory-stale-epoch'],
                                                 terminal_capture_complete=True)
            self.assertEqual(first, {'originalBodyFailure': 'qa-directory-stale-epoch'})
            self.assertEqual(json.loads(receipt.read_text()), original)
            output = observer.persist(case, lambda _: 'fixture-digest', save)
            report = json.loads(output.read_text())
            self.assertEqual(report['originalWait'], 1)
            self.assertEqual(report['originalPID'], 123)
            self.assertEqual(report['httpResponses'][-1]['resource'], 'epoch')
            self.assertNotIn('SECRET_FIXTURE_RAW', output.read_text())


if __name__ == '__main__':
    unittest.main()
