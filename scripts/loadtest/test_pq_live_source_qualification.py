"""Finite source intake controls only; mock facts are not actual CI evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('live_source_intake',Path(__file__).with_name('pq-live-source-qualification.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def log(*markers):return b''.join(('2026-11-01T12:00:00.0000000Z '+name+' '+json.dumps(value)+'\n').encode() for name,value in markers)
def inputs():
    runs={str(run):dict(id=run,head_sha=m.SOURCE,head_branch='codex/ynx-pq-perf-integration',path=path,event='push',run_attempt=1,status='completed',conclusion='success') for run,path in [(m.RESOURCE_RUN,'.github/workflows/resource-market-ci.yml'),(m.CHAIN_RUN,'.github/workflows/chain-core.yml')]}
    required={'resource':['Exercise original lab callee readiness and actual cold costs','Verify complete state bridge and sponsor continuity'],'commit':['Execute every new Commit case and affected original stop cases'],'client':['Verify normal PQ lab producers and the original proof caller','Verify the default-off normal node wire observation adapter']}
    jobs={key:dict(id=job,run_id=run,head_sha=m.SOURCE,name=name,status='completed',conclusion='success',steps=[dict(name=n,status='completed',conclusion='success') for n in required[key]]) for key,(run,job,name) in m.JOBS.items()}
    state=dict(sourceCommit=m.SOURCE,suitePassed=True,requiredPassed=sorted(m.LIVE_CASES),performanceMeasured=False)
    cli=dict(sourceCommit=m.SOURCE,suitePassed=True,requiredPassed=sorted(m.CLI_CASES),networkLoadMeasured=False,publicFinality=False)
    commit=dict(actualCalleeSHA=m.SOURCE,actualCalleeTree=m.TREE,controllerSHA=m.SOURCE,runId=str(m.CHAIN_RUN),runAttempt='1',skipped=0,actualFourNodeWindow=False,dualPQ500CrossSourceEquality=False,authorityGranted=False,workflowOnlyContinuation=False,publicActivation=False,testJSONBytes=100,testJSONSHA256='a'*64,requiredPassed=sorted(m.COMMIT_CASES))
    client=dict(commit=m.SOURCE,nodeProcessesStarted=0,publicActivation=False,requiredPassed=sorted(m.CLIENT_CASES));wire=dict(commit=m.SOURCE,physicalBytesMeasured=False,nodeProcessesStarted=0,requiredPassed=sorted(m.WIRE_CASES))
    logs={'resource':log(('YNX_LAB_CALLEE_TESTS',cli),('YNX_INITIAL_CACHE_STATE_TESTS',state)),'commit':log(('YNX_NORMAL_COMMIT_CONSUMER_CASES_EXECUTED',commit)),'client':log(('YNX_PQ_LAB_CALLEES_EXECUTED',client),('YNX_ORIGINAL_WIRE_OBSERVATION_CALLEES_EXECUTED',wire))}
    facts=dict(runs=runs,jobs=jobs,sourceGraph=dict(sha=m.SOURCE,tree={'sha':m.TREE},parents=[{'sha':'84a57203f2ea10dfa51c9c4cef817ea3cc411b9c'}]));return facts,logs

class OriginalLiveSourceIntakeControls(unittest.TestCase):
    def test_three_groups_qualify_only_source_not_full500_or_pressure(self):
        facts,logs=inputs();d=m.qualify(facts,logs);self.assertTrue(d['sourceFunctionalQualified']);self.assertFalse(d['actual500InitializedOwnersQualified'] or d['pressureAuthorized'] or d['sourceGrant']);self.assertEqual(set(d['officialLinuxGroups']),set(m.JOBS))
    def test_old_source_wrong_tree_attempt_or_incomplete_job_refused(self):
        for mutate in [lambda f:f['runs'][str(m.RESOURCE_RUN)].update(head_sha='c4b39c73ec3a43c2ba32f7071bb735b0c0447f5e'),lambda f:f['sourceGraph']['tree'].update(sha='0'*40),lambda f:f['runs'][str(m.CHAIN_RUN)].update(run_attempt=2),lambda f:f['jobs']['resource'].update(status='in_progress'),lambda f:f['jobs']['resource'].update(conclusion='failure')]:
            facts,logs=inputs();mutate(facts)
            with self.assertRaises(RuntimeError):m.qualify(facts,logs)
    def test_executed_marker_not_echoed_script_and_no_duplicate_marker(self):
        facts,logs=inputs();raw=logs['resource'];logs['resource']=raw.replace(b'Z YNX_',b"Z print('YNX_")
        with self.assertRaises(RuntimeError):m.qualify(facts,logs)
        logs['resource']=raw+raw
        with self.assertRaises(RuntimeError):m.qualify(facts,logs)
    def test_missing_large_case_duplicate_name_or_skipped_required_step_refused(self):
        for mode in ('large','duplicate','step'):
            facts,logs=inputs()
            if mode=='step':facts['jobs']['resource']['steps'][1]['conclusion']='skipped'
            else:
                state=m.marker(logs['resource'],'YNX_INITIAL_CACHE_STATE_TESTS')
                if mode=='large':state['requiredPassed'].remove('TestPQLabLiveMaterialsCacheBoundOriginalSetupRequestResult')
                else:state['requiredPassed'].append(state['requiredPassed'][0])
                logs['resource']=log(('YNX_LAB_CALLEE_TESTS',m.marker(logs['resource'],'YNX_LAB_CALLEE_TESTS')),('YNX_INITIAL_CACHE_STATE_TESTS',state))
            with self.subTest(mode=mode),self.assertRaises(RuntimeError):m.qualify(facts,logs)
    def test_source_only_unrelated_remote_step_skip_does_not_invent_node_evidence(self):
        facts,logs=inputs();facts['jobs']['resource']['steps'].append(dict(name='Verify same-source completed normal CI before remote network execution',status='completed',conclusion='skipped'));d=m.qualify(facts,logs);self.assertFalse(d['actual500InitializedOwnersQualified'])
    def test_unrelated_protocol_delivery_still_running_is_kept_separate(self):
        facts,logs=inputs();facts['runs'][str(m.RESOURCE_RUN)].update(status='in_progress',conclusion=None)
        d=m.qualify(facts,logs);self.assertTrue(d['sourceFunctionalQualified']);self.assertEqual(d['workflowObservations']['resource']['status'],'in_progress');self.assertIsNone(d['workflowObservations']['resource']['conclusion']);self.assertFalse(d['pressureAuthorized'] or d['actual500InitializedOwnersQualified'])
    def test_missing_log_group_or_scope_upgrade_refused(self):
        facts,logs=inputs();del logs['client']
        with self.assertRaises(RuntimeError):m.qualify(facts,logs)
        facts,logs=inputs();c=m.marker(logs['commit'],'YNX_NORMAL_COMMIT_CONSUMER_CASES_EXECUTED');c['actualFourNodeWindow']=True;logs['commit']=log(('YNX_NORMAL_COMMIT_CONSUMER_CASES_EXECUTED',c))
        with self.assertRaises(RuntimeError):m.qualify(facts,logs)

if __name__=='__main__':unittest.main()
