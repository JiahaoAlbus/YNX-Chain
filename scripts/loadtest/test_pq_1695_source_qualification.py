"""Original same-source CI stream controls; no Go or node execution."""
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest


spec=importlib.util.spec_from_file_location('own1695_source_controls',Path(__file__).with_name('pq-1695-source-qualification.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
FIXTURE=Path(__file__).with_name('fixtures')/'1695-source'


class OriginalSourceControls(unittest.TestCase):
    def test_original_four_streams_and_six_collectors_preserve_skips_and_scope(self):
        r=m.qualification()
        self.assertEqual((len(r['flows']),r['originalCollectorsRead'],r['requiredNamedCases']),(4,6,130))
        self.assertEqual([f['packageInvocations'] for f in r['flows']],[1,5,1,1])
        self.assertEqual(len(r['originalOptInSkips']),10)
        self.assertIn('TestABCITransferPerformance',r['originalOptInSkips'])
        self.assertFalse(r['pressureAuthorized']);self.assertFalse(r['semanticPairConsumed'])
        self.assertFalse(r['sourceParentAuthorityGranted']);self.assertFalse(r['runtimeOrExporterBytesIntaken'])
        self.assertIsNone(r['businessTPS']);self.assertIsNone(r['finalityLatency'])

    def test_missing_or_tampered_original_metadata_and_stream_never_qualifies(self):
        for leaf in ('HANDOFF.json','original-public-streams.zip','collector-4.stdout','resource-jobs-030.json'):
            with self.subTest(leaf=leaf),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)/'original';shutil.copytree(FIXTURE,root)
                path=root/leaf;path.write_bytes(path.read_bytes()[:-1])
                with self.assertRaises(RuntimeError):m.qualification(root)

    def test_original_file_alias_is_not_accepted_as_frozen_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'original';shutil.copytree(FIXTURE,root)
            path=root/'HANDOFF.json';path.unlink();path.symlink_to(FIXTURE.resolve()/'HANDOFF.json')
            with self.assertRaises(RuntimeError):m.qualification(root)

    def test_trial_consumes_actual_semantic_original_without_granting_pressure(self):
        r=m.trial_qualification()
        self.assertTrue(r['semanticPairConsumed']);self.assertEqual(r['semanticOriginalReadback']['heights'],9)
        self.assertFalse(r['pressureAuthorized']);self.assertFalse(r['actual500InitializedOwnersQualified'])
        self.assertFalse(r['semanticOriginalReadback']['liveNetworkPairQualified'])

    def test_missing_or_changed_semantic_original_cannot_open_trial(self):
        for missing in (True,False):
            with self.subTest(missing=missing),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)/'original';shutil.copytree(FIXTURE,root);path=root/'SEMANTIC-READBACK.json'
                if missing:path.unlink()
                else:path.write_bytes(path.read_bytes()[:-1])
                with self.assertRaises((RuntimeError,FileNotFoundError)):m.trial_qualification(root)


if __name__=='__main__':unittest.main()
