#!/usr/bin/env python3
"""Process controls only: synthetic tasks, plus one tiny Linux Python child.

No test calls run(), the real producer, a retained config, Caddy, a protocol
binary, a service command or a deployment. Mocked telemetry is labelled here;
the isolated child smoke test exercises actual Popen/pipes/smaps/exit only.
"""
import copy
import contextlib
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import selectors
import subprocess
import sys
from types import SimpleNamespace
import tempfile
import time
import unittest
from unittest import mock

RUNNER = Path(__file__).resolve().parents[1] / 'ops/run-public-bft-caddy-baseline.py'
spec = importlib.util.spec_from_file_location('caddy_data_window', RUNNER)
window = importlib.util.module_from_spec(spec)
spec.loader.exec_module(window)


def low_level():
    path = RUNNER.parent / 'verify-original-native-copy.py'
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != window.GUARD_SHA256:
        raise AssertionError('test must reuse the exact measured original low-level source')
    return window.captured_module(raw, path, 'caddy_window_test_original_proc_definitions')


def historical_fa8(raw):
    """Reverse only this FD repair, then verify the whole historical source.

    No copied 47 KiB fixture, Git/network lookup or invented old branch. The
    resulting original callee must have the independently retained full pin.
    """
    changes = [
        (b"        Missing/zero smaps, a disappearing FD directory or an FD closed/reused\n        during readback can receive a short complete observation. All tasks share the caller's current 200ms\n",
         b"        Only missing/zero smaps or a disappearing FD directory can receive a\n        short terminal observation. All tasks share the caller's current 200ms\n"),
        (b'        fd_churn = ("fd_closed_during_read", "fd_reused_during_read")\n\n        def unstable_code():\n            return "owned_fd_observation_unresolved" if any(item["kind"] in fd_churn for item in observations) else "owned_live_rss_unresolved"\n',b''),
        (b'                resolvedStat=public_stat(after or before) if resolution in ("rss_recovered", "fd_recovered", "terminal_single_thread") else None,\n                resolvedSmapsRSSKiB=rss_kib if resolution in ("rss_recovered", "fd_recovered") else None,\n',
         b'                resolvedStat=public_stat(after or before) if resolution in ("rss_recovered", "terminal_single_thread") else None,\n                resolvedSmapsRSSKiB=rss_kib if resolution == "rss_recovered" else None,\n'),
        (b'''                            except FileNotFoundError as exc:
                                try:
                                    entry.lstat()
                                except FileNotFoundError:
                                    reason = "fd_closed_during_read"
                                else:
                                    reason = "fd_reused_during_read"
                                missing_errno = exc.errno
                                # Invalidate this whole FD observation. Still
                                # inspect the remaining readable entries so a
                                # socket already visible is refused immediately.
                                # The next attempt starts with fresh stat, real
                                # smaps RSS and the complete FD inventory.
                                continue
''',b'''                            except FileNotFoundError:
                                try:
                                    entry.lstat()
                                except FileNotFoundError:
                                    continue
                                raise Refused("owned_fd_readback_incomplete")
'''),
        (b'                        require(time.monotonic() <= deadline, unstable_code())\n                        finish("fd_recovered" if any(item["kind"] in fd_churn for item in observations) else "rss_recovered")\n',
         b'                        require(time.monotonic() <= deadline, "owned_live_rss_unresolved")\n                        finish("rss_recovered")\n'),
        (b'                require(remaining > 0 and attempt < max_attempts, unstable_code())\n',b'                require(remaining > 0 and attempt < max_attempts, "owned_live_rss_unresolved")\n'),
        (b'                require(time.monotonic() < deadline, unstable_code())\n',b'                require(time.monotonic() < deadline, "owned_live_rss_unresolved")\n'),
    ]
    for current, old in changes:
        if raw.count(current) != 1:
            raise AssertionError('exact historical reverse-patch anchor missing or duplicated')
        raw = raw.replace(current, old, 1)
    if len(raw) != 47901 or hashlib.sha256(raw).hexdigest() != 'fa8a1ac1230b4f3ac5bee549019d7e7e3312c5a954c3a19227c8607f054e6c37':
        raise AssertionError('historical full source does not equal the retained fa8 callee')
    return window.captured_module(raw, RUNNER.parent/'verify-original-native-copy.py', 'caddy_window_exact_fa8_regression')


def row(pid, parent=1, start=1, group=None, rss=1 << 20, comm='python3'):
    return dict(pid=pid, parent=parent, group=pid if group is None else group,
                session=pid if group is None else group, startTicks=start, rssBytes=rss,
                threads=1, state='S', comm=comm)


class Clock:
    def __init__(self): self.value = 0.0
    def now(self): self.value += 0.01; return self.value
    def sleep(self, seconds): self.value += seconds


class CapacityControls(unittest.TestCase):
    def controller(self, self_rss=20 << 20, child_rss=30 << 20):
        controller = window.Controller.__new__(window.Controller)
        controller.contract = {'mustBeEmptyProcessGroups': []}
        rows = {100: row(100, rss=self_rss), 200: row(200, parent=100, start=2, rss=child_rss),
                300: row(300, rss=10 << 30, comm='go')}
        controller.low = {'directory_bytes': mock.Mock(return_value=1024)}
        controller.proc = SimpleNamespace(inventory=mock.Mock(return_value=rows),
            sample_task=mock.Mock(side_effect=lambda original, **_: dict(original)),
            available_memory=mock.Mock(return_value=2 << 30))
        controller.owned = SimpleNamespace(controller=100, update=mock.Mock(return_value={200: rows[200]}))
        controller.started, controller.next_sample, controller.initial_bytes = 0.0, 0.0, 1024
        controller.events, controller.samples, controller.peak_rss, controller.max_delta = None, 0, 0, 0
        controller.journal_bytes = 0
        controller.task_sample_failure = controller.task_sample_journal_error = None
        return controller

    def capacity(self, controller, **kwargs):
        with mock.patch.object(window.time, 'monotonic', return_value=1.0), \
                mock.patch.object(window.os, 'statvfs', return_value=SimpleNamespace(f_bavail=2 << 30, f_frsize=1)):
            controller.capacity(**kwargs)

    def test_controller_and_children_counted_foreign_name_is_not_a_gate(self):
        controller = self.controller()
        self.capacity(controller, fresh=True)
        self.assertEqual(controller.peak_rss, 50 << 20)
        self.assertEqual(controller.samples, 1)
        calls = controller.proc.sample_task.call_args_list
        self.assertEqual({call.args[0]['pid'] for call in calls}, {100, 200})
        self.assertTrue(next(call.kwargs['check_sockets'] for call in calls if call.args[0]['pid'] == 200))
        self.assertFalse(next(call.kwargs['check_sockets'] for call in calls if call.args[0]['pid'] == 100))
        # The unrelated compiler's 10 GiB stat RSS is neither owned memory nor
        # an admission veto. Root's actual fresh-memory floor still applies.
        controller = self.controller(self_rss=400 << 20, child_rss=200 << 20)
        with self.assertRaisesRegex(window.Refused, 'owned_rss_limit'):
            self.capacity(controller, fresh=True)

    def test_missing_rss_and_socket_refusal_propagate_without_zero_sample(self):
        low = low_level()
        for code in ['owned_smaps_rss_missing', 'owned_live_rss_unresolved', 'owned_socket_present']:
            controller = self.controller()
            controller.proc.sample_task.side_effect = low['Refused'](code)
            with self.subTest(code=code), self.assertRaisesRegex(low['Refused'], code):
                self.capacity(controller, fresh=True)
            self.assertEqual(controller.samples, 0)
            self.assertEqual(controller.peak_rss, 0)

    def test_fresh_memory_disk_delta_time_tasks_and_blocked_group_boundaries(self):
        controller = self.controller()
        controller.proc.available_memory.return_value = window.LIMITS['freshMemoryBytes'] - 1
        with self.assertRaisesRegex(window.Refused, 'fresh_memory_floor'):
            self.capacity(controller, fresh=True)
        controller = self.controller()
        with mock.patch.object(window.time, 'monotonic', return_value=1.0), \
                mock.patch.object(window.os, 'statvfs', return_value=SimpleNamespace(f_bavail=(1 << 30)-1, f_frsize=1)), \
                self.assertRaisesRegex(window.Refused, 'disk_floor'):
            controller.capacity(fresh=True)
        controller = self.controller()
        controller.low['directory_bytes'].return_value = controller.initial_bytes + (64 << 20) + 1
        with self.assertRaisesRegex(window.Refused, 'case_delta_limit'): self.capacity(controller)
        controller = self.controller()
        with mock.patch.object(window.time, 'monotonic', return_value=120.001), self.assertRaisesRegex(window.Refused, 'active_time_limit'):
            controller.capacity()
        controller = self.controller()
        controller.contract['mustBeEmptyProcessGroups'] = [{'pgid':'300','leaderStartTicks':'1'}]
        with self.assertRaisesRegex(window.Refused, 'original_owner_group_not_empty'): self.capacity(controller)
        controller = self.controller()
        controller.proc.sample_task.side_effect = lambda original, **_: dict(original, threads=65)
        with self.assertRaisesRegex(window.Refused, 'owned_task_limit'): self.capacity(controller)

    def test_each_log_and_journal_bound_are_separate(self):
        self.assertEqual(window.LIMITS['stdoutBytes'], 262144)
        self.assertEqual(window.LIMITS['stderrBytes'], 262144)
        self.assertEqual(window.LIMITS['journalBytes'], 262144)
        controller = self.controller()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'journal.jsonl'
            with path.open('wb') as out:
                controller.events = out
                controller.journal_bytes = 262144
                with self.assertRaisesRegex(window.Refused, 'journal_size_limit'):
                    controller.event('sample', {'synthetic':True})
            self.assertEqual(path.read_bytes(), b'')

    def test_typed_refused_task_is_retained_without_journal_masking_firstcause(self):
        controller=self.controller()
        detail=dict(pid=200,expectedStartTicks=2,resolution='refused',failureCode='owned_fd_observation_unresolved',observations=[])
        def sample(original,**_):
            if original['pid']==200:
                controller.proc.last_task_observation=detail
                raise window.Refused('owned_fd_observation_unresolved')
            return original
        controller.proc.sample_task.side_effect=sample
        controller.event=mock.Mock(side_effect=OSError(errno.ENOSPC,'synthetic journal full'))
        with self.assertRaisesRegex(window.Refused,'owned_fd_observation_unresolved'):
            self.capacity(controller,fresh=True)
        self.assertEqual(controller.task_sample_failure,detail)
        self.assertEqual(controller.task_sample_journal_error,dict(errorClass='OSError',errno=errno.ENOSPC))
        self.assertEqual(controller.samples,0)


class CleanupControls(unittest.TestCase):
    def fixture(self):
        low = low_level()
        baseline = {100:row(100, group=99), 1432803:row(1432803, start=905926894, comm='caddy')}
        owner = low['Owned'](100, baseline)
        rows = copy.deepcopy(baseline)
        rows[200] = row(200, parent=100, start=3)
        owner.update(rows)
        proc = SimpleNamespace(inventory=mock.Mock(side_effect=lambda: copy.deepcopy(rows)),
                               one_or_gone=mock.Mock(side_effect=lambda pid: copy.deepcopy(rows.get(pid))))
        controller = window.Controller.__new__(window.Controller)
        controller.low,controller.proc,controller.owned = low,proc,owner
        controller.children,controller.started,controller.first_cause = [],0.0,'preserved_original_first_cause'
        return controller,rows

    def test_pidfd_owns_only_child_and_confirms_two_empty_scans(self):
        controller,rows = self.fixture(); clock=Clock(); signals=[]
        def send(fd, sig):
            signals.append((fd,sig)); rows.pop(200,None)
        with mock.patch.object(window.time,'monotonic',side_effect=clock.now), \
                mock.patch.object(window.time,'sleep',side_effect=clock.sleep), \
                mock.patch.object(window.os,'pidfd_open',return_value=700,create=True) as opened, \
                mock.patch.object(window.os,'close'), \
                mock.patch.object(window.signal,'pidfd_send_signal',side_effect=send,create=True):
            complete,error=controller.cleanup()
        self.assertTrue(complete); self.assertIsNone(error)
        self.assertEqual(signals,[(700,signal.SIGTERM)])
        opened.assert_called_once_with(200,0)
        self.assertGreaterEqual(controller.proc.inventory.call_count,3)
        self.assertIn(1432803,rows)
        self.assertEqual(controller.first_cause,'preserved_original_first_cause')

    def test_reused_pid_after_pidfd_open_is_never_signalled(self):
        controller,rows=self.fixture(); clock=Clock()
        def reuse(_pid,_flags):
            rows[200]=row(200,parent=1,start=999,group=888,comm='unrelated')
            return 700
        with mock.patch.object(window.time,'monotonic',side_effect=clock.now), \
                mock.patch.object(window.time,'sleep',side_effect=clock.sleep), \
                mock.patch.object(window.os,'pidfd_open',side_effect=reuse,create=True), \
                mock.patch.object(window.os,'close'), \
                mock.patch.object(window.signal,'pidfd_send_signal',create=True) as sent:
            complete,error=controller.cleanup()
        self.assertFalse(complete)
        self.assertEqual(error,'cleanup_pidfd_identity_changed')
        sent.assert_not_called()
        self.assertEqual(rows[200]['startTicks'],999)
        self.assertIn(1432803,rows)

    def test_term_then_kill_deadline_does_not_fake_empty_or_replace_firstcause(self):
        controller,rows=self.fixture(); clock=Clock(); signals=[]
        with mock.patch.object(window.time,'monotonic',side_effect=clock.now), \
                mock.patch.object(window.time,'sleep',side_effect=clock.sleep), \
                mock.patch.object(window.os,'pidfd_open',return_value=700,create=True), \
                mock.patch.object(window.os,'close'), \
                mock.patch.object(window.signal,'pidfd_send_signal',side_effect=lambda _fd,sig:signals.append(sig),create=True):
            complete,error=controller.cleanup()
        self.assertFalse(complete); self.assertEqual(error,'owned_cleanup_incomplete')
        self.assertIn(signal.SIGTERM,signals); self.assertIn(signal.SIGKILL,signals)
        self.assertGreaterEqual(clock.value,15)
        self.assertEqual(controller.first_cause,'preserved_original_first_cause')
        self.assertIn(1432803,rows)


class SourceAndCommandControls(unittest.TestCase):
    def test_guard_measured_bytes_are_the_only_definitions_executed(self):
        measured={'pin':{'bytes':window.GUARD_BYTES,'sha256':'0'*64},'identity':(1,)}
        with mock.patch.object(window,'read_private',return_value=(b'unapproved code',measured)), \
                mock.patch.object(window,'captured_module') as compile_source, \
                self.assertRaisesRegex(window.Refused,'original_process_guard_source_pin_mismatch'):
            window.load_process_guard(Path('/synthetic/guard.py'))
        compile_source.assert_not_called()
        low=low_level()
        self.assertTrue(all(callable(low[name]) for name in ['LinuxProc','Owned','cleanup_once']))

    def test_fixed_unique_prepare_argv_has_no_install_or_service_commands(self):
        case=Path(window.CASE)
        self.assertEqual(window.normal_command(),['/usr/bin/python3','-B',str(case/window.PRODUCER),
            '--binding',str(case/window.BINDING),'--binding-sha256',window.PINNED[window.BINDING]['sha256'],
            '--json-helper-sha256',window.PINNED[window.HELPER]['sha256'],'--output-dir',str(case/window.DESTINATION)])
        for word in ['install','daemon-reload','reload','restart','ynx-comet','ynx-chaind']:
            self.assertNotIn(word,window.normal_command())

    def test_changed_runtime_inode_refuses_before_popen(self):
        controller=window.Controller.__new__(window.Controller)
        controller.contract={'pythonRuntime':{'resolvedPath':'/usr/bin/python3.12'}}
        controller.capacity=mock.Mock()
        pinned={'pin':{'bytes':'1','sha256':'a'*64},'identity':(1,)}
        changed=dict(pinned,identity=(2,))
        with mock.patch.object(window,'read_private',return_value=(b'not-executed',changed)), \
                mock.patch.object(window.subprocess,'Popen') as spawned, \
                self.assertRaisesRegex(window.Refused,'normal_python_runtime_changed'):
            controller.command(pinned)
        spawned.assert_not_called()
        controller.capacity.assert_called_once_with(fresh=True)

    @unittest.skipUnless(os.name=='posix' and Path('/proc/self/smaps_rollup').exists(), 'Linux actual-process smoke only')
    def test_actual_small_python_child_uses_fixed_env_pipes_and_observed_exit(self):
        # This is NOT the real producer or a prepared-baseline result. Source
        # provenance is tested separately; only the real process seam runs.
        low=low_level()
        with tempfile.TemporaryDirectory() as temporary:
            case=Path(temporary).resolve()
            script=case/window.PRODUCER; script.parent.mkdir(parents=True)
            script.write_text('import json,os,sys\nprint(json.dumps({"syntheticProcessOnly":True,"env":dict(os.environ),"argv":sys.argv}))\n')
            script.chmod(0o600)
            output=case/window.ATTEMPT; output.mkdir(mode=0o700)
            runtime=Path('/usr/bin/python3').resolve(strict=True)
            raw=runtime.read_bytes()
            runtime_record={'pin':{'bytes':str(len(raw)),'sha256':hashlib.sha256(raw).hexdigest()},'identity':window.identity(runtime.stat())}
            contract={'mustBeEmptyProcessGroups':[], 'pythonRuntime':{'resolvedPath':str(runtime)}}
            with mock.patch.object(window,'CASE',str(case)),mock.patch.object(window,'check_witness') as provenance:
                controller=window.Controller(contract,low)
                controller.capacity(fresh=True)
                actual_popen=window.subprocess.Popen
                with mock.patch.object(window.subprocess,'Popen',wraps=actual_popen) as spawned:
                    controller.command(runtime_record)
                complete,error=controller.cleanup()
                self.assertTrue(complete,error); self.assertEqual(controller.codes,[0])
                self.assertGreater(controller.samples,0); self.assertGreater(controller.peak_rss,0)
                kwargs=spawned.call_args.kwargs
                self.assertEqual(kwargs['env'],window.ENVIRONMENT)
                self.assertEqual(kwargs['stdin'],window.subprocess.DEVNULL)
                self.assertTrue(kwargs['start_new_session']); self.assertTrue(kwargs['close_fds'])
                self.assertRegex(kwargs['executable'],r'^/proc/self/fd/[0-9]+$')
                self.assertEqual(len(kwargs['pass_fds']),1)
                self.assertEqual(spawned.call_args.args[0],window.normal_command())
                provenance.assert_called_once_with(contract)
                self.assertTrue(all(stream.closed for child in controller.children for stream in (child.stdout,child.stderr)))
            result=json.loads((output/'prepare.stdout').read_bytes())
            self.assertTrue(result['syntheticProcessOnly'])
            self.assertEqual(result['env'],window.ENVIRONMENT)
            self.assertEqual(result['argv'],spawned.call_args.args[0][2:])
            self.assertEqual((output/'prepare.stderr').read_bytes(),b'')
            self.assertEqual({path.name for path in output.iterdir()},{'prepare.stdout','prepare.stderr'})


@unittest.skipUnless(sys.platform=='linux' and Path('/proc/self/smaps_rollup').exists(), 'real Linux FD regression only')
class FDKernelControls(unittest.TestCase):
    @contextlib.contextmanager
    def child(self):
        # One controlled synthetic child, pipes and /dev/null only. The socket
        # negative creates an unbound AF_UNIX FD, never a listening port.
        program='''import os,socket,sys
fd=os.open('/dev/null',os.O_RDONLY)
owned_socket=None
print(fd,flush=True)
for command in sys.stdin:
    command=command.strip()
    if command=='exit': break
    if command=='close':
        if owned_socket is not None:
            owned_socket.close(); owned_socket=None
        else: os.close(fd)
    elif command=='open':
        assert os.open('/dev/null',os.O_RDONLY)==fd
    elif command=='socket':
        owned_socket=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        assert owned_socket.fileno()==fd
    else: raise AssertionError('unexpected synthetic control')
    print('ack',flush=True)
'''
        child=subprocess.Popen([sys.executable,'-B','-c',program],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,text=True,env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},close_fds=True,start_new_session=True)
        selector=selectors.DefaultSelector(); selector.register(child.stdout,selectors.EVENT_READ)
        def line():
            self.assertTrue(selector.select(2),'synthetic FD child did not acknowledge')
            value=child.stdout.readline()
            self.assertTrue(value,'synthetic FD child exited unexpectedly')
            return value.strip()
        try:
            fd=int(line())
            def command(value):
                child.stdin.write(value+'\n'); child.stdin.flush()
                self.assertEqual(line(),'ack')
            yield child,fd,command
        finally:
            selector.close()
            try:
                _out,error=child.communicate('exit\n',timeout=2)
            except subprocess.TimeoutExpired:
                child.kill(); _out,error=child.communicate(timeout=2)
            self.assertEqual(child.returncode,0,error)

    @contextlib.contextmanager
    def kernel_close_reuse(self, child, fd, command, repeated=False, replacement='open'):
        target='/proc/'+str(child.pid)+'/fd/'+str(fd)
        original_readlink=os.readlink
        events=[]
        def ordered(entry,*args,**kwargs):
            if os.fspath(entry)==target and (repeated or not events):
                command('close')
                try:
                    original_readlink(entry,*args,**kwargs)
                except FileNotFoundError as actual:
                    self.assertEqual(actual.errno,errno.ENOENT)
                    command(replacement)
                    # Real kernel ENOENT followed by a real reused symlink.
                    self.assertTrue(Path(target).is_symlink())
                    events.append('actual_kernel_closed_then_reused')
                    raise
                else:
                    raise AssertionError('kernel FD did not close before readlink')
            return original_readlink(entry,*args,**kwargs)
        with mock.patch.object(os,'readlink',side_effect=ordered):
            yield events

    def test_actual_fd_close_reuse_replays_exact_fa8_red_and_fixed_resample(self):
        fixed=low_level()
        raw=(RUNNER.parent/'verify-original-native-copy.py').read_bytes()
        old=historical_fa8(raw)
        with self.child() as (child,fd,command):
            old_proc=old['LinuxProc'](); old_task=old_proc.one(child.pid)
            with self.kernel_close_reuse(child,fd,command) as old_events:
                with self.assertRaisesRegex(old['Refused'],'owned_fd_readback_incomplete'):
                    old_proc.sample_task(old_task,observation_deadline=time.monotonic()+0.2)
            self.assertEqual(len(old_events),1)
            proc=fixed['LinuxProc'](); task=proc.one(child.pid)
            with self.kernel_close_reuse(child,fd,command) as current_events:
                observed=proc.sample_task(task,observation_deadline=time.monotonic()+0.2)
            self.assertEqual(len(current_events),1)
            self.assertEqual(observed['startTicks'],old_task['startTicks'])
            self.assertGreater(observed['rssBytes'],0)
            self.assertEqual(proc.last_task_observation['resolution'],'fd_recovered')
            self.assertEqual(proc.last_task_observation['observations'][0]['kind'],'fd_reused_during_read')
            self.assertTrue(all(item['before']['startTicks']==item['after']['startTicks']==task['startTicks']
                                for item in proc.last_task_observation['observations']))
        print('CADDY_FD_KERNEL_FA8_RED_REPRODUCED_FIXED_RESAMPLED_DATA_ONLY')

    def test_actual_persistent_churn_and_reopened_socket_remain_refused(self):
        low=low_level()
        with self.child() as (child,fd,command):
            proc=low['LinuxProc'](); task=proc.one(child.pid)
            began=time.monotonic()
            with self.kernel_close_reuse(child,fd,command,repeated=True) as events:
                with self.assertRaisesRegex(low['Refused'],'owned_fd_observation_unresolved'):
                    proc.sample_task(task,observation_deadline=began+0.2)
            self.assertGreater(len(events),1)
            self.assertLess(time.monotonic()-began,0.5)
            self.assertEqual(proc.last_task_observation['resolution'],'refused')
            self.assertTrue(all(item['smapsRSSKiB']>0 for item in proc.last_task_observation['observations']))
            with self.kernel_close_reuse(child,fd,command,replacement='socket') as socket_events:
                with self.assertRaisesRegex(low['Refused'],'owned_socket_present'):
                    proc.sample_task(task,observation_deadline=time.monotonic()+0.2)
            self.assertEqual(len(socket_events),1)
            self.assertEqual(proc.last_task_observation['failureCode'],'owned_socket_present')


if __name__=='__main__':
    unittest.main()
