"""Actual local child concurrency/cleanup controls; no business result fixtures."""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location('helper_driver',Path(__file__).with_name('pq-independent-load.py'))
driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)

class OriginalWaitFailure(RuntimeError):pass

class ChildWindow:
    def __init__(self,root,fail_wait=False):
        self.work=root;self.lock=threading.Lock();self.children=[];self.logs=[];self.peak=0;self.fail_wait=fail_wait
    def launch(self,name,command,**kwargs):
        with self.lock:
            log=(self.work/'public'/(name+'.log')).open('xb');self.logs.append(log)
            proc=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
            self.children.append(dict(name=name,process=proc))
            self.peak=max(self.peak,sum(c['process'].poll() is None for c in self.children))
            return proc
    def wait(self,proc):
        if self.fail_wait:raise OriginalWaitFailure('original resource sample failure')
        if proc.wait(timeout=5):raise RuntimeError('original helper exit failure')
    def retire_log(self,proc):pass
    def close(self):
        for c in self.children:
            if c['process'].poll() is None:c['process'].kill()
            c['process'].wait(timeout=2)
        for log in self.logs:log.close()

class HelperLifecycleControls(unittest.TestCase):
    def backend(self,root,fail_wait=False):
        (root/'public').mkdir()
        ceremony=SimpleNamespace(w=ChildWindow(root,fail_wait),live=[{} for _ in range(4)],mode='pre-signed',workload={'transactions':[]})
        backend=driver.NormalBackend(ceremony,[],threading.Event())
        self.addCleanup(ceremony.w.close)
        return backend
    def test_four_real_lanes_share_three_slots_through_process_exit(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);b=self.backend(root)
            script="import json,pathlib,sys,time; pathlib.Path(sys.argv[1]).touch();\nwhile not pathlib.Path(sys.argv[2]).exists(): time.sleep(.01)\nprint(json.dumps({'childExit':True}))"
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                jobs=[pool.submit(b.helper,'lane-'+str(i),[sys.executable,'-I','-c',script,str(root/('ready-'+str(i))),str(root/'release')]) for i in range(4)]
                try:
                    until=time.monotonic()+3
                    while len(list(root.glob('ready-*')))<3 and time.monotonic()<until:time.sleep(.01)
                    self.assertEqual(len(list(root.glob('ready-*'))),3)
                    self.assertEqual(len(b.w.children),3)
                    self.assertEqual(b.w.peak,3)
                finally:(root/'release').touch()
                self.assertEqual([j.result(timeout=5) for j in jobs],[{'childExit':True}]*4)
            self.assertEqual(len(b.w.children),4);self.assertEqual(b.w.peak,3)
            report=b.helper_timing_report();self.assertEqual((report['attempted'],report['completed'],report['inFlight'],report['retained']),(4,4,0,4))
            for row in report['records']:
                times=[row[key] for key in ('requestedMonotonicNs','slotAcquiredMonotonicNs','launchRequestedMonotonicNs','launchReturnedMonotonicNs','waitReturnedMonotonicNs','cleanupFinishedMonotonicNs','returnedMonotonicNs')]
                self.assertEqual(times,sorted(times));self.assertNotIn('errorType',row)
            report['records'][0]['name']='mutated-copy'
            self.assertNotEqual(b.helper_timing_report()['records'][0]['name'],'mutated-copy')
            self.assertTrue(all(c['process'].poll()==0 for c in b.w.children))
            for _ in range(3):self.assertTrue(b.helper_slots.acquire(blocking=False))
            self.assertFalse(b.helper_slots.acquire(blocking=False))
    def test_cancelled_queued_helper_never_launches_and_does_not_steal_slot(self):
        with tempfile.TemporaryDirectory() as temp:
            b=self.backend(Path(temp))
            for _ in range(3):b.helper_slots.acquire()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                job=pool.submit(b.helper,'cancelled',[sys.executable,'-c','pass'])
                b.stop_event.set()
                with self.assertRaisesRegex(RuntimeError,'interrupted|cancelled'):job.result(timeout=2)
            self.assertEqual(b.w.children,[])
            row=b.helper_timing_report()['records'][0];self.assertEqual(row['errorType'],'RuntimeError')
            self.assertNotIn('launchRequestedMonotonicNs',row);self.assertNotIn('slotAcquiredMonotonicNs',row)
            self.assertGreaterEqual(row['returnedMonotonicNs'],row['requestedMonotonicNs'])
            for _ in range(3):b.helper_slots.release()
            with self.assertRaises(ValueError):b.helper_slots.release()
    def test_real_wait_failure_reaps_child_preserves_firstcause_and_unknown(self):
        with tempfile.TemporaryDirectory() as temp:
            b=self.backend(Path(temp),True)
            with self.assertRaisesRegex(OriginalWaitFailure,'original resource sample failure'):
                b.helper('failed',[sys.executable,'-I','-c','import time; time.sleep(60)'])
            self.assertTrue(b.stop_event.is_set());self.assertIsNotNone(b.w.children[0]['process'].poll())
            self.assertEqual(b.helper_cleanup_debt,[])
            row=b.helper_timing_report()['records'][0];self.assertEqual(row['errorType'],'OriginalWaitFailure')
            self.assertNotIn('waitReturnedMonotonicNs',row);self.assertIn('cleanupFinishedMonotonicNs',row)
            for _ in range(3):self.assertTrue(b.helper_slots.acquire(blocking=False))
            with self.assertRaisesRegex(RuntimeError,'interrupted'):b.helper('no-retry',[sys.executable,'-c','pass'])
            self.assertEqual(len(b.w.children),1)

if __name__=='__main__':unittest.main()
