#!/usr/bin/env python3
"""Local mapping-preparation controls with a resolver spy, never real DNS."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('mapping_collector', HERE / 'collect_public_entry_mappings.py')
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)
SOURCE = HERE / 'fixtures/public-entry-reviewed-bridges.json'
COMMANDS = []


class MappingTests(unittest.TestCase):
    def setUp(self):
        self.fronts, self.stun = COLLECTOR.SCOPE.reviewed_hosts(SOURCE)

    def test_only_fixed_ten_names(self):
        called = []
        def lookup(name):
            called.append(name)
            return ['8.8.8.8']
        result = COLLECTOR.collect(SOURCE, lookup)
        self.assertEqual(called, self.fronts + self.stun)
        self.assertEqual(set(result), set(called))

    def test_canonicalize_and_deduplicate_actual_resolver_shape(self):
        self.assertEqual(COLLECTOR.checked_answer(['2606:4700:4700:0:0:0:0:1111', '8.8.8.8', '8.8.8.8']),
                         ['2606:4700:4700::1111', '8.8.8.8'])

    def test_poisoned_or_scoped_answer_is_not_trimmed(self):
        for value in ['127.0.0.1', '10.0.0.1', '192.0.2.1', '::ffff:8.8.8.8', 'fe80::1%en0']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                COLLECTOR.checked_answer(['8.8.8.8', value])

    def test_no_empty_or_large_partial_answer(self):
        for answer in [[], ['8.8.8.%d' % i for i in range(1, 18)], ['8.8.8.8'] * 65]:
            with self.assertRaises(ValueError):
                COLLECTOR.checked_answer(answer)

    def test_unknown_name_rejected_before_resolver(self):
        with patch.object(COLLECTOR.socket, 'getaddrinfo') as resolver:
            with self.assertRaises(ValueError):
                COLLECTOR.worker(SOURCE, 'unreviewed.invalid')
            resolver.assert_not_called()

    def test_actual_worker_uses_reviewed_port_and_type(self):
        answer = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))]
        with patch.object(COLLECTOR.socket, 'getaddrinfo', return_value=answer) as resolver:
            self.assertEqual(COLLECTOR.worker(SOURCE, self.fronts[0]), ['8.8.8.8'])
            resolver.assert_called_once_with(self.fronts[0], 443, socket.AF_UNSPEC, socket.SOCK_STREAM)
        answer = [(socket.AF_INET, socket.SOCK_DGRAM, 17, '', ('8.8.8.8', 3478))]
        with patch.object(COLLECTOR.socket, 'getaddrinfo', return_value=answer) as resolver:
            self.assertEqual(COLLECTOR.worker(SOURCE, self.stun[0]), ['8.8.8.8'])
            resolver.assert_called_once_with(self.stun[0], 3478, socket.AF_UNSPEC, socket.SOCK_DGRAM)

    def test_real_worker_rejects_ipv6_scope_id(self):
        answer = [(socket.AF_INET6, socket.SOCK_DGRAM, 17, '', ('2606:4700:4700::1111', 3478, 0, 4))]
        with patch.object(COLLECTOR.socket, 'getaddrinfo', return_value=answer):
            with self.assertRaises(ValueError):
                COLLECTOR.worker(SOURCE, self.stun[0])

    def test_resolver_failure_never_returns_partial_table(self):
        called = []
        def lookup(name):
            called.append(name)
            if len(called) == 3:
                raise TimeoutError('synthetic deadline')
            return ['8.8.8.8']
        with self.assertRaises(TimeoutError):
            COLLECTOR.collect(SOURCE, lookup)
        self.assertEqual(len(called), 3)

    def test_excess_stun_tuples_not_selected_partially(self):
        def lookup(name):
            if name in self.stun:
                index = self.stun.index(name)
                return ['8.9.%d.%d' % (index, i) for i in range(1, 10)]
            return ['8.8.8.8']
        with self.assertRaises(ValueError):
            COLLECTOR.collect(SOURCE, lookup)

    def test_cli_requires_explicit_mode_and_rejects_unreviewed_worker(self):
        for suffix in [[], ['--worker-name', 'unreviewed.invalid']]:
            argv = [sys.executable, str(HERE / 'collect_public_entry_mappings.py'), '--reviewed-source', str(SOURCE)] + suffix
            child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, stderr = child.communicate(timeout=5)
            COMMANDS.append(dict(pid=child.pid, exit=child.returncode, reaped=True))
            self.assertEqual(child.returncode, 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, mode=0o700, exist_ok=False)
    with patch('socket.getaddrinfo', side_effect=AssertionError('real DNS forbidden')), patch('socket.socket', side_effect=AssertionError('real socket forbidden')):
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(MappingTests))
    report = dict(status='PASS' if result.wasSuccessful() else 'FAIL', tests=result.testsRun,
                  failures=len(result.failures), errors=len(result.errors), commands=COMMANDS,
                  actualDNS='NOT_RUN', backend='NOT_RUN', productionQualification=False,
                  collectorSHA256=hashlib.sha256((HERE / 'collect_public_entry_mappings.py').read_bytes()).hexdigest())
    (out / 'RESULT.json').write_text(json.dumps(report, indent=2) + '\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == '__main__':
    main()
