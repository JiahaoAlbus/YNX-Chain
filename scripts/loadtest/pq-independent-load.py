#!/usr/bin/env python3
"""Bounded normal PQ single-transfer load. No experimental signer/verifier.

The normal CORE live-materials callee must exist in an exact clean source pin.
The default entry only prepares the configuration; hosted --execute is explicit.
"""
import argparse
import base64
import copy
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import sys
import tempfile
import threading
import time
import urllib.request


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


normal=module("normal_pq_load","pq-normal-process-lab.py")
scheduler=module("independent_pq_load","pq-independent-scheduler.py")
lab=normal.lab


class Journal:
    def __init__(self,path):
        self.path=path;self.paths=[];self.file=None;self.bytes=0;self.open_next()
    def open_next(self):
        path=self.path.with_name(self.path.stem+"-%05d"%len(self.paths)+self.path.suffix)
        self.file=open(path,"xb",buffering=0);os.chmod(path,0o600);self.paths.append(path);self.bytes=0
        fd=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
    def emit(self,value):
        raw=json.dumps(value,separators=(",",":")).encode()+b"\n"
        lab.require(len(raw)<=lab.CAPS["logBytes"],"normal single journal record exceeds retained log bound")
        if self.bytes+len(raw)>lab.CAPS["logBytes"]:
            self.file.close();self.open_next()
        lab.require(self.file.write(raw)==len(raw),"original demand journal short write; do not retry")
        os.fsync(self.file.fileno());self.bytes+=len(raw)
    def close(self):self.file.close()


class Monitor:
    def __init__(self,window,stop):
        self.w=window;self.stop_event=stop;self.finished=threading.Event();self.error=None
        self.thread=threading.Thread(target=self.loop,name="owned-original-resource-observer",daemon=True)
    def loop(self):
        while not self.finished.is_set():
            try:self.w.sample()
            except BaseException as error:self.error=str(error);self.stop_event.set();return
            self.finished.wait(.2)
    def check(self):
        if self.error:raise RuntimeError(self.error)
    def close(self):self.finished.set();self.thread.join(timeout=10)


class SenderSession:
    """One leased normal sender stdin/stdout stream, not a new signing API."""
    def __init__(self,ceremony,owner):
        self.c=ceremony;self.owner=owner;self.offset=0;self.partial=b""
        path=ceremony.root/"workload/private-senders/recovery.raw"
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        try:
            st=os.fstat(fd);lab.require(stat.S_ISREG(st.st_mode) and st.st_size==32 and st.st_mode&0o077==0 and st.st_nlink==1,"original private credential required")
            args=[str(ceremony.bins/"ynx-consensus-pq-lab"),"sender","--synthetic","--root",str(ceremony.root),"--plan-sha256",ceremony.pin,"--activation-sha256",ceremony.activation_pin,"--workload-sha256",ceremony.workload_pin,"--owner",str(owner),"--credential-fd","3"]
            self.name="load-sender-%d"%owner
            self.proc=ceremony.w.launch(self.name,normal.fd3_command(args,fd),True,pass_fds=(fd,),stdin_pipe=True,thread_safe=True)
        finally:os.close(fd)
        self.path=ceremony.w.work/"public"/(self.name+".log")
    def exchange(self,command,path,stop):
        lab.require(not stop.is_set(),"original sender interrupted before new command; preserve pending original")
        raw=json.dumps(command,separators=(",",":")).encode()+b"\n"
        lab.require(len(raw)<=32<<10,"original canonical command bound")
        # Original one-pending-account ownership makes a single bounded write
        # possible. A broken/uncertain stream is never reopened or retried.
        lab.require(self.proc.poll() is None,"original sender exited; preserve UNKNOWN")
        self.proc.stdin.write(raw);self.proc.stdin.flush()
        while not stop.is_set():
            with open(self.path,"rb") as source:
                source.seek(self.offset);chunk=source.read(65536);self.offset+=len(chunk)
            self.partial+=chunk;lab.require(len(self.partial)<=2<<20,"original sender reply bound")
            if b"\n" in self.partial:
                line,self.partial=self.partial.split(b"\n",1)
                with open(path,"xb") as output:output.write(line+b"\n");output.flush();os.fsync(output.fileno())
                reply=json.loads(line);lab.require(reply["version"]=="YNX-PQ-LAB-SENDER-REPLY/v1","original sender reply version differs")
                return reply
            lab.require(self.proc.poll() is None,"original sender exited without one exact reply; preserve UNKNOWN")
            stop.wait(.01)
        raise RuntimeError("original pending sender interrupted; never re-sign or replay")


class LoadCeremony(normal.Ceremony):
    def __init__(self,*args,operations,proof_timeout,**kwargs):
        super().__init__(*args,**kwargs);self.operations=operations;self.proof_timeout=proof_timeout;self.live=[]
    def activation_startup(self,activation):
        resumed=copy.deepcopy(activation)
        for node in range(4):
            result=self.call("live-setup-%d"%node,["live-materials","setup","--synthetic","--root",str(self.root),"--plan-sha256",self.pin,"--activation-sha256",self.activation_pin,"--node",str(node),"--max-operations",str(self.operations),"--trusting-period","10m","--max-clock-drift","5s","--capture-timeout",str(self.proof_timeout)+"s","--trust-numerator","1","--trust-denominator","3"])
            lab.require(result["version"]=="YNX-PQ-LAB-LIVE-MATERIALS-SETUP/v1" and result["syntheticOnly"] is True and result["nodeStarted"] is False and result["authorityGranted"] is False,"normal independent live setup required")
            original=activation["nodes"][node]["args"]
            lab.require(result["nodeArguments"][:len(original)]==original,"normal live setup changed original activation arguments")
            policy=Path(result["policy"]["path"]);lab.require(policy.resolve()==policy and self.root in policy.parents and lab.guard.digest(policy)==result["policy"]["sha256"],"normal startup policy pin differs")
            lab.require(result["nodeArguments"]==[*original,"--proof-host-live-policy",str(policy),"--proof-host-live-policy-sha256",result["policy"]["sha256"]],"normal live setup arguments differ from exact pinned policy opt-in")
            self.live.append(dict(node=node,policy=policy,pin=result["policy"]["sha256"],sequence=0,lock=threading.Lock(),retired=False))
            resumed["nodes"][node]["args"]=result["nodeArguments"]
        return resumed


class NormalBackend:
    def __init__(self,ceremony,owners,stop):
        self.c=ceremony;self.w=ceremony.w;self.stop_event=stop
        self.sessions={};self.attempted=set();self.submit_lock=threading.Lock();self.checkpoint_lock=threading.Lock();self.cached_checkpoint=None;self.fingerprint=None
        self.queue=__import__('queue').Queue()
        for lane in ceremony.live:self.queue.put(lane)
        if ceremony.mode=="online":
            for owner in owners:self.sessions[owner["ownerIndex"]]=SenderSession(ceremony,owner["ownerIndex"])
        self.corpus={}
        for index,tx in enumerate(ceremony.workload["transactions"]):
            key=(tx["ownerIndex"],int(tx["firstNonce"]))
            lab.require(key not in self.corpus,"original corpus has duplicate account nonce")
            self.corpus[key]=index
    def call(self,name,args,stdin=None):
        p=self.w.launch(name,[str(self.c.bins/"ynx-consensus-pq-lab"),*args],stdin_path=stdin,thread_safe=True)
        try:self.w.wait(p)
        finally:
            if p.poll() is not None:self.w.retire_log(p)
        return json.loads((self.w.work/"public"/(name+".log")).read_bytes())
    def checkpoint(self,stop):
        paths=[Path(n["statePath"]) for n in self.c.plan["nodes"]]
        while not stop.is_set():
            with self.checkpoint_lock:
                fingerprint=tuple((p.stat().st_mtime_ns,p.stat().st_size) for p in paths)
                if fingerprint==self.fingerprint and self.cached_checkpoint is not None:return dict(self.cached_checkpoint)
                values=[json.loads(lab.guard.bounded(p,128<<20)) for p in paths]
                points={(v["height"],v["appHash"]) for v in values}
                if len(points)==1 and all(v["initialized"] for v in values):
                    height,app=next(iter(points));self.fingerprint=fingerprint;self.cached_checkpoint=dict(height=height,appHash=app)
                    return dict(self.cached_checkpoint)
            stop.wait(.01)
        raise RuntimeError("no current common original checkpoint before interruption")
    def original(self,row,account,case,notify,stop):
        notify(dict(kind="normal_stage",stage="checkpoint"))
        checkpoint=self.checkpoint(stop);owner=account["ownerIndex"]
        request=dict(version="YNX-PQ-LAB-SENDER-REQUEST/v1",operationId=row["operationId"],ownerIndex=owner,firstNonce=str(row["nonce"]),members=1)
        if self.c.mode=="online":
            notify(dict(kind="normal_stage",stage="signer"))
            reply=self.sessions[owner].exchange(normal.sender_command_data("sign",request,checkpoint["height"],checkpoint["appHash"]),case/"original-sign-reply.json",stop)
            if reply["code"]=="REJECTED":raise scheduler.KnownFailure("normal signer returned explicit REJECTED; no retry")
            lab.require(reply["code"]=="ORIGINAL_SAVED","normal original sign did not return known durable original; no retry")
            result=reply["result"];directory=self.c.root/"workload/sender-public"/("%04d"%owner)/row["operationId"]
            lab.require(result["operationId"]==row["operationId"],"normal signed operation identity differs")
        else:
            notify(dict(kind="normal_stage",stage="presigned"))
            key=(owner,row["nonce"]);lab.require(key in self.corpus,"original finite corpus exhausted")
            result=self.call("load-%05d-presigned"%row["index"],["presigned","--synthetic","--root",str(self.c.root),"--plan-sha256",self.c.pin,"--activation-sha256",self.c.activation_pin,"--workload-sha256",self.c.workload_pin,"--index",str(self.corpus[key]),"--checkpoint-height",str(checkpoint["height"]),"--checkpoint-app-hash",checkpoint["appHash"]])
            directory=self.c.root/"workload"
        lab.require(result["version"]=="YNX-PQ-LAB-SENDER-RESULT/v1" and result["syntheticOnly"] is True and result["authorityGranted"] is False and result["ownerIndex"]==owner,"normal sender scope differs")
        tx=result["transaction"]
        lab.require(tx["type"]=="pq_transfer" and tx["members"]=="1" and tx["ownerIndex"]==owner and int(tx["firstNonce"])==row["nonce"],"original independent single-transfer identity differs")
        path=normal.public_file(directory,tx["envelope"]);wire=normal.public_file(directory,tx["wire"])
        raw=lab.guard.bounded(path,1<<20);wire_raw=lab.guard.bounded(wire,1<<20)
        lab.require(len(raw)==int(tx["envelope"]["bytes"]) and len(wire_raw)==int(tx["wire"]["bytes"]) and normal.digest(raw)==normal.comet_hash(tx["abciHash"]) and normal.digest(wire_raw)==normal.comet_hash(tx["nativeHash"]),"original dual bytes/hashes differ")
        notify(dict(kind="normal_stage",stage="durable_original"))
        for name,value in (("transaction.abci",raw),("transaction.wire",wire_raw)):
            with open(case/name,"xb") as out:out.write(value);out.flush();os.fsync(out.fileno())
        return tx,path,raw,request
    def broadcast_and_include(self,row,tx,raw,case,notify,stop):
        expected=normal.comet_hash(tx["abciHash"])
        with self.submit_lock:
            lab.require(expected not in self.attempted,"original transaction already attempted; no replay")
            self.attempted.add(expected)
            lab.write_new(case/"submission-intent.json",dict(id=row["id"],operationId=row["operationId"],owner=row["ownerIndex"],nonce=str(row["nonce"]),transactionHash=expected,nativeHash=normal.comet_hash(tx["nativeHash"]),submissionAttempts=1,qualifiedFinal=False))
        body=json.dumps(dict(jsonrpc="2.0",id=row["id"],method="broadcast_tx_sync",params=dict(tx=base64.b64encode(raw).decode())),separators=(",",":")).encode()
        notify(dict(kind="normal_stage",stage="post"))
        notify(dict(kind="submitted"))
        ack=None;transport=None
        try:
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(urllib.request.Request(self.c.plan["nodes"][row["index"]%4]["rpcAddress"],data=body,headers={"Content-Type":"application/json"}),timeout=3) as response:
                data=response.read((1<<20)+1);lab.require(len(data)<=1<<20,"normal ACK response bound")
            ack=json.loads(data)
        except (OSError,ValueError,RuntimeError) as error:transport=str(error)
        lab.write_new(case/"ack.json",dict(ack=ack,error=transport,requestBodyBytes=len(body),interpretation="one POST attempt, never inferred acceptance/finality from HTTP"))
        if isinstance(ack,dict) and isinstance(ack.get("result"),dict) and ack["result"].get("hash"):
            lab.require(normal.comet_hash(ack["result"]["hash"])==expected,"normal ACK transaction hash differs")
            if int(ack["result"].get("code",0))!=0:raise scheduler.KnownFailure("original identity-bound CheckTx rejection; no retry")
            notify(dict(kind="ack"))
        notify(dict(kind="normal_stage",stage="inclusion"))
        until=time.monotonic()+self.c.proof_timeout
        while time.monotonic()<until and not stop.is_set():
            try:
                rows=[self.w.rpc(n["rpcAddress"],"tx","?hash=0x"+expected+"&prove=true") for n in self.c.plan["nodes"]]
                lab.require(all(normal.comet_hash(r["hash"])==expected for r in rows),"normal included transaction identity differs")
                lab.require(len({int(r["height"]) for r in rows})==1 and all(int(r["tx_result"].get("code",0))==0 for r in rows),"normal included execution/height differs")
                notify(dict(kind="included"))
                lab.write_new(case/"four-node-inclusion.json",dict(rows=rows,qualifiedFinal=False,interpretation="original hash-bound execution observations only"));return
            except (OSError,ValueError,KeyError):pass
            except RuntimeError as error:
                if "identity differs" in str(error) or "execution/height differs" in str(error):raise
            stop.wait(.02)
        raise RuntimeError("original submitted hash unresolved at bounded inclusion cutoff; no replay")
    def live_proof(self,row,tx,path,case,notify,stop):
        notify(dict(kind="normal_stage",stage="proof_queue"))
        lane=None
        while not stop.is_set():
            try:lane=self.queue.get(timeout=.02);break
            except __import__('queue').Empty:pass
        lab.require(lane is not None,"live proof lane not supplied before cutoff")
        try:
            lab.require(not lane["retired"],"normal original live lane retired")
            lane["sequence"]+=1;seq=lane["sequence"];prefix="load-%05d"%row["index"]
            notify(dict(kind="normal_stage",stage="live_publish"))
            self.call(prefix+"-live-publish",["live-materials","request","--synthetic","--policy",str(lane["policy"]),"--policy-sha256",lane["pin"],"--sequence",str(seq),"--transaction",str(path),"--transaction-sha256",normal.comet_hash(tx["abciHash"]),"--native-wire-hash",normal.comet_hash(tx["nativeHash"])])
            output=lane["policy"].parent/("operation-%06d"%seq);until=time.monotonic()+self.c.proof_timeout
            notify(dict(kind="normal_stage",stage="live_capture"))
            while not (output/"result.json").exists() and not stop.is_set() and time.monotonic()<until:
                lab.require(not (output/"failure.json").exists(),"normal live proof operation is UNKNOWN")
                stop.wait(.02)
            lab.require((output/"result.json").exists(),"normal original live proof result not supplied before bounded cutoff")
            notify(dict(kind="normal_stage",stage="live_read"))
            result=self.call(prefix+"-live-result",["live-materials","result","--synthetic","--policy",str(lane["policy"]),"--policy-sha256",lane["pin"],"--sequence",str(seq)])
            lab.require(result["version"]=="YNX-PQ-LAB-LIVE-MATERIALS-RESULT/v1" and result["outcome"]=="verified_transaction_data" and result["policySHA256"]==lane["pin"] and int(result["sequence"])==seq and result["owningNodeIndex"]==lane["node"] and result["sourceKind"]=="original-node-owning-stores" and result["syntheticOnly"] is True and result["sourceReadOnly"] is True and result["authorityGranted"] is False and result["fourNodeAgreementClaim"] is False,"normal original live result scope differs")
            lab.require(normal.comet_hash(result["transactionHash"])==normal.comet_hash(tx["abciHash"]) and normal.comet_hash(result["nativeWireHash"])==normal.comet_hash(tx["nativeHash"]),"normal live proof original dual identity differs")
            for key in ("materials","proof","checkpoint"):normal.public_file(output,result[key])
            context=result["verified"];directory=output/"verifier"
            request=normal.public_file(directory,context["request"]);trust=normal.public_file(directory,context["context"])
            lab.require(context["verifierArguments"]==["--trust-context",str(trust),"--trust-context-sha256",context["context"]["sha256"]],"normal original independent verifier invocation differs")
            notify(dict(kind="normal_stage",stage="verifier"))
            proc=self.w.launch(prefix+"-normal-verifier",[str(self.c.bins/"ynx-consensus-proof-verify"),*context["verifierArguments"]],stdin_path=request,thread_safe=True)
            try:self.w.wait(proc)
            finally:
                if proc.poll() is not None:self.w.retire_log(proc)
            verified=json.loads((self.w.work/"public"/(prefix+"-normal-verifier.log")).read_bytes());normal.require_verified(verified,tx)
            return result,verified
        except BaseException:
            lane["retired"]=True;raise
        finally:
            if not lane["retired"]:self.queue.put(lane)
    def perform(self,row,account,notify,stop):
        case=self.w.work/"public/load-operations"/("%05d"%row["index"]);case.mkdir(mode=0o700)
        directory=os.open(case.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
        lab.write_new(case/"operation-intent.json",dict(logicalId=row["id"],operationId=row["operationId"],ownerIndex=account["ownerIndex"],nonce=str(row["nonce"]),mode=self.c.mode,kind="normal independent single transfer",sourceGrant=False))
        started=time.monotonic_ns();tx,path,raw,request=self.original(row,account,case,notify,stop)
        notify(dict(kind="signed",hash=normal.comet_hash(tx["abciHash"]),nativeHash=normal.comet_hash(tx["nativeHash"])))
        self.broadcast_and_include(row,tx,raw,case,notify,stop)
        proof,verified=self.live_proof(row,tx,path,case,notify,stop)
        confirmed=None
        if self.c.mode=="online":
            notify(dict(kind="normal_stage",stage="confirm"))
            confirmed=self.sessions[account["ownerIndex"]].exchange(normal.sender_command_data("confirm",request,materials=proof["materials"]["path"],materials_sha=proof["materials"]["sha256"],proof=proof["proof"]["path"]),case/"original-confirm-reply.json",stop)
            lab.require(confirmed["code"]=="PROOF_CONFIRMED_DATA","normal original pending operation not confirmed")
            normal.require_verified(dict(code="VERIFIED_TRANSACTION_DATA",result=confirmed["result"]["result"]),tx)
        notify(dict(kind="normal_stage",stage="receipt"))
        final=dict(id=row["id"],operationId=row["operationId"],mode=self.c.mode,transaction=tx,normalLiveResult=proof,normalVerifier=verified,normalConfirm=confirmed,parentPipelineNs=time.monotonic_ns()-started,physicalCommitMeasured=False,sourceGrant=False)
        lab.write_new(case/"qualified-receipt.json",final)
        notify(dict(kind="qualified",hash=normal.comet_hash(tx["abciHash"]),nativeHash=normal.comet_hash(tx["nativeHash"]),normalVerifierCode=verified["code"],executionSuccessful=verified["result"]["executionSuccessful"],executionCode=verified["result"]["executionCode"],transactionType=verified["result"]["transactionType"],members=int(tx["members"]),nativeGrant=verified["result"]["nativeGrant"],normalConfirmCode=None if confirmed is None else confirmed["code"],proofReference=str((case/"qualified-receipt.json").relative_to(self.w.work/"public"))))
    def stop(self):
        self.stop_event.set();self.w.stopping=True
        with self.w.lock:children=list(self.w.children)
        for child in children:
            if child["name"].startswith("load-") and child["process"].poll() is None:
                try:os.killpg(child["process"].pid,signal.SIGTERM)
                except ProcessLookupError:pass
        # Terminate before closing buffered stdin so a stalled child cannot
        # hold a writer/close lock past the bounded cleanup boundary.
        for session in self.sessions.values():
            if session.proc.stdin is not None and not session.proc.stdin.closed:
                try:session.proc.stdin.close()
                except (OSError,ValueError):pass


def validate_options(args):
    lab.require(args.mode in ("online","pre-signed") and args.rate in (100,500,1000) and 1<=args.accounts<=996 and 1<=args.per_account<=1024 and 1<=args.seconds<=60 and 1<=args.tail_seconds<=120 and 1<=args.proof_timeout<=120,"bounded explicit original load configuration required")
    demand=args.rate*args.seconds
    lab.require(demand<=10000 and args.accounts*args.per_account>=demand,"complete original account capacity must cover fixed demand")
    lab.require((args.accounts+4)*args.per_account<=(10000 if args.mode=="online" else 1024),"current normal original corpus aggregate capacity exceeded")
    return demand


def validate_escalation(args):
    if args.rate==100:return
    lab.require(args.prior_result and args.prior_result_sha256,"higher load requires the actual preceding level's pinned original result")
    path=Path(args.prior_result);lab.require(path.resolve()==path and lab.guard.digest(path)==args.prior_result_sha256,"preceding exact result pin differs")
    prior=json.loads(path.read_bytes());r=prior["loadResult"];n=r["configuredDemand"]
    lab.require(prior["source"]["commit"]==args.commit and prior["mode"]==args.mode and prior["cleanupComplete"] is True and prior["firstCause"] is None and r["firstCause"] is None and prior["normalLiveCalleeUsed"] is True,"matching actual original preceding run required")
    lab.require(r["requestedOfferedTPS"]==(100 if args.rate==500 else 500) and r["windowCompleted"] is True and r["notReleased"]==0 and r["releasedWithinWindow"]==n and r["notSubmitted"]==0 and r["lateSubmitted"]==0 and r["notQualified"]==0 and r["sourceAcceptanceOrInclusionWithinWindow"]*1000>=n*999 and r["backlogGrowing"] is False,"preceding level did not deliver full independent demand/final data without growing backlog")
    q=r["submitToQualifiedReceiptObserved"]
    lab.require(q["censored"]==0 and q["p95Ms"]<=2000 and q["p99Ms"]<=5000,"preceding observed qualified receipt latency target not achieved")


def run(args):
    demand=validate_options(args);source=Path(args.source);identity=lab.check_source(source,args.commit)
    lab.git(source,"merge-base","--is-ancestor",normal.HELPER_COMMIT,args.commit)
    if args.wire_observation:lab.git(source,"merge-base","--is-ancestor",normal.WIRE_OBSERVER_COMMIT,args.commit)
    lab.require(b"live-materials" in __import__('subprocess').check_output(["git","-C",str(source),"show",args.commit+":cmd/ynx-consensus-pq-lab/main.go"]),"matching original CORE continuous materials callee NOT_SUPPLIED")
    if not args.execute:return dict(status="prepared-only",source=identity,mode=args.mode,requestedOfferedTPS=args.rate,configuredDemand=demand,accountCount=args.accounts,actualLoadExecuted=False,fullFinalityCallee="original CORE live-materials policy/startup and original signer/verifier/confirm required")
    validate_escalation(args)
    lab.require(sys.platform=="linux" and os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted","original isolated hosted Linux job required")
    parent=Path(os.environ["RUNNER_TEMP"]).resolve(strict=True);rows,_=lab.guard.proc_inventory();lab.admit(lab.guard.memory_available(),shutil.disk_usage(parent).free,lab.heavy_processes(rows));lab.ports_available()
    lab.require(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"original Linux subreaper required")
    work=Path(tempfile.mkdtemp(prefix="pq-independent-load-",dir=parent));work.chmod(0o700);(work/".private").mkdir(mode=0o700);(work/"public").mkdir(mode=0o700);(work/"public/load-operations").mkdir(mode=0o700)
    roots=[]
    for root in (source,Path(__file__).resolve().parents[2]):
        if any(existing==root or existing in root.parents for existing in roots):continue
        roots=[existing for existing in roots if root not in existing.parents];roots.append(root)
    w=lab.Window(source,work,additional_storage=tuple(roots));stop=threading.Event();backend=monitor=journal=ceremony=None
    result=dict(schema="YNX-PQ-INDEPENDENT-NORMAL-RUN/v1",source=identity,caps=lab.CAPS,storageRoots=[str(p) for p in w.storage_roots],mode=args.mode,requestedOfferedTPS=args.rate,configuredDemand=demand,firstCause=None,loadExecuted=False,normalLiveCalleeUsed=False,stableFinalTPS="UNMEASURED",P95FinalConfirmation="UNMEASURED",actualHopBytesPerTx="UNMEASURED",firstSaturatedChainStage="UNMEASURED",sameHost=True,physicalFaultDomains=1,signerTransport="original per-account persistent stdin/stdout; explicit process count; initialization has no separate ready acknowledgment and may remain in signing time")
    lab.write_new(work/"public/requested-load.json",dict(source=identity,mode=args.mode,rate=args.rate,seconds=args.seconds,tailSeconds=args.tail_seconds,accounts=args.accounts,perAccountCapacity=args.per_account,configuredDemand=demand,sourceGrant=False))
    try:
        bins=work/".private/bin"
        for name in ("ynx-consensus-pq-lab","ynx-comet","ynx-consensus-proof-verify"):w.wait(w.launch("build-"+name,["go","build","-mod=readonly","-p","1","-o",str(bins/name),"./cmd/"+name]))
        result["binaries"]={n:lab.guard.digest(bins/n) for n in ("ynx-consensus-pq-lab","ynx-comet","ynx-consensus-proof-verify")}
        root=work/".private/network";p=w.launch("create-original",[str(bins/"ynx-consensus-pq-lab"),"create","--synthetic","--root",str(root),"--transactions",str(args.per_account),"--batch-size","1","--owners",str(args.accounts+4),*(["--online"] if args.mode=="online" else []),"--base-p2p-port","31656","--base-rpc-port","31757"]);w.wait(p)
        created=json.loads((work/"public/create-original.log").read_bytes())
        ceremony=LoadCeremony(w,root,created,bins,args.wire_observation,expected_owners=args.accounts+4,operations=demand,proof_timeout=args.proof_timeout)
        owners=[dict(ownerIndex=o["index"],address=o["owner"],nextNonce=int(o["initialNonce"])+1,capacity=int(o["memberCapacity"])) for o in ceremony.workload["owners"][4:]]
        lab.require(ceremony.workload["batchSize"]=="1" and ceremony.workload["outstandingPerOwner"]=="1" and ceremony.workload["batchWaitNanoseconds"]=="0","original independent single transfers and one pending required")
        plan=scheduler.make_plan(ceremony.pin,ceremony.workload_pin,args.mode,owners,args.rate,args.seconds*1_000_000_000,args.tail_seconds*1_000_000_000)
        lab.write_new(work/"public/load-plan.json",plan);result["planSHA256"]=lab.guard.digest(work/"public/load-plan.json")
        result["activation"]=ceremony.prepare_network();result["preparationUnconfirmedOwners"]=sorted(ceremony.pending_owners);result["livePolicies"]=[dict(node=l["node"],policy=str(l["policy"]),sha256=l["pin"]) for l in ceremony.live]
        result["normalLiveCalleeUsed"]=True
        backend=NormalBackend(ceremony,owners,stop);journal=Journal(work/"public/load-events.jsonl")
        monitor=Monitor(w,stop);monitor.thread.start()
        result["loadExecuted"]=True
        result["loadResult"]=scheduler.run(plan,backend,journal.emit,monitor.check,stop)
        monitor.check();lab.check_source(source,args.commit)
        result["firstCause"]=result["loadResult"]["firstCause"]
    except BaseException as error:result["firstCause"]=str(error)
    finally:
        stop.set()
        if backend is not None:backend.stop()
        if monitor is not None:
            monitor.close()
            result["resourceObserverRetired"]=not monitor.thread.is_alive()
            if monitor.thread.is_alive():result["firstCause"]=result["firstCause"] or "original resource observer did not retire within bounded cleanup"
        if journal is not None:
            journal.close();result["journalSegments"]=[dict(path=str(p.relative_to(work/"public")),bytes=p.stat().st_size,sha256=lab.guard.digest(p)) for p in journal.paths]
        try:result["cleanupComplete"]=w.stop()
        except BaseException as error:result["cleanupComplete"]=False;result["cleanupError"]=str(error)
        result.update(elapsedSeconds=time.monotonic()-w.started,peakRSSBytes=w.peak_rss,peakNewBytes=w.peak_bytes,resourceSamples=w.samples,processes=w.process_receipt(),retiredSamplingEvidence=w.retired_samples)
        if ceremony is not None:result["wireObservation"]=ceremony.wire_readback()
        if "loadResult" not in result:
            result["preparationOnlyDemandAccounting"]=dict(configuredDemand=demand,notReleased=demand,notSubmitted=demand,notQualified=demand,meaning="normal preparation never opened the requested load window; no achieved offered rate or business TPS")
        lab.write_new(work/"public/receipt.json",result);print(json.dumps(dict(publicArtifacts=str(work/"public"),firstCause=result["firstCause"],loadExecuted=result["loadExecuted"])))
    return result


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--source",required=True);p.add_argument("--commit",required=True);p.add_argument("--mode",choices=("online","pre-signed"),required=True)
    p.add_argument("--rate",type=int,choices=(100,500,1000),default=100);p.add_argument("--seconds",type=int,required=True);p.add_argument("--tail-seconds",type=int,default=30);p.add_argument("--accounts",type=int,required=True);p.add_argument("--per-account",type=int,required=True);p.add_argument("--proof-timeout",type=int,default=30);p.add_argument("--wire-observation",action="store_true");p.add_argument("--prior-result");p.add_argument("--prior-result-sha256");p.add_argument("--execute",action="store_true")
    def interrupted(signum,frame):raise RuntimeError("normal independent load received signal "+str(signum))
    signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGTERM,interrupted)
    args=p.parse_args();result=run(args);print(json.dumps(result))
    if args.execute:lab.require(result["firstCause"] is None and result["cleanupComplete"] and result.get("loadResult",{}).get("windowCompleted") is True and result["loadResult"]["notQualified"]==0,"original finite load incomplete or unresolved; retain full demand and originals, do not escalate")
