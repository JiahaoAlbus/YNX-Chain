"""Preparation/differential controls only; fake rows are never measurements."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


prep=module("baseline_prepare","prepare-pq-baseline.py")
runner=module("baseline_run","run-pq-baseline.py")
diff=module("baseline_compare","compare-pq-baseline.py")


class BaselineControls(unittest.TestCase):
    def frozen(self,root):
        owner=root/"owner";owner.mkdir()
        def git(*args):return subprocess.check_output(["git","-C",str(owner),*args],stderr=subprocess.DEVNULL).decode().strip()
        git("init");
        leaves={
         "go.mod":"module control-only\n", "go.sum":"control-only\n",
         "third_party/cometbft/go.mod":"module control-only-not-built\n",
         "internal/consensus/account_policy.go":"func DecodePQTransaction(payload []byte) (PQTransaction, []byte, error) {\n}\n",
         "internal/consensus/account_batch.go":"func cloneConsensusPQBatches(input map[string]PQCommittedBatch) map[string]PQCommittedBatch {\n}\nfunc cloneBatchTransferCandidate(state executionState) executionState {\n}\nfunc (a *Application) applyPQWhole(state executionState, payload, wire []byte, height int64, blockTime time.Time) (executionState, transactionExecution, error) {\n}\n",
         "internal/consensus/application.go":"func cloneExecutionStateValue(state executionState) executionState {\n}\n"}
        leaves["internal/consensus/state.go"]="func sealCommittedStateOwned(witness *validatedMigration, height int64, execution executionState) (CommittedState, error) {\n}\nfunc (s CommittedState) validateOwnedWithTimings(witness *validatedMigration, timings *commitValidationTimings) (result error) {\n}\nfunc (s CommittedState) calculateHashForWithTimings(domain string, version int, timings *commitValidationTimings) (string, error) {\n}\n"
        for name,content in leaves.items():
            file=owner/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text(content)
        git("add",".");git("-c","user.name=Control Fixture","-c","user.email=fixture@example.invalid","commit","-m","uncompiled control fixture")
        head=git("rev-parse","HEAD")
        (owner/"internal/consensus/inflight.go").write_text("never include owner untracked file")
        target=root/"prepared";plan=prep.prepare(str(owner),head,str(target))
        return owner,target,plan

    def test_actual_archive_preparation_excludes_owner_dirty_and_preserves_originals(self):
        with tempfile.TemporaryDirectory() as directory:
            owner,target,plan=self.frozen(Path(directory).resolve())
            self.assertIn("inflight.go",plan["observedOwnerDirty"])
            self.assertFalse((Path(plan["source"])/"internal/consensus/inflight.go").exists())
            self.assertNotIn("baselineCount",(owner/"internal/consensus/account_policy.go").read_text())
            self.assertNotIn("baselineCount",(owner/"internal/consensus/state.go").read_text())
            self.assertIn("internal/consensus/state.go",plan["diagnosticPatches"])
            self.assertTrue(runner.validate(target/"prepared.json"))
            with self.assertRaises(ValueError):prep.prepare(str(owner),plan["commit"],str(target))

    def test_changed_source_and_extra_overlay_are_refused(self):
        for mutation in ("source","overlay"):
            with tempfile.TemporaryDirectory() as directory:
                _,target,plan=self.frozen(Path(directory).resolve())
                if mutation=="source":(Path(plan["source"])/"go.mod").write_text("changed")
                else:
                    path=target/"overlay.json";obj=json.loads(path.read_bytes());obj["Replace"]["/foreign.go"]="/foreign.go";path.write_text(json.dumps(obj))
                with self.assertRaises(RuntimeError):runner.validate(target/"prepared.json")

    def pair(self,root):
        dirs=[root/"before",root/"after"]
        for i,directory in enumerate(dirs):
            directory.mkdir();(directory/"receipt.json").write_text(json.dumps(dict(sourceMatrixComplete=True,cleanupComplete=True,inputSha256="same-public-input",sourceCommit=str(i)*40)))
            for h in (0,64,256,512):
                for k in (1,16):
                    case="H%d-K%d"%(h,k)
                    measure=dict(inputSha256="same-public-input",outerTxHash="original",memberResults=[dict(outcome="admitted")],appHash="app",blockHeight=h+4,historyWholeCount=h,members=k,wholeCountInCandidate=1,phases=[dict(name="Commit",elapsedNs=123,counters={})])
                    (directory/(case+"-measure.json")).write_text(json.dumps(measure))
                    (directory/(case+"-after.json")).write_text(json.dumps(dict(accounts=[dict(balance=10,nonce=1)],feeEvents=[dict(fee=1)],PQHistory=["original"],AppHash="same")))
        return dirs

    def test_complete_state_comparison_never_projects_fees_nonce_or_history_away(self):
        for field in (None,"accounts","feeEvents","PQHistory","AppHash"):
            with tempfile.TemporaryDirectory() as directory:
                before,after=self.pair(Path(directory))
                if field:
                    path=after/"H256-K16-after.json";state=json.loads(path.read_bytes());state[field]=["changed"];path.write_text(json.dumps(state))
                    with self.assertRaisesRegex(ValueError,"full committed state differs"):diff.compare(before,after)
                else:self.assertEqual(diff.compare(before,after)["stableFinalTPS"],"UNMEASURED")

    def test_incomplete_or_different_input_runs_cannot_form_before_after(self):
        for field,value in (("inputSha256","different"),("sourceMatrixComplete",False),("cleanupComplete",False)):
            with tempfile.TemporaryDirectory() as directory:
                before,after=self.pair(Path(directory));path=after/"receipt.json";receipt=json.loads(path.read_bytes());receipt[field]=value;path.write_text(json.dumps(receipt))
                with self.assertRaises(ValueError):diff.compare(before,after)

    def multi_pair(self,root):
        cases=runner.case_names("multi-whole");dirs=[root/"before",root/"after"]
        for i,directory in enumerate(dirs):
            directory.mkdir();(directory/"receipt.json").write_text(json.dumps(dict(profile="multi-whole",expectedCases=cases,completedCases=cases,sourceMatrixComplete=True,cleanupComplete=True,inputSha256="new-independent-signed-corpus",sourceCommit=str(i)*40)))
            for case in cases:
                h=int(case.split("-")[0][1:]);w=int(case.split("-")[1][1:])
                # Uncompiled contract fixture, never a Go or measurement result.
                measure=dict(inputSha256="new-independent-signed-corpus",outerTxHashes=[str(n) for n in range(w)],memberResults=[dict(outcome="admitted")]*w,appHash="full",blockHeight=h+4,historyWholeCount=h,members=1,wholeCountInCandidate=w,totalMembers=w,envelopeBytes=w*100,checkTxResponses=[dict(code=0,data="original")]*w,recheckTxResponses=[dict(code=0,data="original")]*w,finalizeResponse=dict(appHash="full",txResults=[dict(code=0)]*w),architecture="control",goVersion="control",gomaxprocs=1,phases=[dict(name="Commit",elapsedNs=123)])
                (directory/(case+"-measure.json")).write_text(json.dumps(measure))
                (directory/(case+"-after.json")).write_text(json.dumps(dict(accounts=[dict(balance=10,nonce=w)],feeEvents=[dict(fee=w)],history=[str(n) for n in range(w)],appHash="full")))
        return dirs

    def test_multi_whole_denominator_and_original_admission_errors_are_compared(self):
        self.assertEqual(runner.case_names("multi-whole"),["H0-W1-K1","H0-W16-K1","H512-W1-K1","H512-W16-K1"])
        with self.assertRaises(ValueError):runner.case_names("unknown")
        for field in (None,"outerTxHashes","checkTxResponses","recheckTxResponses","finalizeResponse","wholeCountInCandidate","members","gomaxprocs"):
            with tempfile.TemporaryDirectory() as temporary:
                before,after=self.multi_pair(Path(temporary))
                if field:
                    path=after/"H512-W16-K1-measure.json";data=json.loads(path.read_bytes());data[field]="changed";path.write_text(json.dumps(data))
                    with self.assertRaisesRegex(ValueError,field+" differs"):diff.compare(before,after)
                else:self.assertEqual(len(diff.compare(before,after)["cases"]),4)

    def test_source_profiles_and_truncated_case_inventory_cannot_mix(self):
        for change in (dict(profile="original"),dict(completedCases=["H0-W1-K1"]),dict(expectedCases=["H0-W1-K1"])):
            with tempfile.TemporaryDirectory() as temporary:
                before,after=self.multi_pair(Path(temporary));path=after/"receipt.json";data=json.loads(path.read_bytes());data.update(change);path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):diff.compare(before,after)


if __name__=="__main__":unittest.main()
