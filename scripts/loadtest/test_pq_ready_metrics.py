"""703 transport/metrics adapter controls only; no custody, signing or proof."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('ready_metrics_adapter',Path(__file__).with_name('pq-independent-load.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)

def metrics(**stages):
    return {'version':'YNX-PQ-LAB-CALLEE-ELAPSED/v1','clock':'monotonic_elapsed_wall_ns','intervalsOverlap':True,'stages':{k:{'calls':1,'elapsedNs':v} for k,v in stages.items()}}

def ready():
    # Protocol-shaped PUBLIC unit metadata, not a real custody-ready claim.
    return {'version':'YNX-PQ-LAB-SENDER-READY/v1','status':'original_custody_opened_imported_writer_lease_held','ownerIndex':4,'planSHA256':'a'*64,'workloadSHA256':'b'*64,'startupElapsedNs':100,'timings':metrics(open=80,kdf=50),'syntheticOnly':True,'authorityGranted':False,'signed':False,'nonceReserved':False}

class ReadyMetricsAdapterControls(unittest.TestCase):
    def session(self,root,reply):
        (root/'public').mkdir();path=root/'public/load-sender-4.log';path.write_text(json.dumps(reply)+'\n')
        ceremony=SimpleNamespace(w=SimpleNamespace(work=root),pin='a'*64,workload_pin='b'*64,measurements=d.CalleeMeasurements(500,8))
        session=object.__new__(d.SenderSession);session.c=ceremony;session.owner=4;session.name='load-sender-4';session.offset=0;session.partial=b'';session.ready=None;session.launched_ns=time.monotonic_ns();session.path=path;session.proc=SimpleNamespace(pid=123,stdin=io.BytesIO(),poll=lambda:None)
        return session
    def test_ready_consumed_without_command_or_business_and_first_reply_is_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            s=self.session(Path(temp),ready());s.wait_ready(threading.Event(),time.monotonic()+1,lambda:None)
            self.assertEqual(s.proc.stdin.getvalue(),b'');self.assertFalse(s.ready['signed']);self.assertFalse(s.ready['nonceReserved'])
            snapshot=s.c.measurements.report();self.assertEqual(snapshot['groups']['startup']['calleeElapsed']['observed'],1)
            self.assertEqual(snapshot['groups']['sign']['calleeElapsed']['observed'],0)
            reply={'version':'YNX-PQ-LAB-SENDER-REPLY/v1','code':'REJECTED','result':None,'calleeElapsedNs':30,'timings':metrics(current=20),'startupElapsedNs':100,'startupTimings':ready()['timings']}
            with s.path.open('a') as out:out.write(json.dumps(reply)+'\n')
            command=d.normal.sender_command_data('sign',{'operationId':'PUBLIC-unit-command'})
            self.assertEqual(s.exchange(command,Path(temp)/'public/sign.json',threading.Event())['code'],'REJECTED')
            report=s.c.measurements.report();self.assertEqual(report['groups']['sign']['calleeElapsed']['totalNs'],30)
            self.assertEqual(report['groups']['startup']['calleeElapsed']['totalNs'],100)
            self.assertEqual(report['groups']['sign']['outcomes'],{'REJECTED':1})
    def test_unready_or_wrong_scope_can_never_send_command(self):
        for field,value in [('authorityGranted',True),('signed',True),('nonceReserved',True),('ownerIndex',5),('planSHA256','c'*64),('workloadSHA256','c'*64)]:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temp:
                reply=ready();reply[field]=value;s=self.session(Path(temp),reply)
                with self.assertRaisesRegex(RuntimeError,'DATA-ready'):s.wait_ready(threading.Event(),time.monotonic()+1,lambda:None)
                with self.assertRaisesRegex(RuntimeError,'DATA-ready required'):s.exchange({},Path(temp)/'unused',threading.Event())
                self.assertEqual(s.proc.stdin.getvalue(),b'');self.assertTrue((Path(temp)/'public/load-sender-4-ready.json').exists())
    def test_ready_cutoff_does_not_consume_or_write_a_command(self):
        with tempfile.TemporaryDirectory() as temp:
            s=self.session(Path(temp),ready())
            with self.assertRaisesRegex(RuntimeError,'cutoff'):s.wait_ready(threading.Event(),time.monotonic()-1,lambda:None)
            self.assertIsNone(s.ready);self.assertEqual(s.offset,0);self.assertEqual(s.proc.stdin.getvalue(),b'')
    def test_nested_spans_and_partial_denominators_are_not_qualification(self):
        collector=d.CalleeMeasurements(2,1)
        collector.record('startup',4,ready(),owner=4)
        collector.record('sign','op1',{'code':'UNKNOWN','calleeElapsedNs':100,'timings':metrics(total=90,child=80),'startupElapsedNs':100,'startupTimings':ready()['timings']})
        report=collector.report();g=report['groups']['sign']
        self.assertEqual(g['calleeElapsed']['totalNs'],100);self.assertEqual(g['stages']['total']['totalNs'],90)
        self.assertIsNone(g['calleeElapsed']['fullDemandPercentilesMs']['p95'])
        self.assertEqual(g['calleeElapsed']['censoredOrNotReached'],1)
        with self.assertRaisesRegex(RuntimeError,'duplicate'):collector.record('sign','op1',{'calleeElapsedNs':100,'timings':metrics(total=90)})
        collector.record('sign','op2',{'code':'ORIGINAL_SAVED','calleeElapsedNs':200,'timings':metrics(total=190)})
        g=collector.report()['groups']['sign'];self.assertEqual(g['calleeElapsed']['fullDemandPercentilesMs']['p95'],.0002)
        self.assertIsNone(g['stages']['child']['fullDemandPercentilesMs']['p95'])
        self.assertNotIn('qualified',report);self.assertTrue(report['intervalsOverlap'])
    def test_invalid_timings_or_static_cache_claims_are_refused(self):
        for snapshot in [dict(metrics(),clock='wall_absolute_ns'),dict(metrics(),intervalsOverlap=False),metrics(total=-1)]:
            with self.assertRaises(RuntimeError):d.CalleeMeasurements(1,1).record('sign','x',{'calleeElapsedNs':1,'timings':snapshot})
        cache={'Scope':'YNX-PQ-LAB-PUBLIC-STATIC-MATH/v1','Entries':1,'HeldFiles':1,'OriginalBytes':(32<<20)+1,'Hits':0,'Misses':1,'Bypasses':0,'Closed':False}
        with self.assertRaisesRegex(RuntimeError,'bound'):d.CalleeMeasurements(1,1).record('sign','x',{'calleeElapsedNs':1,'timings':metrics(),'staticCache':cache})
    def test_pool_ready_waits_all_eight_before_arrival_without_signing(self):
        b=object.__new__(d.NormalBackend);b.c=SimpleNamespace(proof_timeout=1);b.stop_event=threading.Event();b.pool_started_ns=time.monotonic_ns();order=[]
        def wait_ready(stop,deadline,check):order.append('DATA-ready');check();return {'signed':False,'nonceReserved':False}
        b.sessions={i:SimpleNamespace(wait_ready=wait_ready) for i in range(8)}
        result=b.prepare(lambda:None);self.assertEqual(len(order),8);self.assertEqual(result['readyCount'],8)
        self.assertFalse(result['loadClockStarted']);self.assertFalse(result['signed']);self.assertFalse(result['nonceReserved'])
    def test_live_cli_timings_use_actual_uppercase_publication_and_lowercase_result(self):
        b=object.__new__(d.NormalBackend);b.c=SimpleNamespace(bins=Path('/PUBLIC-unit-bin'),measurements=d.CalleeMeasurements(500,8));commands=[]
        def helper(name,command,stdin):
            commands.append(command)
            if 'request' in command:return {'Version':'YNX-PQ-LAB-LIVE-MATERIALS-PUBLICATION/v1','Outcome':'request_published','calleeElapsedNs':20,'timings':metrics(policy=10)}
            return {'version':'YNX-PQ-LAB-LIVE-MATERIALS-RESULT/v1','outcome':'CONTROL_ONLY','calleeElapsedNs':30,'timings':metrics(policy=15)}
        b.helper=helper
        b.call('load-1-live-publish',['live-materials','request','--synthetic'])
        b.call('load-1-live-result',['live-materials','result','--synthetic'])
        self.assertTrue(all(c.count('--timings')==1 for c in commands))
        report=b.c.measurements.report()['groups']
        self.assertEqual(report['live_publish']['outcomes'],{'request_published':1})
        self.assertEqual(report['live_result']['calleeElapsed']['totalNs'],30)
        self.assertIsNone(report['live_result']['calleeElapsed']['fullDemandPercentilesMs']['p95'])
    def test_old_source_cannot_silently_use_new_ready_contract(self):
        args=SimpleNamespace(mode='online',rate=100,accounts=8,per_account=63,seconds=5,tail_seconds=30,proof_timeout=30,source='/not-used',commit='7593d691bafa6e7e5bb40511464aed27a41b416d')
        with mock.patch.object(d.lab,'check_source') as checked:
            with self.assertRaisesRegex(RuntimeError,'old75'):d.run(args)
            checked.assert_not_called()

if __name__=='__main__':unittest.main()
