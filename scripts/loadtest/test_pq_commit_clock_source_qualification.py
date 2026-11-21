"""Closed synthetic source/CI controls; no network, node or runtime grant."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('original_clock_ci',Path(__file__).with_name('pq-commit-clock-source-qualification.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class ClockSourceQualificationControls(unittest.TestCase):
    def fixture(self):
        binding=dict(source='a'*40,tree='b'*40,forkTree='c'*40,branch='codex/clock-fixture',run=101,focusedJob=102,deliveryJob=103,caddyJob=104,verifierJob=105)
        identity=dict(commit=binding['source'],tree=binding['tree'],forkTree=binding['forkTree'])
        run=dict(id=101,head_sha=binding['source'],head_branch=binding['branch'],event='push',run_attempt=1,
            workflow_id=m.WORKFLOW_ID,repository=dict(full_name=m.REPOSITORY),path=m.WORKFLOW_PATH,status='completed',conclusion='success')
        def job(name,number,steps):
            return dict(id=number,run_id=101,run_attempt=1,run_url='https://api.github.com/repos/'+m.REPOSITORY+'/actions/runs/101',head_sha=binding['source'],head_branch=binding['branch'],name=name,
                status='completed',conclusion='success',steps=[dict(name=n,status='completed',conclusion='success') for n in steps])
        focused=job('focused-go',102,(*m.held.REQUIRED_STEPS,*m.EXTRA_FOCUSED_STEPS))
        delivery=job('protocol-delivery',103,m.held.DELIVERY_STEPS)
        return binding,identity,run,focused,[copy.deepcopy(focused),delivery,job('caddy-source',104,m.CADDY_STEPS),job('proof-verifier-macos',105,m.VERIFIER_STEPS)]

    def test_default_gate_refuses_before_any_metadata_call(self):
        self.assertIsNone(m.BINDING);calls=[]
        with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):m.qualification({},metadata_reader=calls.append)
        self.assertEqual(calls,[])
        binding,identity,_,_,_=self.fixture();identity['forkTree']='d'*40
        with mock.patch.object(m,'BINDING',binding),self.assertRaisesRegex(RuntimeError,'source/tree/fork differs'):
            m.qualification(identity,metadata_reader=calls.append)
        self.assertEqual(calls,[])

    def test_exact_same_run_jobs_and_three_metadata_objects(self):
        binding,identity,run,focused,jobs=self.fixture();calls=[]
        def read(endpoint):
            calls.append(endpoint)
            return {'runs/101':run,'jobs/102':focused,'runs/101/jobs?per_page=100':dict(total_count=4,jobs=jobs)}[endpoint]
        with mock.patch.object(m,'BINDING',binding):result=m.qualification(identity,metadata_reader=read)
        self.assertEqual(calls,['runs/101','jobs/102','runs/101/jobs?per_page=100','runs/101'])
        self.assertFalse(result['runtimePermissionGranted'] or result['pressureAuthorized'] or result['independentFinality'])
        self.assertFalse(result['binaryAndLiveProcessIndependentlyBound'])

    def test_wrong_source_run_attempt_or_job_cannot_borrow_evidence(self):
        for case in ('source','tree','fork','run_id','source_sha','branch','dispatch','attempt','workflow','repo','run_failure','focus_id','job_run','job_sha','job_branch','job_attempt','job_failure','duplicate_job','focus_copy','delivery_id','missing_verifier','skipped_caddy','job_url'):
            with self.subTest(case=case):
                binding,identity,run,focused,jobs=self.fixture()
                if case=='source':identity['commit']='d'*40
                elif case=='tree':identity['tree']='d'*40
                elif case=='fork':identity['forkTree']='d'*40
                elif case=='run_id':run['id']=102
                elif case=='source_sha':run['head_sha']='d'*40
                elif case=='branch':run['head_branch']='codex/another'
                elif case=='dispatch':run['event']='workflow_dispatch'
                elif case=='attempt':run['run_attempt']=2
                elif case=='workflow':run['workflow_id']+=1
                elif case=='repo':run['repository']['full_name']='other/repo'
                elif case=='run_failure':run['conclusion']='failure'
                elif case=='focus_id':focused['id']=True
                elif case=='job_run':jobs[1]['run_id']=102
                elif case=='job_sha':jobs[1]['head_sha']='d'*40
                elif case=='job_branch':jobs[1]['head_branch']='codex/another'
                elif case=='job_attempt':jobs[1]['run_attempt']=2
                elif case=='job_failure':jobs[1]['conclusion']='failure'
                elif case=='duplicate_job':jobs.append(copy.deepcopy(jobs[1]))
                elif case=='focus_copy':focused['steps'][0]['conclusion']='failure'
                elif case=='delivery_id':binding['deliveryJob']=999
                elif case=='missing_verifier':jobs.pop()
                elif case=='skipped_caddy':jobs[2]['conclusion']='skipped'
                else:jobs[1]['run_url']='https://api.github.com/repos/other/actions/runs/101'
                with self.assertRaises(RuntimeError):m.validate(binding,identity,run,focused,jobs)

    def test_every_original_focused_and_delivery_step_is_unique_success(self):
        binding,identity,run,focused,jobs=self.fixture()
        for which,names in ((0,(*m.held.REQUIRED_STEPS,*m.EXTRA_FOCUSED_STEPS)),(1,m.held.DELIVERY_STEPS),(2,m.CADDY_STEPS),(3,m.VERIFIER_STEPS)):
            for name in names:
                for mutation in ('missing','duplicate','skipped','failed'):
                    with self.subTest(job=which,name=name,mutation=mutation):
                        selected=copy.deepcopy(jobs);steps=selected[which]['steps'];index=next(i for i,x in enumerate(steps) if x['name']==name)
                        if mutation=='missing':steps.pop(index)
                        elif mutation=='duplicate':steps.append(copy.deepcopy(steps[index]))
                        else:steps[index]['conclusion']='skipped' if mutation=='skipped' else 'failure'
                        fetched=copy.deepcopy(selected[0]) if which==0 else focused
                        with self.assertRaises(RuntimeError):m.validate(binding,identity,run,fetched,selected)

    def test_inventory_incomplete_or_metadata_exception_never_falls_back(self):
        binding,identity,run,focused,jobs=self.fixture()
        for malformed in (dict(total_count=5,jobs=jobs),dict(total_count=True,jobs=jobs)):
            calls=[]
            def read(endpoint):
                calls.append(endpoint)
                return {'runs/101':run,'jobs/102':focused,'runs/101/jobs?per_page=100':malformed}[endpoint]
            with mock.patch.object(m,'BINDING',binding),self.assertRaises(RuntimeError):m.qualification(identity,metadata_reader=read)
            self.assertEqual(len(calls),3)
        def failure(endpoint):raise OSError('original API unavailable')
        with mock.patch.object(m,'BINDING',binding),self.assertRaisesRegex(OSError,'original API unavailable'):
            m.qualification(identity,metadata_reader=failure)

    def test_duplicate_and_nonfinite_metadata_refused(self):
        for raw in (b'{"id":1,"id":2}',b'{"id":NaN}'):
            with self.assertRaises(RuntimeError):m.strict(raw)

    def test_boolean_fetched_job_id_cannot_alias_integer_one(self):
        binding,identity,run,focused,jobs=self.fixture();binding['focusedJob']=1;jobs[0]['id']=1;focused['id']=True
        with self.assertRaisesRegex(RuntimeError,'focused job differs'):m.validate(binding,identity,run,focused,jobs)

    def test_rerun_during_original_inventory_fails_closed(self):
        binding,identity,run,focused,jobs=self.fixture();calls=[]
        def read(endpoint):
            calls.append(endpoint)
            if endpoint=='runs/101' and calls.count(endpoint)==2:return dict(run,run_attempt=2)
            return {'runs/101':run,'jobs/102':focused,'runs/101/jobs?per_page=100':dict(total_count=4,jobs=jobs)}[endpoint]
        with mock.patch.object(m,'BINDING',binding),self.assertRaisesRegex(RuntimeError,'run changed'):
            m.qualification(identity,metadata_reader=read)
        calls=[]
        def changed_repository(endpoint):
            calls.append(endpoint)
            if endpoint=='runs/101' and calls.count(endpoint)==2:return dict(run,repository=dict(full_name='other/repo'))
            return {'runs/101':run,'jobs/102':focused,'runs/101/jobs?per_page=100':dict(total_count=4,jobs=jobs)}[endpoint]
        with mock.patch.object(m,'BINDING',binding),self.assertRaisesRegex(RuntimeError,'run changed'):
            m.qualification(identity,metadata_reader=changed_repository)


if __name__=='__main__':unittest.main(verbosity=2)
