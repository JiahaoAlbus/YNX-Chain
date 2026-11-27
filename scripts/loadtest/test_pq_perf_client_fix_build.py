import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('e339_build_controls', Path(__file__).with_name('pq-perf-client-fix-e339-build.py'))
build = importlib.util.module_from_spec(spec); sys.modules[spec.name] = build; spec.loader.exec_module(build)


def info():
    return ('/private/client: go1.26.10\n\tpath\t' + build.TARGET + '\n'
        '\tbuild\tGOOS=linux\n\tbuild\tGOARCH=amd64\n\tbuild\tCGO_ENABLED=1\n'
        '\tbuild\t-trimpath=true\n\tbuild\tvcs.revision=' + build.SOURCE + '\n\tbuild\tvcs.modified=false\n').encode()


def test_stream():
    def e(action, name=None):
        value = dict(Time='2026-11-28T00:00:00Z', Action=action, Package=build.TARGET)
        if name is not None: value['Test'] = name
        return (json.dumps(value, separators=(',', ':')) + '\n').encode()
    names = sorted(build.TESTS)
    return b'go: downloading public.example/mod v1.0.0\n' + e('start') + e('run', names[0]) + e('pass', names[0]) + e('run', names[1]) + e('pass', names[1]) + e('pass')


class OriginalClientBuildControls(unittest.TestCase):
    def test_exact_original_build_info(self):
        self.assertEqual(build.inspect_build_info(info())['vcs.revision'], build.SOURCE)

    def test_wrong_source_arch_or_duplicate_rejected(self):
        for raw in (info().replace(build.SOURCE.encode(), b'a'*40), info().replace(b'GOARCH=amd64', b'GOARCH=arm64'),
                    info() + b'\tbuild\tCGO_ENABLED=0\n'):
            with self.subTest(raw=raw[-40:]), self.assertRaises(RuntimeError): build.inspect_build_info(raw)

    def test_binary_hash_and_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'client'; path.write_bytes(b'candidate')
            self.assertEqual(build.binary_digest(path)['bytes'], 9)
            path.unlink(); path.symlink_to('/dev/null')
            with self.assertRaises(OSError): build.binary_digest(path)

    def test_binary_growth_reads_at_most_original_size_plus_one(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'client'; path.write_bytes(b'candidate')
            original_read = os.read; reads = []
            def grow(fd, length):
                data = original_read(fd, length); reads.append(len(data))
                if len(reads) == 1:
                    with path.open('ab') as stream: stream.write(b'x' * 65536)
                return data
            with mock.patch.object(build.os, 'read', side_effect=grow):
                with self.assertRaisesRegex(RuntimeError, 'grew beyond bound'): build.binary_digest(path)
            self.assertEqual(reads, [9, 1])

    def test_wrong_go_version_rejected(self):
        with self.assertRaises(RuntimeError): build.inspect_build_info(info().replace(b'go1.26.10', b'go1.26.11'))

    def test_original_race_events_require_two_complete_top_tests(self):
        raw, downloads = build.inspect_test_events(test_stream())
        self.assertEqual(downloads, 1)
        self.assertNotIn(b'go: downloading', raw)

    def test_race_events_reject_skip_missing_and_wrong_package(self):
        for raw in (test_stream().replace(b'"Action":"pass"', b'"Action":"skip"', 1),
                    test_stream().replace(b'TestEndpointAndWorkloadBounds', b'TestUnexpectedControl'),
                    test_stream().replace(build.TARGET.encode(), b'wrong/package', 1)):
            with self.subTest(raw=raw[-80:]), self.assertRaises(RuntimeError): build.inspect_test_events(raw)

    def test_race_events_reject_truncation_and_duplicate(self):
        raw = test_stream()
        with self.assertRaises((RuntimeError, ValueError)): build.inspect_test_events(raw[:-2])
        with self.assertRaises(RuntimeError): build.inspect_test_events(raw + raw)
