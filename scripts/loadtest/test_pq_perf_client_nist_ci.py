import importlib.util
import contextlib
import errno
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock

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

    def test_later_failure_retains_original_nist_log_and_first_cause(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); work = root/'work'; private = work/'.private'; private.mkdir(parents=True)
            public = root/'public'; state = dict(name='tree-after', process=types.SimpleNamespace(returncode=0))
            (private/'original-nist-test.log').write_bytes(raw_events())
            (private/'tree-after.log').write_bytes(b'original tree failure')
            class Monitor:
                def __init__(self): self.thread = threading.Thread(target=lambda: None)
                def close(self): self.thread.join(timeout=2); raise OSError('secondary monitor close')
                def failure_snapshot(self): return None
            window = types.SimpleNamespace(stop=mock.Mock(side_effect=OSError('secondary stop')))
            def operation(): raise ValueError()
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(ValueError):
                    nist.run_nist_preserving(window, Monitor(), operation, lambda _: None, work, public, state,
                        dict(source=nist.SOURCE, toolsSource='a'*40, runId='1', attempt='1'))
            window.stop.assert_called_once()
            primary = json.loads((public/'failure-metadata.json').read_bytes())
            extra = json.loads((public/'failure-nist-evidence.json').read_bytes())
            self.assertEqual((primary['firstCaughtErrorType'], primary['firstCaughtError'], primary['status']), ('ValueError', '', 'UNKNOWN'))
            self.assertEqual(extra['status'], 'ORIGINAL_BOUNDED_LOG')
            self.assertEqual((public/'failure-nist-test-original.log').read_bytes(), raw_events())

    def test_post_retirement_failure_retains_original_nist_log(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); work = root/'work'; private = work/'.private'; private.mkdir(parents=True)
            public = root/'public'; state = dict(name='original-nist-test', process=types.SimpleNamespace(returncode=0))
            (private/'original-nist-test.log').write_bytes(raw_events())
            class Monitor:
                def __init__(self): self.thread = threading.Thread(target=lambda: None)
                def close(self): self.thread.join(timeout=2)
                def failure_snapshot(self): return None
            window = types.SimpleNamespace(stop=mock.Mock(return_value=True))
            def after_stop(_): raise ValueError('original post-retirement failure')
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(ValueError, 'original post-retirement failure'):
                    nist.run_nist_preserving(window, Monitor(), lambda: object(), after_stop, work, public, state,
                        dict(source=nist.SOURCE, toolsSource='a'*40, runId='1', attempt='1'))
            self.assertEqual(state['name'], 'post-retirement-readback')
            self.assertEqual((public/'failure-nist-test-original.log').read_bytes(), raw_events())

    def test_broken_failure_reporting_cannot_replace_original_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); work = root/'work'; private = work/'.private'; private.mkdir(parents=True)
            public = root/'public'; state = dict(name='tree-after', process=types.SimpleNamespace(returncode=0))
            (private/'original-nist-test.log').write_bytes(raw_events())
            class Monitor:
                def __init__(self): self.thread = threading.Thread(target=lambda: None)
                def close(self): self.thread.join(timeout=2); raise OSError('secondary monitor close')
                def failure_snapshot(self): return None
            window = types.SimpleNamespace(stop=mock.Mock(return_value=True))
            def operation(): raise ValueError('original primary')
            with mock.patch('builtins.print', side_effect=BrokenPipeError('secondary output')):
                with self.assertRaisesRegex(ValueError, 'original primary') as caught:
                    nist.run_nist_preserving(window, Monitor(), operation, lambda _: None, work, public, state,
                        dict(source=nist.SOURCE, toolsSource='a'*40, runId='1', attempt='1'))
            window.stop.assert_called_once()
            self.assertTrue(any('failure reporting unavailable: BrokenPipeError' in note for note in caught.exception.__notes__))
            self.assertEqual((public/'failure-nist-test-original.log').read_bytes(), raw_events())
            self.assertEqual(json.loads((public/'failure-metadata.json').read_bytes())['firstCaughtError'], 'original primary')

    def test_publication_failure_preserves_original_nist_log(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); work = root/'work'; private = work/'.private'; private.mkdir(parents=True)
            public = root/'public'; state = dict(name='original-nist-test', process=types.SimpleNamespace(returncode=0))
            (private/'original-nist-test.log').write_bytes(raw_events())
            class Monitor:
                def __init__(self): self.thread = threading.Thread(target=lambda: None)
                def close(self): self.thread.join(timeout=2)
                def failure_snapshot(self): return None
            window = types.SimpleNamespace(stop=mock.Mock(return_value=True)); original_write = Path.write_bytes
            def fail_events(path, data):
                if path.name == 'nist-test-events.jsonl': raise OSError(errno.ENOSPC, 'original publication error')
                return original_write(path, data)
            result = (raw_events(), raw_events(), {})
            with contextlib.redirect_stdout(io.StringIO()), mock.patch.object(Path, 'write_bytes', fail_events):
                with self.assertRaises(OSError) as caught:
                    nist.run_nist_preserving(window, Monitor(), lambda: result, lambda _: None, work, public, state,
                        dict(source=nist.SOURCE, toolsSource='a'*40, runId='1', attempt='1'),
                        publish=lambda value: nist.publish_nist(public, value))
            self.assertEqual(caught.exception.errno, errno.ENOSPC)
            self.assertEqual((public/'failure-nist-test-original.log').read_bytes(), raw_events())
            self.assertEqual(json.loads((public/'failure-metadata.json').read_bytes())['firstCaughtErrorType'], 'OSError')
