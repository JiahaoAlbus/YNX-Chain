"""Normal initialization controller pure controls. No Go/nodes/network."""
import contextlib,hashlib,importlib.util,io,json,tempfile,unittest
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location('initialization_ci',Path(__file__).with_name('pq-current75-baseline-ci.py'));entry=importlib.util.module_from_spec(spec);spec.loader.exec_module(entry)
class InitializationControllerControls(unittest.TestCase):
    def test_default_inert_and_full500_not_assumed(self):
        with mock.patch.object(entry,'execute',side_effect=AssertionError('execute')),mock.patch.object(entry,'git',side_effect=AssertionError('git')),contextlib.redirect_stdout(io.StringIO()) as out:self.assertEqual(entry.main([]),0)
        d=json.loads(out.getvalue());self.assertFalse(d['executed'] or d['pressureAuthorized'] or d['actual500InitializationQualified']);self.assertEqual(d['configuredBusinessDemand'],500)
    def test_fixed_source_caps_exact500_and_no_business_load(self):
        a=entry.fixed_options(Path('/source'));self.assertEqual((a.accounts,a.per_account,a.rate,a.seconds),(500,1,100,5));self.assertTrue(a.initialization_only and a.staged_publication);self.assertFalse(a.network_accounting or a.header_hop_capture);self.assertEqual(entry.GO_SOURCE,'896ea094c985cd4b9e90681e436285a9bba0a979');self.assertEqual(entry.CAPS['totalSeconds'],900);self.assertEqual(entry.CAPS['cpus'],2)
    def test_workflow_uses_only_exact_init_profile_and_pinned_tools(self):
        raw=(Path(__file__).parents[2]/'.github/workflows/pq-normal-process.yml').read_text();self.assertIn('ref: '+entry.TOOLS,raw);self.assertIn('ref: '+entry.GO_SOURCE,raw);self.assertIn('id: initialization',raw);self.assertNotIn('id: load',raw);self.assertNotIn('currentc06-online',raw);self.assertIn('test_pq_initialization_measurements.py -v',raw);self.assertIn('Original61 pure controls reused',raw)
    def test_nonhosted_or_wrong_profile_ref_attempt_refused_before_runtime(self):
        with mock.patch.object(entry.sys,'platform','darwin'),mock.patch.object(entry,'git') as git:
            with self.assertRaises(RuntimeError):entry.execute(Path('/source'),Path('/tools'))
            git.assert_not_called()
        env=dict(GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',GITHUB_REPOSITORY='JiahaoAlbus/YNX-Chain',GITHUB_EVENT_NAME='push',GITHUB_REF=entry.REF,GITHUB_RUN_ATTEMPT='1',PQ_BASELINE_PROFILE=entry.PROFILE,GITHUB_WORKFLOW_REF='JiahaoAlbus/YNX-Chain/'+entry.WORKFLOW+'@'+entry.REF,GITHUB_SHA='a'*40,GITHUB_RUN_ID='123')
        with mock.patch.object(entry.sys,'platform','linux'):
            entry.validate_host(env)
            for k,v in [('PQ_BASELINE_PROFILE','currentc06-online-100x5-commitstages'),('GITHUB_REF','refs/heads/main'),('GITHUB_RUN_ATTEMPT','2')]:
                with self.subTest(k=k),self.assertRaises(RuntimeError):entry.validate_host(dict(env,**{k:v}))
    def test_modified_pinned_python_not_imported(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'bad.py';p.write_text("raise AssertionError('must not execute')")
            with self.assertRaises(RuntimeError):entry.pinned_module('bad',p,'0'*64)
    def test_no_rate_account_or_duplicate_cli_override(self):
        for args in [['--rate','1000'],['--accounts','8'],['--source','a','--source','b']]:
            with contextlib.redirect_stderr(io.StringIO()),self.assertRaises((RuntimeError,SystemExit)):entry.main(args)
if __name__=='__main__':unittest.main()
