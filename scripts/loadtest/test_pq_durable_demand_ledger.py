"""Bounded accounting controls; synthetic events are never chain evidence."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import tracemalloc
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('durable_controls',Path(__file__).with_name('pq-durable-demand-ledger.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)


class DurableDemandControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.events=[]
        self.owners=[dict(ownerIndex=4+i,address='synthetic-owner-'+str(i),nextNonce=2,capacity=4) for i in range(2)]
        self.plan=d.make_plan('1'*64,'2'*64,'online',self.owners,100,50_000_000,1_000_000_000,enabled=True)
    def ledger(self,**kwargs):
        ledger=d.DurableLedger(self.plan,self.root/'accounting.sqlite',self.events.append,lambda:None,enabled=True,**kwargs)
        self.addCleanup(ledger.close);return ledger
    def events_for(self,row,at):
        base=dict(index=row['index'],id=row['id'])
        tx='%064x'%(row['index']+1);native='%064x'%(row['index']+1000)
        payloads=[dict(kind='signed',hash=tx,nativeHash=native),dict(kind='submitted'),dict(kind='ack'),
                  dict(kind='included'),dict(kind='qualified',hash=tx,nativeHash=native,
                       normalVerifierCode='VERIFIED_TRANSACTION_DATA',normalConfirmCode='PROOF_CONFIRMED_DATA',
                       executionSuccessful=True,executionCode='0',transactionType='pq_transfer',members=1,
                       nativeGrant=False,proofReference='synthetic/original-proof-'+str(row['index']))]
        return [dict(base,atNs=at+i,**payload) for i,payload in enumerate(payloads)]

    def test_default_closed_and_normal_runtime_limits_are_not_raised(self):
        with self.assertRaisesRegex(ValueError,'opt-in'):
            d.DurableLedger(self.plan,self.root/'accounting.sqlite',self.events.append,lambda:None)
        with self.assertRaisesRegex(ValueError,'opt-in'):
            d.original.open_durable_ledger(self.plan,self.root/'accounting.sqlite',self.events.append,lambda:None)
        self.assertFalse((self.root/'accounting.sqlite').exists())
        self.assertEqual(d.original.MAX_DEMAND,10000)
        with self.assertRaises(ValueError):d.original.make_plan('1'*64,'2'*64,'online',self.owners,1000,600_000_000_000,1_000_000_000)

    def test_600000_plan_is_lazy_and_not_a_core_capacity_or_runtime_grant(self):
        owners=[dict(ownerIndex=4+i,address='synthetic-'+str(i),nextNonce=2,capacity=1000) for i in range(600)]
        tracemalloc.start()
        try:
            plan=d.make_plan('1'*64,'2'*64,'online',owners,1000,600_000_000_000,1_000_000_000,enabled=True)
            _,peak=tracemalloc.get_traced_memory()
        finally:tracemalloc.stop()
        self.assertEqual(len(plan['rows']),600000);self.assertLess(peak,4<<20)
        self.assertEqual(plan['rows'][599999]['logicalArrivalOffsetNs'],599999000000)
        self.assertFalse(plan['durableAccounting']['runtimeAuthorized'] or plan['durableAccounting']['sourceCapacityQualified'])
        with self.assertRaises(ValueError):plan['rows'][:]
        self.assertEqual(list(self.plan['rows']),d.original.make_plan('1'*64,'2'*64,'online',self.owners,100,50_000_000,1_000_000_000)['rows'])
        ledger=d.DurableLedger(plan,self.root/'large-plan.sqlite',lambda event:None,lambda:None,enabled=True)
        self.addCleanup(ledger.close)
        self.assertEqual(ledger.audit()['configuredDemand'],600000)
        self.assertEqual(ledger.db.execute('SELECT count(*) FROM rows').fetchone()[0],0)
        self.assertLess(ledger.path.stat().st_size,1<<20)

    def test_original_factory_calls_disk_adapter_without_changing_old_ledger(self):
        ledger=d.original.open_durable_ledger(self.plan,self.root/'accounting.sqlite',self.events.append,lambda:None,enabled=True)
        self.addCleanup(ledger.close);ledger.release(0);row,account=ledger.reserve(1)
        self.assertEqual(row['nonce'],2);self.assertEqual(account['pending'],0)
        self.assertEqual(ledger.audit()['claimed'],1)

    def test_complete_small_cohort_matches_original_rows_nonce_and_all_quantiles(self):
        ledger=self.ledger();old=d.original.Ledger(dict(self.plan,rows=list(self.plan['rows'])),lambda event:None)
        ledger.release(40_000_000);old.release(40_000_000)
        for index in range(5):
            at=50_000_000+index*100
            row,account=ledger.reserve(at);old_row,old_account=old.reserve(at)
            self.assertEqual((row,account),(old_row,old_account))
            for event in self.events_for(row,at+1):ledger.event(event);old.event(event)
            self.assertEqual(ledger.row(index),old.rows[index])
        cutoff=100_000_000;ledger.seal(cutoff);actual=ledger.report(cutoff);expected=old.report(cutoff)
        for key in ('configuredDemand','logicalReleased','notReleased','submitted','qualified','notQualified','accountState',*d.INTERVALS):
            self.assertEqual(actual[key],expected[key],key)
        self.assertEqual(actual['terminalCounts'],expected['terminalCounts'])
        self.assertEqual(ledger.audit()['originalPending'],[])

    def test_unreached_and_unknown_keep_full_denominator_and_exact_original_pending(self):
        ledger=self.ledger();ledger.release(40_000_000);row,_=ledger.reserve(40_000_001)
        for event in self.events_for(row,40_000_002)[:4]:ledger.event(event)
        ledger.event(dict(index=row['index'],id=row['id'],kind='unknown',atNs=40_000_007,error='original confirm timeout'))
        ledger.seal(50_000_000);report=ledger.report(50_000_000,'original first cause')
        self.assertEqual(report['qualified'],0);self.assertEqual(report['notQualified'],5)
        self.assertEqual(report['endToEndLogicalArrivalToQualified'],dict(denominator=5,observed=0,censored=5,p50Ms=None,p95Ms=None,p99Ms=None))
        self.assertIsNone(report['submitToInclusionObserved']['p95Ms'])
        self.assertEqual(report['firstCause'],'original first cause')
        pending=ledger.audit()['originalPending'][0]
        self.assertEqual((pending['nextNonce'],pending['pending'],pending['quarantined']),(2,0,True))
        self.assertEqual(ledger.row(4)['status'],'queued')

    def test_after_cutoff_original_reply_is_durable_but_cannot_qualify_or_release(self):
        ledger=self.ledger();ledger.release(0);row,_=ledger.reserve(1)
        events=self.events_for(row,2)
        for event in events[:4]:ledger.event(event)
        ledger.seal(6);ledger.event(dict(events[4],atNs=7))
        report=ledger.report(6);self.assertEqual(report['qualified'],0);self.assertEqual(report['lateOriginalEvents'],1)
        self.assertEqual(ledger.row(0)['status'],'included');self.assertEqual(ledger.audit()['originalPending'][0]['nextNonce'],2)
        with self.assertRaisesRegex(ValueError,'sealed'):ledger.reserve(8)
        with self.assertRaisesRegex(ValueError,'sealed'):ledger.release(8)

    def test_missing_confirm_and_duplicate_hash_cannot_release_nonce(self):
        for kind in ('confirm','hash'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory(dir=self.root) as directory:
                ledger=d.DurableLedger(self.plan,Path(directory)/'ledger.sqlite',lambda event:None,lambda:None,enabled=True)
                try:
                    ledger.release(40_000_000);row,_=ledger.reserve(40_000_001);events=self.events_for(row,40_000_002)
                    if kind=='confirm':
                        for event in events[:4]:ledger.event(event)
                        bad=dict(events[4]);bad.pop('normalConfirmCode')
                    else:
                        for event in events:ledger.event(event)
                        row,_=ledger.reserve(40_000_009);bad=dict(self.events_for(row,40_000_010)[0],hash=events[0]['hash'])
                    with self.assertRaises(ValueError):ledger.event(bad)
                    self.assertIsNotNone(ledger.failed)
                    self.assertEqual(ledger.audit()['originalPending'][0]['nextNonce'],2)
                    with self.assertRaisesRegex(ValueError,'stopped'):ledger.reserve(40_000_020)
                finally:ledger.close()

    def test_durable_claim_survives_process_exit_without_close_and_reopens_only_readonly(self):
        path=self.root/'interrupted.sqlite'
        script='''import importlib.util,os,sys
from pathlib import Path
s=importlib.util.spec_from_file_location('child_ledger',sys.argv[1]);d=importlib.util.module_from_spec(s);s.loader.exec_module(d)
owners=[dict(ownerIndex=4+i,address='synthetic-owner-'+str(i),nextNonce=2,capacity=4) for i in range(2)]
p=d.make_plan('1'*64,'2'*64,'online',owners,100,50_000_000,1_000_000_000,enabled=True)
l=d.DurableLedger(p,Path(sys.argv[2]),lambda event:None,lambda:None,enabled=True)
l.release(0);l.reserve(1)
os._exit(0)
'''
        subprocess.run([sys.executable,'-B','-c',script,str(Path(d.__file__).resolve()),str(path)],check=True,timeout=10)
        metadata={k:v for k,v in self.plan.items() if k!='rows'}
        pin=hashlib.sha256(d.encoded(metadata,d.MAX_PLAN_BYTES).encode()).hexdigest()
        before=hashlib.sha256(path.read_bytes()).hexdigest()
        audit=d.open_readonly(path,self.plan,pin);self.addCleanup(audit.close)
        self.assertEqual(audit.row(0)['status'],'reserved');self.assertEqual(audit.audit()['originalPending'][0]['pending'],0)
        with self.assertRaisesRegex(ValueError,'stopped'):audit.reserve(2)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),before)
        with self.assertRaises(FileExistsError):d.DurableLedger(self.plan,path,self.events.append,lambda:None,enabled=True)

    def test_emitter_failure_keeps_committed_claim_and_blocks_another_effect(self):
        ledger=self.ledger();ledger.release(0)
        def failed(event):raise OSError('original event observer unavailable')
        ledger.emit=failed
        with self.assertRaises(OSError):ledger.reserve(1)
        self.assertEqual(ledger.row(0)['status'],'reserved');self.assertEqual(ledger.audit()['claimed'],1)
        with self.assertRaisesRegex(ValueError,'stopped'):ledger.reserve(2)

    def test_real_sqlite_page_limit_keeps_original_pending_and_fails_closed(self):
        ledger=self.ledger(max_db_bytes=256<<10);ledger.release(0);row,_=ledger.reserve(1)
        with self.assertRaises(sqlite3.OperationalError):
            for index in range(100):
                ledger.event(dict(index=0,id=row['id'],kind='normal_stage',stage='checkpoint',atNs=index+2,
                                  syntheticDiagnostic='x'*16000))
        self.assertLessEqual(ledger.path.stat().st_size,256<<10)
        self.assertEqual(ledger.audit()['originalPending'][0]['pending'],0)
        self.assertIsNotNone(ledger.failed)
        with self.assertRaisesRegex(ValueError,'stopped'):ledger.reserve(200)

    def test_resource_guard_failure_before_claim_does_not_return_signable_work(self):
        ledger=self.ledger();ledger.release(0)
        def refused():raise RuntimeError('original 8GiB guard')
        ledger.check_resources=refused
        with self.assertRaisesRegex(RuntimeError,'8GiB'):ledger.reserve(1)
        self.assertEqual(ledger.audit()['claimed'],0);self.assertEqual(ledger.row(0)['status'],'queued')

    def test_complete_rows_stream_and_partial_export_never_erase_denominator(self):
        ledger=self.ledger();ledger.release(0);ledger.reserve(1)
        target=self.root/'complete.jsonl';result=ledger.export_rows(target,max_bytes=64<<10)
        rows=[json.loads(line) for line in target.read_bytes().splitlines()]
        self.assertEqual(len(rows),5);self.assertEqual(result['rows'],5)
        self.assertEqual([r['index'] for r in rows],list(range(5)))
        self.assertEqual(rows[-1]['status'],'not_released')
        partial=self.root/'partial.jsonl'
        with self.assertRaisesRegex(ValueError,'complete row export'):ledger.export_rows(partial,max_bytes=800)
        self.assertTrue(partial.exists())
        with self.assertRaises(FileExistsError):ledger.export_rows(partial,max_bytes=64<<10)

    def test_caller_plan_mutation_cannot_change_original_demand_nonce_or_ids(self):
        ledger=self.ledger();expected=self.plan['rows'][0]
        self.plan['accounts'][0]['nextNonce']=99;self.plan['configuredDemand']=1
        self.plan['rows'].identity=('forged',);self.plan['rows'].count=1
        ledger.release(0);row,_=ledger.reserve(1)
        self.assertEqual((row['id'],row['nonce']),(expected['id'],2))
        self.assertEqual(ledger.audit()['configuredDemand'],5)

    def test_replaced_database_inode_fails_before_claim(self):
        ledger=self.ledger();ledger.release(0)
        original=self.root/'preserved-original.sqlite';ledger.path.rename(original)
        ledger.path.write_bytes(b'foreign file');ledger.path.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'identity changed'):ledger.reserve(1)
        self.assertEqual(ledger.db.execute("SELECT value FROM metadata WHERE key='claimed'").fetchone()[0],'0')
        self.assertEqual(ledger.path.read_bytes(),b'foreign file');self.assertTrue(original.exists())

    def test_cutoff_cannot_hide_prior_release_or_already_applied_observation(self):
        ledger=self.ledger();ledger.release(100)
        with self.assertRaisesRegex(ValueError,'cutoff precedes'):ledger.seal(100)
        self.assertEqual(ledger.audit()['logicalReleased'],1)
        self.assertIsNone(ledger.audit()['sealedCutoffNs'])

    def test_sealed_report_does_not_advance_on_queued_pre_cutoff_qualification(self):
        ledger=self.ledger();ledger.release(0);row,_=ledger.reserve(1)
        events=self.events_for(row,2)
        for event in events[:4]:ledger.event(event)
        ledger.seal(10);before=ledger.report(10)
        ledger.event(events[4]) # Claimed observed timestamp 6, consumed AFTER seal.
        after=ledger.report(10)
        self.assertEqual(after['qualified'],before['qualified'])
        self.assertEqual(after['accountState'],before['accountState'])
        self.assertEqual(after['lateOriginalEvents'],1)
        self.assertEqual(ledger.row(0)['status'],'included')

    def test_cutoff_checks_normal_stage_and_unknown_event_clocks(self):
        for kind in ('normal_stage','unknown'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory(dir=self.root) as directory:
                ledger=d.DurableLedger(self.plan,Path(directory)/'ledger.sqlite',lambda event:None,lambda:None,enabled=True)
                try:
                    ledger.release(0);row,_=ledger.reserve(1)
                    extra=dict(stage='checkpoint') if kind=='normal_stage' else dict(error='original UNKNOWN at100')
                    ledger.event(dict(index=0,id=row['id'],kind=kind,atNs=100,**extra))
                    with self.assertRaisesRegex(ValueError,'cutoff precedes'):ledger.seal(50)
                    self.assertIsNone(ledger.audit()['sealedCutoffNs'])
                    self.assertEqual(ledger.row(0)['activeStage'],'checkpoint' if kind=='normal_stage' else 'unknown')
                finally:ledger.close()

    def test_post_commit_directory_sync_failure_keeps_claim_without_returning_work(self):
        ledger=self.ledger();ledger.release(0);original=d.os.fsync
        def fail_directory(fd):
            if stat.S_ISDIR(d.os.fstat(fd).st_mode):raise OSError('original directory sync failed')
            return original(fd)
        with mock.patch.object(d.os,'fsync',side_effect=fail_directory):
            with self.assertRaisesRegex(OSError,'directory sync failed'):ledger.reserve(1)
        self.assertEqual(ledger.row(0)['status'],'reserved')
        self.assertEqual([event['kind'] for event in self.events],['logical_release_range'])
        self.assertEqual(ledger.audit()['claimed'],1)
        with self.assertRaisesRegex(ValueError,'stopped'):ledger.reserve(2)

    def test_readonly_audit_cannot_export_or_accept_another_plan(self):
        ledger=self.ledger();ledger.release(0);ledger.reserve(1);ledger.close()
        with self.assertRaisesRegex(ValueError,'plan binding differs'):
            d.open_readonly(ledger.path,self.plan,'0'*64)
        audit=d.open_readonly(ledger.path,self.plan,ledger.plan_sha256);self.addCleanup(audit.close)
        target=self.root/'must-not-exist.jsonl'
        with self.assertRaisesRegex(ValueError,'read-only'):audit.export_rows(target,max_bytes=64<<10)
        self.assertFalse(target.exists());self.assertEqual(audit.audit()['claimed'],1)


if __name__=='__main__':unittest.main(verbosity=2)
