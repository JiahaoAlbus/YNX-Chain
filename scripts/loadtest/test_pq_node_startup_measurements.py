"""Startup diagnostic transport controls; no Go source/runtime qualification."""
import importlib.util,json,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('node_startup_controls',Path(__file__).with_name('pq-node-startup-measurements.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def event(stage,kind,clock,elapsed=0,outcome=None):return dict(version=m.VERSION,clock='monotonic_elapsed_wall_ns',stage=stage,event=kind,outcome=outcome or ('RUNNING' if kind=='begin' else 'SUCCEEDED'),elapsedNs=elapsed,startupElapsedNs=clock)
def raw(events):return b'\n'.join(json.dumps(e).encode() if isinstance(e,dict) else e for e in events)+b'\n'
class NodeStartupControls(unittest.TestCase):
 def test_nested_actual_elapsed_not_endpoint_difference_or_sum(self):
  r=m.parse(raw([event('startup.normalNodeConstructor','begin',12),event('local.applicationColdConstructor','begin',17),event('local.applicationColdConstructor','end',42,30),event('startup.normalNodeConstructor','end',50,46)]));self.assertEqual(r['status'],'COMPLETE_OBSERVED_BOUNDARIES');self.assertEqual([v['elapsedNs'] for v in r['records']],[46,30]);self.assertTrue(r['intervalsOverlap']);self.assertFalse(r['readinessOrNodeStartSuccessInferred'])
 def test_killed_in_proofhost_begin_stays_unknown_not_zero(self):
  r=m.parse(raw([event('startup.prepareOperatorProofHostLive','begin',100)]));self.assertEqual(r['unfinishedRecordIndexes'],[0]);self.assertIsNone(r['records'][0]['elapsedNs']);self.assertEqual(r['records'][0]['outcome'],'RETURN_NOT_OBSERVED');self.assertEqual(r['status'],'PARTIAL_OR_UNKNOWN')
 def test_failed_original_return_retained_as_failed_even_with_duration(self):
  r=m.parse(raw([event('startup.nodeStart','begin',100),event('startup.nodeStart','end',150,49,'REFUSED_OR_UNKNOWN')]));self.assertEqual(r['status'],'COMPLETE_OBSERVED_BOUNDARIES');self.assertEqual(r['records'][0]['outcome'],'REFUSED_OR_UNKNOWN');self.assertEqual(r['records'][0]['elapsedNs'],49);self.assertIsNone(r['businessTPS'])
 def test_malformed_duplicate_key_clock_bool_and_partial_line_not_success(self):
  for bad in [raw([event('x','begin',True)]),raw([event('x','begin',10),event('x','end',9,1)]),b'{"version":"'+m.VERSION.encode()+b'","version":"duplicate"}',b'{"version":"'+m.VERSION.encode()+b'"']:
   r=m.parse(bad);self.assertEqual(r['status'],'PARTIAL_OR_UNKNOWN');self.assertTrue(r['errors'])
 def test_same_stage_overlap_and_orphan_end_are_never_paired_by_guess(self):
  r=m.parse(raw([event('same','begin',1),event('same','begin',2),event('same','end',8,6),event('same','end',9,8),event('other','end',10,4)]));self.assertTrue(r['errors']);self.assertTrue(all(v['elapsedNs'] is None for v in r['records']));self.assertTrue(all(v['pairingAmbiguous'] for v in r['records']))
 def test_sequential_repeated_stage_zero_return_and_nontiming_logs(self):
  r=m.parse(raw([b'I[original normal node log]',event('same','begin',1),event('same','end',1,0),event('same','begin',2),event('same','end',4,2)]));self.assertEqual([v['elapsedNs'] for v in r['records']],[0,2]);self.assertEqual(r['status'],'COMPLETE_OBSERVED_BOUNDARIES');self.assertEqual(r['ignoredNonTimingLines'],1)
 def test_event_and_log_bounds_keep_partial_coverage(self):
  events=[]
  for i in range(130):events.extend([event('same','begin',i*2),event('same','end',i*2+1,1)])
  r=m.parse(raw(events));self.assertEqual(len(r['events']),256);self.assertEqual(r['eventOverflow'],4);self.assertEqual(r['status'],'PARTIAL_OR_UNKNOWN')
  with self.assertRaises(RuntimeError):m.parse(b'x'*(m.MAX_LOG_BYTES+1))
 def test_original_process_flags_and_log_hashes_do_not_infer_readiness(self):
  files={};processes=[];body=raw([event('startup.nodeStart','begin',1)])
  for phase in ('bootstrap','pq'):
   for i in range(4):
    name=phase+'-node-'+str(i);files['public/'+name+'.log']=body;processes.append(dict(name=name,pid=100+i,startTicks=7,rawReturnCode=-9,command=['ynx-comet','start','--startup-timings']))
  r=m.original_nodes(files,'public/',processes);self.assertTrue(r['allEightOriginalLogsObserved']);self.assertFalse(r['allEightRequestedBoundariesComplete']);self.assertEqual(r['nodes'][-1]['rawReturnCode'],-9);self.assertIsNone(r['nodes'][-1]['originalStages']['records'][0]['elapsedNs'])
  del files['public/pq-node-3.log'];self.assertFalse(m.original_nodes(files,'public/',processes)['allEightOriginalLogsObserved'])
 def test_bad_diagnostic_keeps_original_process_exit_and_unknown_duration(self):
  rows=[dict(name='pq-node-0',pid=1,startTicks=7,rawReturnCode=-9,command=['ynx-comet','start','--startup-timings'])];r=m.original_nodes({'pq-node-0.log':b'x'*(m.MAX_LOG_BYTES+1)},'',rows);node=next(v for v in r['nodes'] if v['name']=='pq-node-0');self.assertEqual(node['rawReturnCode'],-9);self.assertEqual(node['originalStages']['status'],'INVALID_OR_UNKNOWN_DIAGNOSTIC');self.assertIsNone(node['originalStages']['elapsedNs'])
 def test_missing_receipt_process_identity_keeps_raw_events_unbound(self):
  body=raw([event('startup.nodeStart','begin',1),event('startup.nodeStart','end',8,7)]);r=m.original_nodes({'pq-node-0.log':body},'',[]);node=next(n for n in r['nodes'] if n['name']=='pq-node-0');self.assertFalse(node['processIdentityBound']);self.assertEqual(node['originalStages']['records'][0]['elapsedNs'],7);self.assertEqual(node['originalStages']['status'],'PARTIAL_OR_UNKNOWN');self.assertFalse(r['allEightProcessIdentitiesBound'] or r['allEightRequestedBoundariesComplete'])
if __name__=='__main__':unittest.main()
