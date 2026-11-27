import importlib.util
import hashlib
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('original_vuln_events', Path(__file__).with_name('pq-perf-client-vuln-events.py'))
events = importlib.util.module_from_spec(spec)
spec.loader.exec_module(events)


def stream(*messages):
    return ''.join(json.dumps(m, indent=1) + '\n' for m in messages).encode()


def base():
    return [dict(config=dict(protocol_version='v1.0.0', scanner_name='govulncheck', scanner_version='v1.1.4', go_version='go1.26.10',
        db='https://vuln.go.dev', db_last_modified='2026-11-28T00:00:00Z', scan_level='symbol', scan_mode='source')),
        dict(SBOM=dict(roots=[events.TARGET], modules=[dict(path=events.MODULE, version='v1.5.3')])),
        dict(progress=dict(message='Fetching vulnerabilities from the database...')), dict(osv=dict(id=events.ADVISORY)),
        dict(progress=dict(message='Checking the code against the vulnerabilities...'))]


class OriginalScannerEvents(unittest.TestCase):
    def test_complete_multiline_stream_and_symbol(self):
        data = base() + [dict(osv=dict(id=events.ADVISORY)), dict(finding=dict(osv=events.ADVISORY,
            trace=[dict(module=events.MODULE, package=events.MODULE, function='WriteMessage'), dict(package=events.TARGET)]))]
        out = events.inspect(stream(*data), exit_code=0, output_complete=True)
        self.assertEqual(out['targetReachability'], 'CALLED')
        self.assertFalse(out['runtimeAuthorized'])

    def test_osv_or_module_does_not_imply_called(self):
        data = base() + [dict(osv=dict(id=events.ADVISORY)),
            dict(finding=dict(osv=events.ADVISORY, trace=[dict(module=events.MODULE)]))]
        self.assertEqual(events.inspect(stream(*data), exit_code=0, output_complete=True)['targetReachability'], 'NO_SYMBOL_FINDING_REPORTED')

    def test_wrong_toolchain_database_or_scanner_rejected(self):
        for key, value in [('go_version', 'go1.26.11'), ('db', 'https://example.invalid'),
                           ('db_last_modified', None), ('scanner_version', 'v1.1.5')]:
            data = base(); data[0]['config'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): events.inspect(stream(*data), exit_code=0, output_complete=True)

    def test_toolchain_12611_is_explicit_and_cannot_borrow_12610(self):
        data = base(); data[0]['config']['go_version'] = 'go1.26.11'
        with self.assertRaises(ValueError): events.inspect(stream(*data), exit_code=0, output_complete=True)
        self.assertEqual(events.inspect(stream(*data), exit_code=0, output_complete=True, expected_go='go1.26.11')['goVersion'], 'go1.26.11')
        with self.assertRaises(ValueError): events.inspect(stream(*data), exit_code=0, output_complete=True, expected_go='go1.26.12')

    def test_invalid_database_calendar_time_rejected(self):
        for timestamp in ('2026-02-30T25:00:00Z', '2026-11-28T00:00:00+00:60', '2026-11-28T00:00:00+24:00'):
            data = base(); data[0]['config']['db_last_modified'] = timestamp
            with self.subTest(timestamp=timestamp), self.assertRaises(ValueError):
                events.inspect(stream(*data), exit_code=0, output_complete=True)

    def test_wrong_root_or_missing_sbom_rejected(self):
        for data in [base()[:1], [base()[0], dict(SBOM=dict(roots=['wrong']))]]:
            with self.assertRaises(ValueError): events.inspect(stream(*data), exit_code=0, output_complete=True)

    def test_truncation_duplicate_and_extra_message_rejected(self):
        for raw in [stream(*base())[:-3], b'{"config":{},"config":{}}', stream(*base(), dict(unexpected={}))]:
            with self.assertRaises((ValueError, UnicodeError)): events.inspect(raw, exit_code=0, output_complete=True)

    def test_wrong_target_module_rejected(self):
        data = base() + [dict(finding=dict(osv=events.ADVISORY, trace=[dict(module='wrong', function='X')]))]
        with self.assertRaises(ValueError): events.inspect(stream(*data), exit_code=0, output_complete=True)

    def test_oversized_rejected(self):
        with self.assertRaises(ValueError): events.inspect(b' ' * (events.MAX_BYTES + 1), exit_code=0, output_complete=True)

    def test_interrupted_or_unclosed_stream_never_reports_negative(self):
        for code, complete in [(-15, True), (1, True), (0, False), (None, True)]:
            with self.subTest(code=code, complete=complete), self.assertRaises(ValueError):
                events.inspect(stream(*base()), exit_code=code, output_complete=complete)

    def test_real_failed_child_with_complete_prefix_is_unknown(self):
        program = 'import sys; sys.stdout.buffer.write(bytes.fromhex(sys.argv[1])); sys.exit(7)'
        child = subprocess.run([sys.executable, '-c', program, stream(*base()).hex()], stdout=subprocess.PIPE, timeout=5)
        self.assertEqual(child.returncode, 7)
        with self.assertRaises(ValueError):
            events.inspect(child.stdout, exit_code=child.returncode, output_complete=True)

    def test_progress_prefix_without_analysis_is_unknown(self):
        with self.assertRaises(ValueError):
            events.inspect(stream(*base()[:2]), exit_code=0, output_complete=True)

    def test_target_module_without_own_advisory_is_unknown(self):
        data = [message for message in base() if 'osv' not in message]
        with self.assertRaises(ValueError): events.inspect(stream(*data), exit_code=0, output_complete=True)

    def test_absent_module_reports_only_sbom_scope(self):
        data = base(); data[1]['SBOM']['modules'] = []
        self.assertEqual(events.inspect(stream(*data), exit_code=0, output_complete=True)['targetReachability'], 'NOT_IN_TARGET_SBOM')

    def test_tracked_inventory_rejects_mutation_and_symlink(self):
        ci_spec = importlib.util.spec_from_file_location('original_vuln_ci_fixture', Path(__file__).with_name('pq-perf-client-vuln-ci.py'))
        ci = importlib.util.module_from_spec(ci_spec); sys.modules[ci_spec.name] = ci; ci_spec.loader.exec_module(ci)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'dir').mkdir(); file = root / 'dir/a'; file.write_bytes(b'abc')
            blob = hashlib.sha1(b'blob 3\0abc').hexdigest().encode()
            inventory = b'100644 blob ' + blob + b'\tdir/a\0'
            self.assertEqual(ci.inventory(root, inventory, expected_files=1)['files'], 1)
            file.write_bytes(b'abd')
            with self.assertRaises(RuntimeError): ci.inventory(root, inventory, expected_files=1)
            file.unlink(); file.symlink_to('/dev/null')
            with self.assertRaises(OSError): ci.inventory(root, inventory, expected_files=1)

    def test_real_fifo_inventory_is_bounded_and_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); os.mkfifo(root / 'input')
            code = ('import importlib.util,sys,pathlib; p=pathlib.Path(sys.argv[1]); '
                's=importlib.util.spec_from_file_location("fifo_ci",p); m=importlib.util.module_from_spec(s); '
                'sys.modules[s.name]=m; s.loader.exec_module(m); '
                'm.inventory(pathlib.Path(sys.argv[2]),bytes.fromhex(sys.argv[3]),expected_files=1)')
            raw = b'100644 blob ' + b'0' * 40 + b'\tinput\0'
            child = subprocess.run([sys.executable, '-B', '-c', code, str(Path(__file__).with_name('pq-perf-client-vuln-ci.py')),
                str(root), raw.hex()], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            self.assertNotEqual(child.returncode, 0)
            self.assertIn(b'source file shape differs', child.stderr)

    def test_source_inventory_growth_stops_at_original_size_plus_one(self):
        spec = importlib.util.spec_from_file_location('original_vuln_growth_fixture', Path(__file__).with_name('pq-perf-client-vuln-ci.py'))
        ci = importlib.util.module_from_spec(spec); sys.modules[spec.name] = ci; spec.loader.exec_module(ci)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root / 'source'; path.write_bytes(b'abc')
            blob = hashlib.sha1(b'blob 3\0abc').hexdigest().encode()
            original_read = os.read; lengths = []
            def grow(fd, maximum):
                data = original_read(fd, maximum); lengths.append(len(data))
                if len(lengths) == 1:
                    with path.open('ab') as stream: stream.write(b'x' * 65536)
                return data
            with mock.patch.object(ci.os, 'read', side_effect=grow):
                with self.assertRaisesRegex(RuntimeError, 'grew beyond bound'):
                    ci.inventory(root, b'100644 blob ' + blob + b'\tsource\0', expected_files=1)
            self.assertEqual(lengths, [3, 1])

    def test_scanner_descriptor_growth_stops_at_original_size_plus_one(self):
        spec = importlib.util.spec_from_file_location('original_vuln_scanner_growth_fixture', Path(__file__).with_name('pq-perf-client-vuln-ci.py'))
        ci = importlib.util.module_from_spec(spec); sys.modules[spec.name] = ci; spec.loader.exec_module(ci)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'scanner'; path.write_bytes(b'abc'); fd = os.open(path, os.O_RDONLY)
            try:
                original_read = os.read; lengths = []
                def grow(descriptor, maximum):
                    data = original_read(descriptor, maximum); lengths.append(len(data))
                    if len(lengths) == 1:
                        with path.open('ab') as stream: stream.write(b'x' * 65536)
                    return data
                with mock.patch.object(ci.os, 'read', side_effect=grow):
                    with self.assertRaisesRegex(RuntimeError, 'grew beyond bound'):
                        ci.hash_scanner_descriptor(fd, os.fstat(fd))
                self.assertEqual(lengths, [3, 1])
            finally:
                os.close(fd)

    def test_original_window_rejects_registered_overlimit_stream(self):
        ci_spec = importlib.util.spec_from_file_location('original_vuln_window_fixture', Path(__file__).with_name('pq-perf-client-vuln-ci.py'))
        ci = importlib.util.module_from_spec(ci_spec); sys.modules[ci_spec.name] = ci; ci_spec.loader.exec_module(ci)
        with tempfile.TemporaryDirectory() as directory:
            window = object.__new__(ci.lab.Window)
            window.lock = threading.RLock(); window.closed_for_launch = False; window.launches_closed = False
            window.logs = []; window.known = {}; window.started = time.monotonic(); window.sample_stage_totals = {}
            window.last_storage_sample = time.monotonic(); window.storage_bytes = 0; window.peak_rss_sample = None
            window.peak_rss = window.peak_bytes = 0; window.children = []; window.work = Path(directory)
            window.samples = []; window.stopping = False
            stream = ci.register_stream(window, Path(directory) / 'stdout', threading.Event())
            os.write(stream.fileno(), b'x' * (ci.lab.CAPS['logBytes'] + 1))
            with mock.patch.object(ci.lab.guard, 'proc_inventory', return_value=({}, None)), \
                 mock.patch.object(ci.lab.guard, 'owned_set', return_value=[]), \
                 mock.patch.object(ci.lab.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=2 << 30)):
                with self.assertRaisesRegex(RuntimeError, 'bounded process log exceeded'): ci.lab.Window._sample(window)
            stream.close()

    def test_registration_lock_failure_retains_first_cause_and_closes_once(self):
        ci_spec = importlib.util.spec_from_file_location('original_vuln_close_fixture', Path(__file__).with_name('pq-perf-client-vuln-ci.py'))
        ci = importlib.util.module_from_spec(ci_spec); sys.modules[ci_spec.name] = ci; ci_spec.loader.exec_module(ci)
        class FailedClose:
            closed = False
            calls = 0
            def fileno(self): return 1
            def close(self):
                self.calls += 1
                raise OSError('secondary close')
        held = FailedClose(); lock = threading.Lock(); lock.acquire()
        window = types.SimpleNamespace(lock=lock, logs=[], closed_for_launch=False, launches_closed=False)
        try:
            with mock.patch('builtins.open', return_value=held), mock.patch.object(ci.os, 'fchmod'):
                with self.assertRaisesRegex(RuntimeError, 'registration lock unavailable') as caught:
                    ci.register_stream(window, Path('/unused'), threading.Event())
            self.assertEqual(held.calls, 1)
            self.assertEqual(len(ci.UNKNOWN_STREAM_CUSTODY), 1)
            self.assertIn('close outcome UNKNOWN', caught.exception.__notes__[0])
            ci.UNKNOWN_STREAM_CUSTODY[0].close()
            self.assertEqual(held.calls, 1)
        finally:
            lock.release()

    def test_launch_failure_never_inherits_previous_process(self):
        ci_spec = importlib.util.spec_from_file_location('original_vuln_launch_fixture', Path(__file__).with_name('pq-perf-client-vuln-ci.py'))
        ci = importlib.util.module_from_spec(ci_spec); sys.modules[ci_spec.name] = ci; ci_spec.loader.exec_module(ci)
        state = dict(name='previous', process=types.SimpleNamespace(returncode=0))
        window = types.SimpleNamespace(launch=mock.Mock(side_effect=OSError('real launch failure')))
        with self.assertRaisesRegex(OSError, 'real launch failure'):
            ci.launch_owned(window, state, 'scanner', ['scanner'], threading.Event(), ())
        self.assertEqual(state, dict(name='scanner', process=None))

    def test_original_descriptor_exec_or_explicit_unsupported(self):
        helper = Path(__file__).with_name('pq-perf-client-vuln-exec.py')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); output = root / 'stdout'
            scanner_fd = os.open('/usr/bin/true', os.O_RDONLY)
            output_fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                env = dict(os.environ, YNX_PERF_VULN_SOURCE=str(root), GOOS='linux', GOARCH='amd64',
                    CGO_ENABLED='1', GOAMD64='v1', GOWORK='off', GOTOOLCHAIN='local', GOFLAGS='-mod=readonly -p=1')
                env.pop('GOVERSION', None)
                child = subprocess.run([sys.executable, '-I', str(helper), str(scanner_fd), str(output_fd)], cwd=root, env=env,
                    pass_fds=(scanner_fd, output_fd), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                if os.execve in os.supports_fd:
                    self.assertEqual(child.returncode, 0, child.stderr)
                else:
                    self.assertNotEqual(child.returncode, 0)
                    self.assertIn(b'descriptors unavailable', child.stderr)
            finally:
                os.close(scanner_fd); os.close(output_fd)

    def test_real_child_failure_and_cleanup_errors_preserve_original_receipt(self):
        ci_spec = importlib.util.spec_from_file_location('original_vuln_finally_fixture', Path(__file__).with_name('pq-perf-client-vuln-ci.py'))
        ci = importlib.util.module_from_spec(ci_spec); sys.modules[ci_spec.name] = ci; ci_spec.loader.exec_module(ci)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            work = root / 'work'; private = work / '.private'; private.mkdir(parents=True)
            public = root / 'public'; state = dict(name='scanner', process=None)
            class Monitor:
                def __init__(self): self.thread = threading.Thread(target=lambda: None)
                def close(self): self.thread.join(timeout=2); raise OSError('secondary monitor close')
                def failure_snapshot(self): return None
            window = types.SimpleNamespace(stop=mock.Mock(side_effect=OSError('secondary window stop')))
            def operation():
                child = subprocess.run([sys.executable, '-c', 'import sys; sys.stderr.write("original child error"); sys.exit(7)'],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                state['process'] = child
                (private / 'scanner.log').write_bytes(child.stderr)
                (private / 'original-scanner-events.json').write_bytes(b'{"config":')
                raise ValueError()
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(ValueError):
                    ci.run_preserving(window, Monitor(), operation, lambda _: None, work, public, state,
                        dict(source=ci.SOURCE, toolsSource='a'*40, runId='1', attempt='1'))
            window.stop.assert_called_once()
            receipt = json.loads((public / 'failure-metadata.json').read_bytes())
            self.assertEqual((receipt['status'], receipt['firstCaughtErrorType'], receipt['firstCaughtError'], receipt['originalReturnCode']),
                ('UNKNOWN', 'ValueError', '', 7))
            self.assertEqual((public / 'failure-original-stderr.log').read_bytes(), b'original child error')
            self.assertEqual((public / 'failure-scanner-events.partial').read_bytes(), b'{"config":')

    def test_candidate_source_profile_is_closed_and_exact(self):
        spec = importlib.util.spec_from_file_location('original_vuln_profile_fixture', Path(__file__).with_name('pq-perf-client-vuln-ci.py'))
        ci = importlib.util.module_from_spec(spec); sys.modules[spec.name] = ci; spec.loader.exec_module(ci)
        self.assertEqual(set(ci.PROFILES), {'original70e', 'fixed-e339', 'fixed-491188-go12611'})
        self.assertEqual(ci.PROFILE_TOOLCHAINS['fixed-491188-go12611'], 'go1.26.11')
        expected = list(ci.PROFILES['fixed-e339']); ci.check_profile('fixed-e339', expected)
        for index in range(3):
            wrong = expected.copy(); wrong[index] = 'a' * 40
            with self.assertRaises(RuntimeError): ci.check_profile('fixed-e339', wrong)
        with self.assertRaises(RuntimeError): ci.check_profile('unknown', expected)

    def test_exec_rejects_real_wrong_cwd_and_environment_before_output(self):
        helper = Path(__file__).with_name('pq-perf-client-vuln-exec.py')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); out = root / 'result'
            env = dict(os.environ, YNX_PERF_VULN_SOURCE=str(root), GOOS='linux', GOARCH='amd64',
                CGO_ENABLED='1', GOAMD64='v1', GOWORK='off', GOTOOLCHAIN='local', GOFLAGS='-mod=readonly -p=1')
            env.pop('GOVERSION', None)
            for cwd, changes in [(root.parent, {}), (root, {'GOARCH': 'arm64'}), (root, {'GOVERSION': 'go1.26.10'})]:
                with self.subTest(cwd=cwd, changes=changes):
                    trial = dict(env); trial.update(changes)
                    result = subprocess.run([sys.executable, '-I', str(helper), '/usr/bin/true', str(out)], cwd=cwd, env=trial,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                    self.assertNotEqual(result.returncode, 0); self.assertFalse(out.exists())
