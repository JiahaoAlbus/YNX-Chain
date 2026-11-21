"""Synthetic original-ledger controls; no producer, keys, signing or nodes."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
old=module('test_pq_durable_demand_ledger.py');d=old.d
def raw(value):return json.dumps(value,separators=(',',':')).encode()
def sha(value):return hashlib.sha256(value).hexdigest()


class DurableEnrollmentReservationControls(unittest.TestCase):
    def setUp(self):
        self.base=old.DurableDemandControls();self.base.setUp();self.addCleanup(self.base.doCleanups)
        self.root=self.base.root;self.plan=self.base.plan
    def fresh(self):
        directory=tempfile.TemporaryDirectory(dir=self.root);self.addCleanup(directory.cleanup)
        events=[];ledger=d.DurableLedger(self.plan,Path(directory.name)/'original.sqlite',events.append,lambda:None,enabled=True)
        self.addCleanup(ledger.close);ledger.release(40_000_000);row,account=ledger.reserve(40_000_001)
        return ledger,row,account,events
    def request(self,row,**changes):
        value=dict(version='YNX-PQ-LAB-ENROLLMENT-REQUEST/v1',fundingOperationId=row['operationId'],migrationOperationId='a'*64,
            ownerIndex=row['ownerIndex'],fundingNonce=str(row['nonce']),targetOwner='synthetic-new-target',fundingAmount='3',
            activationHeight='9',pka=base64.b64encode(b'a'*2592).decode(),pkb=base64.b64encode(b'b'*64).decode())
        value.update(changes);return raw(value)
    def prepare(self,ledger,row,value=None,at=40_000_002,**kwargs):
        value=self.request(row) if value is None else value
        return ledger.prepare_enrollment_pair(row['index'],value,sha(value),d.enrollment.SOURCE,at,enabled=True,**kwargs)
    def reopen(self,ledger):
        path=ledger.path;pin=ledger.plan_sha256;ledger.close();before=path.read_bytes()
        opened=d.open_readonly(path,self.plan,pin);self.addCleanup(opened.close)
        return opened,before
    def frames(self):
        # These deliberately have no valid HMAC/proof. Retention is never verification.
        return {role:dict(raw=('UNIT invalid '+role+' confirmation').encode(),sha256=sha(('UNIT invalid '+role+' confirmation').encode()))
                for role in ('funding','migration')}

    def test_atomic_pair_reservation_retains_request_and_both_ids_after_readonly_reopen(self):
        ledger,row,account,_=self.fresh();value=self.request(row)
        with mock.patch('subprocess.Popen',side_effect=AssertionError('no signer')):out=self.prepare(ledger,row,value)
        self.assertEqual(out['status'],'LOCAL_RESERVATION_RETAINED');self.assertFalse(out['signingAuthorized'])
        self.assertEqual(out['reservationStartedNs'],40_000_002);self.assertGreater(out['durabilityElapsedNs'],0)
        self.assertEqual(ledger.db.execute('SELECT count(*) FROM enrollment_ids').fetchone()[0],2)
        reopened,before=self.reopen(ledger);original=reopened.read_enrollment_pair(0,sha(value))
        self.assertEqual(original['requestRaw'],value);self.assertEqual(original['status'],'UNKNOWN')
        self.assertFalse(original['durabilityReturnObserved'])
        self.assertEqual(reopened.audit()['originalPending'][0]['pending'],0)
        self.assertFalse(original['nonceReleased'] or original['automaticRetry'] or original['signingAuthorized'])
        self.assertEqual(before,reopened.path.read_bytes())
        with self.assertRaises(ValueError):reopened.prepare_enrollment_pair(0,value,sha(value),d.enrollment.SOURCE,40_000_003,enabled=True)
        with self.assertRaises(ValueError):reopened.read_enrollment_pair(0,'f'*64)

    def test_default_and_invalid_request_pin_source_or_role_cannot_prepare(self):
        ledger,row,_,_=self.fresh();value=self.request(row)
        with self.assertRaisesRegex(ValueError,'opt-in'):
            ledger.prepare_enrollment_pair(0,value,sha(value),d.enrollment.SOURCE,40_000_002)
        self.assertFalse(ledger.enrollment_pairs)
        for change in ({'ownerIndex':True},{'fundingNonce':'3'},{'fundingOperationId':'b'*64},
                       {'migrationOperationId':row['operationId']},{'targetOwner':'synthetic-owner-0'}):
            with self.subTest(change=change):
                item,current,_,_=self.fresh();value=self.request(current,**change)
                with self.assertRaises(ValueError):self.prepare(item,current,value)
                self.assertIsNotNone(item.failed);self.assertEqual(item.audit()['originalPending'][0]['nextNonce'],2)
                with self.assertRaisesRegex(ValueError,'stopped'):item.reserve(50_000_000)
        for source,pin in ((d.enrollment.SOURCE,'f'*64),('f'*40,sha(self.request(row)))):
            item,current,_,_=self.fresh();value=self.request(current)
            with self.assertRaises(ValueError):item.prepare_enrollment_pair(0,value,pin,source,40_000_002,enabled=True)
            self.assertIsNotNone(item.failed)
        item,current,_,_=self.fresh();value=self.request(current)+b' '
        with self.assertRaisesRegex(ValueError,'canonical request'):self.prepare(item,current,value)
        self.assertIsNotNone(item.failed)

    def test_pair_ids_cannot_collide_with_existing_future_or_other_pair_operations(self):
        ledger,row,_,_=self.fresh();second,_=ledger.reserve(40_000_002)
        with self.assertRaisesRegex(ValueError,'collides'):
            self.prepare(ledger,row,self.request(row,migrationOperationId=second['operationId']),at=40_000_003)
        ledger,row,_,_=self.fresh();self.prepare(ledger,row);second,_=ledger.reserve(40_000_003)
        with self.assertRaises(sqlite3.IntegrityError):self.prepare(ledger,second,self.request(second),at=40_000_004)
        self.assertEqual(ledger.db.execute('SELECT count(*) FROM enrollment_pairs').fetchone()[0],1)
        self.assertEqual(ledger.db.execute('SELECT count(*) FROM enrollment_ids').fetchone()[0],2)
        ledger,row,_,_=self.fresh()
        reference=d.original.Ledger(dict(self.plan,rows=list(self.plan['rows'])),lambda event:None)
        reference.release(40_000_000);reference.reserve(40_000_001);future,_=reference.reserve(40_000_003)
        self.prepare(ledger,row,self.request(row,migrationOperationId=future['operationId']))
        with self.assertRaisesRegex(ValueError,'collides'):ledger.reserve(40_000_003)
        self.assertEqual(ledger.audit()['claimed'],1)

    def test_prepare_is_not_repeatable_or_allowed_after_sign_or_cutoff(self):
        ledger,row,_,_=self.fresh();self.prepare(ledger,row)
        with self.assertRaises(sqlite3.IntegrityError):self.prepare(ledger,row,at=40_000_003)
        ledger,row,_,_=self.fresh();ledger.event(self.base.events_for(row,40_000_002)[0])
        with self.assertRaisesRegex(ValueError,'signing already'):self.prepare(ledger,row,at=40_000_003)
        ledger,row,_,_=self.fresh();ledger.begin_cutoff(40_000_002)
        with self.assertRaisesRegex(ValueError,'cutoff'):self.prepare(ledger,row,at=40_000_003)

    def test_second_id_insert_failure_rolls_back_pair_atomically_and_blocks_live_ledger(self):
        ledger,row,_,_=self.fresh();original=ledger.db
        class FailSecondID:
            def __getattr__(self,name):return getattr(original,name)
            def execute(self,sql,args=()):
                if sql=='INSERT INTO enrollment_ids VALUES(?,?,?)' and args[2]=='migration':raise OSError('UNIT second ID storage failure')
                return original.execute(sql,args)
        ledger.db=FailSecondID()
        with self.assertRaisesRegex(OSError,'second ID'):self.prepare(ledger,row)
        self.assertFalse(original.in_transaction)
        self.assertIsNone(original.execute("SELECT 1 FROM sqlite_master WHERE name='enrollment_pairs'").fetchone())
        self.assertEqual(ledger.row(0)['status'],'reserved');self.assertEqual(ledger.audit()['originalPending'][0]['pending'],0)
        with self.assertRaisesRegex(ValueError,'stopped'):ledger.reserve(50_000_000)

    def test_post_commit_directory_fsync_failure_preserves_pair_without_a_success_return(self):
        ledger,row,_,_=self.fresh();value=self.request(row)
        with mock.patch.object(d.os,'fsync',side_effect=OSError('UNIT original directory barrier failed')):
            with self.assertRaisesRegex(OSError,'barrier'):self.prepare(ledger,row,value)
        self.assertIn('barrier',ledger.failed);self.assertEqual(ledger.db.execute('SELECT count(*) FROM enrollment_ids').fetchone()[0],2)
        reopened,before=self.reopen(ledger);out=reopened.read_enrollment_pair(0,sha(value))
        self.assertEqual(out['requestRaw'],value);self.assertFalse(out['signingAuthorized']);self.assertEqual(before,reopened.path.read_bytes())
        ledger,row,_,_=self.fresh();value=self.request(row);self.prepare(ledger,row,value);frames=self.frames()
        with mock.patch.object(d.os,'fsync',side_effect=OSError('UNIT confirmation directory barrier failed')):
            with self.assertRaisesRegex(OSError,'barrier'):
                ledger.observe_enrollment_confirmations(0,sha(value),frames,40_000_003,enabled=True)
        reopened,before=self.reopen(ledger);out=reopened.read_enrollment_pair(0,sha(value))
        self.assertEqual(out['fundingConfirmationRaw'],frames['funding']['raw'])
        self.assertEqual(out['migrationConfirmationRaw'],frames['migration']['raw']);self.assertFalse(out['nonceReleased'])

    def test_single_qualified_and_even_two_unverified_frames_never_release_original_pair(self):
        for retain_both in (False,True):
            with self.subTest(retain_both=retain_both):
                ledger,row,_,events=self.fresh();value=self.request(row);self.prepare(ledger,row,value)
                if retain_both:
                    out=ledger.observe_enrollment_confirmations(0,sha(value),self.frames(),40_000_003,enabled=True)
                    self.assertEqual(out['status'],'OBSERVED_NOT_AUTHENTICATED')
                sequence=self.base.events_for(row,40_000_004)
                for event in sequence[:4]:ledger.event(event)
                with self.assertRaisesRegex(RuntimeError,'dual-confirmation'):ledger.event(sequence[4])
                self.assertEqual(ledger.row(0)['status'],'unknown');self.assertIsNone(ledger.row(0)['finalNs'])
                pending=ledger.audit()['originalPending'][0]
                self.assertEqual((pending['pending'],pending['nextNonce'],pending['quarantined']),(0,2,True))
                saved=json.loads(ledger.db.execute("SELECT data FROM events WHERE kind='enrollment_qualified_rejected'").fetchone()[0])
                self.assertEqual(saved['original'],sequence[4]);self.assertEqual(events[-1]['kind'],'unknown')
                self.assertIsNone(d.enrollment.NORMAL_DUAL_CONFIRMATION_CALLEE)

    def test_partial_wrong_digest_or_repeated_confirmation_observation_fails_closed(self):
        for mode in ('missing','digest','request','regressed','repeat'):
            with self.subTest(mode=mode):
                ledger,row,_,_=self.fresh();value=self.request(row);self.prepare(ledger,row,value);frames=self.frames();pin=sha(value);at=40_000_003
                if mode=='missing':frames.pop('migration')
                if mode=='digest':frames['migration']['sha256']='f'*64
                if mode=='request':pin='f'*64
                if mode=='regressed':at=40_000_001
                if mode=='repeat':ledger.observe_enrollment_confirmations(0,pin,frames,at,enabled=True);at+=1
                with self.assertRaises(ValueError):ledger.observe_enrollment_confirmations(0,pin,frames,at,enabled=True)
                saved=ledger.db.execute('SELECT funding_confirmation,migration_confirmation FROM enrollment_pairs').fetchone()
                self.assertEqual(saved,(frames['funding']['raw'],frames['migration']['raw']) if mode=='repeat' else (None,None))
                self.assertEqual(ledger.audit()['originalPending'][0]['nextNonce'],2)

    def test_cutoff_preserves_late_original_qualified_without_reducing_pair(self):
        ledger,row,_,_=self.fresh();value=self.request(row);self.prepare(ledger,row,value)
        seq=self.base.events_for(row,40_000_003)
        for event in seq[:4]:ledger.event(event)
        ledger.seal(40_000_007);ledger.event(dict(seq[4],atNs=40_000_008))
        self.assertEqual(ledger.report(40_000_007)['qualified'],0)
        self.assertEqual(ledger.report(40_000_007)['lateOriginalEvents'],1)
        self.assertEqual(ledger.audit()['originalPending'][0]['nextNonce'],2)

    def test_real_process_exit_retains_atomic_pair_and_reopens_readonly_without_retry(self):
        path=self.root/'process-original.sqlite'
        script='''import importlib.util,json,os,sys
from pathlib import Path
s=importlib.util.spec_from_file_location('case',sys.argv[1]);t=importlib.util.module_from_spec(s);s.loader.exec_module(t)
c=t.DurableEnrollmentReservationControls()
owners=[dict(ownerIndex=4+i,address='synthetic-owner-'+str(i),nextNonce=2,capacity=4) for i in range(2)]
p=t.d.make_plan('1'*64,'2'*64,'online',owners,100,50000000,1000000000,enabled=True)
l=t.d.DurableLedger(p,Path(sys.argv[2]),lambda event:None,lambda:None,enabled=True)
l.release(40000000);r,_=l.reserve(40000001);q=c.request(r)
l.prepare_enrollment_pair(0,q,t.sha(q),t.d.enrollment.SOURCE,40000002,enabled=True)
os._exit(0)
'''
        subprocess.run([sys.executable,'-B','-c',script,str(Path(__file__).resolve()),str(path)],check=True,timeout=10)
        pin=sha(d.encoded({k:v for k,v in self.plan.items() if k!='rows'},d.MAX_PLAN_BYTES).encode())
        before=path.read_bytes();opened=d.open_readonly(path,self.plan,pin);self.addCleanup(opened.close)
        value=self.request(opened.row(0));out=opened.read_enrollment_pair(0,sha(value))
        self.assertEqual(out['requestRaw'],value);self.assertEqual(opened.audit()['originalPending'][0]['nextNonce'],2)
        self.assertEqual(before,path.read_bytes())
        with self.assertRaises(FileExistsError):d.DurableLedger(self.plan,path,lambda event:None,lambda:None,enabled=True)

    def test_original_resource_failure_and_event_observer_failure_keep_first_cause(self):
        ledger,row,_,_=self.fresh();ledger.check_resources=mock.Mock(side_effect=RuntimeError('UNIT original RSS limit'))
        with self.assertRaisesRegex(RuntimeError,'RSS'):self.prepare(ledger,row)
        self.assertEqual(ledger.failed,'UNIT original RSS limit');self.assertFalse(ledger.enrollment_pairs)
        ledger,row,_,_=self.fresh();self.prepare(ledger,row)
        seq=self.base.events_for(row,40_000_003)
        for event in seq[:4]:ledger.event(event)
        ledger.emit=mock.Mock(side_effect=OSError('UNIT observer failed'))
        with self.assertRaises(OSError):ledger.event(seq[4])
        self.assertIn('dual-confirmation',ledger.failed);self.assertEqual(ledger.row(0)['status'],'unknown')

    def test_original_finite_single_operation_remains_compatible_without_pair_tables(self):
        ledger,row,_,_=self.fresh()
        self.assertFalse(ledger.enrollment_pairs)
        for event in self.base.events_for(row,40_000_002):ledger.event(event)
        self.assertEqual(ledger.row(0)['status'],'qualified');self.assertEqual(ledger.audit()['originalPending'],[])
        self.assertIsNone(ledger.db.execute("SELECT 1 FROM sqlite_master WHERE name='enrollment_pairs'").fetchone())
        reopened,before=self.reopen(ledger)
        self.assertEqual(reopened.read_enrollment_pair(0,'a'*64)['missingEvidence'],['originalPairReservation'])
        self.assertEqual(before,reopened.path.read_bytes())

    def test_original_staged_pipeline_cannot_turn_single_funding_qualified_into_pair_success(self):
        staged=module('pq-staged-independent-scheduler.py');events=[];stop=__import__('threading').Event()
        plan=staged.configure_durable(self.plan,enabled=True);path=self.root/'staged-pair.sqlite';requests={}
        old_factory=staged.original.open_durable_ledger
        def reserve_before_publish(*args,**kwargs):
            ledger=old_factory(*args,**kwargs);reserve=ledger.reserve
            def prepared(now):
                claimed=reserve(now)
                if claimed is None:return None
                row,account=claimed;value=self.request(row,migrationOperationId='%064x'%(row['index']+10000))
                requests[row['index']]=value
                ledger.prepare_enrollment_pair(row['index'],value,sha(value),d.enrollment.SOURCE,now,enabled=True)
                return row,account
            ledger.reserve=prepared;return ledger
        base=self.base
        class OnlyFunding:
            def publish(self,row,account,notify,cancel):
                for event in base.events_for(row,1)[:3]:notify({k:v for k,v in event.items() if k not in ('index','id','atNs')})
                return row
            def observe(self,row,notify,cancel):notify(dict(kind='included'));return row
            def finalize(self,row,notify,cancel):
                event=base.events_for(row,1)[4];notify({k:v for k,v in event.items() if k not in ('index','id','atNs')});return row
            def stop(self):pass
        with mock.patch.object(staged.original,'open_durable_ledger',side_effect=reserve_before_publish):
            result=staged.run_durable(plan,OnlyFunding(),events.append,lambda:None,stop,ledger_path=path,enabled=True)
        self.assertIn('dual-confirmation',result['firstCause']);self.assertFalse(result['durableAccountingComplete'])
        pin=sha(d.encoded({k:v for k,v in self.plan.items() if k!='rows'},d.MAX_PLAN_BYTES).encode())
        opened=d.open_readonly(path,self.plan,pin);self.addCleanup(opened.close)
        self.assertEqual(opened.row(0)['status'],'unknown');self.assertIsNone(opened.row(0)['finalNs'])
        self.assertFalse(opened.read_enrollment_pair(0,sha(requests[0]))['nonceReleased'])
        self.assertGreaterEqual(len(opened.audit()['originalPending']),1)


if __name__=='__main__':unittest.main()
