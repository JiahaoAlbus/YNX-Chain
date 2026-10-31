#!/usr/bin/env python3
"""Original synthetic PQ ceremony in four normal processes. No finality surrogate.

CORE's stopped-checkpoint materials/proof producer is still required before
the original verifier can qualify a final observation or a fixed-window rate.
"""
import argparse
import base64
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import sys
import tempfile
import time
import urllib.request

spec=importlib.util.spec_from_file_location("normal_linux_lab",Path(__file__).with_name("consensus-linux-cohort.py"))
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
HELPER_COMMIT="56f04dae0059db75598a42de38f44d4dec434ce0"


def digest(raw):return hashlib.sha256(raw).hexdigest()


def original_plan(created,root):
    p=created["plan"]
    lab.require(p["version"]=="YNX-PQ-LOOPBACK-NETWORK/v1" and p["syntheticOnly"] is True and p["publicNetwork"] is False,"original synthetic-only plan required")
    lab.require(p["nativeChainId"]=="642399" and p["createEmptyBlocks"] is False and len(p["nodes"])==4,"original synthetic identity/quiet configuration differs")
    lab.require(Path(p["rootDir"])==root and Path(created["planFile"])==root/"network-plan.json","original root/plan escaped")
    lab.require(lab.guard.digest(root/"network-plan.json")==created["planSHA256"],"original plan pin differs")
    rpc=set()
    for i,n in enumerate(p["nodes"]):
        lab.require(n["index"]==i and n["recoveryFD"]==3,"original node/FD mapping differs")
        for key in ("home","statePath","legacyKeyFile","legacyStateFile","nodeKeyFile","candidateMaterialFile","recoveryCredentialFile","hostBindingFile","vaultFile","signerStateFile"):
            path=Path(n[key]);lab.require(path.resolve()==path and root in path.parents,"node/custody path escaped owned root")
        lab.require(re.fullmatch(r"http://127\.0\.0\.1:[0-9]+",n["rpcAddress"]) and n["rpcAddress"] not in rpc,"distinct loopback RPC required")
        lab.require(re.fullmatch(r"tcp://127\.0\.0\.1:[0-9]+",n["p2pAddress"]),"loopback peers required")
        rpc.add(n["rpcAddress"])
        args=n["bootstrapArgs"]
        lab.require(args[:3]==["start","--home",n["home"]] and "--pq-recovery-fd" not in args,"original bootstrap-only args required")
        lab.require(lab.guard.digest(Path(n["home"])/"config/config.toml")==n["configSHA256"],"original node config changed")
    return p


def fd3_command(command,fd):
    # Duplicate an already-open private descriptor in the child. No credential
    # bytes, shell expansions or credential path are added to argv/environment.
    lab.require(type(fd) is int and fd>=3,"private inherited descriptor required")
    script="exec 3<&%d; "%fd
    if fd!=3:script+="exec %d<&-; "%fd
    return ["/bin/sh","-c",script+'exec "$@"',"original-pq-recovery-fd",*command]


def decoded_hash(value):
    if isinstance(value,str) and re.fullmatch(r"[0-9a-fA-F]{64}",value):return value.lower()
    raw=base64.b64decode(value,validate=True);lab.require(len(raw)==32,"original ABCI hash length differs");return raw.hex()


class Ceremony:
    def __init__(self,window,root,created,bins):
        self.w,self.root,self.bins=window,root,bins
        self.plan=original_plan(created,root);self.pin=created["planSHA256"]
        self.workload=created["workload"];self.nodes=[];self.attempted=set();self.observations=[]
        self.next_workload=0

    def call(self,name,args):
        proc=self.w.launch(name,[str(self.bins/"ynx-consensus-pq-lab"),*args]);self.w.wait(proc)
        return json.loads((self.w.work/"public"/(name+".log")).read_bytes())

    def start(self,activation=None):
        self.w.stopping=False
        for n in self.plan["nodes"]:
            if activation is None:
                proc=self.w.launch("bootstrap-node-%d"%n["index"],[str(self.bins/"ynx-comet"),*n["bootstrapArgs"]],True)
            else:
                a=activation["nodes"][n["index"]]
                lab.require(a["index"]==n["index"] and a["recoveryFD"]==3 and a["recoveryCredentialFile"]==n["recoveryCredentialFile"],"activation changed original credential mapping")
                path=Path(a["recoveryCredentialFile"])
                fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
                try:
                    info=os.fstat(fd)
                    lab.require(stat.S_ISREG(info.st_mode) and info.st_size==32 and info.st_mode&0o077==0 and info.st_nlink==1,"original private recovery file required")
                    command=fd3_command([str(self.bins/"ynx-comet"),*a["args"]],fd)
                    proc=self.w.launch("pq-node-%d"%n["index"],command,True,pass_fds=(fd,))
                finally:os.close(fd)
            self.nodes.append(proc)

    def quiet(self,minimum=0,timeout=60):
        until=time.monotonic()+timeout;last=None;stable=0
        while time.monotonic()<until:
            self.w.sample()
            try:
                states=[json.loads(lab.guard.bounded(Path(n["statePath"]),128<<20)) for n in self.plan["nodes"]]
                h={s["height"] for s in states};app={s["appHash"] for s in states}
                lab.require(len(h)==1 and len(app)==1 and next(iter(h))>=minimum and all(s["initialized"] for s in states),"four applications not at common initialized checkpoint")
                height=next(iter(h));apphash=next(iter(app))
                for n in self.plan["nodes"]:
                    status=self.w.rpc(n["rpcAddress"],"status")
                    info=self.w.rpc(n["rpcAddress"],"abci_info")["response"]
                    # Status.LatestAppHash belongs to the latest HEADER (H-1).
                    # Compare the current App hash with original ABCI Info.
                    lab.require(status["node_info"]["network"]==self.plan["chainId"] and int(status["sync_info"]["latest_block_height"])==height,"normal RPC height/chain differs")
                    lab.require(int(info["last_block_height"])==height and decoded_hash(info["last_block_app_hash"])==apphash.lower(),"normal ABCI Info differs from actual disk checkpoint")
                current=(height,apphash)
                stable=stable+1 if current==last else 1;last=current
                if stable>=3:return dict(height=height,appHash=apphash)
            except (OSError,ValueError,KeyError,RuntimeError):stable=0
            time.sleep(.2)
        raise RuntimeError("four normal applications/RPCs did not reach a quiet common checkpoint")

    def post_once(self,name,raw,expected):
        lab.require(digest(raw)==expected.lower() and expected.lower() not in self.attempted,"original hash differs or duplicate broadcast attempted")
        self.attempted.add(expected.lower())
        body=json.dumps(dict(jsonrpc="2.0",id=name,method="broadcast_tx_sync",params=dict(tx=base64.b64encode(raw).decode())),separators=(",",":")).encode()
        # Durable intent comes before the one and only HTTP POST.
        lab.write_new(self.w.work/"public"/(name+"-intent.json"),dict(transactionHash=expected,transaction=base64.b64encode(raw).decode(),submissionAttempts=1,qualifiedFinal=False))
        offered=time.monotonic_ns();ack=None;transport_error=None
        try:
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            request=urllib.request.Request(self.plan["nodes"][0]["rpcAddress"],data=body,headers={"Content-Type":"application/json"},method="POST")
            with opener.open(request,timeout=3) as response:
                data=response.read((1<<20)+1)
            lab.require(len(data)<=1<<20,"bounded broadcast response exceeded")
            ack=json.loads(data)
        except (OSError,ValueError,RuntimeError) as error:transport_error=str(error)
        lab.write_new(self.w.work/"public"/(name+"-ack.json"),dict(ack=ack,error=transport_error,requestBodyBytes=len(body),interpretation="transport/ACK only; no retry and no finality inference"))
        if isinstance(ack,dict) and isinstance(ack.get("result"),dict) and ack["result"].get("hash"):
            lab.require(ack["result"]["hash"].lower()==expected.lower(),"original broadcast ACK identity differs")
            lab.require(int(ack["result"].get("code",0))==0,"original identity-bound CheckTx rejected; no retry")
        until=time.monotonic()+45
        while time.monotonic()<until:
            self.w.sample()
            try:
                rows=[self.w.rpc(n["rpcAddress"],"tx","?hash=0x"+expected+"&prove=true") for n in self.plan["nodes"]]
                lab.require(all(r["hash"].lower()==expected.lower() for r in rows),"original transaction identity differs")
                heights={int(r["height"]) for r in rows};lab.require(len(heights)==1,"transaction heights differ across nodes")
                lab.require(all(int(r["tx_result"].get("code",0))==0 for r in rows),"original transaction execution failed")
                height=next(iter(heights));checkpoint=self.quiet(height+1,timeout=30)
                row=dict(name=name,hash=expected,height=height,successorCheckpoint=checkpoint,offeredMonotonicNs=offered,observedMonotonicNs=time.monotonic_ns(),rpcExecutionObservations=rows,qualifiedFinal=False,signatureProofVerification="NOT_PERFORMED")
                lab.write_new(self.w.work/"public"/(name+"-observation.json"),row);self.observations.append(row);return row
            except (OSError,ValueError,KeyError):pass
            except RuntimeError as error:
                if "execution failed" in str(error) or "identity differs" in str(error):raise
            time.sleep(.2)
        raise RuntimeError("UNKNOWN original submission retained by hash; never re-sign or rebroadcast")

    def traffic(self,name):
        transactions=self.workload["transactions"]
        lab.require(self.next_workload<len(transactions),"original finite corpus exhausted")
        tx=transactions[self.next_workload];self.next_workload+=1
        f=tx["envelope"];path=self.root/"workload"/f["path"]
        lab.require(path.resolve()==path and (self.root/"workload") in path.parents,"original corpus path escaped")
        raw=path.read_bytes();lab.require(len(raw)==int(f["bytes"]) and digest(raw)==f["sha256"]==tx["abciHash"],"original public envelope/hash differs")
        return self.post_once(name,raw,tx["abciHash"])

    def execute(self):
        self.start();self.quiet(int(self.plan["initialHeight"]))
        for i in range(4):
            before=self.quiet();registration=self.call("registration-%d"%i,["registration","--synthetic","--root",str(self.root),"--plan-sha256",self.pin,"--node",str(i),"--approved-at",str(before["height"]+1)])
            after=self.quiet();lab.require(after==before,"checkpoint advanced during one-shot approval; preserve originals")
            self.post_once("registration-%d"%i,base64.b64decode(registration["transaction"],validate=True),registration["transactionHash"])
        before=self.quiet();target=before["height"]+2
        self.call("publish-halt",["halt","--synthetic","--root",str(self.root),"--plan-sha256",self.pin,"--height",str(target)])
        # One original corpus transfer drives H+1 and its automatic successor
        # to R. Natural halt is expected; the resource monitor still applies.
        self.w.stopping=True
        # No live finality is inferred at the halted R. The original activation
        # callee validates stopped DB/App/signing leases and exact common R.
        tx=self.workload["transactions"][self.next_workload];self.next_workload+=1
        raw=(self.root/"workload"/tx["envelope"]["path"]).read_bytes()
        self.halt_post(raw,tx["abciHash"])
        for proc in self.nodes:self.w.wait(proc,allow_failure=True)
        for child in self.w.children:
            if child["process"] in self.nodes:child["persistent"]=False
        self.nodes=[]
        activation=self.call("activate-original",["activate","--synthetic","--root",str(self.root),"--plan-sha256",self.pin])
        lab.require(int(activation["registryHeight"])==target and int(activation["activationHeight"])==target+4,"original activation R/A differs")
        self.start(activation);checkpoint=self.quiet(target)
        while checkpoint["height"]<int(activation["activationHeight"]):
            self.traffic("activation-traffic-%d"%self.next_workload);checkpoint=self.quiet()
        observation=self.traffic("post-activation-functional-transfer")
        return dict(phaseComplete=True,activation=activation,postActivationObservation=observation,
                    preparationTrafficEnvelopes=self.next_workload-1,functionalEnvelopes=1,registrationEnvelopes=4,
                    measuredWindowEnvelopes=0,originalCorpusOwnerCount=1,
                    normalNodeProcessPIDs=[p.pid for p in self.nodes],PQQuorumVerified=False,
                    qualifiedFinalCount=None,fixedWindowResult="UNMEASURED",finalConfirmationLatency="UNMEASURED",
                    missing="actual stopped BlockStore/App independent proof-material export -> original proof-context/verifier required")

    def halt_post(self,raw,expected):
        # Same no-retry POST intent, but observation must use stopped files at R
        # because original nodes intentionally close RPC on normal height halt.
        lab.require(digest(raw)==expected and expected not in self.attempted,"halt driver hash/replay differs")
        self.attempted.add(expected)
        lab.write_new(self.w.work/"public/halt-traffic-intent.json",dict(hash=expected,transaction=base64.b64encode(raw).decode(),qualifiedFinal=False,submissionAttempts=1))
        body=json.dumps(dict(jsonrpc="2.0",id="halt-traffic",method="broadcast_tx_sync",params=dict(tx=base64.b64encode(raw).decode()))).encode()
        try:
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(urllib.request.Request(self.plan["nodes"][0]["rpcAddress"],data=body,headers={"Content-Type":"application/json"}),timeout=3) as response:
                raw=response.read((1<<20)+1);lab.require(len(raw)<=1<<20,"halt ACK bound")
                lab.write_new(self.w.work/"public/halt-traffic-ack.json",json.loads(raw))
        except (OSError,ValueError) as error:
            lab.write_new(self.w.work/"public/halt-traffic-transport-unknown.json",dict(error=str(error),hash=expected,noRetry=True))


def run(args):
    source=Path(args.source);identity=lab.check_source(source,args.commit)
    lab.git(source,"merge-base","--is-ancestor",HELPER_COMMIT,args.commit)
    if not args.execute:return dict(status="prepared-only",source=identity,helper=HELPER_COMMIT,scope="four normal process ceremony only; finality/window withheld")
    lab.require(sys.platform=="linux" and os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted","dedicated hosted Linux job required")
    parent=Path(os.environ["RUNNER_TEMP"]).resolve(strict=True);rows,_=lab.guard.proc_inventory()
    lab.admit(lab.guard.memory_available(),shutil.disk_usage(parent).free,lab.heavy_processes(rows));lab.ports_available()
    lab.require(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"Linux subreaper required")
    work=Path(tempfile.mkdtemp(prefix="pq-normal-process-",dir=parent));work.chmod(0o700)
    (work/".private").mkdir(mode=0o700);(work/"public").mkdir(mode=0o700)
    w=lab.Window(source,work);result=dict(schema="YNX-PQ-NORMAL-PROCESS-CEREMONY/v1",source=identity,caps=lab.CAPS,firstCause=None,phaseComplete=False,sameHost=True,physicalFaultDomains=1,stableFinalTPS="UNMEASURED",P95FinalConfirmation="UNMEASURED",actualHopBytesPerTx="UNMEASURED",firstSaturatedChainStage="UNMEASURED")
    try:
        bins=work/".private/bin"
        for name in ("ynx-consensus-pq-lab","ynx-comet"):
            w.wait(w.launch("build-"+name,["go","build","-mod=readonly","-p","1","-o",str(bins/name),"./cmd/"+name]))
        root=work/".private/network"
        proc=w.launch("create-original",[str(bins/"ynx-consensus-pq-lab"),"create","--synthetic","--root",str(root),"--transactions","32","--batch-size","1","--base-p2p-port","31656","--base-rpc-port","31757"]);w.wait(proc)
        created=json.loads((work/"public/create-original.log").read_bytes())
        result["originalPlanSHA256"]=created["planSHA256"]
        result.update(Ceremony(w,root,created,bins).execute())
        lab.check_source(source,args.commit)
    except BaseException as error:result["firstCause"]=str(error)
    finally:
        try:result["cleanupComplete"]=w.stop()
        except BaseException as error:result["cleanupComplete"]=False;result["cleanupError"]=str(error)
        result.update(elapsedSeconds=time.monotonic()-w.started,peakRSSBytes=w.peak_rss,peakNewBytes=w.peak_bytes,resourceSamples=w.samples)
        lab.write_new(work/"public/receipt.json",result);print(json.dumps(dict(publicArtifacts=str(work/"public"),firstCause=result["firstCause"],phaseComplete=result["phaseComplete"])))
    lab.require(result["firstCause"] is None and result["cleanupComplete"],"normal ceremony failed; original intent/state/UNKNOWN retained")
    return result


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--source",required=True);parser.add_argument("--commit",required=True);parser.add_argument("--execute",action="store_true");args=parser.parse_args()
    def interrupted(signum,frame):raise RuntimeError("normal PQ lab received signal "+str(signum))
    signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGTERM,interrupted)
    print(json.dumps(run(args)))
