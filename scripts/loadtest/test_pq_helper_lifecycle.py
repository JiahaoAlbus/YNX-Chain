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
from unittest import mock
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
    def test_original_helper_separates_real_go_fixture_bytes_without_changing_tail(self):
        fixture=Path(__file__).with_name('fixtures')/'live-request-observation-f76/component.combined.log'
        with tempfile.TemporaryDirectory() as temp:
            b=self.backend(Path(temp))
            reply=b.helper('observed',[sys.executable,'-I','-c',
                'import pathlib,sys;sys.stdout.buffer.write(pathlib.Path(sys.argv[1]).read_bytes())',str(fixture)],observe_request=True)
            self.assertFalse(reply['requestExecuted'])
            row=b.helper_timing_report()['records'][0]
            self.assertEqual(row['requestProcessReturnCode'],0)
            self.assertEqual(row['requestProcessID'],b.w.children[0]['process'].pid)
            self.assertEqual(row['requestStageObservation']['ordinaryOutputBytes'],135)
            self.assertFalse(row['requestStageObservation']['businessQualified'])
            self.assertIn('waitReturnedMonotonicNs',row)
            row['requestStageObservation']['status']='mutated-copy'
            self.assertEqual(b.helper_timing_report()['records'][0]['requestStageObservation']['status'],'INTERVALS_RETURNED')

    def test_diagnostic_capture_failure_does_not_replace_original_wait_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            b=self.backend(Path(temp),True)
            original=OriginalWaitFailure('original resource sample failure')
            b.w.wait=mock.Mock(side_effect=original)
            with mock.patch.object(driver.request_observation_readback,'split_original',side_effect=ValueError('unqualified trace')):
                with self.assertRaisesRegex(OriginalWaitFailure,'original resource sample failure') as context:
                    b.helper('failed-observed',[sys.executable,'-I','-c','import time;time.sleep(60)'],observe_request=True)
            self.assertIs(context.exception,original)
            row=b.helper_timing_report()['records'][0]
            self.assertEqual(row['errorType'],'OriginalWaitFailure')
            self.assertEqual(row['requestObservationCaptureStatus'],'UNQUALIFIED_ORIGINAL_LOG')
            self.assertIsNotNone(row['requestProcessReturnCode'])
            self.assertNotIn('waitReturnedMonotonicNs',row)
            self.assertEqual(b.helper_cleanup_debt,[])
            trace={}
            metadata_failure=SimpleNamespace(pid=1,poll=mock.Mock(side_effect=OSError('original process metadata unavailable')))
            self.assertIsNone(b.capture_request_observation('failed-observed',metadata_failure,True,trace))
            self.assertEqual(trace['requestObservationErrorType'],'OSError')
            metadata_failure.poll.reset_mock();trace={}
            self.assertIsNone(b.capture_request_observation('failed-observed',metadata_failure,False,trace))
            metadata_failure.poll.assert_not_called()
            self.assertEqual(trace['requestObservationCaptureStatus'],'ORIGINAL_PROCESS_UNREAPED')

    def test_request_argv_selects_splitter_and_other_modes_cannot_inherit_flag(self):
        with tempfile.TemporaryDirectory() as temp:
            b=self.backend(Path(temp));b.c.bins=Path('/original/bin')
            b.c.measurements=SimpleNamespace(record=mock.Mock())
            original=dict(original='returned')
            with mock.patch.object(b,'helper',return_value=original) as helper:
                self.assertIs(b.call('request',['live-materials','request','--observe-stages']),original)
                self.assertTrue(helper.call_args.kwargs['observe_request'])
                self.assertEqual(helper.call_args.args[1].count('--timings'),1)
                self.assertEqual(helper.call_args.args[1].count('--observe-stages'),1)
                b.call('plain',['live-materials','request'])
                self.assertNotIn('observe_request',helper.call_args.kwargs)
                for args in [['live-materials','result','--observe-stages'],['live-materials','request','--observe-stages','--observe-stages']]:
                    before=helper.call_count
                    with self.assertRaises(RuntimeError):b.call('invalid',args)
                    self.assertEqual(helper.call_count,before)

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
    def test_stop_during_launch_resource_guard_never_starts_a_new_helper(self):
        stop = threading.Event()
        window = object.__new__(driver.lab.Window)
        window.lock = threading.Lock()
        window.sample = stop.set
        with mock.patch.object(driver.lab.subprocess, 'Popen') as child:
            with self.assertRaisesRegex(RuntimeError, 'cancelled before launch'):
                window.launch('canceled-resource-guard', ['unused'], thread_safe=True, stop=stop)
            child.assert_not_called()

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
