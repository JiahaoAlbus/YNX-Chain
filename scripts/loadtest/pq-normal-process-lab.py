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


def callee_snapshot(value):
    lab.require(type(value) is dict and value.get("version")=="YNX-PQ-LAB-CALLEE-ELAPSED/v1" and value.get("clock")=="monotonic_elapsed_wall_ns" and value.get("intervalsOverlap") is True,"exact original callee elapsed schema required")
    stages=value.get("stages")
    lab.require(type(stages) is dict and len(stages)<=128,"bounded original callee stages required")
    for name,stage in stages.items():
        lab.require(type(name) is str and 0<len(name)<=128 and type(stage) is dict and type(stage.get("calls")) is int and 0<stage["calls"]<1<<64 and type(stage.get("elapsedNs")) is int and 0<=stage["elapsedNs"]<1<<63,"invalid original callee stage timing")
    return value



def comet_hash(value):
    lab.require(isinstance(value,str) and re.fullmatch(r"(?:0x)?[0-9a-fA-F]{64}",value),"exact original hash representation required")
    return value.removeprefix("0x").lower()


def public_file(directory,reference):
    path=directory/reference["path"]
    lab.require(path.resolve()==path and directory in path.parents and path.is_file(),"original public path escaped")
    lab.require(lab.guard.digest(path)==reference["sha256"],"original public file pin differs")
    return path


PREPARED_OWNER_SOURCE = '0b515124bda8ff7efaf3ec03456d69dee2c6ad18'

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


def network_baseline_result(network,accounting,reader,public):
    """Qualify the explicit wire/TCP profile separately from business proofs."""
    expected={n["name"]:n for n in network.binding["nodes"]}
    wire_errors=[];retention_errors=[]
    for side in ("start","end"):
        checkpoint=getattr(network,side,None) or {}
        rows=checkpoint.get("nodes",[])
        if len(rows)!=4 or {r.get("name") for r in rows}!=set(expected):
            wire_errors.append(side+":four_original_live_nodes_missing")
        for row in rows:
            if row.get("liveStatus")!="OBSERVED" or row.get("live") is None:
                wire_errors.append(side+":"+str(row.get("name"))+":"+str(row.get("liveReason")))
    rows=accounting.get("nodes",[])
    if len(rows)!=4 or {r.get("name") for r in rows}!=set(expected):
        wire_errors.append("four_original_wire_deltas_missing")
    for row in rows:
        window=row.get("liveWindow",{})
        if row.get("logical",{}).get("status")!="OBSERVED" or window.get("clock")!="CLOCK_MONOTONIC" or any(
            window.get("wireStatus",{}).get(side,{}).get("complete") is not True for side in ("start","end")):
            wire_errors.append(str(row.get("name"))+":wire_or_lifetime_delta_unknown")
    records=reader.evidence
    identities={(r.get("node"),r.get("phase")) for r in records}
    if len(records)!=8 or identities!={(name,phase) for name in expected for phase in ("before","after")}:
        retention_errors.append("eight_original_read_records_missing_or_duplicated")
    if set(reader.slots)!=set(expected) or any(slot["next"]!=2 or slot["retired"] or not slot["observed"] for slot in reader.slots.values()):
        retention_errors.append("original_two_slot_sessions_not_closed")
    for row in records:
        node=expected.get(row.get("node"),{})
        if row.get("status")!="OBSERVED" or row.get("pid")!=node.get("pid") or row.get("startTicks")!=node.get("startTicks"):
            retention_errors.append(str(row.get("node"))+":original_read_unknown_or_identity_changed")
        originals=row.get("originalFiles",[]);phase=row.get("phase");name=row.get("node")
        paths={"network-live-originals/"+str(name)+"-"+str(phase)+"-"+slot for slot in
               ("producer.json",str(phase)+".request",str(phase)+".raw.json",str(phase)+".result.json")}
        if len(originals)!=4 or {f.get("path") for f in originals}!=paths:
            retention_errors.append(str(name)+":four_original_files_not_retained")
        for ref in originals:
            try:public_file(public,ref)
            except (OSError,ValueError,KeyError,RuntimeError) as error:
                retention_errors.append(str(name)+":retained_original_file_invalid:"+type(error).__name__)
    tcp=accounting.get("tcp",{})
    tcp_observed=tcp.get("status")=="OBSERVED_ENDPOINT_DELTA" and tcp.get("complete") is True
    wire=dict(status="UNKNOWN" if wire_errors else "OBSERVED",reasons=wire_errors)
    retained=dict(status="UNKNOWN" if retention_errors else "OBSERVED",reasons=retention_errors,expectedReads=8,actualReads=len(records))
    return dict(status="OBSERVED" if not wire_errors and not retention_errors and tcp_observed else "UNKNOWN",
                wire=wire,originalReadClosure=retained,tcp=dict(status=tcp.get("status","UNKNOWN"),complete=tcp.get("complete",False),firstCause=tcp.get("firstCause"),reasons=tcp.get("reasons",[])),
                tcpCoverage="matched endpoint sockets only; incomplete total traffic and physical coverage remain unmeasured",
                losslessRequired=False,protoRequired=False,physicalBytesMeasured=False,qualifiedCount=None)


def observe_parent_sampling(window):
    """Time the original guard without changing its checks or return/exception."""
    import threading
    lock=threading.Lock();original=window.sample
    totals=dict(calls=0,failedCalls=0,timedCalls=0,clockErrors=0,totalNs=0,minNs=None,maxNs=None)
    def tick():
        try:return time.monotonic_ns()
        except Exception:return None
    def sample():
        begin=tick();failed=False
        try:return original()
        except BaseException:
            failed=True;raise
        finally:
            end=tick()
            with lock:
                totals["calls"]+=1;totals["failedCalls"]+=int(failed)
                if begin is None or end is None or end<begin:totals["clockErrors"]+=1
                else:
                    elapsed=end-begin;totals["timedCalls"]+=1;totals["totalNs"]+=elapsed
                    totals["minNs"]=elapsed if totals["minNs"] is None else min(totals["minNs"],elapsed)
                    totals["maxNs"]=elapsed if totals["maxNs"] is None else max(totals["maxNs"],elapsed)
    window.sample=sample
    def report():
        with lock:
            values=dict(totals)
            if not values["timedCalls"]:values["totalNs"]=None
        return dict(schema="YNX-PERF-ORIGINAL-PARENT-SAMPLER-ELAPSED/v1",
            status="NOT_OBSERVED" if not values["calls"] else "UNKNOWN" if values["clockErrors"] else "OBSERVED",
            clock="parent_monotonic_ns",**values,
            meaning="original sampled resource guard wall time, including lock wait; may overlap child work; not Go CPU or an amount to subtract from child elapsed; original exceptions unchanged")
    return report


def normal_node_clean_exit(processes):
    """Eight original node exits, independent of cleanup and proof success."""
    expected=[phase+"-node-"+str(i) for phase in ("bootstrap","pq") for i in range(4)]
    records=[];errors=[]
    for name in expected:
        matches=[row for row in processes if row.get("name")==name]
        if len(matches)!=1:
            errors.append(dict(name=name,reason="missing or duplicate original node receipt"));continue
        row=matches[0]
        records.append({key:row.get(key) for key in ("name","pid","startTicks","rawReturnCode","exitCode","signal","exited")})
        if not (row.get("exited") is True and type(row.get("rawReturnCode")) is int and row["rawReturnCode"]==0 and type(row.get("exitCode")) is int and row["exitCode"]==0 and row.get("signal") is None):
            errors.append(dict(name=name,reason="original normal node exit0 not observed; retain original return/signal and log"))
    return dict(schema="YNX-PERF-EIGHT-NORMAL-NODE-CLEAN-EXIT/v1",expectedNodes=8,observedNodes=len(records),
        allEightExitZero=len(records)==8 and not errors,operationalCleanExit=len(records)==8 and not errors,
        records=records,errors=errors,meaning="Original bootstrap4 and PQ4 process exits only; cleanup reaping, network observation and business verification remain separate; no forced-kill or exit1 success")


def apply_normal_clean_exit(result):
    result["normalNodeCleanExit"]=normal_node_clean_exit(result["processes"])
    if not result["normalNodeCleanExit"]["operationalCleanExit"]:
        result["firstCause"]=result.get("firstCause") or "original eight normal nodes did not all exit0; preserve raw logs and cleanup result"


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
    def __init__(self,window,root,created,bins,observe_wire=False,expected_owners=8):
        self.w,self.root,self.bins=window,root,bins
        self.plan=original_plan(created,root);self.pin=created["planSHA256"]
        self.workload=created["workload"];self.nodes=[];self.attempted=set();self.observations=[]
        self.next_workload=0;self.used_indices=set();self.transfers=[];self.pending_owners=set();self.activation_pin=""
        self.workload_pin=lab.guard.digest(root/"workload/PUBLIC-WORKLOAD.json")
        self.mode=self.workload["mode"]
        self.observe_wire=observe_wire;self.wire_outputs=[]
        lab.require(self.mode in ("online","pre-signed") and len(self.workload["owners"])==expected_owners,"exact original independent owner pool required")

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
            if getattr(self,"live_reader",None) is not None:
                validate=getattr(self.live_reader,'validate_original_startup_arguments',None)
                if validate is not None:validate(n['bootstrapArgs'] if activation is None else activation['nodes'][n['index']]['args'])
                observed+=self.live_reader.startup_arguments("bootstrap" if activation is None else "pq",n["index"])
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

    def readiness_process_observations(self):
        result=[]
        for node,proc in enumerate(getattr(self,'nodes',[])):
            value=dict(node=node,pid=proc.pid,scope='original registered Popen, before cleanup')
            try:
                with self.w.lock:
                    child=next(c for c in self.w.children if c['process'] is proc)
                    value.update(name=child['name'],startTicks=child.get('startTicks'),rawReturnCode=proc.poll())
            except BaseException as error:value['observationErrorType']=type(error).__name__
            result.append(value)
        return result

    def quiet(self,minimum=0,timeout=60):
        # The caller allocates a cold phase inside the unchanged global guard.
        # RPC startup, first observed height and stable disk/RPC readiness are
        # separate observations; none is authority or transaction finality.
        started=time.monotonic_ns();remaining=self.w.started+lab.CAPS['totalSeconds']-lab.CAPS['cleanupSeconds']-time.monotonic()
        allocated=max(0,min(timeout,remaining));until=time.monotonic()+allocated;last=None;stable=0;attempts=0;errors={};last_error=None;last_nodes=[];last_rpc_errors=[];last_rpc_metadata=[];first_rpc={};first_height={};first_common=None;confirmed=None;terminal_error=None;outcome='FAILED';totals=dict(snapshotReadNs=0,snapshotDecodeNs=0,rpcStatusNs=0,rpcABCIInfoNs=0)
        def timed(name,operation):
            begin=time.monotonic_ns()
            try:return operation()
            finally:totals[name]+=time.monotonic_ns()-begin
        try:
            while time.monotonic()<until:
                self.w.sample();attempts+=1;observed=[];answer=None;rpc={};rpc_errors=[]
                # Probe all four original endpoints, even while another node
                # still has no application snapshot. Never declare readiness
                # until every original disk/status/ABCI condition below passes.
                for node in self.plan['nodes']:
                    try:
                        status=timed('rpcStatusNs',lambda:self.w.rpc(node['rpcAddress'],'status'))
                        status_at=time.monotonic_ns()
                        info=timed('rpcABCIInfoNs',lambda:self.w.rpc(node['rpcAddress'],'abci_info'))['response']
                        info_at=time.monotonic_ns();height_observed=status['sync_info']['latest_block_height'];network_observed=status['node_info']['network'];int(height_observed);int(info['last_block_height']);info['last_block_app_hash']
                        rpc[node['index']]=(status,info)
                        first_rpc.setdefault(node['index'],dict(statusObservedMonotonicNs=status_at,abciInfoObservedMonotonicNs=info_at,height=height_observed,chainId=network_observed))
                        if int(height_observed)>=int(self.plan['initialHeight']):first_height.setdefault(node['index'],dict(observedMonotonicNs=status_at,height=height_observed))
                    except (OSError,ValueError,KeyError,RuntimeError) as error:
                        kind=type(error).__name__;errors[kind]=errors.get(kind,0)+1;rpc_errors.append(dict(node=node['index'],errorType=kind,reason=str(error)[:512]))
                last_rpc_errors=rpc_errors;last_rpc_metadata=[dict(node=index,chainId=pair[0]['node_info']['network'],height=pair[0]['sync_info']['latest_block_height'],abciHeight=pair[1]['last_block_height']) for index,pair in rpc.items()]
                try:
                    for node in self.plan['nodes']:
                        raw=timed('snapshotReadNs',lambda:lab.guard.bounded(Path(node['statePath']),128<<20))
                        state=timed('snapshotDecodeNs',lambda:json.loads(raw))
                        observed.append(dict(node=node['index'],height=state['height'],appHash=state['appHash'],initialized=state['initialized']));del raw,state
                    last_nodes=observed;heights={v['height'] for v in observed};hashes={v['appHash'] for v in observed}
                    lab.require(len(heights)==1 and len(hashes)==1 and next(iter(heights))>=minimum and all(v['initialized'] for v in observed),'four applications not at common initialized checkpoint')
                    lab.require(not rpc_errors and len(rpc)==4,'all four original RPC observations required: '+json.dumps(rpc_errors,separators=(',',':')))
                    height=next(iter(heights));app_hash=next(iter(hashes))
                    for node in self.plan['nodes']:
                        status,info=rpc[node['index']]
                        lab.require(status['node_info']['network']==self.plan['chainId'] and int(status['sync_info']['latest_block_height'])==height,'normal RPC height/chain differs')
                        lab.require(int(info['last_block_height'])==height and decoded_hash(info['last_block_app_hash'])==app_hash.lower(),'normal ABCI Info differs from actual disk checkpoint')
                    now=time.monotonic_ns()
                    if first_common is None:first_common=dict(observedMonotonicNs=now,height=height,appHash=app_hash)
                    current=(height,app_hash);stable=stable+1 if current==last else 1;last=current
                    if stable>=3:answer=dict(height=height,appHash=app_hash);confirmed=now
                except (OSError,ValueError,KeyError,RuntimeError) as error:
                    stable=0;kind=type(error).__name__;errors[kind]=errors.get(kind,0)+1;last_error=dict(errorType=kind,reason=str(error)[:512]);last_nodes=observed
                self.w.sample() # Critical resource/owner failure is never not-ready.
                if answer is not None:outcome='RETURNED';return answer
                time.sleep(.2)
            raise RuntimeError('four normal applications/RPCs did not reach a quiet common checkpoint; last observation='+json.dumps(last_error,separators=(',',':')))
        except BaseException as error:terminal_error=dict(errorType=type(error).__name__,reason=str(error)[:512]);raise
        finally:
            processes=self.readiness_process_observations()
            with self.w.lock:
                if not hasattr(self,'quiet_observations'):self.quiet_observations=[]
                self.quiet_calls=getattr(self,'quiet_calls',0)+1
                if len(self.quiet_observations)<128:self.quiet_observations.append(dict(index=self.quiet_calls-1,minimumHeight=minimum,requestedTimeoutSeconds=timeout,allocatedTimeoutSeconds=allocated,globalActiveLimitSeconds=lab.CAPS['totalSeconds']-lab.CAPS['cleanupSeconds'],startedMonotonicNs=started,returnedMonotonicNs=time.monotonic_ns(),attempts=attempts,outcome=outcome,stableObservations=stable,lastCheckpoint=None if last is None else dict(height=last[0],appHash=last[1]),firstSuccessfulRPCObservationByNode=first_rpc,firstInitialHeightOrLaterObservedByNode=first_height,firstCommonInitializedObservation=first_common,quietConfirmedMonotonicNs=confirmed,lastError=last_error,terminalError=terminal_error,errorCounts=errors,lastOriginalNodeMetadata=last_nodes,lastRPCErrors=last_rpc_errors,lastRPCMetadata=last_rpc_metadata,originalProcessObservations=processes,spansNs=totals,intervalsAreParentElapsed=True,authorityGranted=False))

    def readiness_report(self):
        with self.w.lock:return dict(schema='YNX-PERF-ORIGINAL-READINESS-OBSERVATIONS/v1',calls=getattr(self,'quiet_calls',0),retained=len(getattr(self,'quiet_observations',[])),omitted=max(0,getattr(self,'quiet_calls',0)-len(getattr(self,'quiet_observations',[]))),recordLimit=128,records=__import__('copy').deepcopy(getattr(self,'quiet_observations',[])),meaning='Original disk/RPC readiness only. RPC/height timestamps are first observations, not exact service/commit times; original node logs retain those. Full original JSON decoded, only checkpoint metadata retained. Parent spans include failures/transport; never Go CPU or business finality.')

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
        metric=None
        if "--timings" in getattr(self,"preparation_sender_arguments",()):
            records=getattr(self,"original_sender_timer_records",None)
            if records is None:self.original_sender_timer_records=[];records=self.original_sender_timer_records
            lab.require(len(records)<64,"bounded original sender timing records exhausted before dispatch")
            metric=dict(name=name,owner=owner,operation=command["operation"],status="RETURN_NOT_OBSERVED",calleeElapsedNs=None)
            records.append(metric)
        path=self.w.work/".private"/(name+"-command.jsonl")
        lab.write_new(path,command)
        credential=self.root/"workload/private-senders/recovery.raw"
        fd=os.open(credential,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        try:
            info=os.fstat(fd);lab.require(stat.S_ISREG(info.st_mode) and info.st_size==32 and info.st_mode&0o077==0 and info.st_nlink==1,"original private sender credential required")
            args=[str(self.bins/"ynx-consensus-pq-lab"),"sender","--synthetic","--root",str(self.root),"--plan-sha256",self.pin,"--activation-sha256",self.activation_pin,"--workload-sha256",self.workload_pin,"--owner",str(owner),*getattr(self,"preparation_sender_arguments",()),"--credential-fd","3"]
            proc=self.w.launch(name,fd3_command(args,fd),pass_fds=(fd,),stdin_path=path);self.w.wait(proc)
        finally:os.close(fd)
        log=self.w.work/"public"/(name+".log")
        if metric is not None:
            metric.update(status="RETURN_RECEIVED_TIMING_UNQUALIFIED_NO_RETRY",originalLogSHA256=lab.guard.digest(log))
        reply=json.loads(log.read_bytes())
        if metric is not None:
            stages=callee_snapshot(reply.get("timings"));startup=callee_snapshot(reply.get("startupTimings"))
            elapsed,cold=reply.get("calleeElapsedNs"),reply.get("startupElapsedNs")
            lab.require(type(elapsed) is int and 0<=elapsed<1<<63 and type(cold) is int and 0<=cold<1<<63,"original sender cold/callee timing missing")
            metric.update(status="OBSERVED",calleeElapsedNs=elapsed,startupElapsedNs=cold,timings=stages,startupTimings=startup,
                intervalsOverlap=True,startupEchoNotAddedToCallee=True)
        return reply

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

    def activation_startup(self,activation):
        return activation

    def prepare_network(self):
        self.start();self.quiet(int(self.plan["initialHeight"]),timeout=getattr(self,"initial_quiet_timeout",60))
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
        self.start(self.activation_startup(activation));checkpoint=self.quiet(target,timeout=getattr(self,"activation_quiet_timeout",60))
        while checkpoint["height"]<int(activation["activationHeight"]):
            lab.require(self.next_workload<4,"bounded original activation traffic exceeded reserved owners")
            self.traffic("activation-traffic-%d"%self.next_workload,self.next_workload);checkpoint=self.quiet()
        return activation

    def begin_network_baseline(self):
        profile=getattr(self,"network_profile",None)
        if profile is None:return None
        spec=importlib.util.spec_from_file_location("normal_functional_network",Path(__file__).with_name("pq-network-window.py"))
        hook=importlib.util.module_from_spec(spec);spec.loader.exec_module(hook)
        network=hook.NetworkWindow(self,lab,profile["source"],profile["tools"],self.workload_pin,4,live_reader=self.live_reader)
        network.capture("start")
        return network

    def execute(self):
        activation=self.prepare_network()
        network=self.begin_network_baseline()
        planned=[dict(id=digest((self.pin+":functional:"+str(i)).encode()),owner=i,status="not-submitted") for i in range(4,8)]
        lab.write_new(self.w.work/"public/functional-cohort-plan.json",dict(schema="YNX-PQ-FOUR-PROCESS-FUNCTIONAL-PLAN/v1",planSHA256=self.pin,mode=self.mode,requests=planned,fixedWindowConfigured=False))
        functional=[]
        for request in planned:
            functional.append(self.traffic("functional-owner-%d"%request["owner"],request["owner"]))
        if network is not None:
            # Actual hot functional traffic plus drain only; never cold-first-packet.
            accounting=network.finish(None)
            self.network_baseline=network_baseline_result(network,accounting,self.live_reader,self.w.work/"public")
        node_pids=[p.pid for p in self.nodes]
        self.w.stopping=True
        for proc in self.nodes:proc.send_signal(signal.SIGTERM)
        for proc in self.nodes:self.w.wait(proc,allow_failure=True)
        for child in self.w.children:
            if child["process"] in self.nodes:child["persistent"]=False
        full_hashes=[lab.guard.digest(Path(n["statePath"])) for n in self.plan["nodes"]]
        lab.require(len(set(full_hashes))==1,"four stopped full committed states differ; no fields projected away")
        trace=None
        if getattr(self,'stopped_trace_export',None) is not None:trace=self.stopped_trace_export()
        proofs=[]
        for row in functional:proofs.append(self.verify_stopped(row))
        baseline=getattr(self,"network_baseline",None)
        return dict(phaseComplete=network is None or baseline["status"]=="OBSERVED",functionalPhaseComplete=True,networkBaseline=baseline,
                    **({'completeFinalizeTrace':trace} if trace is not None else {}),
                    activation=activation,signingMode=self.mode,functionalCohort=proofs,
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
    live_requested=getattr(args,"live_network_baseline",False)
    live_module=None
    if live_requested:
        spec=importlib.util.spec_from_file_location("normal_private_live_reader",Path(__file__).with_name("pq-normal-live-reader.py"))
        live_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(live_module)
        live_module.qualify(identity)  # Before any build, key creation or node startup.
        lab.require(args.mode=="online","normal live baseline requires original online finite functional fixture")
    callee_timings=getattr(args,"callee_timings",False)
    lab.require(not callee_timings or (live_requested and args.mode=="online"),"original sender timing requires exact qualified normal online live profile")
    observe_wire=getattr(args,"wire_observation",False) or live_requested
    if observe_wire:lab.git(source,"merge-base","--is-ancestor",WIRE_OBSERVER_COMMIT,args.commit)
    if not args.execute:return dict(status="prepared-only",source=identity,helper=HELPER_COMMIT,mode=args.mode,scope="four normal process functional cohort and original stopped proof; sustained window withheld")
    lab.require(sys.platform=="linux" and os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted","dedicated hosted Linux job required")
    parent=Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    # Public admission DATA is retained even if the original guard refuses.
    # Only empty owned directories exist here; no Window, key or node yet.
    work=Path(tempfile.mkdtemp(prefix="pq-normal-process-",dir=parent));work.chmod(0o700)
    (work/".private").mkdir(mode=0o700);(work/"public").mkdir(mode=0o700)
    rows,_=lab.guard.proc_inventory()
    fresh=dict(observedMonotonicNs=time.monotonic_ns(),availableMemoryBytes=lab.guard.memory_available(),
        freeDiskBytes=shutil.disk_usage(parent).free,conflictingHeavyProcesses=lab.heavy_processes(rows),
        caps=dict(lab.CAPS),ownedPIDLimit=lab.guard.CAPS["ownedProcesses"],scope="before original Window/key/node creation")
    lab.write_new(work/"public/fresh-resource-admission.json",fresh)
    lab.admit(fresh["availableMemoryBytes"],fresh["freeDiskBytes"],fresh["conflictingHeavyProcesses"]);lab.ports_available()
    lab.require(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"Linux subreaper required")
    w=lab.Window(source,work,additional_storage=(source,));result=dict(schema="YNX-PQ-NORMAL-PROCESS-CEREMONY/v1",source=identity,caps=lab.CAPS,storageRoots=[str(p) for p in w.storage_roots],signingMode=args.mode,firstCause=None,phaseComplete=False,functionalPhaseComplete=False,sameHost=True,physicalFaultDomains=1,configuredFunctionalDenominator=4,stableFinalTPS="UNMEASURED",P95FinalConfirmation="UNMEASURED",actualHopBytesPerTx="UNMEASURED",firstSaturatedChainStage="UNMEASURED")
    sampling_report=observe_parent_sampling(w)
    result["freshResourceAdmission"]=fresh
    result["originalSenderTimingsRequested"]=callee_timings
    ceremony=None
    try:
        bins=work/".private/bin"
        if live_requested:
            composed=work/".private/live-matching-source"
            proc=w.launch("prepare-normal-live-source",[sys.executable,"-I",str(Path(__file__).with_name("pq-normal-live-reader.py")),
                "--prepare-source",str(source),"--destination",str(composed)],thread_safe=True)
            w.wait(proc)
            composition=json.loads((work/"public/prepare-normal-live-source.log").read_bytes())
            lab.require(composition["source"]==identity and composition["buildSource"]==str(composed/"source") and
                        composition["originalSourceUnchanged"] is True,"original matching source composition differs")
            selection=composition["originalCoreSelection"]
            raw_selection=lab.guard.bounded(Path(selection["receiptPath"]),64<<10)
            lab.require(digest(raw_selection)==selection["receiptSHA256"] and len(raw_selection)==selection["receiptBytes"],"original source-selection receipt pin differs")
            with (work/"public/normal-live-source-selection.json").open("xb") as out:out.write(raw_selection)
            result["normalLiveBuildSource"]=composition
            # Only build cwd changes. Source identity and postcheck stay original.
            w.source=composed/"source"
        for name in ("ynx-consensus-pq-lab","ynx-comet","ynx-consensus-proof-verify"):
            w.wait(w.launch("build-"+name,["go","build","-mod=readonly","-p","1",*(["-trimpath","-buildvcs=false"] if live_requested else []),*(["-tags",live_module.BUILD_TAG] if live_requested and name=="ynx-comet" else []),"-o",str(bins/name),"./cmd/"+name]))
        result["binaries"]={name:lab.guard.digest(bins/name) for name in ("ynx-consensus-pq-lab","ynx-comet","ynx-consensus-proof-verify")}
        if live_requested:
            result["normalLiveBuildProvenance"]={}
            for name,pin in result["binaries"].items():
                w.wait(w.launch("buildinfo-"+name,["go","version","-m",str(bins/name)]))
                info=work/"public"/("buildinfo-"+name+".log")
                build=next(child for child in w.children if child["name"]=="build-"+name)
                result["normalLiveBuildProvenance"][name]=dict(binarySHA256=pin,buildArgv=build["command"],buildCwd=str(w.source),
                    sourceSelectionSHA256=selection["receiptSHA256"],buildInfoFile=info.name,buildInfoSHA256=lab.guard.digest(info),
                    originalSource=identity,selectedOptionalForkTree=composition["optionalForkTree"])

        root=work/".private/network"
        proc=w.launch("create-original",[str(bins/"ynx-consensus-pq-lab"),"create","--synthetic","--root",str(root),"--transactions","32","--batch-size","1","--owners","8",*(["--online"] if args.mode=="online" else []),"--base-p2p-port","31656","--base-rpc-port","31757"]);w.wait(proc)
        created=json.loads((work/"public/create-original.log").read_bytes())
        result["originalPlanSHA256"]=created["planSHA256"]
        ceremony=Ceremony(w,root,created,bins,observe_wire)
        if callee_timings:ceremony.preparation_sender_arguments=("--timings",)
        if live_requested:
            ceremony.live_reader=live_module.NormalLiveReader(ceremony,lab)
            ceremony.network_profile=dict(source=args.commit,tools=lab.git(Path(__file__).resolve().parents[2],"rev-parse","HEAD"))
            result["networkBaseline"]=dict(status="UNKNOWN",reason="explicit live baseline not completed")
            result["networkBaselineScope"]="hot functional four-owner traffic plus drain; cold/legacy/failure and physical bytes unmeasured"
        result.update(ceremony.execute())
        if live_requested:
            lab.require(result["networkBaseline"]["status"]=="OBSERVED","explicit live baseline incomplete; functional proofs do not qualify missing network observations")
        lab.check_source(source,args.commit)
    except BaseException as error:result["firstCause"]=str(error)
    finally:
        try:result["cleanupComplete"]=w.stop()
        except BaseException as error:result["cleanupComplete"]=False;result["cleanupError"]=str(error);result["directOwnedCleanupAfterFailure"]=getattr(w,"direct_cleanup_after_failure",[])
        result["liveNetworkBaselineRequested"]=live_requested
        result["wireObservationRequested"]=observe_wire
        if ceremony is not None:
            result["wireObservation"]=ceremony.wire_readback()
            result["originalReadinessObservations"]=ceremony.readiness_report()
            result["originalSenderTimingReadback"]=getattr(ceremony,"original_sender_timer_records",[])
            if getattr(ceremony,"network_baseline",None) is not None:
                result["networkBaseline"]=ceremony.network_baseline
            if getattr(ceremony,"live_reader",None) is not None:
                result["liveNetworkReads"]=ceremony.live_reader.evidence
        result["parentResourceSamplingElapsed"]=sampling_report()
        result["resourceGuardStageElapsed"]=w.sample_stage_report()
        result.update(elapsedSeconds=time.monotonic()-w.started,peakRSSBytes=w.peak_rss,peakNewBytes=w.peak_bytes,resourceSamples=w.samples,
                      processes=w.process_receipt(),retiredSamplingEvidence=w.retired_samples,resourceObserverVersion=lab.RSS_OBSERVER_VERSION,processEvidenceVersion=lab.PROCESS_EVIDENCE_VERSION,rssSamplingFallbackEvidence=w.rss_fallback_samples,
                      completedFunctionalProofs=[p.name for p in (work/"public").glob("functional-owner-*-final-proof.json")])
        if live_requested:apply_normal_clean_exit(result)
        lab.write_new(work/"public/receipt.json",result);print(json.dumps(dict(publicArtifacts=str(work/"public"),firstCause=result["firstCause"],phaseComplete=result["phaseComplete"])))
    lab.require(result["firstCause"] is None and result["cleanupComplete"],"normal ceremony failed; original intent/state/UNKNOWN retained")
    return result


def paired_candidate_main(argv):
    """Read-only actual-originals candidate entry; never build/start/POST."""
    parser=argparse.ArgumentParser(description='Prepare normal OFF/ON candidate DATA without execution',allow_abbrev=False)
    for side in ('off','on'):
        for suffix in ('public','receipt-sha256','tools-commit'):parser.add_argument('--'+side+'-'+suffix)
    parser.add_argument('--replay-data');parser.add_argument('--replay-sha256');parser.add_argument('--output');parser.add_argument('--source-only-ci',action='store_true')
    for name in ('finalize-trace','trace-sha256','before-replay','before-replay-sha256','after-replay','after-replay-sha256','replay-execution','replay-execution-sha256'):parser.add_argument('--'+name)
    flags=[value for value in argv if value.startswith('--')]
    lab.require(len(flags)==len(set(flags)),'duplicate paired-candidate option')
    args=parser.parse_args(argv)
    for side in ('off','on'):
        values=[getattr(args,side+'_'+suffix) for suffix in ('public','receipt_sha256','tools_commit')]
        lab.require(not any(values) or all(values),'each original leg requires public directory, receipt SHA and tools commit together')
        if all(values):lab.require(re.fullmatch('[0-9a-f]{64}',values[1]) and re.fullmatch('[0-9a-f]{40}',values[2]),'exact original leg receipt/tool pins required')
    lab.require(bool(args.replay_data)==bool(args.replay_sha256),'original replay DATA requires an external SHA')
    spec=importlib.util.spec_from_file_location('original_normal_pair_candidate_reader',Path(__file__).with_name('pq-normal-live-reader.py'))
    reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
    legs={}
    for side in ('off','on'):
        path=getattr(args,side+'_public')
        legs[side]=None if path is None else reader.read_normal_business_leg(Path(path),getattr(args,side+'_receipt_sha256'),getattr(args,side+'_tools_commit'))
    replay=None
    if args.replay_data:
        proof_spec=importlib.util.spec_from_file_location('pair_original_replay_io',Path(__file__).with_name('pq-public-proof-readback.py'))
        proof=importlib.util.module_from_spec(proof_spec);proof_spec.loader.exec_module(proof)
        raw=proof.read_original(Path(args.replay_data),256<<10)
        lab.require(proof.sha(raw)==args.replay_sha256,'external original replay DATA SHA differs')
        replay=proof.strict(raw);lab.require(replay.get('schema')=='YNX-PQ-PER-HEIGHT-DIFFERENTIAL/v1','only original per-height differential DATA accepted; new full-trace format awaits owning Core callee')
    complete_trace=None
    trace_options=[args.finalize_trace,args.trace_sha256]
    lab.require(not any(trace_options) or all(trace_options),'original complete trace requires directory and result SHA')
    for side in ('before','after'):
        values=[getattr(args,side+'_replay'),getattr(args,side+'_replay_sha256')]
        lab.require(not any(values) or all(values),'original replay requires directory and result SHA')
        lab.require(not any(values) or args.finalize_trace,'original replay requires common complete trace')
    lab.require(not args.finalize_trace or replay is None,'legacy source fixture and complete original trace must remain separate candidate inputs')
    lab.require(bool(args.replay_execution)==bool(args.replay_execution_sha256),'original execution H and external pin required together')
    lab.require(not args.replay_execution or (args.finalize_trace and not args.before_replay and not args.after_replay),'verified execution requires common trace and owns its original replay paths')
    if args.finalize_trace:
        trace_spec=importlib.util.spec_from_file_location('pair_complete_finalize_reader',Path(__file__).with_name('pq-finalize-trace-readback.py'))
        trace_reader=importlib.util.module_from_spec(trace_spec);trace_spec.loader.exec_module(trace_reader)
        trace=trace_reader.read_bundle(Path(args.finalize_trace),args.trace_sha256,'trace');replays={}
        for side in ('before','after'):
            path=getattr(args,side+'_replay')
            replays[side]=None if path is None else trace_reader.read_bundle(Path(path),getattr(args,side+'_replay_sha256'),'replay')
        if args.replay_execution:
            execution=trace_reader.read_execution(Path(args.replay_execution),args.replay_execution_sha256,trace)
            complete_trace=trace_reader.compare(trace,execution.before,execution.after,execution=execution)
        else:complete_trace=trace_reader.compare(trace,replays['before'],replays['after'])
    result=reader.prepare_paired_candidate(legs['off'],legs['on'],replay,source_only_ci=args.source_only_ci,complete_trace_data=complete_trace)
    result['entryScope']='read-only existing PUBLIC originals and new candidate DATA; no execution option'
    if args.output:
        output=Path(args.output);lab.require(output.is_absolute() and output.parent.resolve(strict=True)==output.parent,'new canonical candidate output required')
        lab.write_new(output,result)
    return result


if __name__=="__main__":
    if sys.argv[1:2]==["--prepare-paired-candidate"]:
        print(json.dumps(paired_candidate_main(sys.argv[2:]),sort_keys=True));raise SystemExit(0)
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--source",required=True);parser.add_argument("--commit",required=True);parser.add_argument("--mode",choices=["pre-signed","online"],required=True);parser.add_argument("--wire-observation",action="store_true");parser.add_argument("--live-network-baseline",action="store_true");parser.add_argument("--callee-timings",action="store_true");parser.add_argument("--execute",action="store_true");args=parser.parse_args()
    def interrupted(signum,frame):raise RuntimeError("normal PQ lab received signal "+str(signum))
    signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGTERM,interrupted)
    print(json.dumps(run(args)))
