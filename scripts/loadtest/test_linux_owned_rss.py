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


def stat_line(state="S",ticks=100):
    fields=[state]+["0"]*45;fields[1]="1";fields[2]="42";fields[17]="2";fields[19]=str(ticks)
    return ("42 (owned compiler) "+" ".join(fields)).encode()


class OwnedRSSControls(unittest.TestCase):
    def read(self,values):
        with mock.patch.object(lab.guard,"bounded",side_effect=values):
            return lab.owned_rss(42,dict(startTicks=100))

    def test_attempt2_esrch_then_proved_gone_is_not_a_fake_zero_live_sample(self):
        self.assertIsNone(self.read([ProcessLookupError(errno.ESRCH,"exited"),FileNotFoundError(errno.ENOENT,"gone")]))
        self.assertIsNone(self.read([FileNotFoundError(errno.ENOENT,"exited"),ProcessLookupError(errno.ESRCH,"gone")]))

    def test_same_identity_zombie_has_no_live_rss(self):
        self.assertEqual(self.read([ProcessLookupError(errno.ESRCH,"exited"),stat_line("Z")]),0)

    def test_live_unreadable_and_recycled_pids_fail_closed(self):
        for state,ticks in (("S",100),("Z",101),("S",101)):
            with self.assertRaises(RuntimeError):self.read([ProcessLookupError(errno.ESRCH,"raced"),stat_line(state,ticks)])

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
        self.assertEqual(events,[dict(pid=42,startTicks=100,reason="second-stat-proved-gone",rssError=errno.ESRCH,statError=errno.ENOENT)])

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


if __name__=="__main__":unittest.main()
