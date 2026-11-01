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
        q=r.prepare_paired_candidate(source_only_ci=True);self.assertEqual(q['originalSourceOnlyCI']['source'],m.COMPONENT_SOURCE);self.assertFalse(q['ready'] or q['normalONSourceQualified'] or q['runtimeAuthorized']);self.assertTrue(any('running window' in v for v in q['missing']))
    def test_new6cc_consumes_own44_named_originals_without_old_grant(self):
        q=m.component_qualification();self.assertEqual(q['actualNamedCases'],44);self.assertEqual(q['originalFilesVerified'],13);self.assertEqual(q['source'],m.COMPONENT_SOURCE);self.assertFalse(q['prior1aGrantTransferred'] or q['normalONRuntimeQualified'] or q['wholeResourceCIQualified'])
    def test_new6cc_originals_corruption_does_not_fall_back_to1a(self):
        from unittest import mock
        read=Path.read_bytes
        def corrupt(path):return read(path)+b' ' if path.name=='6cc-lossless-source-original.zip' else read(path)
        with mock.patch.object(Path,'read_bytes',corrupt),self.assertRaisesRegex(RuntimeError,'new6cc original artifact pin'):m.component_qualification()
    def test_paired_composer_old_source_rejected_before_destination_created(self):
        from unittest import mock
        import tempfile
        sp=importlib.util.spec_from_file_location('pair_composer_old_source',Path(__file__).with_name('pq-normal-live-reader.py'));r=importlib.util.module_from_spec(sp);sp.loader.exec_module(r)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();dest=root/'not-created'
            def git(args,**kwargs):
                tail=args[3:]
                if tail[0]=='status':return b''
                return ('9081f14654a48f4fe14e57696ec33527869da353' if tail[-1]=='HEAD' else m.COMPONENT_TREE if tail[-1]=='HEAD^{tree}' else '54e88e6aba735eaceeb2d00bb40731248c673bd7').encode()
            with mock.patch.object(r.subprocess,'check_output',side_effect=git),self.assertRaisesRegex(RuntimeError,'exact independently qualified'):r.prepare_lossless_matching_source(root,dest)
            self.assertFalse(dest.exists())
    def test_paired_composer_changed_callee_not_executed(self):
        from unittest import mock
        import tempfile
        sp=importlib.util.spec_from_file_location('pair_composer_changed_source',Path(__file__).with_name('pq-normal-live-reader.py'));r=importlib.util.module_from_spec(sp);sp.loader.exec_module(r)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();dest=root/'not-created';path=root/'scripts/verify/wire-live-matching-source-ci.py';path.parent.mkdir(parents=True);path.write_text("raise AssertionError('must not execute')")
            def git(args,**kwargs):
                tail=args[3:]
                if tail[0]=='status':return b''
                return (m.COMPONENT_SOURCE if tail[-1]=='HEAD' else m.COMPONENT_TREE if tail[-1]=='HEAD^{tree}' else '54e88e6aba735eaceeb2d00bb40731248c673bd7').encode()
            with mock.patch.object(r.subprocess,'check_output',side_effect=git),self.assertRaisesRegex(RuntimeError,'exact new Core lossless composer'):r.prepare_lossless_matching_source(root,dest)
            self.assertFalse(dest.exists())
if __name__=='__main__':unittest.main()
