"""Separated original observation boundaries; fixture events are not chain proof."""
import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('observed_tps_controls',Path(__file__).with_name('pq-independent-scheduler.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class ObservedThroughputControls(unittest.TestCase):
 def ledger(self,n=4):
  p=m.make_plan('a'*64,'b'*64,'online',[dict(ownerIndex=4+i,address='CONTROL-'+str(i),nextNonce=2,capacity=1) for i in range(n)],100,n*10_000_000,50_000_000)
  ledger=m.Ledger(p,lambda e:None);ledger.release(p['windowNs']-10_000_000);return ledger
 def event(self,ledger,row,kind,at,**extra):ledger.event(dict(kind=kind,index=row['index'],id=row['id'],atNs=at,**extra))
 def submitted(self,ledger):
  row,_=ledger.reserve(ledger.plan['windowNs']);at=ledger.plan['windowNs']+1
  self.event(ledger,row,'signed',at,hash=format(row['index']+1,'064x'),nativeHash=format(row['index']+100,'064x'));self.event(ledger,row,'submitted',at+1)
  return row
 def final(self,ledger,row,at):self.event(ledger,row,'qualified',at,hash=row['hash'],nativeHash=row['nativeHash'],normalVerifierCode='VERIFIED_TRANSACTION_DATA',executionSuccessful=True,executionCode='0',transactionType='pq_transfer',members=1,nativeGrant=False,normalConfirmCode='PROOF_CONFIRMED_DATA',proofReference='CONTROL-NOT-REAL-PROOF')
 def test_ack_only_is_not_inclusion_or_final_receipt(self):
  ledger=self.ledger();row=self.submitted(ledger);self.event(ledger,row,'ack',ledger.plan['windowNs']+3);r=ledger.report(ledger.plan['windowNs']+5);v=r['observedThroughput']
  self.assertEqual((v['checkTxAccepted'],v['successfulInclusion'],r['qualified']),(1,0,0));self.assertEqual(v['checkTxAcceptedInTail'],1);self.assertEqual(v['successfulInclusionTPS'],0);self.assertIsNone(r['submitToInclusionObserved']['p95Ms'])
 def test_inclusion_without_ack_keeps_ack_unknown_not_inferred(self):
  ledger=self.ledger();row=self.submitted(ledger);self.event(ledger,row,'included',ledger.plan['windowNs']+3);self.final(ledger,row,ledger.plan['windowNs']+4);r=ledger.report(ledger.plan['windowNs']+5);v=r['observedThroughput']
  self.assertEqual((v['checkTxAccepted'],v['successfulInclusion'],v['includedWithoutAckObservation']),(0,1,1));self.assertEqual(r['submitToCheckTxAckObserved']['observed'],0);self.assertIsNone(r['submitToCheckTxAckObserved']['p50Ms']);self.assertEqual(r['qualified'],1)
 def test_exact_window_end_and_tail_never_inflate_tps(self):
  # Claim before window end while retaining the original release/nonce contract.
  ledger=self.ledger(1);row,_=ledger.reserve(0);window=ledger.plan['windowNs']
  self.event(ledger,row,'signed',1,hash='1'*64,nativeHash='2'*64);self.event(ledger,row,'submitted',2);self.event(ledger,row,'ack',3);self.event(ledger,row,'included',window);self.final(ledger,row,window+1)
  r=ledger.report(window+2);v=r['observedThroughput'];self.assertEqual(v['checkTxAcceptedTPS'],100);self.assertEqual(v['successfulInclusionTPS'],0);self.assertEqual(v['qualifiedReceiptTPS'],0);self.assertEqual(v['successfulInclusionInTail'],1);self.assertEqual(r['submitToInclusionObserved']['p95Ms'],(window-2)/1e6)
 def test_mixed_boundaries_are_counted_separately_from_union(self):
  ledger=self.ledger();window=ledger.plan['windowNs']
  for i in range(4):
   row,_=ledger.reserve(window-10_000_000);at=row['releasedNs']+1;self.event(ledger,row,'signed',at,hash=format(i+1,'064x'),nativeHash=format(i+100,'064x'));self.event(ledger,row,'submitted',at+1)
   if i<3:self.event(ledger,row,'ack',at+2)
   if i>=2:self.event(ledger,row,'included',at+3)
   if i==3:self.final(ledger,row,at+4)
  r=ledger.report(window+1);v=r['observedThroughput'];self.assertEqual(r['sourceAcceptanceOrInclusionWithinWindow'],4);self.assertEqual((v['checkTxAcceptedTPS'],v['successfulInclusionTPS'],v['qualifiedReceiptTPS']),(75,50,25));self.assertEqual(v['includedWithoutAckObservation'],1)
 def test_partial_cohort_never_reports_survivor_only_new_latencies(self):
  ledger=self.ledger(500)
  for _ in range(499):
   row=self.submitted(ledger);at=ledger.plan['windowNs']+3;self.event(ledger,row,'ack',at);self.event(ledger,row,'included',at+1);self.final(ledger,row,at+2)
  r=ledger.report(ledger.plan['windowNs']+6)
  for key in ('submitToCheckTxAckObserved','inclusionToQualifiedReceiptObserved'):
   self.assertEqual(r[key]['observed'],499);self.assertEqual(r[key]['censored'],1);self.assertTrue(all(r[key]['p%dMs'%p] is None for p in (50,95,99)))

if __name__=='__main__':unittest.main()
