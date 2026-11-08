"""Readback binding controls, not a CGO build or business proof."""
import hashlib,importlib.util,json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('native7c_business_readback',Path(__file__).with_name('pq-first100-7c25-native-readback.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class NativeBusinessReadback(unittest.TestCase):
    def test_original_actual_source_receipt_is_source_only(self):
        raw=(Path(__file__).with_name('fixtures')/'7c25-native-source/SOURCE-NATIVE-DEPENDENCIES.json').read_bytes()
        value=json.loads(raw);ref=dict(receiptBytes=len(raw),receiptSHA256=hashlib.sha256(raw).hexdigest(),sourceDependencies=value)
        result=r.native_source_receipt({'normal-live-source-dependencies.json':raw},'',dict(normalLiveSourceDependencies=ref))
        self.assertEqual(result['status'],'ORIGINAL_READ');self.assertFalse(result['buildOrBusinessQualified'])
        self.assertEqual(result['originalReceipt']['fileCount'],11)
        with self.assertRaisesRegex(RuntimeError,'receipt bytes differ'):
            r.native_source_receipt({'normal-live-source-dependencies.json':raw[:-1]},'',dict(normalLiveSourceDependencies=ref))
    def test_missing_source_is_not_a_build_or_zero_tps(self):
        result=r.native_source_receipt({},'',{})
        self.assertEqual(result['status'],'NOT_SUPPLIED');self.assertFalse(result['buildOrBusinessQualified'])
        with self.assertRaisesRegex(RuntimeError,'requires supporting source'):
            r.native_source_receipt({},'',dict(normalLiveBuildSource=dict(source='not sufficient')))
    def test_old_tools_cannot_migrate_to_native_tuple(self):
        adapter=dict(controllerCommit='a'*40,controllerSourceSHA256=r.ADAPTER_SHA256,
            profile='first100-7c25-public-owner',senderBackend='public-owner',goSource=r.SOURCE,goTree=r.TREE,
            tools='79faca6de0c57e72c6ac9c44cf20de6d022e5b4f',toolsTree='ebf4a18afc42ab19175489fa959c1959aace629a')
        with self.assertRaisesRegex(RuntimeError,'adapter tuple differs'):r.identities(adapter,{},'a'*40)

if __name__=='__main__':unittest.main(verbosity=2)
