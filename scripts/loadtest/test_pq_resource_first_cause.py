"""Original resource failure propagation; simulated proc/RSS, no node/pressure."""
import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

driver=module('pq-independent-load.py')
resource=module('test_resource_guard_sampling.py')
staged_controls=module('test_pq_staged_independent_scheduler.py')


class ResourceFirstCauseControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.window=resource.ResourceGuardSamplingControls().window(Path(self.temp.name).resolve())
        self.stop=threading.Event();self.lab=resource.lab
        patch=mock.patch.object(self.lab.guard,'proc_inventory',return_value=(resource.ResourceGuardSamplingControls().rows(),[]))
        patch.start();self.addCleanup(patch.stop)
    def monitor(self):
        value=driver.Monitor(self.window,self.stop);self.addCleanup(value.close);return value
    def in_worker(self,callback):
        caught=[]
        def work():
            try:callback()
            except BaseException as error:caught.append(error)
        worker=threading.Thread(target=work,name='original-business-sampler-control')
        worker.start();worker.join(1);self.assertFalse(worker.is_alive());return caught

    def test_non_monitor_sample_latches_short_rss_peak_even_after_it_disappears(self):
        monitor=self.monitor()
        with mock.patch.object(self.lab,'owned_rss',return_value=self.lab.CAPS['rssBytes']+1):errors=self.in_worker(self.window.sample)
        self.assertEqual(len(errors),1);self.assertEqual(str(errors[0]),'owned RSS exceeded 4GiB')
        self.assertTrue(self.stop.is_set())
        with mock.patch.object(self.lab,'owned_rss',return_value=1):self.window.sample()
        with self.assertRaisesRegex(RuntimeError,'owned RSS exceeded 4GiB'):monitor.check()
        failure=monitor.failure_snapshot()
        self.assertEqual(failure['originalError'],'owned RSS exceeded 4GiB')
        self.assertEqual(failure['callerThread'],'original-business-sampler-control')
        self.assertIs(type(failure['observedMonotonicNs']),int)

    def test_staged_late_unknown_keeps_original_resource_first_cause_and_pending(self):
        # A previously captured bound sample callback must still be covered.
        # Delay UNKNOWN until backend.stop to reproduce the real late-only
        # evidence with firstCause=null, without running an original transaction.
        captured=self.window.sample;monitor=self.monitor();release=threading.Event();outer=self
        class Backend(staged_controls.StructuralBackend):
            def publish(self,row,account,notify,stop):
                super().publish(row,account,notify,stop)
                try:
                    with mock.patch.object(outer.lab,'owned_rss',return_value=outer.lab.CAPS['rssBytes']+1):captured()
                except BaseException:
                    release.wait(1);raise
            def stop(self):self.stop_calls+=1;release.set()
        backend=Backend();plan=staged_controls.plan(count=3,accounts=1,tail_ns=60_000_000)
        result=staged_controls.staged.run(plan,backend,lambda event:None,monitor.check,self.stop)
        self.assertEqual(result['firstCause'],'owned RSS exceeded 4GiB')
        self.assertEqual(len(backend.calls['publish']),1);self.assertEqual(result['qualified'],0)
        self.assertEqual((result['accountState'][0]['pending'],result['accountState'][0]['nextNonce']),(0,2))
        self.assertTrue(any(event.get('error')=='owned RSS exceeded 4GiB' for event in result['pipeline']['lateEvidence']))
        self.assertLessEqual(monitor.failure_snapshot()['observedMonotonicNs'],int(result['originMonotonicNs'])+result['observationCutoffNs'])

    def test_secondary_monitor_failure_cannot_overwrite_first_original_exception(self):
        monitor=self.monitor();first=RuntimeError('original owned RSS read failure');second=RuntimeError('secondary guard failure')
        with mock.patch.object(self.lab,'owned_rss',side_effect=first):caught=self.in_worker(self.window.sample)
        self.assertIs(caught[0],first)
        with mock.patch.object(self.lab,'owned_rss',side_effect=second):monitor.loop()
        self.assertEqual(monitor.error,str(first))
        with self.assertRaisesRegex(RuntimeError,'original owned RSS read failure'):monitor.check()

    def test_guard_refusal_stops_a_later_healthy_launch_before_popen(self):
        monitor=self.monitor()
        with mock.patch.object(self.lab,'owned_rss',return_value=self.lab.CAPS['rssBytes']+1),mock.patch.object(self.lab.subprocess,'Popen') as popen:
            with self.assertRaisesRegex(RuntimeError,'owned RSS exceeded'):self.window.launch('original-refused',['CONTROL'],stop=self.stop)
            popen.assert_not_called()
        with mock.patch.object(self.lab,'owned_rss',return_value=1),mock.patch.object(self.lab.subprocess,'Popen') as popen:
            with self.assertRaisesRegex(RuntimeError,'cancelled before launch'):self.window.launch('no-new-callee',['CONTROL'],stop=self.stop)
            popen.assert_not_called()
        with self.assertRaisesRegex(RuntimeError,'owned RSS exceeded'):monitor.check()


if __name__=='__main__':unittest.main(verbosity=2)
