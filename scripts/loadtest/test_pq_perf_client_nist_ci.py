import importlib.util
import json
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location('original_client_nist_controls', Path(__file__).with_name('pq-perf-client-491188-nist-ci.py'))
nist = importlib.util.module_from_spec(spec); sys.modules[spec.name] = nist; spec.loader.exec_module(nist)


def raw_events():
    def event(action, name=None, output=None):
        value = dict(Time='2026-11-28T00:00:00Z', Action=action, Package=nist.PACKAGE)
        if name is not None: value['Test'] = name
        if output is not None: value['Output'] = output
        return (json.dumps(value, separators=(',', ':')) + '\n').encode()
    return b'go: downloading public.example/mod v1.0.0\n' + b''.join([
        event('start'), event('run', nist.TEST), event('output', nist.TEST, '=== RUN   '+nist.TEST+'\n'),
        event('output', nist.TEST, '--- PASS: '+nist.TEST+' (0.1s)\n'), event('pass', nist.TEST),
        event('output', output='PASS\n'), event('output', output='ok  '+nist.PACKAGE+'  0.1s\n'), event('pass')])


def tree():
    return b''.join(('100644 blob '+blob+'\t'+name+'\0').encode() for name, blob in nist.PINS.items())


class OriginalNISTControls(unittest.TestCase):
    def test_exact_original_public_events(self):
        raw, downloads = nist.inspect_nist_events(raw_events())
        self.assertEqual(downloads, 1); self.assertNotIn(b'go: downloading', raw)

    def test_wrong_package_skip_duplicate_or_truncation_rejected(self):
        raw = raw_events()
        for value in (raw.replace(nist.PACKAGE.encode(), b'wrong/package', 1), raw.replace(b'"Action":"pass"', b'"Action":"skip"', 1), raw+raw, raw[:-1]):
            with self.subTest(value=value[-32:]), self.assertRaises((RuntimeError, ValueError)):
                nist.inspect_nist_events(value)

    def test_original_source_pins_are_closed(self):
        nist.check_fixture_pins(tree())
        for value in (tree().replace(next(iter(nist.PINS.values())).encode(), b'a'*40, 1), tree()+tree(), tree()[:-1]):
            with self.assertRaises((RuntimeError, ValueError)): nist.check_fixture_pins(value)

    def test_missing_terminal_or_wrong_test_rejected(self):
        raw = raw_events()
        for value in (raw.rsplit(b'\n', 2)[0]+b'\n', raw.replace(nist.TEST.encode(), b'UnknownTest', 1)):
            with self.assertRaises((RuntimeError, ValueError)): nist.inspect_nist_events(value)
