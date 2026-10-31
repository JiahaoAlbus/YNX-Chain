"""Evidence-contract fixtures only, never Application/signature measurements."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


h=module("height_evidence_controls","pq-height-vectors.py")
old=module("height_preparation_fixture","test_pq_current_baseline.py")


def raw(value):return json.dumps(value,separators=(",",":"),sort_keys=True).encode()


def save(root,name,value):
    data=raw(value);(root/name).write_bytes(data);return dict(path=name,sha256=h.digest(data),bytes=len(data))


def fixture(root):
    root.mkdir();app_hash="01"*32;initial=dict(height=3,accounts=[dict(address="control-owner",balance="1000",nonce="1")],appHash=app_hash,fullHistory=[])
    encode=lambda v:base64.b64encode(v.encode()).decode()
    inp=dict(schema="YNX-PQ-BASELINE-PUBLIC-INPUT/v1",initial=initial,history=[encode("control-not-signed-%d"%i) for i in range(512)],cases={name:encode("control-not-signed-"+name) for name,_,_,sel in h.inventory("original") if isinstance(sel,str)})
    input_sha=save(root,"baseline-input.json",inp)["sha256"];records=[];parents={};nonces={}
    for index,(name,parent,offset,selector) in enumerate(h.inventory("original")):
        state=copy.deepcopy(initial);state["height"]+=offset
        state["fullHistory"]=[name]
        if selector is None:state=copy.deepcopy(initial)
        txs=[] if selector is None else ([inp["history"][i] for i in selector] if isinstance(selector,range) else [inp["cases"][selector]])
        result={}
        if selector is not None:
            before_nonce=nonces[parent];members=int(selector.rsplit("-K",1)[1]) if isinstance(selector,str) else 1
            state["accounts"][0]["nonce"]=str(before_nonce+len(txs)*members)
            checks=[];expectations=[];finals=[]
            for j in range(len(txs)):
                rejected=isinstance(selector,range) and j>0
                ns=[str(before_nonce+1+j+i) for i in range(members)]
                outcomes=["rejected" if rejected else "admitted"]*members
                errors=["signed transaction nonce %s must equal next account nonce %d"%(n,before_nonce+1) if rejected else "" for n in ns]
                expectations.append(dict(owner="control-owner",committedNonce=str(before_nonce),memberNonces=ns,outcomes=outcomes,errors=errors,code=2 if rejected else 0))
                data=[dict(index=i,outcome=outcomes[i],error=errors[i],transactionHash="" if rejected else "control-member-%d"%i) for i in range(members)]
                checks.append(dict(code=2 if rejected else 0,data=base64.b64encode(raw(dict(results=data))).decode()))
                data=[dict(index=i,outcome="admitted",transactionHash="control-member-%d"%i) for i in range(members)]
                finals.append(dict(data=base64.b64encode(raw(dict(results=data))).decode()))
            result=dict(checkTx=checks,recheckTx=copy.deepcopy(checks),admissionExpectations=expectations,prepareProposal=dict(txs=txs),processProposal=dict(status=1),finalize=dict(tx_results=finals,app_hash=base64.b64encode(bytes.fromhex(app_hash)).decode()),commit={})
        info=dict(last_block_height=state["height"],last_block_app_hash=base64.b64encode(bytes.fromhex(app_hash)).decode())
        state_pin=save(root,"%03d-state.json"%index,state)
        row=dict(schema="YNX-PQ-HEIGHT-RECORD/v1",id=name,parent=parent,height=state["height"],parentCanonicalStateSHA256=state_pin["sha256"] if selector is None else parents[parent],transactionSHA256=[h.digest(base64.b64decode(tx)) for tx in txs],results=result,accounts=state["accounts"],appHash=app_hash,info=info,coldInfo=info,coldCanonicalStateSHA256=state_pin["sha256"],coldEqual=True,state=state_pin)
        parents[name]=state_pin["sha256"];nonces[name]=int(state["accounts"][0]["nonce"]);records.append(save(root,"%03d-record.json"%index,row))
    manifest=dict(schema="YNX-PQ-PER-HEIGHT-VECTORS/v1",complete=True,inputSHA256=input_sha,profile="original",initialHeight=3,architecture="control-only",goVersion="NOT_RUN",gomaxprocs=1,records=records)
    manifest_sha=save(root,"height-manifest.json",manifest)["sha256"]
    save(root,"receipt.json",dict(sourceCommit="a"*40,toolsCommit="b"*40,heightVectorLeafSHA256="c"*64,inputSHA256=input_sha,profile="original",perHeightComplete=True,cleanupComplete=True,testExitCode=0,firstCause=None,heightManifestSHA256=manifest_sha))


def rewrite(root,index,change):
    manifest=json.loads((root/"height-manifest.json").read_bytes());pin=manifest["records"][index]
    row=json.loads((root/pin["path"]).read_bytes());change(row)
    manifest["records"][index]=save(root,pin["path"],row)
    sha=save(root,"height-manifest.json",manifest)["sha256"]
    receipt=json.loads((root/"receipt.json").read_bytes());receipt["heightManifestSHA256"]=sha;save(root,"receipt.json",receipt)


class HeightVectorControls(unittest.TestCase):
    def test_static_committed_nonce_accepts_first_and_checks_future_rejection(self):
        def pair(nonce):
            rejected=nonce!=2;error="signed transaction nonce %d must equal next account nonce 2"%nonce if rejected else ""
            meta=dict(owner="owner",committedNonce="1",memberNonces=[str(nonce)],outcomes=["rejected" if rejected else "admitted"],errors=[error],code=2 if rejected else 0)
            response=dict(code=meta["code"],data=base64.b64encode(raw(dict(results=[dict(index=0,outcome=meta["outcomes"][0],error=error,transactionHash="" if rejected else "member")]))).decode())
            return meta,response
        first,ok=pair(2);future,no=pair(3)
        h.validate_admission({"owner":1},first,ok,1)
        h.validate_admission({"owner":1},future,no,1)
        for code in (0,3):
            wrong=copy.deepcopy(no);wrong["code"]=code
            with self.assertRaisesRegex(RuntimeError,"admission code differs"):h.validate_admission({"owner":1},future,wrong,1)
        wrong=copy.deepcopy(no);data=json.loads(base64.b64decode(wrong["data"]));data["results"][0]["error"]="different rejection cause"
        wrong["data"]=base64.b64encode(raw(data)).decode()
        with self.assertRaisesRegex(RuntimeError,"nonce rejection/member"):h.validate_admission({"owner":1},future,wrong,1)

    def test_valid_static_rejections_do_not_relax_sequential_finalize_members(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()/"arm";fixture(root)
            _,_,rows=h.load_vectors(root);history=rows[3][0]
            self.assertEqual(history["id"],"history-016")
            self.assertEqual([r.get("code",0) for r in history["results"]["checkTx"]],[0]+[2]*15)
            def corrupt(row):
                response=row["results"]["finalize"]["tx_results"][1]
                data=json.loads(base64.b64decode(response["data"]));data["results"][0].update(outcome="rejected",transactionHash="")
                response["data"]=base64.b64encode(raw(data)).decode()
            rewrite(root,3,corrupt)
            with self.assertRaisesRegex(RuntimeError,"Finalize business member rejected"):h.load_vectors(root)

    def test_exact_32_history_blocks_and_profile_branch_denominators(self):
        for profile,n in (("original",41),("multi-whole",37)):
            rows=h.inventory(profile)
            self.assertEqual(len(rows),n);self.assertEqual(sum(isinstance(sel,range) for _,_,_,sel in rows),32)
            self.assertEqual([i for _,_,_,sel in rows if isinstance(sel,range) for i in sel],list(range(512)))

    def test_complete_equal_contract_never_grants_pressure_or_math_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            a,b=Path(directory).resolve()/"a",Path(directory).resolve()/"b";fixture(a);fixture(b)
            result=h.compare(a,b)
            self.assertEqual(result["recordsCompared"],41);self.assertTrue(result["perHeightFunctionalEqual"])
            self.assertFalse(result["optimizedPressureAuthorized"]);self.assertFalse(result["proofMathReverifiedHere"])

    def test_missing_intermediate_height_is_not_hidden_by_equal_last_state(self):
        with tempfile.TemporaryDirectory() as directory:
            a,b=Path(directory).resolve()/"a",Path(directory).resolve()/"b";fixture(a);fixture(b)
            manifest=json.loads((b/"height-manifest.json").read_bytes());manifest["records"].pop(5)
            sha=save(b,"height-manifest.json",manifest)["sha256"]
            receipt=json.loads((b/"receipt.json").read_bytes());receipt["heightManifestSHA256"]=sha;save(b,"receipt.json",receipt)
            self.assertEqual((a/"040-state.json").read_bytes(),(b/"040-state.json").read_bytes())
            with self.assertRaisesRegex(RuntimeError,"denominator"):h.compare(a,b)

    def test_full_intermediate_response_cannot_be_projected_to_success_code(self):
        with tempfile.TemporaryDirectory() as directory:
            a,b=Path(directory).resolve()/"a",Path(directory).resolve()/"b";fixture(a);fixture(b)
            rewrite(b,5,lambda row:row["results"]["finalize"]["tx_results"][0].update(gas_used=999))
            with self.assertRaisesRegex(RuntimeError,"complete per-height results"):h.compare(a,b)

    def test_nonce_change_with_valid_packaging_and_ancestry_still_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            a,b=Path(directory).resolve()/"a",Path(directory).resolve()/"b";fixture(a);fixture(b)
            manifest=json.loads((b/"height-manifest.json").read_bytes());row=json.loads((b/manifest["records"][5]["path"]).read_bytes())
            state=json.loads((b/row["state"]["path"]).read_bytes());state["accounts"][0]["nonce"]="999"
            pin=save(b,row["state"]["path"],state);identity=row["id"]
            rewrite(b,5,lambda r:r.update(state=pin,accounts=state["accounts"],coldCanonicalStateSHA256=pin["sha256"]))
            for i,record in enumerate(manifest["records"]):
                child=json.loads((b/record["path"]).read_bytes())
                if child["parent"]==identity:rewrite(b,i,lambda r:r.update(parentCanonicalStateSHA256=pin["sha256"]))
            self.assertEqual((a/"040-state.json").read_bytes(),(b/"040-state.json").read_bytes())
            with self.assertRaisesRegex(RuntimeError,"full per-height committed state|static pre-state"):h.compare(a,b)

    def test_extra_overlay_is_separate_and_source_or_leaf_change_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();owner,old_target,old_plan=old.BaselineControls().frozen(root)
            target=root/"new-height-prepared";h.prepare(str(owner),old_plan["commit"],str(target))
            plan,_=h.validate(target/"height-prepared.json")
            self.assertEqual(plan["commit"],old_plan["commit"])
            self.assertNotIn(h.LEAF,json.loads((target/"overlay.json").read_bytes())["Replace"])
            (target/h.LEAF).write_text("changed functional observer")
            with self.assertRaisesRegex(RuntimeError,"overlay changed"):h.validate(target/"height-prepared.json")

    def test_resource_failure_interrupts_height_validation_and_observer_versions_bind(self):
        with tempfile.TemporaryDirectory() as directory:
            a,b=Path(directory).resolve()/"a",Path(directory).resolve()/"b";fixture(a);fixture(b)
            def cap():raise RuntimeError("control-only observed RSS cap")
            with self.assertRaisesRegex(RuntimeError,"observed RSS cap"):h.load_vectors(a,checkpoint=cap)
            receipt=json.loads((b/"receipt.json").read_bytes());receipt["heightVectorLeafSHA256"]="d"*64;save(b,"receipt.json",receipt)
            with self.assertRaisesRegex(RuntimeError,"observer/tool versions"):h.compare(a,b)

    def test_guard_only_successor_reuses_original_functional_before_without_performance_grant(self):
        with tempfile.TemporaryDirectory() as directory:
            a,b=Path(directory).resolve()/"a",Path(directory).resolve()/"b";fixture(a);fixture(b)
            for root in (a,b):
                receipt=json.loads((root/"receipt.json").read_bytes());receipt.update(toolsCommit=h.FUNCTIONAL_BASE,heightVectorLeafSHA256=h.FUNCTIONAL_LEAF,caps=h.lab.CAPS);save(root,"receipt.json",receipt)
            receipt=json.loads((b/"receipt.json").read_bytes());receipt.update(toolsCommit="e"*40,compatibleFunctionalToolsCommit=h.FUNCTIONAL_BASE,resourceObserverVersion="same-process-rss-v2");save(b,"receipt.json",receipt)
            result=h.compare(a,b);self.assertTrue(result["guardOnlyFunctionalCompatibility"]);self.assertFalse(result["performanceComparisonQualified"]);self.assertFalse(result["optimizedPressureAuthorized"])
            receipt["caps"]["rssBytes"]+=1;save(b,"receipt.json",receipt)
            with self.assertRaisesRegex(RuntimeError,"versions differ"):h.compare(a,b)


if __name__=="__main__":unittest.main()
