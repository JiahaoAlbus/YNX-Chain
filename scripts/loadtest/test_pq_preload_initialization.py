"""Initialization ordering controls; no live nodes or source qualification."""
import copy
import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('preload_controls',Path(__file__).with_name('pq-preload-initialization.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class PreloadControls(unittest.TestCase):
 def inputs(self):
  census=dict(schema='YNX-PERF-ORIGINAL-INITIALIZED-ACCOUNT-CENSUS/v1',configuredLoadAccounts=500,completeFourNodeAccountReadback=True,normalGoStaticOrCryptoQualification=False,signCommandsIssued=0,businessPOSTsIssued=0,sourceGrant=False,nodes=[dict(node=i,height=14,appHash='a'*64,matchingOriginalLoadAccounts=500,snapshotBytes=1024,snapshotSHA256='b'*64) for i in range(4)])
  processes=[dict(name=f'{phase}-node-{i}',pid=10+phase_index*4+i,startTicks=str(100+phase_index*4+i),exited=phase=='bootstrap',rawReturnCode=0 if phase=='bootstrap' else None,exitCode=0 if phase=='bootstrap' else None,signal=None) for phase_index,phase in enumerate(('bootstrap','pq')) for i in range(4)]
  return [census,processes,[],35,5,30]
 def test_original_order_is_bootstrap_stopped_pq_running_not_all_eight_stopped(self):
  args=self.inputs();saved=copy.deepcopy(args);r=m.validate(*args);self.assertEqual(args,saved);self.assertTrue(r['bootstrapFourNaturalExitZero'] and r['pqFourStillRunning']);self.assertFalse(r['allEightNaturalExitObserved'] or r['sourceGrant'] or r['independentFinality'] or r['loadReleased']);self.assertEqual(r['configuredDemand'],500)
  r['originalProcesses'][0]['name']='mutated';self.assertEqual(args[1][0]['name'],'bootstrap-node-0')
 def test_stopping_pq_before_load_refuses_instead_of_restarting_custody(self):
  for code in (0,-9,1):
   args=self.inputs();args[1][4].update(exited=True,rawReturnCode=code,exitCode=code if code>=0 else None,signal=None if code>=0 else 9)
   with self.subTest(code=code),self.assertRaisesRegex(RuntimeError,'PQ node must remain running'):m.validate(*args)
 def test_cleanup_success_cannot_replace_bootstrap_natural_zero(self):
  for value in (None,-9,1):
   args=self.inputs();args[1][0]['rawReturnCode']=value
   with self.subTest(value=value),self.assertRaisesRegex(RuntimeError,'bootstrap exit0'):m.validate(*args)
 def test_partial_or_changed_census_refuses_entire_demand(self):
  for mutate in (lambda c:c['nodes'][3].update(matchingOriginalLoadAccounts=499),lambda c:c['nodes'][3].update(height=15),lambda c:c.update(configuredLoadAccounts=499),lambda c:c['nodes'].pop(),lambda c:c['nodes'][0].pop('snapshotSHA256'),lambda c:c['nodes'][1].update(node=True)):
   args=self.inputs();mutate(args[0])
   with self.assertRaises(RuntimeError):m.validate(*args)
 def test_missing_duplicate_or_reused_process_identity_refuses(self):
  for mutate in (lambda p:p.pop(),lambda p:p.append(dict(p[0])),lambda p:p[4].update(pid=p[0]['pid'],startTicks=p[0]['startTicks']),lambda p:p[0].update(startTicks=None),lambda p:p[0].update(pid=True)):
   args=self.inputs();mutate(args[1])
   with self.assertRaises(RuntimeError):m.validate(*args)
 def test_insufficient_or_unknown_budget_never_shortens_window(self):
  for remaining in (34.999,-1,None,float('nan'),float('inf'),True):
   args=self.inputs();args[3]=remaining
   with self.subTest(remaining=remaining),self.assertRaises(RuntimeError):m.validate(*args)
  for index,value in ((4,4),(5,29)):
   args=self.inputs();args[index]=value
   with self.assertRaises(RuntimeError):m.validate(*args)
 def test_pending_preparation_or_early_business_commands_cannot_release(self):
  for pending in ([4],[-1],[True],[0,0],[0,1,2,3,4]):
   args=self.inputs();args[2]=pending
   with self.subTest(pending=pending),self.assertRaises(RuntimeError):m.validate(*args)
  for key in ('signCommandsIssued','businessPOSTsIssued'):
   args=self.inputs();args[0][key]=1
   with self.assertRaises(RuntimeError):m.validate(*args)
 def test_reserved_preparation_pending_is_preserved_not_replayed_or_counted(self):
  args=self.inputs();args[2]=[0,1];saved=copy.deepcopy(args);r=m.validate(*args)
  self.assertEqual(args,saved);self.assertEqual(r['unconfirmedReservedPreparationOwners'],[0,1]);self.assertFalse(r['preparationFinalityQualified'] or r['loadReleased']);self.assertEqual(r['configuredDemand'],500)
  r['unconfirmedReservedPreparationOwners'].clear();self.assertEqual(args[2],[0,1])

if __name__=='__main__':unittest.main()
