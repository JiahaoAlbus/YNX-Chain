"""Fixed finite profile controls only; never starts the runtime."""
import contextlib,importlib.util,io,json,os
from pathlib import Path
import unittest
from unittest import mock
spec=importlib.util.spec_from_file_location('fixed_live_controller',Path(__file__).with_name('pq-current75-baseline-ci.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class FixedLiveProfileControls(unittest.TestCase):
 def environment(self):
  return dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain',GITHUB_EVENT_NAME='push',GITHUB_REF=c.REF,GITHUB_RUN_ATTEMPT='1',PQ_BASELINE_PROFILE=c.PROFILE,GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/'+c.WORKFLOW+'@'+c.REF,GITHUB_SHA='a'*40,GITHUB_RUN_ID='123')
 def test_fixed_online_normal_fixture_cannot_select_pressure(self):
  options=c.fixed_options(Path('/source'))
  self.assertEqual(vars(options),dict(source='/source',commit=c.GO_SOURCE,mode='online',wire_observation=True,live_network_baseline=True,execute=True))
  self.assertFalse(hasattr(options,'rate'));self.assertFalse(hasattr(options,'seconds'));self.assertFalse(hasattr(options,'staged_publication'))
 def test_prepared_data_never_grants_runtime_physical_or_pressure(self):
  value=c.prepared_data();self.assertFalse(value['executed']);self.assertFalse(value['nodeStartAuthorized']);self.assertFalse(value['pressureAuthorized']);self.assertFalse(value['sourceGrant']);self.assertEqual(value['sourceQualification']['scope'],'SOURCE_ONLY_FINITE_BASELINE');self.assertFalse(value['sourceQualification']['pressureAuthorized'])
  self.assertEqual((value['originalOwnerCount'],value['functionalOwners'],value['perOwnerCapacity'],value['batchSize']),(8,4,32,1));self.assertEqual(value['physicalFaultDomains'],1);self.assertFalse(value['physicalBytesMeasured']);self.assertEqual(value['caps']['totalSeconds'],900);self.assertEqual(value['caps']['cleanupSeconds'],15)
 def test_fixed_first_attempt_host_identity_and_ref_are_required(self):
  with mock.patch.object(c.sys,'platform','linux'):
   c.validate_host(self.environment())
   for key,value in [('GITHUB_REF','refs/heads/main'),('GITHUB_RUN_ATTEMPT','2'),('RUNNER_ENVIRONMENT','self-hosted'),('GITHUB_WORKFLOW_REF','wrong'),('PQ_BASELINE_PROFILE','functional'),('GITHUB_SHA','0'*40)]:
    with self.subTest(key=key),self.assertRaises(RuntimeError):c.validate_host(dict(self.environment(),**{key:value}))
 def test_execute_without_selected_environment_fails_before_source_or_runtime(self):
  with mock.patch.dict(os.environ,{},clear=True),mock.patch.object(c,'checked_source') as checked,mock.patch.object(c,'pinned_module') as load:
   with self.assertRaises(RuntimeError):c.execute(Path('/source'),Path('/tools'))
   checked.assert_not_called();load.assert_not_called()
 def test_default_and_duplicate_arguments_never_execute(self):
  with mock.patch.object(c,'execute') as execute,contextlib.redirect_stdout(io.StringIO()) as output:
   self.assertEqual(c.main([]),0);self.assertFalse(json.loads(output.getvalue())['executed'])
   with self.assertRaisesRegex(RuntimeError,'duplicate'):c.main(['--source','a','--source','b','--execute'])
   execute.assert_not_called()
 def test_workflow_has_one_selected_live_job_and_explicit_supplier_reception(self):
  raw=(Path(__file__).resolve().parents[2]/'.github/workflows/pq-normal-process.yml').read_text()
  self.assertIn("if: github.ref != '"+c.REF+"'",raw)
  self.assertEqual(raw.count('  '+c.PROFILE+':\n'),1)
  self.assertNotIn('  current896-coldready-initialize500-only:',raw)
  self.assertIn('github.run_attempt == 1',raw)
  self.assertIn('fetch --no-tags --depth=1 origin 54b104fb1cdf3d7d2e89e3bc40eafc6d61f8f076',raw)
  self.assertIn(c.GO_SOURCE,raw);self.assertIn(c.TOOLS,raw)
if __name__=='__main__':unittest.main()
