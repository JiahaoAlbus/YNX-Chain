#!/usr/bin/env python3
"""Pure contract controls: no Actions, Go, Node, SSH or deployment execution."""
import copy, importlib.util, json, pathlib, unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('continuation', HERE / 'pq-source703-continuation.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ContinuationControls(unittest.TestCase):
    def host(self):
        sha = 'a' * 40
        env = {'GITHUB_REPOSITORY': m.REPO, 'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': m.BRANCH, 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': sha, 'GITHUB_WORKFLOW_REF': m.REPO+'/'+m.WORKFLOW+'@'+m.BRANCH, 'GITHUB_WORKFLOW_SHA': sha, 'GOMAXPROCS': '2', 'GOMEMLIMIT': '1536MiB', 'CGO_ENABLED': '0'}
        event = {'ref': m.BRANCH, 'before': '0'*40, 'after': sha, 'created': True, 'deleted': False, 'forced': False, 'repository': {'full_name': m.REPO}}
        controller = {'head': sha, 'parents': [m.SOURCE]}
        source = {'head': m.SOURCE, 'tree': m.TREE, 'shallow': False, 'dirty': False}
        return env, event, controller, source
    def prior(self):
        run = {'id': 41272858949, 'head_sha': m.SOURCE, 'run_attempt': 1, 'event': 'push', 'head_branch': 'codex/ynx-pq-perf-integration', 'path': '.github/workflows/resource-market-ci.yml', 'status': 'completed', 'conclusion': 'cancelled'}
        steps = [{'number': x[0], 'name': x[1], 'conclusion': x[2]} for x in m.SPEC['priorPrefix']]
        steps.append({'number': 48, 'name': m.SPEC['steps'][0]['name'], 'conclusion': 'cancelled'})
        job = {'id': 124749016396, 'run_id': run['id'], 'head_sha': m.SOURCE, 'run_attempt': 1, 'name': 'focused-go', 'conclusion': 'cancelled', 'started_at': '2026-11-01T04:22:43Z', 'completed_at': '2026-11-01T04:37:54Z', 'steps': steps}
        annotations = [{'annotation_level':'failure', 'message':'The job has exceeded the maximum execution time of 15m0s'}]
        chain = {'id': 41272858825, 'head_sha': m.SOURCE, 'run_attempt': 1, 'event': 'push', 'status': 'completed', 'conclusion': 'success', 'path': '.github/workflows/chain-core.yml'}
        commit = {'sha': m.SOURCE, 'tree': {'sha': m.TREE}}
        return run, job, annotations, chain, commit
    def test_fixed_first_push_and_separate_controller_source(self):
        env, event, controller, source = self.host()
        self.assertEqual(m.validate_host(env,event,controller,source), env['GITHUB_SHA'])
        self.assertNotEqual(env['GITHUB_SHA'], m.SOURCE)
    def test_other_event_ref_rerun_source_or_parent_refused(self):
        changes = [('GITHUB_EVENT_NAME','pull_request'),('GITHUB_EVENT_NAME','workflow_dispatch'),('GITHUB_REF','refs/heads/codex/ynx-pq-normal-process-20261031'),('GITHUB_RUN_ATTEMPT','2'),('GITHUB_SHA',m.SOURCE),('GOMEMLIMIT','2GiB')]
        for key,value in changes:
            with self.subTest(key=key,value=value):
                env,event,controller,source=self.host();env[key]=value
                with self.assertRaises(m.Refused):m.validate_host(env,event,controller,source)
        for which,field,value in [('controller','parents',[m.SOURCE,'b'*40]),('source','head','b'*40),('source','dirty',True),('source','shallow',True),('event','created',False),('event','forced',True)]:
            env,event,controller,source=self.host();targets={'controller':controller,'source':source,'event':event};targets[which][field]=value
            with self.assertRaises(m.Refused):m.validate_host(env,event,controller,source)
    def test_cancelled_timeout_and_prior_scope_retained(self):
        result=m.validate_prior(*self.prior())
        self.assertEqual(result['resourceConclusion'],'cancelled')
        self.assertFalse(result['resourceWholeSuccess'])
        self.assertTrue(any('readiness' in x[1] and x[2]=='success' for x in result['prefix']))
        self.assertEqual([x['index'] for x in m.SPEC['steps']],[46,49,50,51,53,54,55])
    def test_missing_timeout_wrong_prefix_or_borrowed_whole_pass_refused(self):
        for kind in ['timeout','whole-pass','prefix','chain','attempt']:
            values=list(copy.deepcopy(self.prior()))
            if kind=='timeout':values[2][0]['message']='The operation was canceled.'
            if kind=='whole-pass':values[0]['conclusion']='success'
            if kind=='prefix':values[1]['steps'][5]['conclusion']='skipped'
            if kind=='chain':values[3]['head_sha']='c'*40
            if kind=='attempt':values[0]['run_attempt']=2
            with self.subTest(kind=kind), self.assertRaises(m.Refused):m.validate_prior(*values)
    def test_seven_requires_actual_completed_success_not_zero_skip_or_failure(self):
        steps=[{'name':x['name'],'status':'completed','conclusion':'success'}for x in m.SPEC['steps']]
        self.assertTrue(m.seven_pass(m.tail_outcomes({'steps':steps})))
        for bad in ['skipped','failure','cancelled',None]:
            changed=copy.deepcopy(steps);changed[-1]['conclusion']=bad
            self.assertFalse(m.seven_pass(m.tail_outcomes({'steps':changed})))
        self.assertFalse(m.seven_pass(m.tail_outcomes({'steps':[]})))
        with self.assertRaises(m.Refused):m.tail_outcomes({'steps':steps+[steps[0]]})
    def test_workflow_single_job_original_bodies_envs_and_history(self):
        root=HERE.parents[1]
        flow=json.loads((root/m.WORKFLOW).read_bytes())
        self.assertEqual(set(flow['jobs']),{m.JOB})
        self.assertEqual(flow['on'],{'push':{'branches':[m.BRANCH.removeprefix('refs/heads/')]}})
        j=flow['jobs'][m.JOB]
        self.assertEqual(j['timeout-minutes'],25)
        self.assertFalse(j['concurrency']['cancel-in-progress'])
        original=[m.SPEC['dependency']]+m.SPEC['steps']
        import hashlib
        for pin in original:
            entries=[x for x in j['steps']if x.get('name')==pin['name']]
            self.assertEqual(len(entries),1)
            self.assertEqual(hashlib.sha256(entries[0]['run'].encode()).hexdigest(),pin['bodySHA256'])
            self.assertEqual(entries[0].get('env',{}),pin['env'])
        source=[s for s in j['steps']if s.get('with',{}).get('ref')==m.SOURCE]
        self.assertEqual(len(source),1);self.assertEqual(source[0]['with']['fetch-depth'],0)
        self.assertFalse(source[0]['with']['persist-credentials'])
        controller=[s for s in j['steps']if s.get('with',{}).get('path')=='controller']
        self.assertEqual(len(controller),1);self.assertEqual(controller[0]['with']['fetch-depth'],2)
        self.assertEqual(flow['permissions'],{'contents':'read','actions':'read','checks':'read'})
        self.assertFalse(any('GITHUB_SHA' in s.get('env',{}) for s in j['steps']))
        self.assertEqual(len([s for s in j['steps']if 'run'in s and s.get('name')in [p['name']for p in m.SPEC['steps']]]),7)

if __name__=='__main__':unittest.main(verbosity=2)
