"""Regression for actual attempt2 ESRCH; resource controls, not node evidence."""
import errno
import importlib.util
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location("cohort_rss",Path(__file__).with_name("consensus-linux-cohort.py"))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)


def stat_line(state="S",ticks=100,threads=2,pid=42):
    fields=[state]+["0"]*45;fields[1]="1";fields[2]="42";fields[17]=str(threads);fields[19]=str(ticks)
    return (str(pid)+" (owned compiler) "+" ".join(fields)).encode()


class OwnedRSSControls(unittest.TestCase):
    def read(self,values):
        with mock.patch.object(lab.guard,"bounded",side_effect=values), mock.patch.object(lab.time,"sleep"),mock.patch.object(lab,"same_process_rss_alternative",return_value=None):
            return lab.owned_rss(42,dict(startTicks=100))

    def test_attempt2_esrch_then_proved_gone_is_not_a_fake_zero_live_sample(self):
        self.assertIsNone(self.read([ProcessLookupError(errno.ESRCH,"exited"),FileNotFoundError(errno.ENOENT,"gone")]))
        self.assertIsNone(self.read([FileNotFoundError(errno.ENOENT,"exited"),ProcessLookupError(errno.ESRCH,"gone")]))

    def test_same_identity_zombie_has_no_live_rss(self):
        self.assertEqual(self.read([ProcessLookupError(errno.ESRCH,"exited"),stat_line("Z",threads=1)]),0)

    def alternative(self,vm=None,tgid=42,tid_ticks_after=None):
        calls={};events=[]
        def kernel(path,limit=65536):
            name=str(path);calls[name]=calls.get(name,0)+1
            if name.endswith('smaps_rollup'):
                if '/task/43/' in name:return b'Rss: 13 kB\n'
                raise ProcessLookupError(errno.ESRCH,'original mm unavailable')
            if name.endswith('/stat'):
                pid=43 if '/task/43/' in name else 42
                ticks=200 if pid==43 else 100
                if pid==43 and tid_ticks_after is not None and calls[name]>1:ticks=tid_ticks_after
                return stat_line('R',ticks=ticks,pid=pid)
            if name.endswith('/status'):
                pid=43 if '/task/43/' in name else 42
                return ('Tgid: %d\nPid: %d\n'%(tgid,pid)+('VmSize: %d kB\n'%vm if vm is not None else '')).encode()
            raise AssertionError(name)
        with mock.patch.object(lab.guard,'bounded',side_effect=kernel),mock.patch.object(Path,'iterdir',return_value=iter([Path('/proc/42/task/43')])):
            value=lab.owned_rss(42,dict(startTicks=100),fallback=events.append)
        return value,events

    def test_original_live_R_esrch_recovers_real_same_thread_group_mm(self):
        value,events=self.alternative()
        self.assertEqual(value,13*1024);self.assertEqual(events[0]['tid'],43)
        self.assertEqual(events[0]['sampleKind'],'same-thread-group-smaps');self.assertFalse(events[0]['retired'])

    def test_live_mm_failure_uses_explicit_conservative_virtual_bound_not_zero(self):
        value,events=self.alternative(vm=8192)
        self.assertEqual(value,8192*1024)
        self.assertEqual(events[0]['sampleKind'],'same-thread-group-VmSize-upper-bound')
        self.assertEqual(events[0]['originalRSSKernelError'],errno.ESRCH)
        self.assertFalse(events[0]['retired'])

    def test_alternative_other_thread_group_or_reused_thread_is_fatal(self):
        with self.assertRaisesRegex(RuntimeError,'thread group differs'):self.alternative(tgid=99)
        with self.assertRaisesRegex(RuntimeError,'member identity changed'):self.alternative(tid_ticks_after=201)

    def test_multi_thread_zombie_without_mm_proof_never_becomes_zero(self):
        with self.assertRaisesRegex(RuntimeError,'RSS unreadable'):
            self.read([ProcessLookupError(errno.ESRCH,'mm'),stat_line('Z',threads=2)]*6)

    def test_conservative_bound_still_trips_original_aggregate_cap(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'.private').mkdir();(root/'public').mkdir()
            with mock.patch.object(lab.os,'sched_getaffinity',return_value={0,1},create=True),mock.patch.object(lab.os,'sched_setaffinity',create=True):window=lab.Window(root,root)
            def fallback_read(pid,before,retired,fallback):
                fallback(dict(pid=pid,startTicks=100,sampleKind='same-thread-group-VmSize-upper-bound',sampledBytes=5<<30,retired=False));return 5<<30
            with mock.patch.object(lab.guard,'proc_inventory',return_value=({42:dict(startTicks=100,state='R')},[])),mock.patch.object(lab.guard,'owned_set',return_value={42}),mock.patch.object(lab,'owned_rss',side_effect=fallback_read):
                with self.assertRaisesRegex(RuntimeError,'RSS exceeded 4GiB'):window.sample()
            self.assertEqual(window.peak_rss,5<<30);self.assertFalse(window.rss_fallback_samples[0]['retired'])

    @unittest.skipUnless(sys.platform=='linux','actual owned Linux PID/Tgid/smaps proof requires sole CORE job')
    def test_actual_owned_thread_group_read_after_injected_leader_esrch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'.private').mkdir();(root/'public').mkdir();window=lab.Window(Path(__file__).resolve().parents[2],root)
            ready=root/'.private/ready'
            script="import pathlib,sys,time; b=bytearray(8<<20); pathlib.Path(sys.argv[1]).write_text('ready'); time.sleep(10)"
            proc=window.launch('real-owned-mm',[sys.executable,'-I','-c',script,str(ready)])
            try:
                until=lab.time.monotonic()+3
                while not ready.exists() and lab.time.monotonic()<until:lab.time.sleep(.01)
                self.assertTrue(ready.exists())
                before=lab.guard.parse_stat(lab.guard.bounded(Path('/proc')/str(proc.pid)/'stat'),proc.pid)
                original=lab.guard.bounded;events=[]
                def read_kernel(path,limit=65536):
                    if path==Path('/proc')/str(proc.pid)/'smaps_rollup':raise ProcessLookupError(errno.ESRCH,'control injection only at leader rollup')
                    return original(path,limit)
                with mock.patch.object(lab.guard,'bounded',side_effect=read_kernel):value=lab.owned_rss(proc.pid,before,fallback=events.append)
                self.assertGreater(value,0);self.assertEqual(events[0]['sampleKind'],'same-thread-group-smaps');self.assertFalse(events[0]['retired'])
            finally:self.assertTrue(window.stop())

    def test_live_unreadable_and_recycled_pids_fail_closed(self):
        for state,ticks in (("S",100),("Z",101),("S",101)):
            attempts=6 if ticks==100 else 1
            with self.assertRaises(RuntimeError):self.read([ProcessLookupError(errno.ESRCH,"raced"),stat_line(state,ticks)]*attempts)

    def test_permissions_or_unknown_kernel_errors_are_not_missing_samples(self):
        with self.assertRaises(PermissionError):self.read([PermissionError(errno.EACCES,"denied")])
        with self.assertRaises(PermissionError):self.read([ProcessLookupError(errno.ESRCH,"raced"),PermissionError(errno.EACCES,"denied")])

    def test_real_sample_keeps_original_identity_and_bytes(self):
        self.assertEqual(self.read([b"Rss: 7 kB\n",stat_line()]),7168)
        with self.assertRaises(RuntimeError):self.read([b"Rss: 7 kB\n",stat_line(ticks=101)])

    def test_retired_evidence_keeps_original_pid_starttime_and_kernel_errors(self):
        events=[]
        with mock.patch.object(lab.guard,"bounded",side_effect=[ProcessLookupError(errno.ESRCH,"exited"),FileNotFoundError(errno.ENOENT,"gone")]):
            self.assertIsNone(lab.owned_rss(42,dict(startTicks=100),events.append))
        self.assertEqual(events,[dict(pid=42,startTicks=100,reason="second-stat-proved-gone",rssError=errno.ESRCH,statError=errno.ENOENT,sampleAttempts=1)])

    def test_transient_same_identity_must_recover_real_rss_or_prove_exit(self):
        transient=[ProcessLookupError(errno.ESRCH,"transition"),stat_line("S")]
        self.assertEqual(self.read(transient+[b"Rss: 9 kB\n",stat_line()]),9216)
        self.assertIsNone(self.read(transient+[ProcessLookupError(errno.ESRCH,"transition"),FileNotFoundError(errno.ENOENT,"gone")]))
        with self.assertRaisesRegex(RuntimeError,'"pid":42.*"startTicks":100.*"attempt":6'):
            self.read(transient*6)

    @unittest.skipUnless(sys.platform=="linux","real Linux child lifecycle; not a fake node")
    def test_actual_nonzero_exit_and_cleanup_signal_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/".private").mkdir();(root/"public").mkdir()
            window=lab.Window(Path(__file__).resolve().parents[2],root)
            failed=window.launch("actual-exit-7",[sys.executable,"-c","raise SystemExit(7)"])
            window.wait(failed,allow_failure=True)
            sleeping=window.launch("actual-cleanup-signal",[sys.executable,"-c","import time; time.sleep(30)"])
            self.assertTrue(window.stop())
            rows={row["name"]:row for row in window.process_receipt()}
            self.assertEqual(rows["actual-exit-7"]["exitCode"],7)
            self.assertIsNone(rows["actual-exit-7"]["signal"])
            self.assertEqual(rows["actual-cleanup-signal"]["signal"],signal.SIGTERM)
            self.assertTrue(all(row["exited"] and row["pid"]>0 and row["startTicks"] is not None for row in rows.values()))

    @unittest.skipUnless(sys.platform=="linux","actual short-lived compiler-like child churn requires Linux")
    def test_actual_short_lived_descendants_do_not_create_fake_zero_samples(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/".private").mkdir();(root/"public").mkdir()
            window=lab.Window(Path(__file__).resolve().parents[2],root)
            try:
                for i in range(8):
                    # Process lifecycle only. These are never validators or tx.
                    proc=window.launch("short-lived-wave-%d"%i,["/bin/sh","-c","i=0; while [ $i -lt 32 ]; do /usr/bin/true; i=$((i+1)); done"])
                    self.assertEqual(window.wait(proc),0)
            finally:self.assertTrue(window.stop())
            self.assertTrue(all(row["exitCode"]==0 for row in window.process_receipt()))


if __name__=="__main__":unittest.main()
