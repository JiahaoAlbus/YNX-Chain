"""Opt-in original startup transport controls; no nodes or source grants."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest import mock
from types import SimpleNamespace

s=importlib.util.spec_from_file_location('preparation_startup_controls',Path(__file__).with_name('pq-independent-load.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class PreparationStartupControls(unittest.TestCase):
 def ceremony(self,enabled=True):
  obj=object.__new__(m.LoadCeremony);obj.consumer_source=next(iter(m.STARTUP_TIMING_ABI_SOURCES));obj.startup_timings_enabled=enabled;obj.preparation_startup_measurements=[]
  return obj
 def reply(self):
  return dict(calleeElapsedNs=123,timings=dict(version='YNX-PQ-LAB-CALLEE-ELAPSED/v1',clock='monotonic_elapsed_wall_ns',intervalsOverlap=True,stages={'checkpoint.nodeReadAndValidate':dict(calls=4,elapsedNs=100)}))
 def test_opt_in_preserves_original_reply_and_nested_elapsed(self):
  obj=self.ceremony();reply=self.reply();args=['registration','--synthetic','--node','0'];saved=list(args)
  with mock.patch.object(m.normal.Ceremony,'call',return_value=reply) as call:
   self.assertIs(obj.call('registration-0',args),reply);self.assertEqual(call.call_args.args,('registration-0',saved+['--timings']))
  self.assertEqual(args,saved);row=obj.preparation_startup_measurements[0];self.assertEqual(row['calleeElapsedNs'],123);self.assertEqual(row['timings'],reply['timings']);self.assertFalse(row['sourceGrant'])
  reply['timings']['stages'].clear();self.assertTrue(row['timings']['stages'])
 def test_old_default_and_other_operations_do_not_add_flags(self):
  for enabled,args in [(False,['activate']), (True,['create']), (True,['live-materials','setup','--timings'])]:
   obj=self.ceremony(enabled)
   with mock.patch.object(m.normal.Ceremony,'call',return_value={}) as call:
    obj.call('original',args);self.assertEqual(call.call_args.args,('original',args))
   self.assertEqual(obj.preparation_startup_measurements,[])
 def test_missing_timer_retains_received_unknown_reply(self):
  obj=self.ceremony()
  with mock.patch.object(m.normal.Ceremony,'call',return_value={}),self.assertRaises(RuntimeError):obj.call('activate-original',['activate'])
  self.assertEqual(obj.preparation_startup_measurements[0]['status'],'ORIGINAL_REPLY_TIMING_UNKNOWN');self.assertIsNone(obj.preparation_startup_measurements[0]['calleeElapsedNs'])
 def test_original_failure_is_not_replaced_or_retried(self):
  obj=self.ceremony();original=RuntimeError('original refusal')
  with mock.patch.object(m.normal.Ceremony,'call',side_effect=original) as call,mock.patch.object(obj,'retain_failed_callee') as retain,self.assertRaises(RuntimeError) as caught:obj.call('activate-original',['activate'])
  self.assertIs(caught.exception,original);self.assertEqual(call.call_count,1);retain.assert_called_once_with('activate-original');self.assertEqual(obj.preparation_startup_measurements,[])
 def test_duplicate_flags_and_overflow_refuse_before_new_operation(self):
  for args,rows in [(['activate','--timings'],[]),(['activate','--timings=false'],[]),(['registration'],[{}]*5)]:
   obj=self.ceremony();obj.preparation_startup_measurements=copy.deepcopy(rows)
   with mock.patch.object(m.normal.Ceremony,'call') as call,self.assertRaises(RuntimeError):obj.call('original',args)
   call.assert_not_called()
 def test_both_original_node_lifetimes_and_legacy_arguments(self):
  for enabled in (False,True):
   obj=self.ceremony(enabled)
   for phase in ('bootstrap','pq'):
    with mock.patch.object(m.normal.Ceremony,'wire_arguments',return_value=['--original','value']):self.assertEqual(obj.wire_arguments(phase,0),['--original','value']+(['--startup-timings'] if enabled else []))
 def test_unsupported_source_refuses_before_constructing_custody(self):
  with mock.patch.object(m.normal.Ceremony,'__init__') as original,self.assertRaises(RuntimeError):m.LoadCeremony(operations=1,proof_timeout=5,consumer_source=m.STAGED_CALLEE_SOURCE,startup_timings=True)
  original.assert_not_called()
 def test_normal_entry_flag_cannot_grant_new_source_or_modify_old_source(self):
  for source,message in [(m.STAGED_CALLEE_SOURCE,'startup timing ABI'),('1b0ea548aca6b5260a9824d0edd3012d52e53521','exact staged normal consumer source')]:
   args=SimpleNamespace(mode='online',rate=100,seconds=5,accounts=500,per_account=1,tail_seconds=30,proof_timeout=30,staged_publication=True,commit=source,startup_timings=True,execute=True)
   with mock.patch.object(m.lab,'Window') as window,mock.patch.object(m.lab,'check_source') as check,self.assertRaisesRegex(RuntimeError,message):m.run(args)
   window.assert_not_called();check.assert_not_called()

if __name__=='__main__':unittest.main()
