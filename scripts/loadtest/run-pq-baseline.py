#!/usr/bin/env python3
"""One resource-bounded hosted source baseline, never a four-node result."""
import argparse
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time

spec=importlib.util.spec_from_file_location("normal_lab",Path(__file__).with_name("consensus-linux-cohort.py"))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)


def case_names(profile):
    if profile=="multi-whole":return ["H%d-W%d-K1"%(h,w) for h in (0,512) for w in (1,16)]
    if profile=="original":return ["H%d-K%d"%(h,k) for h in (0,64,256,512) for k in (1,16)]
    raise ValueError("explicit known source profile required")


def validate(prepared):
    prepared=Path(prepared)
    lab.require(prepared.is_absolute() and prepared.resolve(strict=True)==prepared,"canonical original prepared input required")
    plan=json.loads(prepared.read_bytes());source=Path(plan["source"])
    lab.require(plan["schema"]=="YNX-PQ-CURRENT-BASELINE-PREPARATION/v1","unsupported prepared source")
    lab.require(lab.guard.digest(prepared.parent/"source.tar")==plan["archiveSha256"],"frozen source archive differs")
    # Verify every archived Go source byte, not just the three instrumented
    # leaves. Owner untracked files never enter this standalone source graph.
    with tarfile.open(prepared.parent/"source.tar") as archive:
        for member in archive.getmembers():
            if member.isfile():
                path=source/member.name
                lab.require(path.resolve(strict=True)==path and path.read_bytes()==archive.extractfile(member).read(),"frozen source changed: "+member.name)
            elif not member.isdir(): raise RuntimeError("nonregular frozen source archive entry")
    overlay=json.loads((prepared.parent/"overlay.json").read_bytes())["Replace"]
    expected={str(source/name) for name in plan["diagnosticPatches"]}
    expected.update(str(source/"internal/consensus"/name.removesuffix(".in")) for name in ("pq_baseline_probe.go.in","pq_baseline_test.go.in"))
    lab.require(set(overlay)==expected,"overlay added or removed a production/test replacement")
    for relative,pin in plan["diagnosticPatches"].items():
        lab.require(lab.guard.digest(Path(overlay[str(source/relative)]))==pin["diagnosticSha256"],"diagnostic observer changed")
    for name in ("pq_baseline_probe.go.in","pq_baseline_test.go.in"):
        lab.require(lab.guard.digest(prepared.parent/name)==plan["pins"][name],"frozen probe changed")
    return plan,source


def run(args):
    plan,source=validate(args.prepared)
    cases=case_names(args.profile)
    if not args.execute: return dict(status="prepared-only",commit=plan["commit"],scope=plan["scope"],baselineReady=False)
    lab.require(sys.platform=="linux" and os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted","dedicated hosted Linux source CI required")
    parent=Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    lab.require(parent in Path(args.prepared).parents,"prepared source must be owned by this job RUNNER_TEMP")
    rows,_=lab.guard.proc_inventory();lab.admit(lab.guard.memory_available(),shutil.disk_usage(parent).free,lab.heavy_processes(rows))
    libc=ctypes.CDLL(None,use_errno=True);lab.require(libc.prctl(36,1,0,0,0)==0,"Linux subreaper required")
    work=Path(tempfile.mkdtemp(prefix="pq-baseline-",dir=parent));work.chmod(0o700)
    (work/".private").mkdir(mode=0o700);(work/"public").mkdir(mode=0o700)
    window=lab.Window(source,work,additional_storage=(Path(args.prepared).parent,));window.env["GOMAXPROCS"]="1"
    result=dict(schema="YNX-CURRENT-SOURCE-BASELINE-RUN/v1",sourceCommit=plan["commit"],sourceTree=plan["tree"],
                originalArchiveSHA256=plan["archiveSha256"],originalOwnerDirtyExcluded=plan["observedOwnerDirty"],
                caps=lab.CAPS,profile=args.profile,expectedCases=cases,firstCause=None,sourceMatrixComplete=False,fullChainBaselineReady=False,
                protectedSignerBaseline="UNMEASURED",hopBytes="UNMEASURED",stableFinalTPS="UNMEASURED",P95FinalConfirmation="UNMEASURED",
                scope="instrumented real signed local ABCI state/Commit/cold reopen; not BFT or protected Wallet signer; inclusive observer overhead disclosed")
    try:
        binary=work/".private/bin/baseline.test"
        cmd=["go","test","-overlay",str(Path(args.prepared).parent/"overlay.json"),"-mod=readonly","-p","1","-c","-o",str(binary),"./internal/consensus"]
        window.wait(window.launch("compile-baseline",cmd));result["binarySha256"]=lab.guard.digest(binary)
        data=work/"public/baseline-input.json"
        if args.mode=="replay":
            original=Path(args.input)
            lab.require(original.is_absolute() and original.resolve(strict=True)==original,"canonical original public input required")
            lab.require(args.input_sha256 and lab.guard.digest(original)==args.input_sha256,"same-input digest required")
            with open(data,"xb") as output:
                with open(original,"rb") as reader: shutil.copyfileobj(reader,output,65536)
                output.flush();os.fsync(output.fileno())
            data.chmod(0o600)
        window.env.update(YNX_PERF_CURRENT_BASELINE="source-ci-only",YNX_PERF_BASELINE_INPUT=str(data),
                          YNX_PERF_BASELINE_OUTPUT=str(work/"public"),YNX_PERF_BASELINE_PROFILE=args.profile,YNX_PERF_BASELINE_RECORD="1" if args.mode=="record" else "0")
        test="TestPQMultiWholeBaseline" if args.profile=="multi-whole" else "TestPQCurrentBaseline"
        proc=window.launch("actual-baseline",[str(binary),"-test.run=^"+test+"$","-test.count=1","-test.timeout=780s","-test.v"])
        code=window.wait(proc,allow_failure=True);result["testExitCode"]=code
        if data.exists(): result["inputSha256"]=lab.guard.digest(data)
        result["completedCases"]=[case for case in cases if (work/"public"/(case+"-measure.json")).is_file() and (work/"public"/(case+"-after.json")).is_file()]
        result["sourceMatrixComplete"]=code==0 and result["completedCases"]==cases
        lab.require(result["sourceMatrixComplete"],"source baseline incomplete; partial measurements/first failure retained")
    except BaseException as error:
        result["firstCause"]=str(error)
    finally:
        try: result["cleanupComplete"]=window.stop()
        except BaseException as error: result["cleanupComplete"]=False;result["cleanupError"]=str(error)
        result.update(elapsedSeconds=time.monotonic()-window.started,peakRSSBytes=window.peak_rss,peakNewBytes=window.peak_bytes,resourceSamples=window.samples,
                      processes=window.process_receipt(),retiredSamplingEvidence=window.retired_samples,resourceObserverVersion=lab.RSS_OBSERVER_VERSION,rssSamplingFallbackEvidence=window.rss_fallback_samples)
        lab.write_new(work/"public/receipt.json",result)
        print(json.dumps(dict(publicArtifacts=str(work/"public"),firstCause=result["firstCause"],sourceMatrixComplete=result["sourceMatrixComplete"])))
    lab.require(result["firstCause"] is None and result["cleanupComplete"],"normal source baseline failed; retain public receipt")
    return result


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--prepared",required=True)
    parser.add_argument("--mode",choices=["record","replay"],required=True);parser.add_argument("--input");parser.add_argument("--input-sha256")
    parser.add_argument("--profile",choices=["original","multi-whole"],default="original")
    parser.add_argument("--execute",action="store_true");args=parser.parse_args()
    def interrupted(signum,frame): raise RuntimeError("baseline received signal "+str(signum))
    signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGTERM,interrupted)
    print(json.dumps(run(args)))
