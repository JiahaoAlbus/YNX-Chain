"""Own1b original source readback and first-window scope controls; no nodes."""
import importlib.util
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
s=importlib.util.spec_from_file_location('first_trial_controls',Path(__file__).with_name('pq-independent-load.py'));d=importlib.util.module_from_spec(s);s.loader.exec_module(d);m=d.first_trial_source

class FirstSourceControls(unittest.TestCase):
 def test_actual_own_source_flows_and_collector_are_not_runtime_or500_input(self):
  q=m.qualification();self.assertEqual(q['source'],m.SOURCE);self.assertEqual([f['actualNamedRunPass'] for f in q['separateOriginalJSONLFlows']],[7,22,24,4,10,6,3]);self.assertEqual(q['startupCollectorCases'],6);self.assertEqual(q['startupRawJSONLCasesReRead'],0);self.assertFalse(q['actual500InitializedOwnersQualified'] or q['wholeResourceCIQualified'] or q['runtimePermissionGranted'] or q['pressureAuthorized'])
 def modified(self,name,operation):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp).resolve()/'originals';shutil.copytree(Path(__file__).with_name('fixtures')/'1b-source',root);operation(root/name)
   with self.assertRaises((RuntimeError,OSError)):m.qualification(root)
 def test_mutated_h_cannot_migrate_old_source_or_grant_runtime(self):self.modified('H.json',lambda p:p.write_bytes(p.read_bytes().replace(b'1b0ea548',b'6cc85996')))
 def test_original_zip_corruption_is_not_silently_repaired(self):self.modified('13563183469.zip',lambda p:p.write_bytes(p.read_bytes()[:-1]))
 def test_missing_original_startup_log_cannot_be_replaced_by_collector_json(self):self.modified('CLIENT-ORIGINAL.log',lambda p:p.unlink())
 def test_mutated_startup_collector_stops_readback(self):self.modified('STARTUP-COLLECTOR-RECEIPTS-FINAL.json',lambda p:p.write_bytes(p.read_bytes()+b' '))

class FirstProfileControls(unittest.TestCase):
 def args(self):return SimpleNamespace(mode='online',rate=100,seconds=5,accounts=500,per_account=1,tail_seconds=30,proof_timeout=30,staged_publication=True,initialize_before_load=True,startup_timings=True,wire_observation=True,network_accounting=True,commit_observation=True,owned_storage_accounting=True,header_hop_capture=False,initialization_only=False,source='/CONTROL_ONLY',commit=m.SOURCE,execute=False)
 def test_prepared_only_consumes_own_source_without_opening_window(self):
  args=self.args()
  with mock.patch.object(d.lab,'check_source',return_value=dict(commit=m.SOURCE,tree=m.TREE)),mock.patch.object(d.lab,'git'),mock.patch.object(d.subprocess,'check_output',return_value=b'live-materials'),mock.patch.object(d.lab,'Window') as window:
   result=d.run(args)
  self.assertFalse(result['actualLoadExecuted']);self.assertTrue(result['sameWindowInitializationRequested']);self.assertTrue(result['sourceFunctionalData']['sourceOnlyQualified']);window.assert_not_called()
 def test_changed_load_or_observer_configuration_cannot_inherit_selection(self):
  for key,value in [('rate',500),('rate',1000),('accounts',499),('per_account',2),('tail_seconds',60),('proof_timeout',60),('startup_timings',False),('commit_observation',False),('initialize_before_load',True)]:
   args=self.args();setattr(args,key,value)
   if key=='initialize_before_load':args.initialization_only=True
   with self.subTest(key=key,value=value),self.assertRaises(RuntimeError):d.validate_options(args)
 def test_new_source_requires_explicit_separate_profile_and_does_not_replace_old_pin(self):
  args=self.args();args.initialize_before_load=False
  with mock.patch.object(d.lab,'Window') as window,self.assertRaisesRegex(RuntimeError,'exact staged normal consumer source'):d.run(args)
  window.assert_not_called();self.assertEqual(d.STAGED_CALLEE_SOURCE,'9081f14654a48f4fe14e57696ec33527869da353');self.assertIsNone(d.STAGED_SOURCE_QUALIFICATION)

if __name__=='__main__':unittest.main()
