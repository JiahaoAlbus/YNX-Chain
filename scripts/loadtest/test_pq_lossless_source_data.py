"""Pinned original source DATA negatives; no nodes/build/ON execution."""
import importlib.util,json,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('lossless_source_controls',Path(__file__).with_name('pq-lossless-source-data.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SourceOnlyControls(unittest.TestCase):
    def test_actual_pinned_original28_cases_no_runtime_grant(self):
        q=m.qualification();self.assertEqual(q['actualNamedCases'],28);self.assertEqual(q['originalFilesVerified'],8);self.assertTrue(q['sourceOnlyQualified']);self.assertFalse(q['normalONRuntimeQualified'] or q['runtimeAuthorized'] or q['pressureAuthorized'])
    def test_wrong_original_archive_or_metadata_digest_refused(self):
        b=Path(__file__).with_name('fixtures');a=(b/'1a-lossless-source-original.zip').read_bytes();j=(b/'1a-lossless-source-job.json').read_bytes()
        for first,second in [(a+b' ',j),(a,j+b' ')]:
            with self.assertRaisesRegex(RuntimeError,'pin differs'):m.read_original(first,second)
    def test_original_fail_skip_missing_run_pass_and_duplicate_never_qualify(self):
        good=[dict(Action='run',Test='required'),dict(Action='pass',Test='required'),dict(Action='pass',Package='original')]
        for events in [good+[dict(Action='skip',Test='other')],good+[dict(Action='fail',Test='other')],good[1:],good[:1]+good[2:],good+[good[0]],good[:-1]]:
            with self.subTest(events=events),self.assertRaises(RuntimeError):m.require_named_run_pass(('\n'.join(json.dumps(v) for v in events)).encode(),['required'])
    def test_source_only_candidate_still_requires_actual_on_and_trace(self):
        sp=importlib.util.spec_from_file_location('source_pair_controls',Path(__file__).with_name('pq-normal-live-reader.py'));r=importlib.util.module_from_spec(sp);sp.loader.exec_module(r)
        q=r.prepare_paired_candidate(source_only_ci=True);self.assertEqual(q['originalSourceOnlyCI']['source'],m.SOURCE);self.assertFalse(q['ready'] or q['normalONSourceQualified'] or q['runtimeAuthorized']);self.assertTrue(any('running window' in v for v in q['missing']))
if __name__=='__main__':unittest.main()
