"""Original-row reduction controls; fixture events supply no chain authority."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=module('first100_reader_controls','pq-first100-d24-readback.py')
controls=module('first100_observed_fixture','test_pq_observed_throughput.py')

class First100ReadbackControls(unittest.TestCase):
    def original_rows(self, count=500):
        c=controls.ObservedThroughputControls();ledger=c.ledger(500)
        for _ in range(count):
            row=c.submitted(ledger);at=ledger.plan['windowNs']+3
            c.event(ledger,row,'included',at);c.final(ledger,row,at+1)
        return ledger.report(ledger.plan['windowNs']+6)

    def test_tail_completion_keeps_window_effective_tps_zero(self):
        result=m.cohort(self.original_rows())
        self.assertEqual(result['counts']['qualifiedReceipt'],dict(total=500,withinWindow=0,inTail=500,windowTPS=0))
        self.assertFalse(result['sustainedTPSQualified'] or result['consensusCommitTimestampMeasured'])

    def test_missing_one_final_confirmation_censors_all_cohort_percentiles(self):
        result=m.cohort(self.original_rows(499))
        for row in result['latencies'].values():
            self.assertEqual(row['censored'],1)
            self.assertTrue(all(row[f'p{p}Ms'] is None for p in (50,95,99)))

    def test_report_cannot_inflate_tps_without_original_rows(self):
        report=self.original_rows();report['observedThroughput']['qualifiedReceiptTPS']=100
        with self.assertRaisesRegex(RuntimeError,'qualified cohort'):m.cohort(report)

    def test_missing_duplicate_rows_cannot_shrink_denominator(self):
        report=self.original_rows()
        for rows in (report['rows'][:-1],report['rows'][:-1]+[report['rows'][0]]):
            changed=copy.deepcopy(report);changed['rows']=rows
            with self.assertRaisesRegex(RuntimeError,'all original500'):m.cohort(changed)

    def test_confirmation_before_inclusion_is_not_valid_latency(self):
        report=self.original_rows();report['rows'][0]['finalNs']=report['rows'][0]['submittedNs']
        with self.assertRaisesRegex(RuntimeError,'same original inclusion'):m.cohort(report)


class D24IdentityControls(unittest.TestCase):
    def test_another_artifact_digest_is_rejected_before_file_access(self):
        with mock.patch.object(m.Path,'open',side_effect=AssertionError('must not read unselected artifact')),self.assertRaisesRegex(RuntimeError,'selected original d24 artifact digest'):
            m.main(['--archive','/CONTROL_ONLY','--sha256','0'*64,'--output','/CONTROL_ONLY_OUT'])
    def records(self):
        h=dict(sourceHandoffSHA256='662a608c5706bc144c429e7a360ce61f29bdb3c4a933fc596c1ada7fdabfea1d',semanticReadbackSHA256='d849f0cf11f0a7c763ef8a7f861e9ec3026c8801929c3658267ee4c615db241c',semanticArtifactID=13570369292,semanticArtifactSHA256='58cd27e15fc6e36c83ce19405b38acbaa965e15a3433e0277873ce8d976ab2c5',retainedHeights=9,sourceOnlyQualified=True,semanticReplayReexecuted=False,actual500InitializationQualified=False,runtimePermissionGranted=False,pressureAuthorized=False)
        a=dict(controllerCommit=m.CONTROLLER,controllerSourceSHA256='c1c423d2b1aa18ce1421f3aa983cf6bb2a64ca0d6a1288bc56fafcc738887752',profile='first100-d24-initialize-before-load',goSource=m.SOURCE,goTree=m.TREE,tools=m.TOOLS,toolsTree=m.TOOLS_TREE,sourceAndSemanticHandoff=h,toolsCI=dict(runID=42365120777,jobID=128382053748,attempt=1,head=m.TOOLS,workflowID=322083952,conclusion='success',runtimePermissionGranted=False))
        r=dict(source=dict(commit=m.SOURCE,tree=m.TREE),toolIdentity=dict(commit=m.TOOLS,tree=m.TOOLS_TREE),loadConditions=dict(firstTrialProfile='d24'))
        shared=dict(head_sha=m.TOOLS,status='completed',conclusion='success')
        run=dict(shared,id=42365120777,workflow_id=322083952,run_attempt=1)
        job=dict(shared,id=128382053748,run_id=42365120777,steps=[dict(name=n,status='completed',conclusion='success') for n in ('Execute original Linux worker affinity limits stdin and cleanup case','Verify fixed d24 original semantic and source readback controls','Verify full first100 cohort counts and censored latency readback','Verify original bounded sender and post-ready checkpoint ordering')])
        a['toolsCI']['metadata']=[dict(original=run),dict(original=job)]
        return a,r
    def test_exact_d24_tuple_is_data_only(self):
        a,r=self.records();m.identities(a,r)
        self.assertFalse(a['sourceAndSemanticHandoff']['pressureAuthorized'])
    def test_old_source_tools_controller_and_missing_profile_cannot_migrate(self):
        for key,value in [('goSource','1b0ea548aca6b5260a9824d0edd3012d52e53521'),('tools','d0e0889afb7f171ce568c07ea0d6a7e9206083f2'),('controllerCommit','f76efa2b383dc013c31c5f2f1a5e8adbbd108434'),('profile','functional')]:
            a,r=self.records();a[key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.identities(a,r)
        a,r=self.records();r['loadConditions']['firstTrialProfile']='own1b'
        with self.assertRaises(RuntimeError):m.identities(a,r)
    def test_source_semantic_or_ci_cannot_grant_runtime(self):
        for kind in ('semantic','ci','pin'):
            a,r=self.records()
            if kind=='semantic':a['sourceAndSemanticHandoff']['pressureAuthorized']=True
            if kind=='ci':a['toolsCI']['runID']=42356846693
            if kind=='pin':a['sourceAndSemanticHandoff']['semanticArtifactSHA256']='0'*64
            with self.subTest(kind=kind),self.assertRaises(RuntimeError):m.identities(a,r)
    def test_caps_and_full_demand_observers_cannot_change(self):
        caps=dict(totalSeconds=900,cleanupSeconds=15,rssBytes=4<<30,newBytes=8<<30,initialMemoryBytes=6<<30,initialDiskBytes=16<<30,logBytes=4<<20,cpus=2)
        c=dict(mode='online',accounts=500,perAccountCapacity=1,seconds=5,tailSeconds=30,proofTimeout=30,header_hop_capture=False,**{k:True for k in ('staged_publication','wire_observation','network_accounting','commit_observation','owned_storage_accounting','startup_timings','initialize_before_load')})
        a=dict(caps=caps);r=dict(caps=caps,loadConditions=c)
        m.conditions(a,r)
        for key,value in [('accounts',499),('tailSeconds',60),('startup_timings',False)]:
            changed=copy.deepcopy(r);changed['loadConditions'][key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):m.conditions(a,changed)
        changed=copy.deepcopy(r);changed['caps']['totalSeconds']=915
        with self.assertRaises(RuntimeError):m.conditions(a,changed)

if __name__=='__main__':unittest.main()
