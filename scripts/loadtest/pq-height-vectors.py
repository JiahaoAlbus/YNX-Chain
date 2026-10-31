#!/usr/bin/env python3
"""New functional per-height evidence, replaying existing signed inputs only.

Neither frozen b6/aa tools nor old baseline artifacts are changed. A before
replay here collects vectors never previously emitted; it is not a benchmark.
"""
import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import tempfile
import threading
import time


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


base=module("height_base_prepare","prepare-pq-baseline.py")
runner=module("height_base_runner","run-pq-baseline.py")
lab=runner.lab
LEAF="pq_height_vectors_test.go.in"
FUNCTIONAL_BASE="9c22b0700d4e21f7fc35ec3067339722fb8bc330"
FUNCTIONAL_LEAF="3dda570d92374df2e66aaedadb35907354ec7073ac142fb72de67a16dd2ce0e0"


def digest(raw):return hashlib.sha256(raw).hexdigest()


def read(path,limit=4<<20):return lab.guard.bounded(path,limit)


def inventory(profile):
    lab.require(profile in ("original","multi-whole"),"explicit original profile required")
    rows=[("initial","supplied-initial",0,None)];cursor=0;parent="initial"
    for h in ((0,64,256,512) if profile=="original" else (0,512)):
        while cursor<h:
            end=cursor+16;name="history-%03d"%end;rows.append((name,parent,cursor//16+1,range(cursor,end)));cursor=end;parent=name
        for k in (1,16):
            name=("H%d-K%d" if profile=="original" else "H%d-W%d-K1")%(h,k)
            rows.append((name,parent,h//16+1,name))
    return rows


def prepare(owner,commit,output):
    plan=base.prepare(owner,commit,output);root=Path(output)
    overlay=json.loads((root/"overlay.json").read_bytes())
    leaf=Path(__file__).with_name("overlays")/LEAF
    raw=leaf.read_bytes();(root/LEAF).write_bytes(raw)
    overlay["Replace"][str(Path(plan["source"])/"internal/consensus"/LEAF.removesuffix(".in"))]=str(root/LEAF)
    lab.write_new(root/"height-overlay.json",overlay)
    result=dict(schema="YNX-PQ-HEIGHT-PREPARATION/v1",basePreparedSHA256=lab.guard.digest(root/"prepared.json"),overlaySHA256=lab.guard.digest(root/"height-overlay.json"),leafSHA256=digest(raw),sourceCommit=commit)
    lab.write_new(root/"height-prepared.json",result);return result


def validate(prepared):
    path=Path(prepared);lab.require(path.is_absolute() and path.resolve(strict=True)==path,"canonical height preparation required")
    ext=json.loads(read(path));root=path.parent
    lab.require(ext["schema"]=="YNX-PQ-HEIGHT-PREPARATION/v1" and lab.guard.digest(root/"prepared.json")==ext["basePreparedSHA256"],"height preparation detached from original source freeze")
    plan,source=runner.validate(root/"prepared.json")
    lab.require(ext["sourceCommit"]==plan["commit"] and lab.guard.digest(root/"height-overlay.json")==ext["overlaySHA256"] and lab.guard.digest(root/LEAF)==ext["leafSHA256"],"height overlay changed")
    expected=json.loads(read(root/"overlay.json"))
    expected["Replace"][str(source/"internal/consensus"/LEAF.removesuffix(".in"))]=str(root/LEAF)
    lab.require(json.loads(read(root/"height-overlay.json"))==expected,"height overlay changed production replacement set")
    return plan,source


def bound_file(root,pin,limit):
    lab.require(type(pin) is dict and type(pin.get("path")) is str and Path(pin["path"]).name==pin["path"],"invalid height artifact path")
    path=root/pin["path"];lab.require(not path.is_symlink() and path.resolve(strict=True)==path,"height artifact escaped")
    raw=read(path,limit)
    lab.require(type(pin.get("bytes")) is int and len(raw)==pin["bytes"] and digest(raw)==pin["sha256"],"height artifact bytes/SHA differ")
    return raw


def admission_expectation(pre_nonces,metadata,members):
    """Nonce oracle for this frozen valid-input fixture, never an authorizer."""
    owner=metadata["owner"];lab.require(owner in pre_nonces,"admission owner absent from original pre-state")
    nonce=pre_nonces[owner]
    lab.require(metadata["committedNonce"]==str(nonce) and len(metadata["memberNonces"])==members,"admission metadata detached from static pre-state")
    outcomes=[];errors=[]
    for text in metadata["memberNonces"]:
        lab.require(type(text) is str and text.isdecimal() and str(int(text))==text and 0<int(text)<1<<64 and nonce<(1<<64)-1,"bounded canonical original nonce required")
        value=int(text)
        if value==nonce+1:outcomes.append("admitted");errors.append("");nonce+=1
        else:outcomes.append("rejected");errors.append("signed transaction nonce %d must equal next account nonce %d"%(value,nonce+1))
    lab.require(len(set(outcomes))==1,"frozen fixture must be all-valid or static-nonce-rejected")
    code=0 if outcomes[0]=="admitted" else 2  # Original CodeInvalidTx, not inner CodeInvalidNonce.
    lab.require(metadata["outcomes"]==outcomes and metadata["errors"]==errors and metadata["code"]==code,"static original nonce expectation differs")
    return code,outcomes,errors


def member_results(response,members):
    import base64
    data=json.loads(base64.b64decode(response["data"],validate=True))
    lab.require(type(data.get("results")) is list and len(data["results"])==members,"complete original member results required")
    return data["results"]


def validate_admission(pre_nonces,metadata,response,members):
    code,outcomes,errors=admission_expectation(pre_nonces,metadata,members)
    lab.require(response.get("code",0)==code,"normal static pre-state admission code differs")
    for i,result in enumerate(member_results(response,members)):
        lab.require(result.get("index",0)==i and result["outcome"]==outcomes[i] and result.get("error","")==errors[i] and bool(result.get("transactionHash"))==(outcomes[i]=="admitted"),"normal nonce rejection/member result differs")


def load_vectors(root,receipt_override=None,require_cleanup=True,checkpoint=None):
    root=Path(root);lab.require(root.is_absolute() and root.resolve(strict=True)==root,"canonical original vector directory required")
    receipt=json.loads(read(root/"receipt.json")) if receipt_override is None else receipt_override
    lab.require(receipt.get("perHeightComplete") is True and (not require_cleanup or receipt.get("cleanupComplete") is True) and receipt.get("firstCause") is None and receipt.get("testExitCode")==0,"actual complete height replay and cleanup required")
    manifest_raw=read(root/"height-manifest.json");manifest=json.loads(manifest_raw)
    lab.require(digest(manifest_raw)==receipt["heightManifestSHA256"] and manifest.get("schema")=="YNX-PQ-PER-HEIGHT-VECTORS/v1" and manifest.get("complete") is True,"complete original height manifest required")
    input_raw=read(root/"baseline-input.json",128<<20);inp=json.loads(input_raw)
    lab.require(digest(input_raw)==receipt["inputSHA256"]==manifest["inputSHA256"],"original signed input binding differs")
    profile=manifest["profile"];expected=inventory(profile)
    lab.require(receipt["profile"]==profile and len(manifest["records"])==len(expected),"complete per-height denominator required")
    lab.require(inp["schema"]==("YNX-PQ-BASELINE-PUBLIC-INPUT/v1" if profile=="original" else "YNX-PQ-MULTI-WHOLE-PUBLIC-INPUT/v1") and len(inp["history"])==(512 if profile=="original" else 528),"original signed input profile differs")
    import base64
    def tx_sha(value):return digest(base64.b64decode(value,validate=True))
    initial=inp["initial"];initial_height=initial["height"]
    lab.require(manifest["initialHeight"]==initial_height,"supplied initial height differs")
    rows=[];states={};files=set()
    for pin,(identity,parent,offset,selector) in zip(manifest["records"],expected):
        if checkpoint is not None:checkpoint()
        lab.require(pin["path"] not in files,"duplicate height evidence file");files.add(pin["path"])
        raw=bound_file(root,pin,4<<20);row=json.loads(raw)
        lab.require(row.get("schema")=="YNX-PQ-HEIGHT-RECORD/v1" and row["id"]==identity and row["parent"]==parent and row["height"]==initial_height+offset,"per-height identity/order/coordinates differ")
        lab.require(row["state"]["path"] not in files,"aliased height state");files.add(row["state"]["path"])
        state_raw=bound_file(root,row["state"],256<<20);state=json.loads(state_raw)
        lab.require(row["coldEqual"] is True and row["coldCanonicalStateSHA256"]==digest(state_raw),"normal full cold state equality missing")
        lab.require(state["height"]==row["height"] and state["accounts"]==row["accounts"] and state["appHash"]==row["appHash"],"full accounts/height/AppHash detached")
        lab.require(row["info"]==row["coldInfo"],"normal cold Info differs")
        info=row["info"];lab.require(int(info["last_block_height"])==row["height"] and base64.b64decode(info["last_block_app_hash"],validate=True).hex()==row["appHash"],"normal Info height/AppHash differs")
        if selector is None:
            lab.require(state==initial and row["parentCanonicalStateSHA256"]==digest(state_raw) and row["results"]=={} and row["transactionSHA256"]==[],"supplied initial state differs")
        else:
            parent_sha,parent_height,pre_nonces=states[parent]
            lab.require(row["parentCanonicalStateSHA256"]==parent_sha and parent_height+1==row["height"],"height ancestry broken")
            if isinstance(selector,range):txs=[inp["history"][i] for i in selector]
            elif profile=="original":txs=[inp["cases"][selector]]
            else:txs=inp["candidateCases"][selector]
            lab.require(row["transactionSHA256"]==[tx_sha(tx) for tx in txs],"height transactions detached from original signed corpus")
            result=row["results"];lab.require(set(result)=={"checkTx","recheckTx","admissionExpectations","prepareProposal","processProposal","finalize","commit"},"full normal response inventory required")
            members=int(selector.rsplit("-K",1)[1]) if type(selector) is str and profile=="original" else 1
            lab.require(len(result["admissionExpectations"])==len(txs),"complete static admission metadata required")
            for key in ("checkTx","recheckTx"):
                lab.require(len(result[key])==len(txs),"normal admission response count differs")
                for meta,response in zip(result["admissionExpectations"],result[key]):validate_admission(pre_nonces,meta,response,members)
            lab.require(result["checkTx"]==result["recheckTx"],"normal complete Check/recheck responses differ")
            lab.require(result["prepareProposal"]["txs"]==txs and result["processProposal"]["status"]==1,"original full sequential proposal differs")
            finalized=result["finalize"];tx_results=finalized.get("tx_results",[])
            lab.require(len(tx_results)==len(txs) and all(r.get("code",0)==0 for r in tx_results),"normal Finalize result count/code differs")
            for response in tx_results:
                lab.require(all(r["outcome"]=="admitted" and not r.get("error") and r.get("transactionHash") for r in member_results(response,members)),"original Finalize business member rejected")
            lab.require(base64.b64decode(finalized["app_hash"],validate=True).hex()==state["appHash"],"Finalize AppHash differs")
        # Retain compact ancestry only. Do not keep every growing full state
        # resident while validating another arm against the same 4GiB cap.
        states[identity]=(digest(state_raw),state["height"],{a["address"]:int(a["nonce"]) for a in state["accounts"]});rows.append((row,digest(state_raw)))
        if checkpoint is not None:checkpoint()
    return receipt,manifest,rows


def compare(before,after):
    a,ma,ra=load_vectors(before);b,mb,rb=load_vectors(after)
    lab.require(a["heightVectorLeafSHA256"]==b["heightVectorLeafSHA256"],"per-height observer/tool versions differ: heightVectorLeafSHA256")
    guard_only_compatible=(a["toolsCommit"]==FUNCTIONAL_BASE and a["heightVectorLeafSHA256"]==FUNCTIONAL_LEAF
        and b.get("compatibleFunctionalToolsCommit")==FUNCTIONAL_BASE and b.get("resourceObserverVersion")=="same-process-rss-v2"
        and a.get("caps")==b.get("caps")==lab.CAPS)
    lab.require(a["toolsCommit"]==b["toolsCommit"] or guard_only_compatible,"per-height observer/tool versions differ: toolsCommit")
    for key in ("inputSHA256","profile","initialHeight","architecture","goVersion","gomaxprocs"):
        lab.require(ma[key]==mb[key],"height comparison configuration/input differs: "+key)
    for (x,sx),(y,sy) in zip(ra,rb):
        lab.require(sx==sy,"full per-height committed state bytes differ: "+x["id"])
        # Compare complete normal responses/accounts and cold observations.
        # Only artifact filenames/pins are packaging, never state projections.
        lab.require({k:v for k,v in x.items() if k!="state"}=={k:v for k,v in y.items() if k!="state"},"complete per-height results differ: "+x["id"])
    return dict(schema="YNX-PQ-PER-HEIGHT-DIFFERENTIAL/v1",before=a["sourceCommit"],after=b["sourceCommit"],inputSHA256=ma["inputSHA256"],profile=ma["profile"],recordsCompared=len(ra),perHeightFunctionalEqual=True,guardOnlyFunctionalCompatibility=guard_only_compatible,performanceComparisonQualified=False,scope="all 32 history commits plus complete profile candidate branches, from supplied Initial; complete result/account/nonce/AppHash/full state/cold constructor equality",proofMathReverifiedHere=False,optimizedPressureAuthorized=False,stableTPS="UNMEASURED",finality="UNMEASURED")


def run(args):
    plan,source=validate(args.prepared);original=Path(args.input)
    lab.require(original.is_absolute() and original.resolve(strict=True)==original and lab.guard.digest(original)==args.input_sha256,"exact existing signed input required")
    if not args.execute:return dict(status="prepared-only",newFunctionalScope="previously uncaptured per-height vectors; no generation/signing",source=plan["commit"],profile=args.profile)
    lab.require(sys.platform=="linux" and os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted","sole CORE original hosted Linux required")
    parent=Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    lab.require(parent in Path(args.prepared).parents,"job-owned prepared source required")
    rows,_=lab.guard.proc_inventory();lab.admit(lab.guard.memory_available(),shutil.disk_usage(parent).free,lab.heavy_processes(rows))
    lab.require(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"original Linux subreaper required")
    work=Path(tempfile.mkdtemp(prefix="pq-height-vectors-",dir=parent));work.chmod(0o700)
    for part in (".private","public"):(work/part).mkdir(mode=0o700)
    w=lab.Window(source,work,additional_storage=(Path(args.prepared).parent,Path(__file__).resolve().parents[2]));w.env["GOMAXPROCS"]="1"
    result=dict(schema="YNX-PQ-PER-HEIGHT-RUN/v1",sourceCommit=plan["commit"],sourceTree=plan["tree"],toolsCommit=lab.git(Path(__file__).resolve().parents[2],"rev-parse","HEAD"),heightVectorLeafSHA256=lab.guard.digest(Path(args.prepared).parent/LEAF),inputSHA256=args.input_sha256,profile=args.profile,perHeightComplete=False,firstCause=None,caps=lab.CAPS,newFunctionalValidation=True,performanceComparison=False)
    result.update(resourceObserverVersion=lab.RSS_OBSERVER_VERSION,processEvidenceVersion=lab.PROCESS_EVIDENCE_VERSION,resourceObserverSHA256=lab.guard.digest(Path(__file__).with_name("consensus-linux-cohort.py")),compatibleFunctionalToolsCommit=FUNCTIONAL_BASE if result["heightVectorLeafSHA256"]==FUNCTIONAL_LEAF else None)
    monitor=None
    try:
        data=work/"public/baseline-input.json"
        with open(data,"xb") as out,open(original,"rb") as src:shutil.copyfileobj(src,out,65536);out.flush();os.fsync(out.fileno())
        binary=work/".private/bin/height.test"
        w.wait(w.launch("compile-height-vectors",["go","test","-overlay",str(Path(args.prepared).parent/"height-overlay.json"),"-mod=readonly","-p","1","-c","-o",str(binary),"./internal/consensus"]))
        result["binarySHA256"]=lab.guard.digest(binary)
        w.env.update(YNX_PERF_HEIGHT_VECTORS="same-input-functional-only",YNX_PERF_BASELINE_INPUT=str(data),YNX_PERF_BASELINE_OUTPUT=str(work/"public"),YNX_PERF_BASELINE_PROFILE=args.profile,YNX_PERF_HEIGHT_INPUT_SHA256=args.input_sha256)
        result["testExitCode"]=w.wait(w.launch("actual-height-vectors",[str(binary),"-test.run=^TestPQPerHeightVectors$","-test.count=1","-test.timeout=780s","-test.v"]),allow_failure=True)
        manifest=work/"public/height-manifest.json"
        lab.require(result["testExitCode"]==0 and manifest.is_file(),"per-height replay incomplete; preserve partial evidence")
        result["heightManifestSHA256"]=lab.guard.digest(manifest);result["perHeightComplete"]=True
        # Parsing every growing state is part of the SAME measured window,
        # not unaccounted work after cleanup. Start a monitor only after the
        # last original child launch; no preexec_fn runs with this thread.
        normal=module("height_resource_monitor","pq-independent-load.py")
        monitor=normal.Monitor(w,threading.Event());monitor.thread.start()
        load_vectors(work/"public",receipt_override=result,require_cleanup=False,checkpoint=monitor.check)
        monitor.check();w.sample()
    except BaseException as error:result["firstCause"]=str(error);result["perHeightComplete"]=False
    finally:
        if monitor is not None:
            monitor.close()
            result["evidenceObserverRetired"]=not monitor.thread.is_alive()
            if monitor.thread.is_alive():result["firstCause"]=result["firstCause"] or "height evidence resource observer did not retire"
            try:monitor.check()
            except BaseException as error:result["firstCause"]=result["firstCause"] or str(error);result["perHeightComplete"]=False
        try:result["cleanupComplete"]=w.stop()
        except BaseException as error:result["cleanupComplete"]=False;result["cleanupError"]=str(error)
        result.update(elapsedSeconds=time.monotonic()-w.started,peakRSSBytes=w.peak_rss,peakNewBytes=w.peak_bytes,processes=w.process_receipt(),resourceSamples=w.samples,retiredSamplingEvidence=w.retired_samples,rssSamplingFallbackEvidence=w.rss_fallback_samples)
        lab.write_new(work/"public/receipt.json",result)
        print(json.dumps(dict(publicArtifacts=str(work/"public"),firstCause=result["firstCause"],perHeightComplete=result["perHeightComplete"])))
    lab.require(result["firstCause"] is None and result["cleanupComplete"],"per-height functional replay failed")
    return result


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);subs=p.add_subparsers(dest="action",required=True)
    q=subs.add_parser("prepare");q.add_argument("--owner",required=True);q.add_argument("--commit",required=True);q.add_argument("--output",required=True)
    q=subs.add_parser("run");q.add_argument("--prepared",required=True);q.add_argument("--input",required=True);q.add_argument("--input-sha256",required=True);q.add_argument("--profile",choices=("original","multi-whole"),required=True);q.add_argument("--execute",action="store_true")
    q=subs.add_parser("compare");q.add_argument("--before",required=True);q.add_argument("--after",required=True);q.add_argument("--output",required=True)
    a=p.parse_args()
    def interrupted(signum,frame):raise RuntimeError("per-height validation interrupted: "+str(signum))
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    if a.action=="prepare":print(json.dumps(prepare(a.owner,a.commit,a.output)))
    elif a.action=="run":print(json.dumps(run(a)))
    else:lab.write_new(Path(a.output),compare(a.before,a.after))
