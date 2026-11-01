"""Parent timing and original admission controls; no node or performance run."""
import importlib.util,json,os,tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import mock
spec=importlib.util.spec_from_file_location('normal_parent_controls',Path(__file__).with_name('pq-normal-process-lab.py'))
normal=importlib.util.module_from_spec(spec);spec.loader.exec_module(normal)
class ParentMeasurementControls(unittest.TestCase):
 def test_original_guard_return_is_unchanged_and_no_calls_are_not_observed(self):
  original=mock.Mock(return_value='original result');window=SimpleNamespace(sample=original);report=normal.observe_parent_sampling(window)
  self.assertEqual(report()['status'],'NOT_OBSERVED');self.assertIsNone(report()['totalNs'])
  with mock.patch.object(normal.time,'monotonic_ns',side_effect=[100,150]):self.assertEqual(window.sample(),'original result')
  original.assert_called_once_with();self.assertEqual(report()['totalNs'],50);self.assertEqual(report()['calls'],1)
 def test_resource_firstcause_is_preserved_and_failure_cost_is_retained(self):
  error=RuntimeError('original RSS cap exceeded');window=SimpleNamespace(sample=mock.Mock(side_effect=error));report=normal.observe_parent_sampling(window)
  with mock.patch.object(normal.time,'monotonic_ns',side_effect=[10,30]):
   with self.assertRaises(RuntimeError) as context:window.sample()
  self.assertIs(context.exception,error);self.assertEqual(report()['failedCalls'],1);self.assertEqual(report()['totalNs'],20)
 def test_timing_clock_failure_never_skips_or_hides_the_original_guard(self):
  error=RuntimeError('original total deadline');window=SimpleNamespace(sample=mock.Mock(side_effect=error));report=normal.observe_parent_sampling(window)
  with mock.patch.object(normal.time,'monotonic_ns',side_effect=OSError('clock unavailable')):
   with self.assertRaises(RuntimeError) as context:window.sample()
  self.assertIs(context.exception,error);self.assertEqual(window.sample.__name__,'sample');self.assertEqual(report()['status'],'UNKNOWN');self.assertIsNone(report()['totalNs'])
 def test_failed_admission_retains_exact_observation_before_any_runtime(self):
  with tempfile.TemporaryDirectory() as temporary:
   parent=Path(temporary).resolve();args=SimpleNamespace(source=str(parent),commit='a'*40,mode='online',execute=True,wire_observation=False,live_network_baseline=False)
   with mock.patch.dict(os.environ,dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',RUNNER_TEMP=str(parent))),mock.patch.object(normal.sys,'platform','linux'),mock.patch.object(normal.lab,'check_source',return_value={}),mock.patch.object(normal.lab,'git'),mock.patch.object(normal.lab.guard,'proc_inventory',return_value=({},None)),mock.patch.object(normal.lab.guard,'memory_available',return_value=123),mock.patch.object(normal.lab,'heavy_processes',return_value=[]),mock.patch.object(normal.lab,'Window') as window,mock.patch.object(normal.lab,'ports_available') as ports:
    with self.assertRaisesRegex(RuntimeError,'MemAvailable'):normal.run(args)
    window.assert_not_called();ports.assert_not_called()
   paths=list(parent.glob('pq-normal-process-*/public/fresh-resource-admission.json'));self.assertEqual(len(paths),1);record=json.loads(paths[0].read_text());self.assertEqual(record['availableMemoryBytes'],123);self.assertEqual(record['ownedPIDLimit'],16);self.assertEqual(record['caps']['totalSeconds'],900)
 def test_callee_timings_cannot_be_enabled_by_an_unqualified_ordinary_mode(self):
  args=SimpleNamespace(source='/unused',commit='a'*40,mode='online',execute=True,callee_timings=True,live_network_baseline=False)
  with mock.patch.object(normal.lab,'check_source',return_value={}),mock.patch.object(normal.lab,'git'),mock.patch.object(normal.lab,'Window') as window:
   with self.assertRaisesRegex(RuntimeError,'exact qualified'):normal.run(args)
   window.assert_not_called()
 def test_shared_original_callee_schema_keeps_missing_or_fabricated_values_unknown(self):
  sample=dict(version='YNX-PQ-LAB-CALLEE-ELAPSED/v1',clock='monotonic_elapsed_wall_ns',intervalsOverlap=True,stages={'sender.signTotal':dict(calls=1,elapsedNs=123)})
  self.assertIs(normal.callee_snapshot(sample),sample)
  for value in (None,dict(sample,stages={'bad':dict(calls=0,elapsedNs=1)}),dict(sample,clock='UTC'),dict(sample,stages={'bad':dict(calls=1,elapsedNs=-1)})):
   with self.assertRaises(RuntimeError):normal.callee_snapshot(value)
 def test_original_sender_return_with_missing_timing_is_retained_without_retry(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary).resolve();(root/'.private').mkdir();(root/'public').mkdir();private=root/'network/workload/private-senders';private.mkdir(parents=True);(private/'recovery.raw').write_bytes(bytes(32));(private/'recovery.raw').chmod(0o600)
   obj=object.__new__(normal.Ceremony);obj.root=root/'network';obj.bins=root/'bin';obj.pin='a'*64;obj.activation_pin='b'*64;obj.workload_pin='c'*64;obj.preparation_sender_arguments=('--timings',)
   def launch(name,argv,**kwargs):
    self.assertEqual(argv.count('--timings'),1);self.assertEqual(len(kwargs['pass_fds']),1);self.assertEqual(os.fstat(kwargs['pass_fds'][0]).st_size,32)
    (root/'public'/(name+'.log')).write_text(json.dumps({'code':'ORIGINAL_SAVED','result':{'original':'retained'}}));return object()
   launcher=mock.Mock(side_effect=launch);obj.w=SimpleNamespace(work=root,launch=launcher,wait=mock.Mock())
   with self.assertRaisesRegex(RuntimeError,'callee elapsed schema'):obj.sender_command('original-sign',4,{'operation':'sign'})
   launcher.assert_called_once();row=obj.original_sender_timer_records[0];self.assertEqual(row['status'],'RETURN_RECEIVED_TIMING_UNQUALIFIED_NO_RETRY');self.assertIsNone(row['calleeElapsedNs']);self.assertEqual(row['originalLogSHA256'],normal.lab.guard.digest(root/'public/original-sign.log'));self.assertNotIn('result',row)
if __name__=='__main__':unittest.main()
