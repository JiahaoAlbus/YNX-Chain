"""Escalation receipt controls with synthetic DATA only; no load authorization."""
import copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
spec=importlib.util.spec_from_file_location('escalation_controls',Path(__file__).with_name('pq-independent-load.py'));d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class EscalationConditionsControls(unittest.TestCase):
 def args(self):return SimpleNamespace(rate=500,mode='online',commit=d.STAGED_CALLEE_SOURCE,accounts=500,per_account=10,seconds=5,tail_seconds=30,proof_timeout=30,staged_publication=True,commit_observation=True,network_accounting=True,wire_observation=True,owned_storage_accounting=True,header_hop_capture=False)
 def fixture(self,args):
  n=500
  return dict(source=dict(commit=args.commit),mode=args.mode,caps=d.lab.CAPS,cleanupComplete=True,firstCause=None,normalLiveCalleeUsed=True,toolIdentity=dict(commit='a'*40,tree='b'*40),loadConditions=d.load_conditions(args),loadResult=dict(configuredDemand=n,requestedOfferedTPS=100,firstCause=None,windowCompleted=True,notReleased=0,releasedWithinWindow=n,notSubmitted=0,lateSubmitted=0,notQualified=0,sourceAcceptanceOrInclusionWithinWindow=n,backlogGrowing=False,submitToQualifiedReceiptObserved=dict(censored=0,p95Ms=1000,p99Ms=2000)))
 def check(self,args,prior):
  with tempfile.TemporaryDirectory() as temp:
   p=Path(temp).resolve()/'prior.json';raw=json.dumps(prior).encode();p.write_bytes(raw);args.prior_result=str(p);args.prior_result_sha256=hashlib.sha256(raw).hexdigest()
   with mock.patch.object(d,'tool_identity',return_value=dict(commit='a'*40,tree='b'*40)):return d.validate_escalation(args)
 def test_matching_measured_preceding_result_uses_original_strict_gates(self):
  a=self.args();self.check(a,self.fixture(a))
 def test_changed_tools_caps_accounts_or_observers_cannot_escalate(self):
  for change in [lambda p:p.pop('toolIdentity'),lambda p:p['toolIdentity'].update(commit='c'*40),lambda p:p.update(caps=dict(p['caps'],cpus=4)),lambda p:p['loadConditions'].update(accounts=8),lambda p:p['loadConditions'].update(commit_observation=False),lambda p:p['loadConditions'].update(startup_timings=True)]:
   a=self.args();p=copy.deepcopy(self.fixture(a));change(p)
   with self.assertRaisesRegex(RuntimeError,'conditions missing or changed'):self.check(a,p)
 def test_same_conditions_never_make_partial_or_unknown_demand_successful(self):
  for change in [lambda p:p['loadResult'].update(notQualified=1),lambda p:p['loadResult'].update(backlogGrowing=True),lambda p:p['loadResult']['submitToQualifiedReceiptObserved'].update(censored=1)]:
   a=self.args();p=self.fixture(a);change(p)
   with self.assertRaises(RuntimeError):self.check(a,p)
 def test_fixed_capacity_covers_all_three_rates_without_claiming_input_parity(self):
  a=self.args()
  for rate in (100,500,1000):
   a.rate=rate;self.assertEqual(d.validate_options(a),rate*5);self.assertEqual(d.load_conditions(a)['canonicalInputPairEquality'],'NOT_YET_QUALIFIED')
if __name__=='__main__':unittest.main()
