"""Normal bootstrap4+PQ4 operational exit controls; no node is started."""
import copy,importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('normal_exit_controls',Path(__file__).with_name('pq-normal-process-lab.py'))
n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n)
class NormalCleanExitControls(unittest.TestCase):
 def rows(self):return [dict(name=phase+'-node-'+str(i),pid=100+4*j+i,startTicks=123,rawReturnCode=0,exitCode=0,signal=None,exited=True) for j,phase in enumerate(('bootstrap','pq')) for i in range(4)]
 def test_only_all_eight_original_zero_exits_are_operational(self):
  rows=self.rows();before=copy.deepcopy(rows);r=n.normal_node_clean_exit(rows)
  self.assertTrue(r['operationalCleanExit']);self.assertEqual(r['observedNodes'],8);self.assertEqual(rows,before)
 def test_exit1_and_forced_kill_never_inherit_cleanup_or_network_success(self):
  for patch in [dict(rawReturnCode=1,exitCode=1),dict(rawReturnCode=-9,exitCode=None,signal=9),dict(rawReturnCode=None,exitCode=None,exited=False),dict(rawReturnCode=False)]:
   rows=self.rows();rows[-1].update(patch);r=dict(processes=rows,firstCause=None,cleanupComplete=True,networkBaseline={'status':'OBSERVED'},qualifiedFinalCount=4)
   n.apply_normal_clean_exit(r);self.assertFalse(r['normalNodeCleanExit']['operationalCleanExit']);self.assertIsNotNone(r['firstCause']);self.assertTrue(r['cleanupComplete']);self.assertEqual(r['networkBaseline']['status'],'OBSERVED');self.assertEqual(r['qualifiedFinalCount'],4)
 def test_missing_duplicate_and_pq_only_are_not_eight_node_success(self):
  rows=self.rows()
  for bad in (rows[:-1],rows+[rows[0]],rows[4:],[]):
   with self.subTest(count=len(bad)):self.assertFalse(n.normal_node_clean_exit(bad)['operationalCleanExit'])
 def test_existing_firstcause_and_raw_node_return_are_preserved(self):
  rows=self.rows();rows[0].update(rawReturnCode=1,exitCode=1);before=copy.deepcopy(rows);result=dict(processes=rows,firstCause='original first cause',cleanupComplete=True)
  n.apply_normal_clean_exit(result);self.assertEqual(result['firstCause'],'original first cause');self.assertEqual(result['processes'],before);self.assertEqual(result['normalNodeCleanExit']['records'][0]['rawReturnCode'],1)
if __name__=='__main__':unittest.main()
