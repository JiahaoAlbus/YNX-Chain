#!/usr/bin/env python3
"""Exercise the real scope producer on owned files; no resolver or backend runs."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import types
import unittest
from unittest.mock import patch
import uuid

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('scope_producer', HERE / 'prepare_public_entry_scope.py')
SCOPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCOPE)
SOURCE = HERE / 'fixtures/public-entry-reviewed-bridges.json'
OUT = None
COUNTER = 0
COMMANDS = []


class ScopeTests(unittest.TestCase):
    def setUp(self):
        global COUNTER
        COUNTER += 1
        self.case = OUT / ('case-%02d' % COUNTER)
        self.profile = self.case / 'ynx-public-search-A0000001/YNX Browser Route State/Tor'
        self.profile.mkdir(parents=True, mode=0o700)
        self.profile = self.profile.resolve()
        self.fronts, self.stun = SCOPE.reviewed_hosts(SOURCE)
        self.maps = {host: ['8.8.8.8'] for host in self.fronts + self.stun}
        self.now = time.time_ns()
        self.run_id = 'abcdefab-cdef-4abc-8def-abcdefabcdef'

    def prepare(self, **overrides):
        arguments = dict(profile_home=self.profile, source=SOURCE, supplied_addresses=self.maps,
                         run_id=self.run_id, plan_deadline_ns=self.now + 100_000_000_000,
                         mapping_expires_ns=self.now + 100_000_000_000, now_ns=self.now)
        arguments.update(overrides)
        return SCOPE.prepare(**arguments)

    def test_real_file_and_exact_contract(self):
        self.maps[self.fronts[0]] = ['9.9.9.9', '8.8.8.8', '2606:4700:4700::1111']
        result = self.prepare()
        path = self.profile / SCOPE.SCOPE_NAME
        info = path.stat()
        plan = json.loads(path.read_text())
        self.assertEqual(set(plan), {'schema', 'runID', 'reviewedSourceSHA256',
                         'selectedBridgeLineSHA256', 'profileDevice', 'profileInode',
                         'planDeadlineUnixNano', 'mappingExpiresUnixNano', 'addresses'})
        self.assertEqual((info.st_uid, info.st_nlink, stat.S_IMODE(info.st_mode)), (os.getuid(), 1, 0o600))
        self.assertEqual((plan['profileDevice'], plan['profileInode']),
                         (self.profile.stat().st_dev, self.profile.stat().st_ino))
        self.assertEqual(plan['addresses'][self.fronts[0]], sorted(self.maps[self.fronts[0]]))
        self.assertEqual(result['scopeSHA256'], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertNotIn('8.8.8.8', json.dumps(result))
        self.assertNotIn(self.fronts[0], json.dumps(result))
        self.assertFalse(result['productionQualification'])

    def test_no_overwrite_or_renewal(self):
        self.prepare()
        path = self.profile / SCOPE.SCOPE_NAME
        original = path.read_bytes()
        with self.assertRaises(FileExistsError):
            self.prepare(run_id=str(uuid.uuid4()))
        self.assertEqual(path.read_bytes(), original)

    def test_source_identity_and_size(self):
        changed = self.case / 'changed.json'
        changed.write_bytes(SOURCE.read_bytes() + b' ')
        with self.assertRaises(SCOPE.ScopeError):
            self.prepare(source=changed)
        changed.write_bytes(b'x' * (SCOPE.MAX_INPUT_BYTES + 1))
        with self.assertRaises(SCOPE.ScopeError):
            self.prepare(source=changed)
        self.assertFalse((self.profile / SCOPE.SCOPE_NAME).exists())

    def test_missing_unknown_and_other_address_hosts(self):
        missing = dict(self.maps)
        missing.pop(self.stun[0])
        for value in [missing, dict(self.maps, **{'other-address.invalid': ['8.8.4.4']})]:
            with self.assertRaises(SCOPE.ScopeError):
                self.prepare(supplied_addresses=value)

    def test_private_special_mapped_zone_noncanonical(self):
        values = ['127.0.0.1', '10.1.2.3', '100.64.1.1', '169.254.1.1', '192.168.1.1',
                  '192.0.0.9', '192.0.2.1', '198.18.1.1', '224.0.0.1', '255.255.255.255',
                  '::1', 'fe80::1', 'fc00::1', '2001:db8::1', '2002:808:808::1',
                  '64:ff9b::808:808', '::ffff:8.8.8.8', 'fe80::1%en0',
                  '2606:4700:4700:0000::1111', '8.8.8.8:3478', '8.8.8.8 ']
        for value in values:
            with self.subTest(value=value), self.assertRaises(ValueError):
                maps = dict(self.maps)
                maps[self.fronts[0]] = [value]
                self.prepare(supplied_addresses=maps)
        self.assertFalse((self.profile / SCOPE.SCOPE_NAME).exists())

    def test_duplicate_and_address_bounds(self):
        for values in [[], ['8.8.8.8', '8.8.8.8'], ['8.8.8.%d' % i for i in range(1, 18)]]:
            maps = dict(self.maps)
            maps[self.fronts[0]] = values
            with self.assertRaises(SCOPE.ScopeError):
                self.prepare(supplied_addresses=maps)
        maps = dict(self.maps)
        for i, host in enumerate(self.stun):
            maps[host] = ['8.9.%d.%d' % (i, j) for j in range(1, 10)]
        with self.assertRaises(SCOPE.ScopeError):
            self.prepare(supplied_addresses=maps)

    def test_ipv6_only_does_not_add_nat_target(self):
        result = self.prepare(supplied_addresses={host: ['2606:4700:4700::1111'] for host in self.maps})
        self.assertEqual(result['STUNv4Tuples'], 0)
        self.assertEqual(result['hosts'], 10)

    def test_recursive_duplicate_json_keys(self):
        for raw in [b'{"a":[],"a":[]}', b'{"a":{"ip":[],"ip":[]}}']:
            with self.assertRaises(SCOPE.ScopeError):
                SCOPE.json_object(raw)

    def test_directory_mode_shape_and_symlink(self):
        self.profile.chmod(0o755)
        with self.assertRaises(SCOPE.ScopeError):
            self.prepare()
        self.profile.chmod(0o700)
        alias = self.case / 'alias'
        alias.symlink_to(self.profile, target_is_directory=True)
        with self.assertRaises(SCOPE.ScopeError):
            self.prepare(profile_home=alias)
        wrong = self.case / 'Tor'
        wrong.mkdir(mode=0o700)
        with self.assertRaises(SCOPE.ScopeError):
            self.prepare(profile_home=wrong)

    def test_existing_scope_symlink_preserves_target(self):
        sentinel = self.case / 'sentinel'
        sentinel.write_bytes(b'owned sentinel bytes')
        (self.profile / SCOPE.SCOPE_NAME).symlink_to(sentinel)
        with self.assertRaises(FileExistsError):
            self.prepare()
        self.assertEqual(sentinel.read_bytes(), b'owned sentinel bytes')

    def test_uuid_and_deadline_boundaries(self):
        for changes in [dict(run_id=self.run_id.upper()), dict(plan_deadline_ns=self.now),
                        dict(plan_deadline_ns=self.now + 651_000_000_000),
                        dict(mapping_expires_ns=self.now + 901_000_000_000),
                        dict(plan_deadline_ns=True), dict(plan_deadline_ns=(1 << 63))]:
            with self.subTest(changes=changes), self.assertRaises((ValueError, TypeError)):
                self.prepare(**changes)
        self.prepare(plan_deadline_ns=self.now + 650_000_000_000,
                     mapping_expires_ns=self.now + 900_000_000_000)

    def test_replaced_directory_identity_retains_failed_input(self):
        original = os.stat
        def changed(path, *args, **kwargs):
            info = original(path, *args, **kwargs)
            if str(path) == str(self.profile) and (self.profile / SCOPE.SCOPE_NAME).exists():
                return types.SimpleNamespace(st_dev=info.st_dev, st_ino=info.st_ino + 1)
            return info
        with patch.object(SCOPE.os, 'stat', changed), self.assertRaises(RuntimeError):
            self.prepare()
        self.assertTrue((self.profile / SCOPE.SCOPE_NAME).is_file())

    def test_go_policy_contract_matches(self):
        go = HERE.parent / 'privacy-routing/tor/qa-egress-guard/policy.go'
        text = go.read_text()
        block = text.split('var special = []netip.Prefix{', 1)[1].split('var ipv6Global', 1)[0]
        prefixes = re.findall(r'netip.MustParsePrefix\("([^"]+)"\)', block)
        self.assertEqual(prefixes, [str(prefix) for prefix in SCOPE.SPECIAL])
        self.assertIn('netip.MustParsePrefix("%s")' % SCOPE.IPV6_GLOBAL, text)

    def test_actual_cli_success_then_refuses_existing(self):
        mappings = self.case / 'mappings.json'
        mappings.write_text(json.dumps(self.maps))
        argv = [sys.executable, str(HERE / 'prepare_public_entry_scope.py'),
                '--profile-home', str(self.profile), '--reviewed-source', str(SOURCE),
                '--addresses-json', str(mappings), '--run-id', self.run_id,
                '--plan-deadline-unix-nano', str(self.now + 100_000_000_000),
                '--mapping-expires-unix-nano', str(self.now + 100_000_000_000)]
        for expected in [0, 1]:
            child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            stdout, stderr = child.communicate(timeout=5)
            COMMANDS.append(dict(pid=child.pid, exit=child.returncode, reaped=True))
            self.assertEqual(child.returncode, expected, stderr)
            result = json.loads(stdout)
            self.assertEqual(result['network'], 'NOT_RUN')
            self.assertNotIn('8.8.8.8', stdout + stderr)


def main():
    global OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    OUT = args.output.resolve()
    OUT.mkdir(parents=True, mode=0o700, exist_ok=False)
    # Any accidental resolver or socket call in the producer fails this local suite.
    with patch('socket.getaddrinfo', side_effect=AssertionError('network forbidden')), patch('socket.socket', side_effect=AssertionError('network forbidden')):
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ScopeTests))
    report = dict(status='PASS' if result.wasSuccessful() else 'FAIL', tests=result.testsRun,
                  failures=len(result.failures), errors=len(result.errors), commands=COMMANDS,
                  DNS='NOT_RUN', network='NOT_RUN', backend='NOT_RUN', productionQualification=False,
                  sourceSHA256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                  producerSHA256=hashlib.sha256((HERE / 'prepare_public_entry_scope.py').read_bytes()).hexdigest())
    (OUT / 'RESULT.json').write_text(json.dumps(report, indent=2) + '\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == '__main__':
    main()
