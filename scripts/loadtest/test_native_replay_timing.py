"""Actual signed Go diagnostic fixture and timing corruption cases; no nodes."""
import copy,importlib.util,json,os,unittest
from pathlib import Path
p=Path(__file__).with_name('native-stream-evidence.py');spec=importlib.util.spec_from_file_location('replay_evidence',p);e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)

class NativeReplayTimingTests(unittest.TestCase):
 def test_real_signed_public_fixture_keeps_both_children_and_complete_stream(self):
  value=os.environ.get('YNX_NATIVE_REPLAY_TIMING_PUBLIC_FIXTURE_DIR');self.assertTrue(value,'actual new Go fixture is mandatory')
  root=Path(value);scope=json.loads((root/'PUBLIC_FIXTURE_SCOPE.json').read_bytes());plan=json.loads((root/'transactions-result.json.streaming-plan.json').read_bytes())
  self.assertTrue(plan['nativePrefix']['replayTiming']);self.assertTrue(plan['nativePrefix']['clientProcs2']);self.assertEqual(plan['profile'],'scoped_native_prefix_stream8_prepared_grouped_replay_timing_procs2_v1')
  self.assertFalse(scope['independentBFTProof']);phases=scope['durableReadback']['prefixReplay']['workPhases']
  e.certificate_publish_measurements(phases,32<<20,required=True,native_clone=True,prepared_native=True)
  got=e.suffix_replay_measurements(phases,True);self.assertTrue(got['localReplayOnly']);self.assertFalse(got['nodeDurabilityMeasured'])
  manifest=(root/'network-manifest.json').read_bytes();initial=json.loads((root/'transactions.json').read_bytes())['transactions']
  proof=e.verify_streams(root,scope['runtimeNetworkRoot'],scope['runtimeOutput'],manifest,initial,scope['intents'],scope['terminalStream'],scope['latest'],scope['rounds'],64<<20)
  self.assertEqual(proof['validatedRecords'],102)
  for fault in ('missing','bool','negative','frame_parent','final_parent','fee_parent','fee_calls','extra','deselected'):
   bad=copy.deepcopy(phases);d=bad['suffixReplayDetails']
   if fault=='missing':d.pop('finalizeDetails')
   if fault=='bool':d['finalize']['calls']=True
   if fault=='negative':d['readFrame']['durationNs']=-1
   if fault=='frame_parent':d['readFrame']['durationNs']=bad['suffixReplay']['durationNs']+1
   if fault=='final_parent':d['finalizeDetails']['sealState']['durationNs']=d['finalize']['durationNs']+1
   if fault=='fee_parent':d['finalizeDetails']['transactionDetails']['nativeFeeEventAppend']['durationNs']=d['finalizeDetails']['transactionDetails']['nativeApplyState']['durationNs']+1
   if fault=='fee_calls':d['finalizeDetails']['transactionDetails']['nativeFeeEventAppend']['calls']=d['finalizeDetails']['transactionDetails']['nativeApplyState']['calls']+1
   if fault=='extra':d['fabricatedNodeDurability']={}
   with self.subTest(fault=fault),self.assertRaises(RuntimeError):e.suffix_replay_measurements(bad,fault!='deselected')
  with self.assertRaises(RuntimeError):e.suffix_replay_measurements({},True)

if __name__=='__main__':unittest.main()
