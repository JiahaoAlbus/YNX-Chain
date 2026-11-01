"""Original source evidence readback only; no Go, node or performance test."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('source_data_controls',Path(__file__).with_name('pq-normal-live-source-data.py'))
data=importlib.util.module_from_spec(spec);spec.loader.exec_module(data)
spec=importlib.util.spec_from_file_location('source_reader_controls',Path(__file__).with_name('pq-normal-live-reader.py'))
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
class SourceDataControls(unittest.TestCase):
 def test_original_zip_crc_pins_named_cases_and_scope(self):
  q=data.qualification()
  self.assertEqual(q['commit'],'d9038b9292f9c28d38decb9717282e50febffdb1')
  self.assertEqual((len(data.EXPECTED['normalProducer']),len(data.EXPECTED['originalSupplierBudget'])),(7,22))
  self.assertFalse(q['pressureAuthorized']);self.assertIn('finite',q['scope'])
 def test_truncated_changed_or_missing_original_evidence_cannot_qualify(self):
  raw=data.FIXTURE.read_bytes()
  for changed in (raw[:-1],b'x'+raw[1:],b''):
   with self.subTest(size=len(changed)),self.assertRaisesRegex(RuntimeError,'archive pin'):data.qualification(changed)
  with mock.patch.object(data.Path,'read_bytes',side_effect=FileNotFoundError('not supplied')):
   with self.assertRaises(FileNotFoundError):data.qualification()
 def test_other_source_or_selected_module_is_rejected(self):
  q=data.qualification()
  for key in ('commit','tree','forkTree'):
   identity={k:q[k] for k in ('commit','tree','forkTree')};identity[key]='0'*40
   with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,'exact normal live source'):reader.qualify(identity)
  wrong=dict(q,optionalForkTree='0'*40)
  with mock.patch.object(reader,'NORMAL_LIVE_SOURCE_QUALIFICATION',wrong):
   with self.assertRaisesRegex(RuntimeError,'source-CI qualification differs'):reader.qualify({k:q[k] for k in ('commit','tree','forkTree')})
 def test_exact_source_qualification_never_grants_pressure(self):
  q=data.qualification();actual=reader.qualify({k:q[k] for k in ('commit','tree','forkTree')})
  self.assertEqual(actual,q);self.assertFalse(actual['pressureAuthorized'])
  with mock.patch.object(reader,'NORMAL_LIVE_SOURCE_QUALIFICATION',None):
   with self.assertRaisesRegex(RuntimeError,'not supplied'):reader.qualify({})
if __name__=='__main__':unittest.main()
