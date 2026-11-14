#!/usr/bin/env python3
"""Exercise real local worker reaping, without DNS, sockets or a Tor process."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('collector', HERE / 'collect_public_entry_mappings.py')
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)
RECORDS = []


class WorkerTests(unittest.TestCase):
    def invoke(self, body, timeout=3):
        records = []
        try:
            return COLLECTOR.supervised_worker([sys.executable, '-I', '-c', body], records,
                                              'local-synthetic-worker.invalid', timeout)
        finally:
            RECORDS.extend(records)
            self.assertEqual(len(records), 1)
            self.assertTrue(records[0]['reaped'])
            with self.assertRaises(ProcessLookupError):
                os.kill(records[0]['pid'], 0)

    def test_actual_worker_success(self):
        self.assertEqual(self.invoke('print(\'["8.8.8.8"]\')'), ['8.8.8.8'])
        self.assertEqual(RECORDS[-1]['exit'], 0)

    def test_failed_or_poisoned_output_never_accepted(self):
        for body in ["raise SystemExit(7)", "print('bad-json')",
                     'print(\'["8.8.8.8", "127.0.0.1"]\')', "print('x' * 8193)"]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                self.invoke(body)

    def test_timeout_escalation_reaps_term_ignoring_worker(self):
        with self.assertRaises(ValueError):
            self.invoke('import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)', 1)
        self.assertTrue(RECORDS[-1]['timedOut'])
        self.assertEqual(RECORDS[-1]['exit'], -signal.SIGKILL)

    def test_failure_keeps_only_bounded_diagnostic_code(self):
        diagnostic = dict(schema='P05_BOOTSTRAP_DNS_WORKER_ERROR_V1', errorType='gaierror',
                          errno=-3, raw='SYNTHETIC_VALUE_MUST_NOT_BE_RECORDED')
        body = 'import sys; print(%r, file=sys.stderr); raise SystemExit(2)' % json.dumps(diagnostic)
        with self.assertRaises(ValueError):
            self.invoke(body)
        self.assertEqual(RECORDS[-1]['workerError'], dict(errorType='gaierror', errno=-3))
        self.assertNotIn('SYNTHETIC_VALUE_MUST_NOT_BE_RECORDED', json.dumps(RECORDS[-1]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, mode=0o700, exist_ok=False)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(WorkerTests))
    report = dict(status='PASS' if result.wasSuccessful() else 'FAIL', tests=result.testsRun,
                  failures=len(result.failures), errors=len(result.errors), workers=RECORDS,
                  actualDNS='NOT_RUN', backend='NOT_RUN', productionQualification=False,
                  collectorSHA256=hashlib.sha256((HERE / 'collect_public_entry_mappings.py').read_bytes()).hexdigest())
    (out / 'RESULT.json').write_text(json.dumps(report, indent=2) + '\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == '__main__':
    main()
