"""Finite DATA receiver controls; no Go, node, network or pressure execution."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('c06_receiver',Path(__file__).with_name('pq-c06-source-qualification.py'));q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
ARCHIVE=Path(__file__).with_name('fixtures').joinpath('c06-named-cases-original.zip').read_bytes()

def unit_api():
    data={}
    for identity,head,path,conclusion in [(41285983813,q.SOURCE,'.github/workflows/resource-market-ci.yml','success'),(41285983876,q.SOURCE,'.github/workflows/chain-core.yml','success'),(41288482948,q.CONTROLLER,'.github/workflows/chain-core.yml','failure')]:
        data['actions/runs/'+str(identity)]=dict(id=identity,head_sha=head,head_branch='codex/ynx-pq-perf-integration',path=path,conclusion=conclusion,status='completed',event='push',run_attempt=1)
    for sha,tree,parent in [(q.SOURCE,q.TREE,q.BEFORE),(q.CONTROLLER,q.CONTROLLER_TREE,q.SOURCE)]:data['git/commits/'+sha]=dict(sha=sha,tree=dict(sha=tree),parents=[dict(sha=parent)])
    data['actions/jobs/124794579487']=dict(id=124794579487,run_id=41288482948,head_sha=q.CONTROLLER,name='Original Commit consumer named cases',status='completed',conclusion='success',steps=[dict(name='Execute every new Commit case and affected original stop cases' if i==4 else 'UNIT-step-'+str(i),status='completed',conclusion='success') for i in range(9)])
    data['actions/artifacts/13076665019']=dict(id=13076665019,name='ynx-commit-consumer-cases-'+q.SOURCE+'-41288482948',size_in_bytes=4985,expired=False,digest='sha256:'+q.ARTIFACT_SHA,workflow_run=dict(id=41288482948,head_sha=q.CONTROLLER,head_branch='codex/ynx-pq-perf-integration',repository_id=1285041796,head_repository_id=1285041796))
    data['actions/artifacts/13076665019/zip']=ARCHIVE
    return data

class C06FiniteQualificationControls(unittest.TestCase):
    def qualify(self,data):return q.qualify(lambda path,binary=False:copy.deepcopy(data[path]))
    def test_actual_original_archive_has10top47passes_and_no_whole_supplement_green(self):
        d=self.qualify(unit_api());self.assertEqual(d['actualNamedCases']['includingSubcasesPassed'],47);self.assertEqual(d['actualNamedCases']['originalSupplementWholeConclusion'],'failure');self.assertFalse(d['actual500Window'] or d['authorityGranted'] or d['performanceBeforeAfterSourcePairQualified'])
    def test_old703_or_incomplete_c06_cannot_borrow_source_qualification(self):
        for key,value in [('head_sha','7037966eb2ce7a7167f02a09ee1f3bc0eebd1026'),('status','in_progress'),('conclusion','cancelled'),('run_attempt',True),('event','workflow_dispatch')]:
            d=unit_api();d['actions/runs/41285983813'][key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):self.qualify(d)
    def test_named_job_missing_skipped_or_wrong_callee_refused(self):
        for change in ('skip','step','callee'):
            d=unit_api();job=d['actions/jobs/124794579487']
            if change=='skip':job['steps'][4]['conclusion']='skipped'
            elif change=='step':job['steps'].pop()
            else:job['head_sha']=q.SOURCE
            with self.subTest(change=change),self.assertRaises(RuntimeError):self.qualify(d)
    def test_archive_hash_and_artifact_run_binding_cannot_be_spliced(self):
        for change in ('raw','expired','run'):
            d=unit_api()
            if change=='raw':d['actions/artifacts/13076665019/zip']=ARCHIVE[:-1]+b'X'
            elif change=='expired':d['actions/artifacts/13076665019']['expired']=True
            else:d['actions/artifacts/13076665019']['workflow_run']['head_sha']=q.SOURCE
            with self.subTest(change=change),self.assertRaises(RuntimeError):self.qualify(d)
    def test_exact_parent_tree_cannot_be_replaced_by_workflow_success(self):
        d=unit_api();d['git/commits/'+q.CONTROLLER]['parents']=[dict(sha=q.BEFORE)]
        with self.assertRaisesRegex(RuntimeError,'graph'):self.qualify(d)
    def test_original_run_is_reconciled_again_before_returning(self):
        d=unit_api();reads={}
        def fetch(path,binary=False):
            reads[path]=reads.get(path,0)+1;value=copy.deepcopy(d[path])
            if path=='actions/runs/41285983813' and reads[path]==2:value['conclusion']='failure'
            return value
        with self.assertRaises(RuntimeError):q.qualify(fetch)
        self.assertEqual(reads['actions/runs/41285983813'],2)
    def test_snapshot280_cannot_be_promoted_to_full500(self):
        d=q.functional_readback();snapshot=next(v for v in d['layouts'] if v['layout']=='snapshot-journal');self.assertEqual(snapshot['durableMembers'],280);self.assertFalse(snapshot['complete500'])
        with self.assertRaisesRegex(RuntimeError,'snapshot280'):q.functional_readback('snapshot-journal')
    def test_diagnostic01a_c06_cannot_qualify_any_performance_comparison_pair(self):
        d=q.functional_readback()
        for pair in [(q.BEFORE,q.SOURCE),('fdc'+'0'*37,q.SOURCE)]:
            with self.assertRaisesRegex(RuntimeError,'NOT_SUPPLIED'):q.require_performance_pair(*pair,d)
    def test_actual_local_stages_remain_ns_and_not_four_node_latency(self):
        d=q.functional_readback();block=next(v for v in d['layouts'] if v['layout']=='block-journal');self.assertEqual(block['durableHeights'],63);self.assertGreater(block['actualLocalStageTotalsNs']['delta_encode'],0);self.assertLess(sum(block['actualLocalStageTotalsNs'].values()),block['actualLocalPersistenceElapsedNs']);self.assertFalse(d['actualFourNodeWindow'] or d['onlinePerformanceClaim']);self.assertFalse(d['originalCASPayloadsRehashedByPERF'])
    def test_duplicate_json_qualification_fields_refused(self):
        with self.assertRaisesRegex(RuntimeError,'duplicate'):q.strict('{"complete500":false,"complete500":true}')
    def test_only_closed_read_only_c06_api_endpoints_can_be_requested(self):
        fetch=q.api_reader()
        with mock.patch.object(q.subprocess,'run',side_effect=AssertionError('no unexpected API')):
            for path,binary in [('actions/runs/41272858949',False),('actions/runs/41285983813',True),('actions/workflows/dispatches',False),('actions/artifacts/13076665019/zip',False)]:
                with self.subTest(path=path,binary=binary),self.assertRaisesRegex(RuntimeError,'fixed read-only'):fetch(path,binary)

if __name__=='__main__':unittest.main()
