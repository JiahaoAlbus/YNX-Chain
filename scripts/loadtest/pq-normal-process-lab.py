#!/usr/bin/env python3
"""Four normal synthetic PQ processes and original stopped-store full proof.

Functional small cohort only. Stop/export/verification latency remains explicit;
it is not physical Commit formation, a continuous window or sustained capacity.
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
HELPER_COMMIT="a78803d31632a461df7f012e2c13e46f17c48e6d"
WIRE_OBSERVER_COMMIT="e3a7319267b4c48d3f9164d702a38a3c3ac51713"


def digest(raw):return hashlib.sha256(raw).hexdigest()


def comet_hash(value):
    lab.require(isinstance(value,str) and re.fullmatch(r"(?:0x)?[0-9a-fA-F]{64}",value),"exact original hash representation required")
    return value.removeprefix("0x").lower()


def public_file(directory,reference):
    path=directory/reference["path"]
    lab.require(path.resolve()==path and directory in path.parents and path.is_file(),"original public path escaped")
    lab.require(lab.guard.digest(path)==reference["sha256"],"original public file pin differs")
    return path


def sender_command_data(operation,request,height=0,app_hash="",materials="",materials_sha="",proof=""):
    # Field order and explicit empty fields match the normal Go canonical JSONL.
    return dict(version="YNX-PQ-LAB-SENDER-COMMAND/v1",operation=operation,request=request,
                checkpointHeight=str(height),checkpointAppHash=app_hash,materialsFile=materials,materialsSHA256=materials_sha,proofFile=proof)


def require_verified(verified,tx):
    result=verified.get("result") or {}
    lab.require(verified.get("code")=="VERIFIED_TRANSACTION_DATA" and result.get("included") is True and result.get("finalized") is True and result.get("executionSuccessful") is True and str(result.get("executionCode"))=="0" and result.get("nativeGrant") is False,"original verifier did not establish full successful H/H+1 data")
    lab.require(comet_hash(result.get("transactionHash"))==comet_hash(tx["abciHash"]) and comet_hash(result.get("nativeWireHash"))==comet_hash(tx["nativeHash"]),"original full-proof dual hash differs")


def validate_wire_observation(record):
    lab.require(type(record) is dict,"original observer object required")
    lab.require(record["version"]=="YNX-COMET-WIRE-OBSERVATION/v1" and record["scope"]=="synthetic-loopback-lab/v1" and record["syntheticOnly"] is True and record["independentFinality"] is False and record["physicalBytesMeasured"] is False,"original logical-only observer scope differs")
    lab.require(record["captureBoundary"]=="after-normal-node-stop;completed-calls-only;in-flight-excluded","original observer lifecycle differs")
    snapshot=record["snapshot"]
    lab.require(type(snapshot) is dict,"original observer snapshot object required")
    lab.require(snapshot["schema"]=="YNX-MEMPOOL-WIRE-OBSERVATION/v1" and snapshot["attached"] is True and snapshot["overflow"] is False and snapshot["physicalBytesMeasured"] is False,"original observer not attached, overflowed or measurement kind differs")
    groups=("sendAttempts","sendQueued","sendNotQueued","received")
    fields=("messages","transactions","transactionBytes","reencodedProtoBytes")
    def counter(value):
        lab.require(type(value) is int and 0<=value<1<<64,"bounded original unsigned counter required")
        return value
    for group in groups:
        lab.require(type(snapshot[group]) is dict,"original message totals object required")
        for field in fields:counter(snapshot[group][field])
    for field in fields:
        lab.require(snapshot["sendAttempts"][field]==snapshot["sendQueued"][field]+snapshot["sendNotQueued"][field],"original completed send accounting differs")
    for field in ("emptyReceived","sendCallNs","sendCallMaxNs","checkTxCalls","checkTxReturnNil","checkTxReturnError","checkTxCallNs","checkTxCallMaxNs"):counter(snapshot[field])
    lab.require(snapshot["checkTxCalls"]==snapshot["checkTxReturnNil"]+snapshot["checkTxReturnError"],"original CheckTx return accounting differs")
    lab.require(snapshot["sendCallMaxNs"]<=snapshot["sendCallNs"] and snapshot["checkTxCallMaxNs"]<=snapshot["checkTxCallNs"],"original call duration accounting differs")
    return snapshot


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
    # bytes or credential path are added to argv/environment. Linux /bin/sh
    # (dash) rejects multi-digit redirections such as 3<&16. Use isolated
    # Python's descriptor syscalls, then exec the exact original binary/argv.
    lab.require(type(fd) is int and fd>=3,"private inherited descriptor required")
    script="import os,sys\nfd=int(sys.argv[1])\nif fd!=3:\n os.dup2(fd,3,inheritable=True)\n os.close(fd)\nelse:\n os.set_inheritable(3,True)\nos.execv(sys.argv[2],sys.argv[2:])\n"
    return [sys.executable,"-I","-c",script,str(fd),*command]


def decoded_hash(value):
    if isinstance(value,str) and re.fullmatch(r"[0-9a-fA-F]{64}",value):return value.lower()
    raw=base64.b64decode(value,validate=True);lab.require(len(raw)==32,"original ABCI hash length differs");return raw.hex()


class Ceremony:
    def __init__(self,window,root,created,bins,observe_wire=False):
        self.w,self.root,self.bins=window,root,bins
        self.plan=original_plan(created,root);self.pin=created["planSHA256"]
        self.workload=created["workload"];self.nodes=[];self.attempted=set();self.observations=[]
        self.next_workload=0;self.used_indices=set();self.transfers=[];self.pending_owners=set();self.activation_pin=""
        self.workload_pin=lab.guard.digest(root/"workload/PUBLIC-WORKLOAD.json")
        self.mode=self.workload["mode"]
        self.observe_wire=observe_wire;self.wire_outputs=[]
        lab.require(self.mode in ("online","pre-signed") and len(self.workload["owners"])==8,"original eight independent owners required")

    def call(self,name,args):
        proc=self.w.launch(name,[str(self.bins/"ynx-consensus-pq-lab"),*args]);self.w.wait(proc)
        return json.loads((self.w.work/"public"/(name+".log")).read_bytes())

    def wire_arguments(self,phase,index):
        if not self.observe_wire:return []
        lab.require(phase in ("bootstrap","pq") and type(index) is int and 0<=index<4,"original observer lifetime identity required")
        directory=self.w.work/"public/node-wire";directory.mkdir(mode=0o700,exist_ok=True)
        path=directory/("%s-node-%d.json"%(phase,index))
        lab.require(directory.resolve()==directory and not path.exists(),"fresh original observer output required")
        lab.require(not any(row["phase"]==phase and row["node"]==index for row in self.wire_outputs),"original observer lifetime cannot be replayed")
        self.wire_outputs.append(dict(phase=phase,node=index,path=path))
        return ["--wire-observation-output",str(path),"--wire-observation-scope","synthetic-loopback-lab/v1"]

    def wire_readback(self):
        result=dict(enabled=self.observe_wire,logicalReadbackComplete=False,producerAllExitZero=False,physicalBytesMeasured=False,independentFinality=False,networkPackingReady=False,observations=[],errors=[],meaning="per-node lifetime totals include preparation/retries; completed calls only, in-flight excluded; no per-business or physical-byte denominator")
        if not self.observe_wire:return result
        for row in self.wire_outputs:
            try:
                path=row["path"];lab.require(path.resolve()==path,"original observer path changed")
                raw=lab.guard.bounded(path,64<<10);snapshot=validate_wire_observation(json.loads(raw))
                name="%s-node-%d"%(row["phase"],row["node"])
                child=next(c for c in self.w.children if c["name"]==name)
                result["observations"].append(dict(phase=row["phase"],node=row["node"],file=str(path.relative_to(self.w.work/"public")),sha256=digest(raw),producerExitCode=child["process"].returncode,snapshot=snapshot))
            except (OSError,ValueError,KeyError,RuntimeError,StopIteration) as error:
                result["errors"].append(dict(phase=row["phase"],node=row["node"],error=str(error)))
        result["logicalReadbackComplete"]=not result["errors"] and {(r["phase"],r["node"]) for r in result["observations"]}=={(phase,i) for phase in ("bootstrap","pq") for i in range(4)}
        result["producerAllExitZero"]=result["logicalReadbackComplete"] and all(r["producerExitCode"]==0 for r in result["observations"])
        return result

    def start(self,activation=None):
        self.w.stopping=False
        for n in self.plan["nodes"]:
            observed=self.wire_arguments("bootstrap" if activation is None else "pq",n["index"])
            if activation is None:
                proc=self.w.launch("bootstrap-node-%d"%n["index"],[str(self.bins/"ynx-comet"),*n["bootstrapArgs"],*observed],True)
            else:
                a=activation["nodes"][n["index"]]
                lab.require(a["index"]==n["index"] and a["recoveryFD"]==3 and a["recoveryCredentialFile"]==n["recoveryCredentialFile"],"activation changed original credential mapping")
                path=Path(a["recoveryCredentialFile"])
                fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
                try:
                    info=os.fstat(fd)
                    lab.require(stat.S_ISREG(info.st_mode) and info.st_size==32 and info.st_mode&0o077==0 and info.st_nlink==1,"original private recovery file required")
                    command=fd3_command([str(self.bins/"ynx-comet"),*a["args"],*observed],fd)
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
        original_hash=expected;expected=comet_hash(expected)
        lab.require(digest(raw)==expected and expected not in self.attempted,"original hash differs or duplicate broadcast attempted")
        self.attempted.add(expected)
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
        ack_returned=time.monotonic_ns()
        lab.write_new(self.w.work/"public"/(name+"-ack.json"),dict(ack=ack,error=transport_error,requestBodyBytes=len(body),broadcastRoundTripNs=ack_returned-offered,interpretation="transport/ACK only; no retry and no finality inference"))
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
                included=time.monotonic_ns();height=next(iter(heights));checkpoint=self.quiet(height+1,timeout=30)
                row=dict(name=name,hash=expected,originalHash=original_hash,height=height,successorCheckpoint=checkpoint,offeredMonotonicNs=offered,ackReturnedMonotonicNs=ack_returned,firstInclusionObservedMonotonicNs=included,observedMonotonicNs=time.monotonic_ns(),rpcExecutionObservations=rows,qualifiedFinal=False,signatureProofVerification="NOT_PERFORMED")
                lab.write_new(self.w.work/"public"/(name+"-observation.json"),row);self.observations.append(row);return row
            except (OSError,ValueError,KeyError):pass
            except RuntimeError as error:
                if "execution failed" in str(error) or "identity differs" in str(error):raise
            time.sleep(.2)
        raise RuntimeError("UNKNOWN original submission retained by hash; never re-sign or rebroadcast")

    def sender_command(self,name,owner,command):
        path=self.w.work/".private"/(name+"-command.jsonl")
        lab.write_new(path,command)
        credential=self.root/"workload/private-senders/recovery.raw"
        fd=os.open(credential,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        try:
            info=os.fstat(fd);lab.require(stat.S_ISREG(info.st_mode) and info.st_size==32 and info.st_mode&0o077==0 and info.st_nlink==1,"original private sender credential required")
            args=[str(self.bins/"ynx-consensus-pq-lab"),"sender","--synthetic","--root",str(self.root),"--plan-sha256",self.pin,"--activation-sha256",self.activation_pin,"--workload-sha256",self.workload_pin,"--owner",str(owner),"--credential-fd","3"]
            proc=self.w.launch(name,fd3_command(args,fd),pass_fds=(fd,),stdin_path=path);self.w.wait(proc)
        finally:os.close(fd)
        return json.loads((self.w.work/"public"/(name+".log")).read_bytes())

    def transfer(self,name,owner):
        offered=time.monotonic_ns();checkpoint=self.quiet();checkpoint_ready=time.monotonic_ns()
        o=self.workload["owners"][owner]
        state=json.loads(lab.guard.bounded(Path(self.plan["nodes"][0]["statePath"]),128<<20))
        account=next(a for a in state["accounts"] if a["address"]==o["owner"]);nonce=int(account["nonce"])+1
        request=None;sign_started=time.monotonic_ns()
        if self.mode=="online":
            lab.require(owner not in self.pending_owners,"original owner has unresolved operation; recover/confirm only")
            operation=digest(json.dumps([self.pin,name,owner,str(nonce)],separators=(",",":")).encode())
            request=dict(version="YNX-PQ-LAB-SENDER-REQUEST/v1",operationId=operation,ownerIndex=owner,firstNonce=str(nonce),members=1)
            command=sender_command_data("sign",request,checkpoint["height"],checkpoint["appHash"])
            self.pending_owners.add(owner)
            reply=self.sender_command(name+"-original-sign",owner,command)
            lab.require(reply["code"]=="ORIGINAL_SAVED","original online signer did not publish a known result; preserve UNKNOWN")
            result=reply["result"];directory=self.root/"workload/sender-public"/("%04d"%owner)/operation
        else:
            indices=[i for i,t in enumerate(self.workload["transactions"]) if i not in self.used_indices and t["ownerIndex"]==owner and int(t["firstNonce"])==nonce]
            lab.require(len(indices)==1,"unique original current pre-signed nonce required")
            index=indices[0];self.used_indices.add(index)
            result=self.call(name+"-original-presigned",["presigned","--synthetic","--root",str(self.root),"--plan-sha256",self.pin,"--activation-sha256",self.activation_pin,"--workload-sha256",self.workload_pin,"--index",str(index),"--checkpoint-height",str(checkpoint["height"]),"--checkpoint-app-hash",checkpoint["appHash"]])
            directory=self.root/"workload"
        sign_returned=time.monotonic_ns()
        lab.require(result["version"]=="YNX-PQ-LAB-SENDER-RESULT/v1" and result["syntheticOnly"] is True and result["authorityGranted"] is False and result["ownerIndex"]==owner,"original sender result scope differs")
        tx=result["transaction"];path=directory/tx["envelope"]["path"]
        lab.require(path.resolve()==path and directory in path.parents,"original public envelope escaped")
        raw=path.read_bytes();lab.require(len(raw)==int(tx["envelope"]["bytes"]) and digest(raw)==tx["envelope"]["sha256"]==comet_hash(tx["abciHash"]),"original envelope bytes differ")
        row=dict(name=name,owner=owner,transaction=tx,envelopePath=str(path),request=request,logicalOfferMonotonicNs=offered,checkpointWaitNs=checkpoint_ready-offered,originalSenderDispatchNs=sign_returned-sign_started,preparationCompletedMonotonicNs=time.monotonic_ns(),mode=self.mode)
        self.transfers.append(row);self.next_workload+=1
        return row,raw

    def traffic(self,name,owner):
        row,raw=self.transfer(name,owner)
        row["observation"]=self.post_once(name,raw,row["transaction"]["abciHash"])
        return row

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
        # Prepare through the same original sender BEFORE nodes halt.
        self.w.stopping=False
        row,raw=self.transfer("halt-traffic",0)
        self.w.stopping=True
        self.halt_post(raw,row["transaction"]["abciHash"])
        for proc in self.nodes:self.w.wait(proc,allow_failure=True)
        for child in self.w.children:
            if child["process"] in self.nodes:child["persistent"]=False
        self.nodes=[]
        activation=self.call("activate-original",["activate","--synthetic","--root",str(self.root),"--plan-sha256",self.pin])
        self.activation_pin=lab.guard.digest(self.root/"activation/activation.json")
        lab.require(int(activation["registryHeight"])==target and int(activation["activationHeight"])==target+4,"original activation R/A differs")
        self.start(activation);checkpoint=self.quiet(target)
        while checkpoint["height"]<int(activation["activationHeight"]):
            lab.require(self.next_workload<4,"bounded original activation traffic exceeded reserved owners")
            self.traffic("activation-traffic-%d"%self.next_workload,self.next_workload);checkpoint=self.quiet()
        planned=[dict(id=digest((self.pin+":functional:"+str(i)).encode()),owner=i,status="not-submitted") for i in range(4,8)]
        lab.write_new(self.w.work/"public/functional-cohort-plan.json",dict(schema="YNX-PQ-FOUR-PROCESS-FUNCTIONAL-PLAN/v1",planSHA256=self.pin,mode=self.mode,requests=planned,fixedWindowConfigured=False))
        functional=[]
        for request in planned:
            functional.append(self.traffic("functional-owner-%d"%request["owner"],request["owner"]))
        node_pids=[p.pid for p in self.nodes]
        self.w.stopping=True
        for proc in self.nodes:proc.send_signal(signal.SIGTERM)
        for proc in self.nodes:self.w.wait(proc,allow_failure=True)
        for child in self.w.children:
            if child["process"] in self.nodes:child["persistent"]=False
        full_hashes=[lab.guard.digest(Path(n["statePath"])) for n in self.plan["nodes"]]
        lab.require(len(set(full_hashes))==1,"four stopped full committed states differ; no fields projected away")
        proofs=[]
        for row in functional:proofs.append(self.verify_stopped(row))
        return dict(phaseComplete=True,activation=activation,signingMode=self.mode,functionalCohort=proofs,
                    preparationTrafficEnvelopes=self.next_workload-4,functionalEnvelopes=4,registrationEnvelopes=4,
                    measuredWindowEnvelopes=0,originalCorpusOwnerCount=8,independentFunctionalOwners=4,
                    normalNodeProcessPIDs=node_pids,allFourStoppedStateSHA256=full_hashes[0],PQQuorumVerified=True,
                    qualifiedFinalCount=len(proofs),fixedWindowResult="UNMEASURED",finalConfirmationLatency="functional parent monotonic upper bounds include stop/export/original verification; not physical Commit or sustained P95",
                    unconfirmedPreparationOwners=sorted(self.pending_owners))

    def verify_stopped(self,row):
        name=row["name"];tx=row["transaction"]
        parent=self.root/"public-exports";parent.mkdir(mode=0o700,exist_ok=True)
        case=parent/name;case.mkdir(mode=0o700)
        export_started=time.monotonic_ns()
        exported=self.call(name+"-original-export",["export","--synthetic","--root",str(self.root),"--plan-sha256",self.pin,"--activation-sha256",self.activation_pin,
            "--transaction",row["envelopePath"],"--transaction-sha256",comet_hash(tx["abciHash"]),"--native-wire-hash",comet_hash(tx["nativeHash"]),"--output",str(case/"export"),
            "--trusting-period","10m","--max-clock-drift","5s","--trust-numerator","1","--trust-denominator","3"])
        lab.require(exported["version"]=="YNX-PQ-LAB-STOPPED-PROOF/v1" and exported["sourceReadOnly"] is True and exported["stoppedNodes"]==4 and exported["authorityGranted"] is False,"original four stopped-store exporter scope differs")
        export_returned=time.monotonic_ns()
        lab.require(int(exported["transactionHeight"])==row["observation"]["height"] and comet_hash(exported["transactionHash"])==comet_hash(tx["abciHash"]) and comet_hash(exported["nativeWireHash"])==comet_hash(tx["nativeHash"]),"stopped proof differs from original observed transaction")
        for key in ("materials","proof","checkpoint"):
            public_file(case,exported[key])
        context_started=time.monotonic_ns()
        context=self.call(name+"-original-proof-context",["proof-context","--synthetic","--materials",exported["materials"]["path"],"--materials-sha256",exported["materials"]["sha256"],"--proof",exported["proof"]["path"],"--output",str(case/"context")])
        lab.require(context["version"]=="YNX-PQ-LOOPBACK-PROOF-EXPORT/v1" and context["authorityGranted"] is False,"original proof-context scope differs")
        context_returned=time.monotonic_ns()
        request=public_file(case/"context",context["request"])
        trust=public_file(case/"context",context["context"])
        lab.require(context["verifierArguments"]==["--trust-context",str(trust),"--trust-context-sha256",context["context"]["sha256"]],"original pinned verifier arguments differ")
        verifier_started=time.monotonic_ns()
        proc=self.w.launch(name+"-normal-verifier",[str(self.bins/"ynx-consensus-proof-verify"),*context["verifierArguments"]],stdin_path=request);self.w.wait(proc)
        verified=json.loads((self.w.work/"public"/(name+"-normal-verifier.log")).read_bytes())
        require_verified(verified,tx)
        verifier_returned=time.monotonic_ns();confirm_started=verifier_returned
        if self.mode=="online":
            command=sender_command_data("confirm",row["request"],materials=exported["materials"]["path"],materials_sha=exported["materials"]["sha256"],proof=exported["proof"]["path"])
            confirmed=self.sender_command(name+"-original-confirm",row["owner"],command)
            lab.require(confirmed["code"]=="PROOF_CONFIRMED_DATA" and confirmed["result"]["result"]["executionSuccessful"] is True,"original online operation remains unresolved; no replay")
            self.pending_owners.remove(row["owner"])
        ended=time.monotonic_ns()
        # A later, separate immutable record qualifies the earlier observation;
        # original RPC_ONLY files and UNKNOWN history are never rewritten.
        final=dict(localRequestId=digest((self.pin+":functional:"+str(row["owner"])).encode()),owner=row["owner"],mode=self.mode,
                   transactionHash=tx["abciHash"],nativeHash=tx["nativeHash"],height=exported["transactionHeight"],qualifiedFinal=True,
                   logicalOfferMonotonicNs=row["logicalOfferMonotonicNs"],preparationNs=row["preparationCompletedMonotonicNs"]-row["logicalOfferMonotonicNs"],
                   stageElapsedNs=dict(checkpointWait=row["checkpointWaitNs"],originalSenderDispatch=row["originalSenderDispatchNs"],
                       broadcastRoundTrip=row["observation"]["ackReturnedMonotonicNs"]-row["observation"]["offeredMonotonicNs"],
                       submitToAllNodeInclusionObservation=row["observation"]["firstInclusionObservedMonotonicNs"]-row["observation"]["offeredMonotonicNs"],
                       inclusionToSuccessorObservation=row["observation"]["observedMonotonicNs"]-row["observation"]["firstInclusionObservedMonotonicNs"],
                       stoppedStoreExport=export_returned-export_started,proofContext=context_returned-context_started,
                       normalVerifier=verifier_returned-verifier_started,originalOnlineConfirm=ended-confirm_started if self.mode=="online" else None),
                   inclusionObservedUpperBoundNs=row["observation"]["firstInclusionObservedMonotonicNs"]-row["logicalOfferMonotonicNs"],
                   successorAvailabilityObservedUpperBoundNs=row["observation"]["observedMonotonicNs"]-row["logicalOfferMonotonicNs"],
                   qualifiedVerificationReturnUpperBoundNs=ended-row["logicalOfferMonotonicNs"],
                   originalRPCObservationSHA256=lab.guard.digest(self.w.work/"public"/(name+"-observation.json")),
                   verification="normal stopped four DB/App/HRS exporter -> original proof-context -> normal VerifierCLI -> original online confirm if applicable",
                   interpretation="parent monotonic observed bounds including signer/readback lifecycle, stop and verification; not physical Commit time or continuous-load percentile")
        lab.write_new(self.w.work/"public"/(name+"-final-proof.json"),final)
        # Only the normal tool's PUBLIC export subtree is copied, never any
        # sender/validator custody, private credential, HRS or raw DB directory.
        shutil.copytree(case,self.w.work/"public"/(name+"-public-proof"))
        return final

    def halt_post(self,raw,expected):
        # Same no-retry POST intent, but observation must use stopped files at R
        # because original nodes intentionally close RPC on normal height halt.
        original_hash=expected;expected=comet_hash(expected)
        lab.require(digest(raw)==expected and expected not in self.attempted,"halt driver hash/replay differs")
        self.attempted.add(expected)
        lab.write_new(self.w.work/"public/halt-traffic-intent.json",dict(hash=expected,originalHash=original_hash,transaction=base64.b64encode(raw).decode(),qualifiedFinal=False,submissionAttempts=1))
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
    observe_wire=getattr(args,"wire_observation",False)
    if observe_wire:lab.git(source,"merge-base","--is-ancestor",WIRE_OBSERVER_COMMIT,args.commit)
    if not args.execute:return dict(status="prepared-only",source=identity,helper=HELPER_COMMIT,mode=args.mode,scope="four normal process functional cohort and original stopped proof; sustained window withheld")
    lab.require(sys.platform=="linux" and os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted","dedicated hosted Linux job required")
    parent=Path(os.environ["RUNNER_TEMP"]).resolve(strict=True);rows,_=lab.guard.proc_inventory()
    lab.admit(lab.guard.memory_available(),shutil.disk_usage(parent).free,lab.heavy_processes(rows));lab.ports_available()
    lab.require(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"Linux subreaper required")
    work=Path(tempfile.mkdtemp(prefix="pq-normal-process-",dir=parent));work.chmod(0o700)
    (work/".private").mkdir(mode=0o700);(work/"public").mkdir(mode=0o700)
    w=lab.Window(source,work,additional_storage=(source,));result=dict(schema="YNX-PQ-NORMAL-PROCESS-CEREMONY/v1",source=identity,caps=lab.CAPS,storageRoots=[str(p) for p in w.storage_roots],signingMode=args.mode,firstCause=None,phaseComplete=False,sameHost=True,physicalFaultDomains=1,configuredFunctionalDenominator=4,stableFinalTPS="UNMEASURED",P95FinalConfirmation="UNMEASURED",actualHopBytesPerTx="UNMEASURED",firstSaturatedChainStage="UNMEASURED")
    ceremony=None
    try:
        bins=work/".private/bin"
        for name in ("ynx-consensus-pq-lab","ynx-comet","ynx-consensus-proof-verify"):
            w.wait(w.launch("build-"+name,["go","build","-mod=readonly","-p","1","-o",str(bins/name),"./cmd/"+name]))
        result["binaries"]={name:lab.guard.digest(bins/name) for name in ("ynx-consensus-pq-lab","ynx-comet","ynx-consensus-proof-verify")}
        root=work/".private/network"
        proc=w.launch("create-original",[str(bins/"ynx-consensus-pq-lab"),"create","--synthetic","--root",str(root),"--transactions","32","--batch-size","1","--owners","8",*(["--online"] if args.mode=="online" else []),"--base-p2p-port","31656","--base-rpc-port","31757"]);w.wait(proc)
        created=json.loads((work/"public/create-original.log").read_bytes())
        result["originalPlanSHA256"]=created["planSHA256"]
        ceremony=Ceremony(w,root,created,bins,observe_wire)
        result.update(ceremony.execute())
        lab.check_source(source,args.commit)
    except BaseException as error:result["firstCause"]=str(error)
    finally:
        try:result["cleanupComplete"]=w.stop()
        except BaseException as error:result["cleanupComplete"]=False;result["cleanupError"]=str(error)
        result["wireObservationRequested"]=observe_wire
        if ceremony is not None:result["wireObservation"]=ceremony.wire_readback()
        result.update(elapsedSeconds=time.monotonic()-w.started,peakRSSBytes=w.peak_rss,peakNewBytes=w.peak_bytes,resourceSamples=w.samples,
                      processes=w.process_receipt(),retiredSamplingEvidence=w.retired_samples,
                      completedFunctionalProofs=[p.name for p in (work/"public").glob("functional-owner-*-final-proof.json")])
        lab.write_new(work/"public/receipt.json",result);print(json.dumps(dict(publicArtifacts=str(work/"public"),firstCause=result["firstCause"],phaseComplete=result["phaseComplete"])))
    lab.require(result["firstCause"] is None and result["cleanupComplete"],"normal ceremony failed; original intent/state/UNKNOWN retained")
    return result


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--source",required=True);parser.add_argument("--commit",required=True);parser.add_argument("--mode",choices=["pre-signed","online"],required=True);parser.add_argument("--wire-observation",action="store_true");parser.add_argument("--execute",action="store_true");args=parser.parse_args()
    def interrupted(signum,frame):raise RuntimeError("normal PQ lab received signal "+str(signum))
    signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGTERM,interrupted)
    print(json.dumps(run(args)))
