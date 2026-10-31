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
    root.mkdir();app_hash="01"*32;initial=dict(height=3,accounts=[dict(balance="1000",nonce="1")],appHash=app_hash,fullHistory=[])
    encode=lambda v:base64.b64encode(v.encode()).decode()
    inp=dict(schema="YNX-PQ-BASELINE-PUBLIC-INPUT/v1",initial=initial,history=[encode("control-not-signed-%d"%i) for i in range(512)],cases={name:encode("control-not-signed-"+name) for name,_,_,sel in h.inventory("original") if isinstance(sel,str)})
    input_sha=save(root,"baseline-input.json",inp)["sha256"];records=[];parents={}
    for index,(name,parent,offset,selector) in enumerate(h.inventory("original")):
        state=copy.deepcopy(initial);state["height"]+=offset
        state["accounts"][0]["nonce"]=str(offset+1)
        state["fullHistory"]=[name]
        if selector is None:state=copy.deepcopy(initial)
        txs=[] if selector is None else ([inp["history"][i] for i in selector] if isinstance(selector,range) else [inp["cases"][selector]])
        info=dict(last_block_height=state["height"],last_block_app_hash=base64.b64encode(bytes.fromhex(app_hash)).decode())
        state_pin=save(root,"%03d-state.json"%index,state)
        result={} if selector is None else dict(checkTx=[dict(data="original") for _ in txs],recheckTx=[dict(data="original") for _ in txs],prepareProposal=dict(txs=txs),processProposal=dict(status=1),finalize=dict(tx_results=[dict(data="original member results") for _ in txs],app_hash=info["last_block_app_hash"]),commit={})
        row=dict(schema="YNX-PQ-HEIGHT-RECORD/v1",id=name,parent=parent,height=state["height"],parentCanonicalStateSHA256=state_pin["sha256"] if selector is None else parents[parent],transactionSHA256=[h.digest(base64.b64decode(tx)) for tx in txs],results=result,accounts=state["accounts"],appHash=app_hash,info=info,coldInfo=info,coldCanonicalStateSHA256=state_pin["sha256"],coldEqual=True,state=state_pin)
        parents[name]=state_pin["sha256"];records.append(save(root,"%03d-record.json"%index,row))
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
            rewrite(b,5,lambda row:row["results"]["finalize"]["tx_results"][0].update(data="different original execution payload"))
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
            with self.assertRaisesRegex(RuntimeError,"full per-height committed state"):h.compare(a,b)

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


if __name__=="__main__":unittest.main()
