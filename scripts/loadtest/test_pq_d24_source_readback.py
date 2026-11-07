"""Pure stream transport negatives, never a source/runtime grant."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

s=importlib.util.spec_from_file_location('d24_source_controls',Path(__file__).with_name('pq-d24-source-readback.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def raw(rows):return b'\n'.join(json.dumps(r).encode() for r in rows)+b'\n'
def rows():return [dict(Package='p',Test='T',Action='run'),dict(Package='p',Test='T',Action='pass'),dict(Package='p',Action='pass')]

class SourceStreamControls(unittest.TestCase):
    def ci_metadata(self):
        chain=dict(id=42359895403,head_sha=m.SOURCE,status='completed',conclusion='success')
        resource=dict(id=42359895427,head_sha=m.SOURCE)
        jobs=[dict(id=i,head_sha=m.SOURCE,run_id=42359895403,status='completed',conclusion='success') for i in (128365866560,128365907200,128365907202,128365907209,128365907249)]
        focused=dict(id=128365867070,head_sha=m.SOURCE,run_id=42359895427,status='completed',conclusion='success',steps=[dict(name='Check reachable vulnerabilities in the eight production runtime commands',status='completed',conclusion='success')])
        return chain,resource,dict(jobs=jobs),dict(jobs=[focused])
    def test_required_ci_outcomes_do_not_qualify_whole_resource_or_pressure(self):
        r=m.ci_jobs(*self.ci_metadata())
        self.assertTrue(r['eightRuntimeGovulncheckConsumed'])
        self.assertFalse(r['wholeResourceCIQualified'])
    def test_skipped_required_job_wrong_source_and_skipped_scanner_refused(self):
        for change in ('job','source','scanner'):
            args=self.ci_metadata()
            if change=='job':args[2]['jobs'][0]['conclusion']='skipped'
            if change=='source':args[0]['head_sha']='old-source'
            if change=='scanner':args[3]['jobs'][0]['steps'][0]['conclusion']='skipped'
            with self.subTest(change=change),self.assertRaises(RuntimeError):m.ci_jobs(*args)
    def collector_log(self, source=None):
        receipts=[dict(commit=source or m.SOURCE,nodeProcessesStarted=0,requiredPassed=list(m.STARTUP_CASES[:4])),dict(commit=source or m.SOURCE,nodeProcessesStarted=0,requiredPassed=list(m.STARTUP_CASES[4:]))]
        return b'\n'.join(('2026-11-07T09:00:00.000Z '+marker+' '+json.dumps(receipt)).encode() for marker,receipt in zip(('YNX_PQ_LAB_CALLEES_EXECUTED','YNX_ORIGINAL_WIRE_OBSERVATION_CALLEES_EXECUTED'),receipts))
    def test_original_collectors_are_not_raw_startup_jsonl(self):
        r=m.startup_collectors(self.collector_log())
        self.assertEqual(r['startupCollectorCases'],6)
        self.assertEqual(r['startupRawJSONLCasesReRead'],0)
    def test_echoed_duplicate_or_wrong_source_collector_cannot_qualify(self):
        raw=self.collector_log()
        for changed in (raw+ b'\n'+raw, self.collector_log('old-source'),raw.replace(b'Z YNX_',b'Z print YNX_')):
            with self.subTest(changed=changed),self.assertRaises(RuntimeError):m.startup_collectors(changed)
    def test_distinct_packages_keep_separate_complete_returns(self):
        a=rows();b=[dict(r,Package='q',**({'Test':'U'} if 'Test' in r else {})) for r in rows()]
        r=m.named_stream(raw(a+b),['T','U'],['p','q'])
        self.assertEqual(r['namedCases'],2)
    def test_nested_failure_or_skip_cannot_be_hidden_by_parent_pass(self):
        for action in ('fail','skip'):
            a=rows();a.insert(1,dict(Package='p',Test='T/sub',Action=action))
            with self.subTest(action=action),self.assertRaises(RuntimeError):m.named_stream(raw(a),['T'],['p'])
    def test_duplicate_missing_or_reversed_case_is_not_one_execution(self):
        a=rows()
        for changed in (a[1:],a+[a[0]],[a[1],a[0],a[2]]):
            with self.subTest(changed=changed),self.assertRaises(RuntimeError):m.named_stream(raw(changed),['T'],['p'])
    def test_missing_duplicate_or_foreign_package_cannot_qualify(self):
        a=rows()
        for changed in (a[:-1],a+[a[-1]],[dict(r,Package='other') for r in a]):
            with self.subTest(changed=changed),self.assertRaises(RuntimeError):m.named_stream(raw(changed),['T'],['p'])
    def test_self_asserted_case_set_cannot_omit_requested_execution(self):
        with self.assertRaises(RuntimeError):m.named_stream(raw(rows()),['T','missing'],['p'])

if __name__=='__main__':unittest.main()
