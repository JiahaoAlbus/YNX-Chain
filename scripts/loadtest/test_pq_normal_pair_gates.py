"""Comparison DATA controls only; no signatures, nodes, ON or replay is run."""
import copy,hashlib,importlib.util,json,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('normal_pair_controls',Path(__file__).with_name('pq-normal-live-reader.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
def bundle(app_hash='a'*64,body_prefix='canonical-control',position=0):
 state=dict(height=26,appHash=app_hash,accounts=[dict(address='control-owner',balance=900,nonce=5)],nativeTransfers=[dict(committedAt='real-clock-'+app_hash[0])],feeEvents=[],pqHistory={'full-history':app_hash})
 raw=json.dumps(state).encode();rows=[];requests=[];verifiers=[];confirms=[];exports=[]
 for i in range(4):
  body=(body_prefix+str(i)).encode();tx=hashlib.sha256(body).hexdigest();native=hashlib.sha256(('native'+str(i)).encode()).hexdigest();row=dict(owner=4+i,transactionHash='0x'+tx,nativeHash='0x'+native,height=str(19+2*i+position),qualifiedFinal=True);rows.append(row);requests.append(body)
  proof=dict(transactionType='pq_transfer',transactionHash=tx,nativeWireHash=native,index=str(position),executionCode='0',gasWanted='0',gasUsed='1',executionData='original-control-data',included=True,finalized=True,executionSuccessful=True,outcome='succeeded',nativeGrant=False,block=dict(commitVerified=True,lightTransitionVerified=True,headerTime='real-clock-'+app_hash[0]),successor=dict(commitVerified=True,lightTransitionVerified=True))
  verifiers.append(dict(code='VERIFIED_TRANSACTION_DATA',result=proof));confirms.append(dict(code='PROOF_CONFIRMED_DATA',result=dict(result=copy.deepcopy(proof))));exports.append(dict(sourceReadOnly=True,stoppedNodes=4,engineHeight='26',engineAppHash=app_hash,transactionHash=tx,nativeWireHash=native))
 receipt=dict(sameHost=True,physicalFaultDomains=1,firstCause=None,phaseComplete=True,functionalPhaseComplete=True,cleanupComplete=True,qualifiedFinalCount=4,configuredFunctionalDenominator=4,functionalCohort=rows,allFourStoppedStateSHA256=hashlib.sha256(raw).hexdigest(),networkBaseline=dict(status='OBSERVED'),source=dict(commit='c'*40,tree='d'*40,forkTree='e'*40),caps=dict(cpus=2,rssBytes=4<<30),binaries={name:'f'*64 for name in ['ynx-comet','ynx-consensus-pq-lab','ynx-consensus-proof-verify']},signingMode='online',processes=[dict(name=phase+'-node-'+str(i),pid=100+4*j+i,startTicks=1,rawReturnCode=0,exitCode=0,signal=None,exited=True) for j,phase in enumerate(('bootstrap','pq')) for i in range(4)])
 return dict(receipt=receipt,stoppedStateBytes=raw,canonicalTransactions=requests,originalVerifiers=verifiers,originalConfirms=confirms,originalExports=exports,toolsCommit='1'*40)
class SeparatePairGateControls(unittest.TestCase):
 def test_real_clock_apphash_and_inclusion_positions_are_not_forced_equal(self):
  off=bundle();on=bundle('b'*64,position=1);original=copy.deepcopy(on);data=r.compare_normal_business_data(off,on)
  self.assertEqual(data['status'],'MATCHED_BUSINESS_DATA_ONLY');self.assertTrue(data['independentAppHashesDiffer']);self.assertFalse(data['normalWirePairQualified']);self.assertTrue(data['deterministicReplayRequiredSeparately']);self.assertNotEqual(data['originalInclusionPositions']['OFF'],data['originalInclusionPositions']['ON']);self.assertEqual(on,original)
 def test_random_independent_fixture_is_not_same_canonical_user_bytes(self):
  data=r.compare_normal_business_data(bundle(),bundle('b'*64,body_prefix='other-control'))
  self.assertEqual(data['status'],'NOT_COMPARABLE');self.assertIn('canonical signed user fixture',data['firstCause'])
 def test_missing_or_unknown_leg_never_becomes_complete(self):
  for mutate in [lambda b:b['originalConfirms'].pop(),lambda b:b['receipt'].update(firstCause='original UNKNOWN retained'),lambda b:b['receipt']['processes'][0].update(rawReturnCode=1,exitCode=1)]:
   on=bundle('b'*64);mutate(on);self.assertEqual(r.compare_normal_business_data(bundle(),on)['status'],'NOT_COMPARABLE')
 def test_changed_balances_nonces_or_business_results_are_not_clock_differences(self):
  for key in ('balance','nonce'):
   on=bundle('b'*64);state=json.loads(on['stoppedStateBytes']);state['accounts'][0][key]+=1;raw=json.dumps(state).encode();on['stoppedStateBytes']=raw;on['receipt']['allFourStoppedStateSHA256']=hashlib.sha256(raw).hexdigest()
   self.assertEqual(r.compare_normal_business_data(bundle(),on)['status'],'NOT_COMPARABLE')
  on=bundle('b'*64);on['originalVerifiers'][0]['result']['gasUsed']='2';on['originalConfirms'][0]['result']['result']['gasUsed']='2';self.assertEqual(r.compare_normal_business_data(bundle(),on)['status'],'NOT_COMPARABLE')
 def test_source_binary_or_caps_change_is_not_a_transport_only_pair(self):
  for mutate in [lambda b:b['receipt']['source'].update(commit='0'*40),lambda b:b['receipt']['binaries'].update({'ynx-comet':'0'*64}),lambda b:b['receipt']['caps'].update(cpus=4)]:
   on=bundle('b'*64);mutate(on);self.assertEqual(r.compare_normal_business_data(bundle(),on)['status'],'NOT_COMPARABLE')

class PairedCandidateEntryControls(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  spec=importlib.util.spec_from_file_location('paired_candidate_driver',Path(__file__).with_name('pq-normal-process-lab.py'));cls.driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.driver)
 def test_default_entry_is_inert_before_any_source_or_window(self):
  from unittest import mock
  with mock.patch.object(self.driver.lab,'Window',side_effect=AssertionError('runtime')),mock.patch.object(self.driver.lab,'check_source',side_effect=AssertionError('source')),mock.patch.object(Path,'read_bytes',side_effect=AssertionError('originals')):
   report=self.driver.paired_candidate_main([])
  self.assertFalse(report['ready'] or report['runtimeAuthorized'] or report['pressureAuthorized']);self.assertEqual(report['requiredSupplier']['commit'],'ed628e5cdd00c4496de5b2587bf2e9585aaf3d2d')
 def test_execute_duplicate_and_partial_leg_arguments_are_refused(self):
  import contextlib,io
  for args in [['--execute'],['--off-public','/one','--off-public','/two'],['--off-public','/incomplete']]:
   with contextlib.redirect_stderr(io.StringIO()),self.assertRaises((RuntimeError,SystemExit)):self.driver.paired_candidate_main(args)
 def test_old_off_qualification_cannot_be_a_new_on_qualification(self):
  from unittest import mock
  with mock.patch.object(r,'PAIR_SOURCE_QUALIFICATION',r.NORMAL_LIVE_SOURCE_QUALIFICATION):report=r.prepare_paired_candidate()
  self.assertFalse(report['normalONSourceQualified']);self.assertTrue(any('qualification parser' in reason for reason in report['missing']))
 def test_legacy_or_self_asserted_replay_success_is_not_original_trace(self):
  for flag in (False,True):
   data=dict(schema='YNX-PQ-PER-HEIGHT-DIFFERENTIAL/v1',perHeightFunctionalEqual=True,commonOriginalFinalizeTrajectoryQualified=flag);before=copy.deepcopy(data);report=r.prepare_paired_candidate(replay_data=data)
   self.assertFalse(report['replayGate']['qualified']);self.assertEqual(report['replayGate']['status'],'ORIGINAL_COMPLETE_TRACE_READER_NOT_SUPPLIED');self.assertEqual(data,before)
 def test_data_match_with_current_supplier_still_needs_source_and_full_trace(self):
  off,on=bundle(),bundle('b'*64,position=1)
  for label,leg in [('OFF',off),('ON',on)]:
   leg['provenance']=dict(runID=label,selectedSupplierCommit=r.PAIR_SUPPLIER['commit'],selectedSupplierTree=r.PAIR_SUPPLIER['tree'])
   status='DISABLED' if label=='OFF' else 'OBSERVED';leg['networkData']=dict(losslessStatuses=[dict(start=dict(status=status),end=dict(status=status)) for _ in range(4)])
  report=r.prepare_paired_candidate(off,on);self.assertEqual(report['normalBusinessGate']['status'],'MATCHED_BUSINESS_DATA_ONLY');self.assertFalse(report['ready'] or report['normalWirePairQualified']);self.assertTrue(report['missing'])
  on['provenance']['runID']='OFF';self.assertTrue(any('same original run' in x for x in r.prepare_paired_candidate(off,on)['missing']))
 def test_public_loader_rejects_wrong_receipt_pin_before_other_originals(self):
  import tempfile
  with tempfile.TemporaryDirectory() as tmp:
   public=Path(tmp).resolve();(public/'receipt.json').write_bytes(b'{}')
   with self.assertRaisesRegex(RuntimeError,'externally pinned'):r.read_normal_business_leg(public,'0'*64,'1'*40)
 def test_candidate_output_never_overwrites_original(self):
  import tempfile
  with tempfile.TemporaryDirectory() as tmp:
   target=Path(tmp).resolve()/'candidate.json';target.write_text('original firstcause')
   with self.assertRaises(FileExistsError):self.driver.paired_candidate_main(['--output',str(target)])
   self.assertEqual(target.read_text(),'original firstcause')

if __name__=='__main__':unittest.main()
