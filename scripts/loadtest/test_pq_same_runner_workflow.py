"""Pure inactive-workflow and synthetic official-metadata controls; no uploads."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import types
import unittest
from unittest import mock
import urllib.request


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


w=module('pq-same-runner-workflow')
controls=module('test_pq_same_runner_pair_producer')
controller_controls=module('test_pq_same_runner_controller')


class WorkflowControls(unittest.TestCase):
    def setUp(self):
        patch=mock.patch.object(urllib.request.OpenerDirector,'open',side_effect=AssertionError('pure controls cannot use network'))
        patch.start();self.addCleanup(patch.stop)

    def candidate(self): return Path(__file__).with_name('pq-same-runner-normal-process.yml').read_text()

    def case(self,root):
        case=controls.Case(root);case.run();raws,metadata=case.uploads()
        run,job,artifacts=metadata;run.update(status='in_progress',conclusion=None);job.update(status='in_progress',conclusion=None)
        for step in job['steps']:step['status']='completed'
        manifest=next(a for a in artifacts['artifacts'] if a['name'].endswith('-manifest'))
        artifacts['artifacts'].remove(manifest);artifacts['total_count']=len(artifacts['artifacts'])
        def read(suffix):
            return {'runs/1':run,'jobs/2':job,'runs/1/artifacts?per_page=100':artifacts}[suffix]
        value=dict(pair=case.pair,output=root/'producer',api=types.SimpleNamespace(read=mock.Mock(side_effect=read)))
        env={}
        for artifact in artifacts['artifacts']:
            label=artifact['name'].rsplit('-',1)[1].upper()
            env['YNX_'+label+'_ARTIFACT_ID']=str(artifact['id'])
            env['YNX_'+label+'_ARTIFACT_DIGEST']=artifact['digest'][7:]
        return case,value,env,raws,metadata,manifest

    def finish(self,value,env,raws,metadata,manifest):
        pair=w.seal(value,env)
        raws['manifest']=controls.fixtures.archive({'same-runner-pair.json':w.p.encode(pair)})
        manifest.update(size_in_bytes=len(raws['manifest']),digest='sha256:'+w.r.digest(raws['manifest']))
        metadata[2]['artifacts'].append(manifest);metadata[2]['total_count']+=1
        env['YNX_MANIFEST_ARTIFACT_ID']=str(manifest['id']);env['YNX_MANIFEST_ARTIFACT_DIGEST']=manifest['digest']

    def test_installed_candidate_reverses_to_exact_original_controller_workflow(self):
        raw=self.candidate();self.assertEqual(w.r.digest(w.original_workflow(raw).encode()),w.ORIGINAL_WORKFLOW_SHA256)
        for before,after in (('go-version: \'1.26.11\'','go-version: \'1.26.10\''),
                             ('timeout-minutes: 18','timeout-minutes: 19'),
                             ('cancel-in-progress: false','cancel-in-progress: true')):
            with self.subTest(before=before),self.assertRaises(RuntimeError):w.original_workflow(raw.replace(before,after,1))

    def test_pair_is_explicit_same_job_no_matrix_no_window_on_push_and_time_caps(self):
        raw=self.candidate();job=raw.split('  first100-held-public-owner:\n',1)[1]
        first=raw.split('    name: Normal original',1)[0]
        self.assertIn("inputs.load_profile != '"+w.PROFILE+"'",first)
        for text in ("github.event_name == 'workflow_dispatch'","github.run_attempt == 1",
                     "github.ref == 'refs/heads/"+w.r.BRANCH+"'","inputs.signing_mode == 'online'",
                     'needs: first100-held-controller-controls'):
            self.assertIn(text,job)
        self.assertNotIn('matrix:',job);self.assertNotIn('continue-on-error',job)
        self.assertIn('&& 45 || 18',job);self.assertIn('timeout-minutes: 35',job)
        self.assertGreater(w.JOB_MINUTES,w.EXECUTION_MINUTES);self.assertGreater(w.EXECUTION_MINUTES*60,2*w.ARM_SECONDS)
        self.assertEqual(controller_controls.original.lab.CAPS['totalSeconds'],w.ARM_SECONDS)
        self.assertEqual((w.JOB_MINUTES*60,w.EXECUTION_MINUTES*60),
                         (w.c.PAIR_JOB_SECONDS,w.c.PAIR_EXECUTION_SECONDS))
        self.assertFalse(w.WORKFLOW_PAIR_ENABLED);self.assertIsNone(w.c.bridge.QUALIFIED_PAIR_BINDING)
        jobs=re.findall(r'(?m)^  [a-z0-9-]+:\n',raw.split('jobs:\n',1)[1])
        guards=re.findall(r'(?m)^    if: .*',raw)
        self.assertEqual(len(guards),len(jobs))
        for guard in guards:self.assertTrue(guard.endswith(" && (inputs.load_profile != '"+w.PROFILE+"' || false)"))

    def test_fresh_job_and_execution_deadlines_reserve_both_arms_cleanup_and_uploads(self):
        pair=dict(jobID=2,runID=1,controllerCommit='e'*40,runnerID=9,runnerName='CONTROL')
        job=dict(id=2,run_id=1,run_attempt=1,head_sha='e'*40,status='in_progress',name=w.r.JOB,
            runner_id=9,runner_name='CONTROL',started_at='2026-11-21T00:00:00Z')
        start=w.c.datetime.datetime(2026,11,21,tzinfo=w.c.datetime.timezone.utc).timestamp()
        w.c.pair_time_budget(job,pair,2,0,now=start+100,elapsed=100)
        w.c.pair_time_budget(job,pair,1,0,now=start+1400,elapsed=1000)
        for arms,age,elapsed in ((2,600,0),(2,100,300),(1,1500,1000),(1,1400,1200)):
            with self.subTest(arms=arms,age=age,elapsed=elapsed),self.assertRaisesRegex(RuntimeError,'deadline cannot cover'):
                w.c.pair_time_budget(job,pair,arms,0,now=start+age,elapsed=elapsed)
        for key,value in (('started_at',None),('run_attempt',2),('runner_id',10),('status','completed')):
            with self.subTest(key=key),self.assertRaises((RuntimeError,ValueError)):
                w.c.pair_time_budget(dict(job,**{key:value}),pair,2,0,now=start+100,elapsed=100)

    def test_deadline_refusal_prevents_driver_or_window_entry(self):
        adapter=object.__new__(w.c.RevalidatedArm);adapter.retained_roots=('/CONTROL',)
        error=RuntimeError('CONTROL remaining original job deadline')
        adapter._deadline_check=mock.Mock(side_effect=error)
        with mock.patch.object(adapter,'qualify'),mock.patch.object(adapter,'admit'), \
                mock.patch.object(w.c.bridge.OriginalDriverAdapter,'execute') as execute, \
                mock.patch.dict(os.environ,{},clear=False):
            os.environ.pop('GH_TOKEN',None);os.environ.pop('GITHUB_TOKEN',None)
            with self.assertRaises(RuntimeError) as raised:adapter.execute(mock.Mock())
            self.assertIs(raised.exception,error);execute.assert_not_called()

    def test_checkout_setup_and_three_uploads_are_after_default_closed_preflight(self):
        raw=self.candidate();block=raw.split('# BEGIN YNX_PAIR_RUNTIME_STEPS',1)[1]
        self.assertLess(block.index('workflow.py checkouts'),block.index('path: source-before'))
        self.assertLess(block.index('workflow.py checkouts'),block.index('actions/setup-go@'))
        self.assertEqual(block.count('pq-same-runner-controller.py --execute'),1)
        self.assertEqual(block.count('actions/upload-artifact@'),3)
        self.assertEqual(block.count('include-hidden-files: false'),3)
        self.assertEqual(block.count('if-no-files-found: error'),3)
        self.assertEqual(block.count('overwrite: false'),3)
        self.assertLess(block.index('Preserve same-runner before'),block.index('workflow.py seal'))
        self.assertLess(block.index('Preserve same-runner after'),block.index('workflow.py seal'))
        self.assertLess(block.index('workflow.py seal'),block.index('Preserve same-runner manifest'))
        self.assertLess(block.index('Preserve same-runner manifest'),block.index('workflow.py verify'))
        self.assertNotIn('.private',block);self.assertNotIn('pq-independent-load-*',block)
        for step in re.split(r'(?=^      - name:)',block,flags=re.M)[1:]:
            self.assertRegex(step,r"(?m)^        if: .*inputs\.load_profile == '"+w.PROFILE+r"'")
        for label in ('before','after','manifest'):
            self.assertIn('path: ${{ steps.pair-inputs.outputs.output }}/'+label+'/',block)
        with mock.patch.object(w.c,'ActionsMetadata') as api,mock.patch.object(w.c,'checkout') as checkout:
            for phase in ('checkouts','seal','verify'):
                with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):w.main([phase])
            api.assert_not_called();checkout.assert_not_called()

    def test_frozen_outputs_refuse_external_go_and_cannot_overwrite_runner_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();binding=dict(schema='YNX-PERF-ORIGINAL-PAIR-BINDING/v1',
                arms=dict(before=controller_controls.arm(),after=controller_controls.arm()))
            values=w.checkout_values(dict(binding=binding,output=root/'producer'))
            path=root/'outputs';path.touch();w.action_outputs(values,path,root)
            self.assertIn('before_source='+'1'*40,path.read_text())
            with self.assertRaisesRegex(RuntimeError,'single-use'):w.action_outputs(values,path,root)
            alias=root/'alias';alias.symlink_to(path)
            with self.assertRaises(OSError):w.action_outputs(values,alias,root)
            for arm in binding['arms'].values():arm['go']='go1.26.11\nINJECT=value'
            with self.assertRaises(RuntimeError):w.checkout_values(dict(binding=binding,output=root/'producer'))

    def test_three_official_uploads_then_terminal_original_reader_preserve_full500_unknown(self):
        with tempfile.TemporaryDirectory() as temp:
            case,value,env,raws,metadata,manifest=self.case(Path(temp).resolve())
            self.finish(value,env,raws,metadata,manifest)
            result=w.verify(value,env)
            self.assertFalse(result['terminalOriginalZIPReadback']);self.assertFalse(result['runtimeQualified'])
            self.assertEqual(result['configuredDemandPerArm'],500)
            for arm in w.r.ARMS:self.assertTrue((case.adapters[arm].work/'.private/original-UNKNOWN').exists())
            # A real hosted collector waits for terminal metadata. This change
            # is ONLY synthetic fixture evolution; no API result is rewritten.
            metadata[0].update(status='completed',conclusion='success')
            metadata[1].update(status='completed',conclusion='success')
            report=controls.fixtures.read(raws,metadata,case.fixture.expected)
            self.assertEqual(report['configuredDemandPerArm'],500)
            self.assertFalse(report['independentFinality']);self.assertFalse(report['sustainedTPSQualified'])
            self.assertFalse(report['unknownReplayed'])

    def test_wrong_official_identity_digest_duplicate_and_partial_inventory_refuse(self):
        with tempfile.TemporaryDirectory() as temp:
            _,value,env,_,metadata,_=self.case(Path(temp).resolve())
            for key,replacement in (('id',99),('digest','sha256:'+'0'*64),('expired',True),('size_in_bytes',True)):
                saved=metadata[2]['artifacts'][0][key];metadata[2]['artifacts'][0][key]=replacement
                with self.subTest(key=key),self.assertRaises(RuntimeError):w.metadata(value,w.r.ARMS,env)
                metadata[2]['artifacts'][0][key]=saved
            metadata[2]['total_count']+=1
            with self.assertRaisesRegex(RuntimeError,'complete bounded'):w.metadata(value,w.r.ARMS,env)
            metadata[2]['artifacts'].append(copy.deepcopy(metadata[2]['artifacts'][0]))
            with self.assertRaisesRegex(RuntimeError,'upload step'):w.metadata(value,w.r.ARMS,env)

    def test_foreign_runner_or_replayed_attempt_cannot_bind_uploads(self):
        with tempfile.TemporaryDirectory() as temp:
            _,value,env,_,metadata,_=self.case(Path(temp).resolve())
            for key,replacement in (('runner_id',10),('head_sha','f'*40),('run_attempt',2),('run_id',2)):
                saved=metadata[1][key];metadata[1][key]=replacement
                with self.subTest(key=key),self.assertRaises(RuntimeError):w.metadata(value,w.r.ARMS,env)
                metadata[1][key]=saved
            for record,key in ((metadata[0],'id'),(metadata[1],'run_id'),(metadata[2]['artifacts'][0]['workflow_run'],'id')):
                saved=record[key];record[key]=True
                with self.subTest(boolean=key),self.assertRaises(RuntimeError):w.metadata(value,w.r.ARMS,env)
                record[key]=saved

    def test_source_credential_is_removed_before_actual_checkout_subprocess_even_on_failure(self):
        import subprocess,sys
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'controller').mkdir()
            binding=dict(schema='YNX-PERF-ORIGINAL-PAIR-BINDING/v1',
                arms=dict(before=controller_controls.arm(),after=controller_controls.arm()))
            env=dict(GITHUB_WORKSPACE=str(root),RUNNER_TEMP=str(root),GH_TOKEN='CONTROL private transport')
            pair=dict(controllerCommit='e'*40,runID=1,jobID=2)
            error=OSError('CONTROL checkout failed')
            def checkout(*args):
                result=subprocess.run([sys.executable,'-I','-c',
                    "import os;raise SystemExit(int(any(k in os.environ for k in ('GH_TOKEN','GITHUB_TOKEN'))))"],check=False)
                self.assertEqual(result.returncode,0)
                raise error
            with mock.patch.object(w.c.bridge,'QUALIFIED_PAIR_BINDING',binding), \
                    mock.patch.object(w.c,'active_pair',return_value=pair), \
                    mock.patch.object(w.c,'checkout',side_effect=checkout), \
                    mock.patch.object(w,'__file__',str(root/'controller/scripts/loadtest/pq-same-runner-workflow.py')), \
                    mock.patch.dict(os.environ,GH_TOKEN='CONTROL ambient',GITHUB_TOKEN='CONTROL ambient two'):
                with self.assertRaises(OSError) as raised:w.context(env)
                self.assertIs(raised.exception,error)
                self.assertNotIn('GH_TOKEN',env);self.assertNotIn('GH_TOKEN',os.environ);self.assertNotIn('GITHUB_TOKEN',os.environ)

    def test_terminal_reader_rejects_truncated_official_artifact_inventory(self):
        with tempfile.TemporaryDirectory() as temp:
            case,value,env,raws,metadata,manifest=self.case(Path(temp).resolve());self.finish(value,env,raws,metadata,manifest)
            metadata[0].update(status='completed',conclusion='success');metadata[1].update(status='completed',conclusion='success')
            metadata[2]['total_count']+=1
            with self.assertRaisesRegex(RuntimeError,'complete bounded'):
                controls.fixtures.read(raws,metadata,case.fixture.expected)

    def test_upload_failure_preserves_original_first_cause_without_creating_after_arm(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();case=controls.Case(root);case.adapters['before'].mode='first-cause';result=case.run()
            value=dict(pair=case.pair,output=root/'producer',api=types.SimpleNamespace(read=mock.Mock()))
            with self.assertRaisesRegex(RuntimeError,'first cause'):w.seal(value,{})
            value['api'].read.assert_not_called()
            saved=json.loads((root/'producer/manifest/INCOMPLETE.json').read_bytes())
            self.assertEqual(saved['originalProducer']['firstCause'],result['firstCause'])
            self.assertFalse((root/'producer/after').exists())
            self.assertFalse((root/'producer/manifest/same-runner-pair.json').exists())
            self.assertTrue((case.adapters['before'].work/'.private/original-UNKNOWN').exists())

    def test_missing_producer_or_private_hardlink_never_creates_failure_upload_payload(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();output=root/'producer';output.mkdir()
            value=dict(output=output,pair={},api=types.SimpleNamespace(read=mock.Mock()))
            with self.assertRaises(FileNotFoundError):w.seal(value,{})
            self.assertFalse((output/'manifest').exists())
            private=root/'.private';private.mkdir();original=private/'CONTROL-not-a-real-secret'
            original.write_bytes(b'CONTROL private content must not become a public failure payload')
            os.link(original,output/'PRODUCER.json')
            with self.assertRaisesRegex(RuntimeError,'hard-link'):w.seal(value,{})
            self.assertFalse((output/'manifest').exists());self.assertTrue(original.exists())
            value['api'].read.assert_not_called()

    def test_manifest_or_payload_changed_after_upload_cannot_verify(self):
        with tempfile.TemporaryDirectory() as temp:
            _,value,env,raws,metadata,manifest=self.case(Path(temp).resolve());self.finish(value,env,raws,metadata,manifest)
            path=value['output']/'manifest/same-runner-pair.json';path.write_bytes(path.read_bytes()+b' ')
            with self.assertRaisesRegex(RuntimeError,'manifest changed'):w.verify(value,env)

    def test_metadata_transport_adds_only_exact_original_artifact_list_route(self):
        api=w.c.ActionsMetadata('CONTROL only');opener=mock.Mock();response=mock.MagicMock()
        response.__enter__.return_value=response;response.status=200
        response.url='https://api.github.com/repos/'+w.c.REPOSITORY+'/actions/runs/1/artifacts?per_page=100'
        response.read.return_value=b'{"total_count":0,"artifacts":[]}'
        opener.open.return_value=response
        with mock.patch.object(w.c.urllib.request,'build_opener',return_value=opener):
            self.assertEqual(api.read('runs/1/artifacts?per_page=100')['total_count'],0)
            for suffix in ('runs/1/artifacts','runs/1/artifacts?per_page=100&page=2','artifacts/1/zip'):
                with self.assertRaises(RuntimeError):api.read(suffix)


if __name__=='__main__':unittest.main()
