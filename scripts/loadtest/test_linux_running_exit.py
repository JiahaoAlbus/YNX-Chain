"""Run41266674073 R/ESRCH first cause; never infer exit from task state."""
import errno
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('running_exit',Path(__file__).with_name('consensus-linux-cohort.py'))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)

def row(ticks=21607):
    fields=['R']+['0']*45;fields[17]='1';fields[19]=str(ticks)
    return ('6180 (original exiting descendant) '+' '.join(fields)).encode()

class RunningExitControls(unittest.TestCase):
    def test_original_six_R_esrch_without_kernel_exit_remains_failure(self):
        events=[]
        with mock.patch.object(lab.guard,'bounded',side_effect=[ProcessLookupError(errno.ESRCH,'mm unavailable'),row()]*6),mock.patch.object(lab,'process_group_exit_probe',return_value={'state':'not-exited'}) as probe,mock.patch.object(lab,'same_process_rss_alternative',return_value=None),mock.patch.object(lab.time,'sleep'):
            with self.assertRaisesRegex(RuntimeError,'RSS unreadable.*6180.*21607'):lab.owned_rss(6180,{'startTicks':21607},events.append)
        self.assertEqual(probe.call_count,6);self.assertEqual(events,[])
    def test_R_requires_original_pidfd_exit_proof_and_preserves_raw_state(self):
        proof={'state':'group-exited','pid':6180,'startTicks':21607,'pidfdFlags':0,'pollMask':1,'firstLeaderState':'R','nonConsuming':True};events=[]
        with mock.patch.object(lab.guard,'bounded',side_effect=[ProcessLookupError(errno.ESRCH,'mm unavailable'),row()]),mock.patch.object(lab,'process_group_exit_probe',return_value=proof):
            self.assertEqual(lab.owned_rss(6180,{'startTicks':21607},events.append),0)
        self.assertEqual(events[0]['groupExitProof'],proof)
        with mock.patch.object(lab.guard,'bounded',side_effect=[ProcessLookupError(errno.ESRCH,'mm unavailable'),row(999)]),mock.patch.object(lab,'process_group_exit_probe') as probe:
            with self.assertRaisesRegex(RuntimeError,'identity changed'):lab.owned_rss(6180,{'startTicks':21607})
            probe.assert_not_called()
    def test_unready_running_process_still_charges_real_rss(self):
        events=[]
        with mock.patch.object(lab.guard,'bounded',side_effect=[ProcessLookupError(errno.ESRCH,'mm unavailable'),row()]),mock.patch.object(lab,'process_group_exit_probe',return_value={'state':'not-exited'}),mock.patch.object(lab,'same_process_rss_alternative',return_value=(8192,{'retired':False,'sampleKind':'same-thread-group-smaps'})):
            self.assertEqual(lab.owned_rss(6180,{'startTicks':21607},fallback=events.append),8192)
        self.assertFalse(events[0]['retired'])
    @unittest.skipUnless(sys.platform=='linux' and hasattr(os,'pidfd_open'),'actual process-wide kernel pidfd requires CORE Linux')
    def test_actual_kernel_exit_readiness_not_stale_R_controls_retirement(self):
        p=subprocess.Popen([sys.executable,'-I','-c','import time; time.sleep(60)'])
        original=lab.guard.bounded;root=Path('/proc')/str(p.pid)
        try:
            raw=original(root/'stat');before=lab.guard.parse_stat(raw,p.pid)
            # Hold only the state text at the exact observed identity. The
            # pidfd open, fdinfo binding and kernel poll remain entirely real.
            fields=raw.split(b') ',1);tail=fields[1].split();tail[0]=b'R';stale=fields[0]+b') '+b' '.join(tail)
            def kernel(path,limit=65536):
                if path==root/'smaps_rollup':raise ProcessLookupError(errno.ESRCH,'inject only missing mm read')
                if path==root/'stat':return stale
                return original(path,limit)
            with mock.patch.object(lab.guard,'bounded',side_effect=kernel),mock.patch.object(lab,'same_process_rss_alternative',return_value=None):
                self.assertEqual(lab.process_group_exit_probe(p.pid,before)['state'],'not-exited')
                with self.assertRaisesRegex(RuntimeError,'RSS unreadable'):lab.owned_rss(p.pid,before)
                p.terminate();events=[]
                # No wait/poll/reap before the actual process-wide pidfd proof.
                self.assertEqual(lab.owned_rss(p.pid,before,events.append),0)
                proof=events[0]['groupExitProof'];self.assertEqual(proof['state'],'group-exited')
                self.assertEqual(proof['pidfdFlags'],0);self.assertTrue(proof['pollMask']&1)
                self.assertEqual(proof['firstLeaderState'],'R');self.assertTrue(proof['nonConsuming'])
                self.assertIsNone(p.returncode)
            self.assertEqual(p.wait(timeout=2),-15)
        finally:
            if p.poll() is None:p.kill()
            p.wait(timeout=2)

if __name__=='__main__':unittest.main()
