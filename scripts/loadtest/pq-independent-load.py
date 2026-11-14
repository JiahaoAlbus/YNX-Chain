#!/usr/bin/env python3
"""Bounded normal PQ single-transfer load. No experimental signer/verifier.

The normal CORE live-materials callee must exist in an exact clean source pin.
The default entry only prepares the configuration; hosted --execute is explicit.
"""
import argparse
import base64
import copy
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
import subprocess
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
proof_readback=module("original_public_proof_readback","pq-public-proof-readback.py")
commit_readback=module("original_normal_commit_readback","pq-commit-observation.py")
initialization=module("original_initialization_measurements","pq-initialization-measurements.py")
rpc_measurements=module('original_parent_rpc_measurements','pq-rpc-measurements.py')
preload_initialization=module('original_preload_initialization','pq-preload-initialization.py')
first_trial_source=module('original_first_trial_source','pq-first-trial-source.py')
first_trial_d24_source=module('original_first_trial_d24_source','pq-d24-source-readback.py')
first_trial_1695_source=module('original_first_trial_1695_source','pq-1695-source-qualification.py')
first_trial_7c25_source=module('original_first_trial_7c25_source','pq-7c25-source-qualification.py')
held_input_footprint=module('original_held_input_footprint','pq-held-input-footprint.py')
request_observation_readback=module('original_request_observation_readback','pq-live-request-observation-readback.py')
owner_failure_readback=module('original_owner_failure_readback','pq-public-owner-failure-readback.py')


def owner_failure_detail(reply, operation):
    try:
        diagnostic = owner_failure_readback.readback(reply, operation)['diagnostic']
    except RuntimeError:
        return ' (unqualified failure diagnostic)'
    if diagnostic is None:
        return ''
    return f" ({diagnostic['failurePhase']}/{diagnostic['errorClass']})"


CALLEE_SOURCE = "c06b4607247a1fdf7e485337ab03206984baa71c"
# Exact c06 normal CI + named-case supplement + 01a/c06 diagnostic N1
# functional DATA are consumed separately by the normal controller. They do
# not qualify an unrelated before/after performance source pair or a load run.
COMMIT_OBSERVATION_SOURCE = CALLEE_SOURCE
# A new large-owner normal callee/ABI must be explicitly qualified by CORE.
STAGED_CALLEE_SOURCE = initialization.LIVE_SOURCE
STAGED_CALLEE_TREE = initialization.LIVE_TREE
STAGED_SOURCE_QUALIFICATION = None # New normal CI and actual500 initialized-owner input still required.
STAGED_SENDER_ARGUMENTS = () # CORE normal cache-bound-only fallback needs no new flag.
# ABI support only. This is neither source qualification nor window permission.
STARTUP_TIMING_ABI_SOURCES = frozenset({'eff586d429a3c18d52b7e91ed2b58c809fa6f15c','1b0ea548aca6b5260a9824d0edd3012d52e53521',first_trial_d24_source.SOURCE,first_trial_1695_source.SOURCE})
HELD_TRIAL_PROFILE = 'held-first100'
HELD_TRIAL_SOURCE = 'a2c0ef48ec840730aabc59212c5ea891a37d45f2'
HELD_TRIAL_TREE = '677f5b52e7251184a8680579b6f43a8c9e8f85c0'
STARTUP_TIMING_ABI_SOURCES = STARTUP_TIMING_ABI_SOURCES | {first_trial_7c25_source.SOURCE, HELD_TRIAL_SOURCE}
PUBLIC_OWNER_ABI_SOURCE = '1695aafd351b3cac7860d3452c555a02498e8350' # ABI identity only; no source/semantic/window qualification.
PUBLIC_OWNER_ABI_SOURCES = frozenset((PUBLIC_OWNER_ABI_SOURCE,first_trial_7c25_source.SOURCE,HELD_TRIAL_SOURCE))


def callee_snapshot(value):
    return normal.callee_snapshot(value)

def original_failed_callee_timing(raw):
    # Original normal CLI failure telemetry is stderr text followed by one
    # closed JSON metric object. It is not a successful sender/material reply.
    marker=b'; elapsed='
    lab.require(type(raw) is bytes and len(raw)<=lab.CAPS['logBytes'] and marker in raw,'original failed-callee elapsed payload NOT_SUPPLIED')
    encoded=raw.rsplit(marker,1)[1].strip()
    def fields(items):
        result={}
        for key,value in items:
            lab.require(key not in result,'duplicate original failed-callee metric field');result[key]=value
        return result
    value=json.loads(encoded,object_pairs_hook=fields)
    lab.require(type(value) is dict and set(value)=={'Version','Outcome','CalleeElapsedNS','Timings'} and value['Version']=='YNX-PQ-LAB-CALLEE-FAILURE/v1' and value['Outcome']=='REFUSED_OR_UNKNOWN_NO_RETRY' and type(value['CalleeElapsedNS']) is int and value['CalleeElapsedNS']>=0,'original failure metric schema differs')
    callee_snapshot(value['Timings'])
    return dict(version=value['Version'],outcome=value['Outcome'],calleeElapsedNs=value['CalleeElapsedNS'],timings=copy.deepcopy(value['Timings']),originalLogSHA256=hashlib.sha256(raw).hexdigest(),businessSuccess=False,sourceGrant=False,meaning='Original failed CLI elapsed spans only; not a normal successful reply, DATA-ready, complete demand, authority, or retry permission.')


class CalleeMeasurements:
    """Original elapsed spans, separate denominators; never sum nested stages."""
    def __init__(self,demand,accounts,sender_pool=False,source=None):
        self.source=CALLEE_SOURCE if source is None else source
        self.denominators=dict(startup=accounts,live_setup=4,sign=demand,confirm=demand,live_publish=demand,live_result=demand)
        if sender_pool:
            self.denominators.pop("startup");self.denominators.update(sender_open_sign=demand,sender_open_confirm=demand)
        self.groups={};self.lock=threading.Lock();self.received={k:set() for k in self.denominators};self.record_failures={k:0 for k in self.denominators}
    def record(self,kind,identity,reply,owner=None,validate_reply=None):
        # Count an original returned reply BEFORE validating its timing fields.
        # Unreached demand is not a missing timer; an invalid/missing timer on
        # a received reply must remain visible even when validation raises.
        with self.lock:
            lab.require(kind in self.denominators,"unknown callee measurement group")
            lab.require(identity not in self.received[kind] and len(self.received[kind])<self.denominators[kind],"duplicate or over-denominator original reply observation")
            self.received[kind].add(identity)
        try:
            if validate_reply is not None:validate_reply(reply)
            return self._record_validated(kind,identity,reply,owner)
        except BaseException:
            with self.lock:self.record_failures[kind]+=1
            raise
    def _record_validated(self,kind,identity,reply,owner=None):
        metrics=callee_snapshot(reply.get("timings"));elapsed=reply.get("startupElapsedNs" if kind in ('startup','sender_open_sign','sender_open_confirm') else "calleeElapsedNs")
        lab.require(type(elapsed) is int and 0<=elapsed<1<<63,"original callee elapsed value missing")
        if "startupTimings" in reply:callee_snapshot(reply["startupTimings"])
        cache=reply.get("staticCache")
        if cache is not None:
            lab.require(type(cache) is dict and cache.get("scope")=="YNX-PQ-LAB-PUBLIC-STATIC-MATH/v1" and type(cache.get("closed")) is bool,"original static cache scope differs")
            for field,limit in (("entries",1),("heldFiles",16),("originalBytes",32<<20),("hits",(1<<64)-1),("misses",(1<<64)-1),("bypasses",(1<<64)-1)):
                lab.require(type(cache.get(field)) is int and 0<=cache[field]<=limit,"original static cache bound differs")
        footprint=None
        if 'sourceInputs' in reply:
            lab.require(type(owner) is int and 0<=owner<=999,'original source-input owner identity required')
            footprint=held_input_footprint.inspect(reply['sourceInputs'],cache)
        outcome=reply.get("code",reply.get("outcome",reply.get("Outcome",reply.get("status","observed"))));lab.require(type(outcome) is str and len(outcome)<=128,"invalid original callee outcome")
        with self.lock:
            lab.require(kind in self.denominators,"unknown callee measurement group")
            g=self.groups.setdefault(kind,dict(seen=set(),elapsed=[],stages={},outcomes={},cacheByOwner={}))
            lab.require(identity not in g["seen"] and len(g["seen"])<self.denominators[kind],"duplicate or over-denominator original callee observation")
            g["seen"].add(identity);g["elapsed"].append(elapsed)
            g["outcomes"][outcome]=g["outcomes"].get(outcome,0)+1
            for name,stage in metrics["stages"].items():g["stages"].setdefault(name,[]).append(dict(stage))
            if cache is not None:g["cacheByOwner"][str(owner)]=dict(cache)
            if footprint is not None:g.setdefault('sourceInputsByOwner',{})[str(owner)]=footprint
    def report(self):
        def spans(values,n):
            values=sorted(values)
            return dict(observed=len(values),denominator=n,censoredOrNotReached=n-len(values),totalNs=sum(values),observedMinNs=min(values) if values else None,observedMaxNs=max(values) if values else None,
                fullDemandPercentilesMs={"p%d"%p:values[(n*p+99)//100-1]/1e6 if n>0 and len(values)==n else None for p in (50,95,99)})
        with self.lock:
            result={}
            for kind,n in self.denominators.items():
                g=self.groups.get(kind,dict(elapsed=[],stages={},outcomes={},cacheByOwner={}))
                received=len(self.received[kind]);observed=len(g['elapsed'])
                coverage=dict(completedReplyObservations=received,timingRecordFailures=self.record_failures[kind],missingTimingForCompletedReplies=received-observed,notReachedOrReplyNotSupplied=n-received,completedRepliesHaveTiming=received==observed and self.record_failures[kind]==0 if received else None,fullDemandTimingComplete=received==observed==n and self.record_failures[kind]==0)
                result[kind]=dict(calleeElapsed=spans(g["elapsed"],n),replyTimingCoverage=coverage,outcomes=dict(g["outcomes"]),stages={name:dict(spans([v["elapsedNs"] for v in values],n),calls=sum(v["calls"] for v in values)) for name,values in g["stages"].items()},lastCumulativeCacheSnapshotByOwner=dict(g["cacheByOwner"]))
                if g.get('sourceInputsByOwner'):
                    result[kind]['lastHeldInputFootprintByOwner']=copy.deepcopy(g['sourceInputsByOwner'])
        return dict(schema="YNX-PERF-ORIGINAL-CALLEE-MEASUREMENTS/v1",source=self.source,groups=result,intervalsOverlap=True,startupSeparate=True,startupEchoInFirstCommandNotAdded=True,cacheSnapshotsCumulativeNeverSummed=True,meaning="original monotonic elapsed wall spans; nested stages and concurrent processes are not additive; no authority or business/finality qualification")



def finish_network_accounting(network, result):
    """Finish the original capture using only an actual load result, if any."""
    original_load = result.get("loadResult")
    if original_load is None:
        return network.finish(None, None, load_result=None)
    return network.finish(original_load.get("qualified"),
                          {key: original_load.get(key) for key in (
                              "originMonotonicNs", "offeredWindowEndMonotonicNs", "windowNs", "observationCutoffNs")},
                          load_result=original_load)


def completion_diagnostics(result):
    """Explain incomplete demand separately from actual returned-reply defects."""
    load=result.get('loadResult',{});groups=result.get('normalCalleeMeasurements',{}).get('groups',{})
    coverage={kind:group.get('replyTimingCoverage') for kind,group in groups.items()}
    known=[v for v in coverage.values() if v is not None]
    missing=sum(v['missingTimingForCompletedReplies'] for v in known) if known else None
    n=result.get('configuredDemand')
    complete=bool(type(n) is int and n>0 and result.get('loadExecuted') and result.get('normalLiveCalleeUsed') is True and load.get('windowCompleted') is True and load.get('configuredDemand')==n and load.get('qualified')==n and load.get('notQualified')==0 and load.get('notSubmitted')==0 and result.get('cleanupComplete') is True and result.get('firstCause') is None and load.get('firstCause') is None and load.get('firstOperationalFailure') is None)
    classification='PREPARATION_ONLY' if not result.get('loadExecuted') else 'LOAD_RESULT_NOT_SUPPLIED' if not load else 'FULL_BUSINESS_DEMAND_COMPLETE' if complete else 'FULL_BUSINESS_DEMAND_INCOMPLETE'
    return dict(schema='YNX-PERF-LOAD-COMPLETION-DIAGNOSTICS/v1',classification=classification,configuredDemand=result.get('configuredDemand'),qualified=load.get('qualified'),notQualified=load.get('notQualified'),notSubmitted=load.get('notSubmitted'),originalDriverFirstCause=result.get('firstCause'),firstOperationalFailure=load.get('firstOperationalFailure'),replyTimingCoverage=coverage,missingTimingForCompletedReplies=missing,fullDemandCalleeTimingComplete=bool(known) and len(known)==len(groups) and all(v['fullDemandTimingComplete'] for v in known),fullBusinessDemandComplete=complete,authorityGranted=False,meaning='Received replies, rejected outcomes, unreached demand and missing timing are separate. Full demand and native verification gates are unchanged; this diagnostic is not a success receipt.')


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
    def __init__(self,ceremony,owner,name=None,startup_kind="startup",startup_identity=None,persistent=True):
        self.c=ceremony;self.owner=owner;self.offset=0;self.partial=b"";self.ready=None;self.startup_kind=startup_kind;self.startup_identity=owner if startup_identity is None else startup_identity
        self.launched_ns=time.monotonic_ns()
        path=ceremony.root/"workload/private-senders/recovery.raw"
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        try:
            st=os.fstat(fd);lab.require(stat.S_ISREG(st.st_mode) and st.st_size==32 and st.st_mode&0o077==0 and st.st_nlink==1,"original private credential required")
            args=[str(ceremony.bins/"ynx-consensus-pq-lab"),"sender","--synthetic","--root",str(ceremony.root),"--plan-sha256",ceremony.pin,"--activation-sha256",ceremony.activation_pin,"--workload-sha256",ceremony.workload_pin,"--owner",str(owner),"--ready","--timings",*(getattr(ceremony,"sender_arguments",None) or ()),"--credential-fd","3"]
            self.name=name if name is not None else "load-sender-%d"%owner
            self.proc=ceremony.w.launch(self.name,normal.fd3_command(args,fd),persistent,pass_fds=(fd,),stdin_pipe=True,thread_safe=True)
        finally:os.close(fd)
        self.path=ceremony.w.work/"public"/(self.name+".log")
    def receive(self,path,stop,version,deadline=None,check=lambda:None,*,include_original=False):
        while not stop.is_set() and (deadline is None or time.monotonic()<deadline):
            check()
            with open(self.path,"rb") as source:
                source.seek(self.offset);chunk=source.read(65536);self.offset+=len(chunk)
            self.partial+=chunk;lab.require(len(self.partial)<=2<<20,"original sender reply bound")
            if b"\n" in self.partial:
                line,self.partial=self.partial.split(b"\n",1)
                if path is not None:
                    with open(path,"xb") as output:output.write(line+b"\n");output.flush();os.fsync(output.fileno())
                reply=json.loads(line);lab.require(reply["version"]==version,"original sender reply version differs")
                return (reply, line+b"\n") if include_original else reply
            if chunk:
                # Drain bytes already written, even if the child has exited.
                continue
            if self.proc.poll() is not None:
                # A final write may race the empty read and process exit.
                lab.require(self.path.stat().st_size > self.offset,
                            "original sender exited without one exact reply; preserve UNKNOWN")
                continue
            stop.wait(.01)
        # The resource monitor sets cancellation after publishing its first cause.
        check()
        raise RuntimeError("original sender reply not supplied before cancellation/cutoff; preserve UNKNOWN, never re-sign or replay")
    def wait_ready(self,stop,deadline,check):
        lab.require(self.ready is None,"original sender ready already consumed")
        path=self.c.w.work/"public"/(self.name+"-ready.json")
        reply=self.receive(path,stop,"YNX-PQ-LAB-SENDER-READY/v1",deadline,check)
        lab.require(reply.get("status")=="original_custody_opened_imported_writer_lease_held" and reply.get("ownerIndex")==self.owner and reply.get("planSHA256")==self.c.pin and reply.get("workloadSHA256")==self.c.workload_pin and reply.get("syntheticOnly") is True and reply.get("authorityGranted") is False and reply.get("signed") is False and reply.get("nonceReserved") is False,"original DATA-ready scope/identity differs; no command issued")
        self.c.measurements.record(getattr(self,"startup_kind","startup"),getattr(self,"startup_identity",self.owner),reply,owner=self.owner)
        self.startup_snapshot=reply["timings"]
        self.ready=dict(ownerIndex=self.owner,pid=self.proc.pid,sourceReply=str(path.relative_to(self.c.w.work/"public")),sha256=lab.guard.digest(path),parentLaunchToReadyObservedNs=time.monotonic_ns()-self.launched_ns,sourceStartupElapsedNs=reply["startupElapsedNs"],signed=False,nonceReserved=False,authorityGranted=False)
        return dict(self.ready)
    def exchange(self,command,path,stop):
        lab.require(self.ready is not None,"original DATA-ready required before any sign/confirm command")
        lab.require(not stop.is_set(),"original sender interrupted before new command; preserve pending original")
        raw=json.dumps(command,separators=(",",":")).encode()+b"\n"
        lab.require(len(raw)<=32<<10,"original canonical command bound")
        lab.require(self.proc.poll() is None,"original sender exited; preserve UNKNOWN")
        self.proc.stdin.write(raw);self.proc.stdin.flush()
        reply=self.receive(path,stop,"YNX-PQ-LAB-SENDER-REPLY/v1")
        def validate_echo(value):
            if "startupTimings" in value:
                lab.require(value.get("startupElapsedNs")==self.ready["sourceStartupElapsedNs"] and value["startupTimings"]==self.startup_snapshot,"original startup echo differs from DATA-ready; no performance relabelling")
        self.c.measurements.record(command["operation"],command["request"]["operationId"],reply,owner=self.owner,validate_reply=validate_echo)
        return reply


class LoadCeremony(normal.Ceremony):
    def __init__(self,*args,operations,proof_timeout,commit_observation=False,sender_pool=False,consumer_source=None,startup_timings=False,**kwargs):
        lab.require(type(startup_timings) is bool and (not startup_timings or consumer_source in STARTUP_TIMING_ABI_SOURCES),'matching original startup timing ABI required; no source qualification implied')
        super().__init__(*args,**kwargs);self.operations=operations;self.proof_timeout=proof_timeout;self.live=[]
        self.commit_observation_enabled=commit_observation;self.commit_observation_descriptors=[]
        self.finalize_observation_enabled=False;self.finalize_observation_descriptors=[]
        self.consumer_source=CALLEE_SOURCE if consumer_source is None else consumer_source
        self.preparation_sender_arguments=("--timings",);self.preparation_sender_measurements=[]
        self.startup_timings_enabled=startup_timings;self.preparation_startup_measurements=[]
        self.failed_callee_measurements=[];self.failed_callee_attempts=0
        self.measurements=CalleeMeasurements(operations,len(self.workload["owners"])-4 if self.mode=="online" else 0,sender_pool=sender_pool,source=self.consumer_source)
        verifier=self.bins/"ynx-consensus-proof-verify";self.verifier_binary_pin=lab.guard.digest(verifier)
        info=verifier.stat();self.verifier_binary_identity=(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns)
    def retain_failed_callee(self,name):
        self.failed_callee_attempts+=1
        if len(self.failed_callee_measurements)>=64:return
        record=dict(name=name,source=self.consumer_source,status='NOT_SUPPLIED',successfulReply=False,sourceGrant=False)
        try:
            lab.require(type(name) is str and name and all(c.isalnum() or c in '-_' for c in name),'original bounded public callee label required')
            raw=lab.guard.bounded(self.w.work/'public'/(name+'.log'),lab.CAPS['logBytes'])
            record.update(status='ORIGINAL_FAILURE_TIMING_OBSERVED',originalFailureTiming=original_failed_callee_timing(raw))
        except BaseException as error:record['measurementErrorType']=type(error).__name__
        self.failed_callee_measurements.append(record)

    def wire_arguments(self,phase,index):
        arguments=super().wire_arguments(phase,index)
        if getattr(self,'startup_timings_enabled',False):
            lab.require(phase in ('bootstrap','pq') and type(index) is int and 0<=index<4,'original startup lifetime required')
            arguments=[*arguments,'--startup-timings']
        return arguments

    def call(self,name,args):
        measured=getattr(self,'startup_timings_enabled',False) and args[:1] in (['registration'],['activate'])
        if measured:
            lab.require(not any(a=='--timings' or a.startswith('--timings=') for a in args),'duplicate startup callee timing opt-in')
            lab.require(len(self.preparation_startup_measurements)<5,'bounded original registration/activation measurements required')
        try:reply=super().call(name,[*args,'--timings'] if measured else args)
        except BaseException:
            self.retain_failed_callee(name)
            raise # Original failure is never replaced by a telemetry failure.
        if measured:
            record=dict(name=name,operation=args[0],source=self.consumer_source,status='ORIGINAL_REPLY_TIMING_UNKNOWN',calleeElapsedNs=None,timings=None,intervalsOverlap=True,sourceGrant=False)
            self.preparation_startup_measurements.append(record)
            stages=callee_snapshot(reply.get('timings'));elapsed=reply.get('calleeElapsedNs')
            lab.require(type(elapsed) is int and 0<=elapsed<1<<63,'original startup callee elapsed missing')
            record.update(status='ORIGINAL_REPLY_TIMING_OBSERVED',calleeElapsedNs=elapsed,timings=copy.deepcopy(stages))
        return reply

    def sender_command(self,name,owner,command):
        # Same original one-shot FD3 sender and command; opt into its existing
        # measured JSON reply, without pre-opening custody or changing timing.
        lab.require(len(self.preparation_sender_measurements)<8,'bounded original preparation command measurements required')
        try:reply=super().sender_command(name,owner,command)
        except BaseException:
            self.retain_failed_callee(name)
            raise
        stages=callee_snapshot(reply.get('timings'));startup=callee_snapshot(reply.get('startupTimings'))
        elapsed=reply.get('calleeElapsedNs');cold=reply.get('startupElapsedNs')
        lab.require(type(elapsed) is int and elapsed>=0 and type(cold) is int and cold>=0,'original preparation callee/startup timing missing')
        self.preparation_sender_measurements.append(dict(name=name,ownerIndex=owner,operation=command['operation'],outcome=reply.get('code'),calleeElapsedNs=elapsed,startupElapsedNs=cold,timings=copy.deepcopy(stages),startupTimings=copy.deepcopy(startup),source=self.consumer_source,intervalsOverlap=True,startupNotAddedToCallee=True))
        return reply

    def activation_startup(self,activation):
        resumed=copy.deepcopy(activation)
        for node in range(4):
            result=self.call("live-setup-%d"%node,["live-materials","setup","--synthetic","--timings","--root",str(self.root),"--plan-sha256",self.pin,"--activation-sha256",self.activation_pin,"--node",str(node),"--max-operations",str(self.operations),"--trusting-period","10m","--max-clock-drift","5s","--capture-timeout",str(self.proof_timeout)+"s","--trust-numerator","1","--trust-denominator","3"])
            lab.require(result["version"]=="YNX-PQ-LAB-LIVE-MATERIALS-SETUP/v1" and result["syntheticOnly"] is True and result["nodeStarted"] is False and result["authorityGranted"] is False,"normal independent live setup required")
            self.measurements.record("live_setup",node,result)
            original=activation["nodes"][node]["args"]
            lab.require(result["nodeArguments"][:len(original)]==original,"normal live setup changed original activation arguments")
            policy=Path(result["policy"]["path"]);lab.require(policy.resolve()==policy and self.root in policy.parents and lab.guard.digest(policy)==result["policy"]["sha256"],"normal startup policy pin differs")
            lab.require(result["nodeArguments"]==[*original,"--proof-host-live-policy",str(policy),"--proof-host-live-policy-sha256",result["policy"]["sha256"]],"normal live setup arguments differ from exact pinned policy opt-in")
            self.live.append(dict(node=node,policy=policy,pin=result["policy"]["sha256"],sequence=0,lock=threading.Lock(),retired=False))
            resumed["nodes"][node]["args"]=list(result["nodeArguments"])
            if self.commit_observation_enabled:
                private=self.w.work/".private/commit-observations";private.mkdir(mode=0o700,exist_ok=True)
                output=private/("pq-node-%d.json"%node)
                observed=commit_readback.arguments(output,private)
                lab.require(not any(a.startswith("--commit-observation-") for a in resumed["nodes"][node]["args"]),"duplicate original Commit observer flags")
                resumed["nodes"][node]["args"].extend(observed)
                self.commit_observation_descriptors.append(dict(node=node,path=str(output),processName="pq-node-%d"%node))
                if self.finalize_observation_enabled:
                    finalize_output = private / ("finalize-node-%d.json" % node)
                    resumed["nodes"][node]["args"].extend(("--finalize-observation-output", str(finalize_output)))
                    self.finalize_observation_descriptors.append(dict(node=node, path=finalize_output,
                                                                      processName="pq-node-%d" % node))
        return resumed


class NormalBackend:
    def __init__(self,ceremony,owners,stop,open_persistent=True):
        self.c=ceremony;self.w=ceremony.w;self.stop_event=stop
        self.pool_started_ns=time.monotonic_ns();self.pool_ready=None
        self.sessions={};self.attempted=set();self.submit_lock=threading.Lock();self.checkpoint_lock=threading.Lock();self.checkpoint_points={}
        # Online originals are signed only after an account claim; the normal
        # Go producer serializes its absent pre-signed slice as JSON null.
        # Validate mode-specific data before opening persistent sender handles.
        self.corpus={};transactions=ceremony.workload["transactions"]
        if ceremony.mode=="pre-signed":
            lab.require(type(transactions) is list,"original pre-signed transaction list required")
            for index,tx in enumerate(transactions):
                key=(tx["ownerIndex"],int(tx["firstNonce"]))
                lab.require(key not in self.corpus,"original corpus has duplicate account nonce")
                self.corpus[key]=index
        else:
            lab.require(ceremony.mode=="online" and (transactions is None or transactions==[]),"online workload must not substitute a pre-signed corpus")
        self.queue=__import__('queue').Queue()
        for lane in ceremony.live:self.queue.put(lane)
        if ceremony.mode=="online" and open_persistent:
            for owner in owners:self.sessions[owner["ownerIndex"]]=SenderSession(ceremony,owner["ownerIndex"])
        # The original Go helper entry points do not spawn child processes.
        # All transient calls share the remaining original owned-PID budget;
        # four live lanes are retained, but cannot each launch a fourth helper.
        slots=min(3,lab.guard.CAPS["ownedProcesses"]-5-len(self.sessions))
        lab.require(slots>0,"no original process capacity for normal helpers")
        self.helper_slots=threading.BoundedSemaphore(slots)
        self.helper_limit=slots;self.helper_cleanup_debt=[]
        self.helper_timing_lock=threading.Lock();self.helper_timing_attempts=0;self.helper_timing_completed=0;self.helper_timings=[]
        self.rpc_measurements=rpc_measurements.RPCMeasurements()
    def observed_rpc(self,node,method,query=''):
        return self.rpc_measurements.call(node['index'],method,lambda:self.w.rpc(node['rpcAddress'],method,query) if query else self.w.rpc(node['rpcAddress'],method))
    def prepare(self,check):
        deadline=time.monotonic()+self.c.proof_timeout
        ready=[session.wait_ready(self.stop_event,deadline,check) for session in self.sessions.values()]
        check();self.pool_ready=dict(startedMonotonicNs=str(self.pool_started_ns),readyObservedMonotonicNs=str(time.monotonic_ns()),parentPoolPreparationNs=time.monotonic_ns()-self.pool_started_ns,readyCount=len(ready),senders=ready,sourceGrant=False,signed=False,nonceReserved=False,loadClockStarted=False)
        return self.pool_ready
    def helper_timing_report(self):
        with self.helper_timing_lock:
            return dict(schema="YNX-PERF-PARENT-HELPER-BOUNDARIES/v1",clock="parent_monotonic_ns",attempted=self.helper_timing_attempts,completed=self.helper_timing_completed,inFlight=self.helper_timing_attempts-self.helper_timing_completed,retained=len(self.helper_timings),omittedCompleted=self.helper_timing_completed-len(self.helper_timings),recordLimit=2048,records=copy.deepcopy(self.helper_timings),meaning="observed parent boundaries only; launch includes Window lock and resource guard; wait includes resource guard and exit observation, not exact child exit; source callee timing is separate; missing boundaries are not zero or qualification")
    def helper(self,name,command,stdin=None,*,observe_request=False):
        trace=dict(name=name,requestedMonotonicNs=time.monotonic_ns())
        if observe_request:trace['requestObservationRequested']=True
        with self.helper_timing_lock:self.helper_timing_attempts+=1
        try:
            return self._helper(name,command,stdin,trace,observe_request=observe_request)
        except BaseException as error:
            trace["errorType"]=type(error).__name__
            raise
        finally:
            trace["returnedMonotonicNs"]=time.monotonic_ns()
            with self.helper_timing_lock:
                self.helper_timing_completed+=1
                if len(self.helper_timings)<2048:self.helper_timings.append(trace)
    def capture_request_observation(self,name,proc,released,trace):
        # Called only after the original wait/cleanup, including its failure
        # path. Diagnostic errors must not replace that original exception.
        try:
            if proc is None:
                trace['requestObservationCaptureStatus']='NOT_LAUNCHED'
                return None
            trace['requestProcessID']=proc.pid
            if not released:
                trace['requestObservationCaptureStatus']='ORIGINAL_PROCESS_UNREAPED'
                return None
            trace['requestProcessReturnCode']=proc.poll()
            raw=lab.guard.bounded(self.w.work/'public'/(name+'.log'),lab.CAPS['logBytes'])
            report,ordinary=request_observation_readback.split_original(raw,hashlib.sha256(raw).hexdigest())
            trace['requestStageObservation']=report
            trace['requestObservationCaptureStatus']='ORIGINAL_BYTES_READ'
            return ordinary
        except Exception as error:
            trace['requestObservationCaptureStatus']='UNQUALIFIED_ORIGINAL_LOG'
            trace['requestObservationErrorType']=type(error).__name__
            return None
    def _helper(self,name,command,stdin,trace,*,observe_request=False):
        acquired=False;proc=None;released=False;ordinary=None
        while not self.stop_event.is_set():
            if self.helper_slots.acquire(timeout=.02):acquired=True;break
        if acquired:trace["slotAcquiredMonotonicNs"]=time.monotonic_ns()
        lab.require(acquired,"normal helper interrupted before launch; preserve UNKNOWN")
        try:
            lab.require(not self.stop_event.is_set(),"normal helper cancelled before launch; preserve UNKNOWN")
            trace["launchRequestedMonotonicNs"]=time.monotonic_ns()
            try:
                proc=self.w.launch(name,command,stdin_path=stdin,thread_safe=True)
                trace["launchReturnedMonotonicNs"]=time.monotonic_ns()
            except BaseException:
                # Window may have registered the exact child before a later
                # start-identity read failed; retain that original handle.
                with self.w.lock:
                    proc=next((c["process"] for c in self.w.children if c["name"]==name),None)
                raise
            self.w.wait(proc)
            trace["waitReturnedMonotonicNs"]=time.monotonic_ns()
        finally:
            # A failed resource sample/wait can leave the original process alive.
            # Never release its slot until that exact Popen has exited/reaped.
            # Cleanup errors cannot replace the original normal-call first cause.
            try:
                if proc is not None and proc.poll() is None:
                    self.stop_event.set()
                    try:proc.terminate()
                    except ProcessLookupError:pass
                    try:proc.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        proc.kill();proc.wait(timeout=1)
                released=proc is None or proc.poll() is not None
                if proc is not None and released:self.w.retire_log(proc)
            except BaseException as error:
                self.stop_event.set()
                self.helper_cleanup_debt.append(dict(name=name,errorType=type(error).__name__,pid=None if proc is None else proc.pid,meaning="original helper cleanup unresolved; preserve UNKNOWN and first cause"))
            finally:
                if released:self.helper_slots.release()
                else:self.stop_event.set()
                trace["cleanupFinishedMonotonicNs"]=time.monotonic_ns()
                if observe_request:
                    ordinary=self.capture_request_observation(name,proc,released,trace)
        lab.require(released and not any(d["name"]==name for d in self.helper_cleanup_debt),"normal helper cleanup unresolved; preserve UNKNOWN")
        if observe_request:
            lab.require(ordinary is not None,'original request log cannot be separated safely; retain original UNKNOWN, no retry')
            return json.loads(ordinary)
        return json.loads((self.w.work/"public"/(name+".log")).read_bytes())
    def call(self,name,args,stdin=None):
        measured=args[:2] in (["live-materials","request"],["live-materials","result"])
        observed='--observe-stages' in args
        lab.require(not observed or (args[:2]==['live-materials','request'] and args.count('--observe-stages')==1),
                    'stage observation belongs only to the explicit original request command')
        command=[str(self.c.bins/"ynx-consensus-pq-lab"),*args,*( ["--timings"] if measured else [])]
        # The caller must supply the opt-in argv from a qualified future source.
        # No flag is added here, and the old source/window gates remain intact.
        reply=self.helper(name,command,stdin,observe_request=True) if observed else self.helper(name,command,stdin)
        if measured:self.c.measurements.record("live_publish" if args[1]=="request" else "live_result",name,reply)
        return reply
    def checkpoint(self,stop):
        paths=[Path(n["statePath"]) for n in self.c.plan["nodes"]]
        lab.require(len(paths)==4 and len(set(paths))==4,'four distinct original node state paths required')
        def identities():
            result = []
            for path in paths:
                info = path.stat()
                result.append((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns))
            return tuple(result)
        while not stop.is_set():
            with self.checkpoint_lock:
                fingerprint=identities()
                readings={}
                for path, identity in zip(paths,fingerprint):
                    cached=self.checkpoint_points.get(path)
                    if cached is None or cached[0]!=identity:
                        value=json.loads(lab.guard.bounded(path,128<<20))
                        cached=(identity,value["height"],value["appHash"],value["initialized"])
                    readings[path]=cached
                if fingerprint==identities():
                    self.checkpoint_points=readings
                    points={(height,app) for _,height,app,_ in readings.values()}
                    if len(points)==1 and all(row[3] for row in readings.values()):
                        height,app=next(iter(points))
                        return dict(height=height,appHash=app)
            stop.wait(.01)
        raise RuntimeError("no current common original checkpoint before interruption")
    def original(self,row,account,case,notify,stop):
        if self.c.mode=='online' and getattr(self,'checkpoint_after_ready',False):
            checkpoint=None # Bounded cold sender selects once after DATA-ready.
        else:
            notify(dict(kind="normal_stage",stage="checkpoint"))
            checkpoint=self.checkpoint(stop)
        owner=account["ownerIndex"]
        request=dict(version="YNX-PQ-LAB-SENDER-REQUEST/v1",operationId=row["operationId"],ownerIndex=owner,firstNonce=str(row["nonce"]),members=1)
        if self.c.mode=="online":
            notify(dict(kind="normal_stage",stage="signer"))
            reply=self.sign_original(row,request,checkpoint,case,notify,stop)
            if reply['code'] == 'REJECTED':
                detail = owner_failure_detail(reply, 'sign')
                raise scheduler.KnownFailure(f'normal signer returned explicit REJECTED{detail}; no retry')
            if reply['code'] != 'ORIGINAL_SAVED':
                detail = owner_failure_detail(reply, 'sign')
                lab.require(False, f'normal original sign did not return known durable original{detail}; no retry')
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
    def sign_original(self,row,request,checkpoint,case,notify,stop):
        return self.sessions[row['ownerIndex']].exchange(normal.sender_command_data('sign',request,checkpoint['height'],checkpoint['appHash']),case/'original-sign-reply.json',stop)
    def confirm_original(self,row,request,proof,case,notify,stop):
        return self.sessions[row['ownerIndex']].exchange(normal.sender_command_data('confirm',request,materials=proof['materials']['path'],materials_sha=proof['materials']['sha256'],proof=proof['proof']['path']),case/'original-confirm-reply.json',stop)
    def broadcast_and_include(self,row,tx,raw,case,notify,stop):
        self.broadcast_once(row,tx,raw,case,notify,stop)
        return self.observe_inclusion(row,tx,case,notify,stop)
    def broadcast_once(self,row,tx,raw,case,notify,stop):
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
    def observe_inclusion(self,row,tx,case,notify,stop):
        expected=normal.comet_hash(tx["abciHash"])
        notify(dict(kind="normal_stage",stage="inclusion"))
        until=time.monotonic()+self.c.proof_timeout
        while time.monotonic()<until and not stop.is_set():
            try:
                rows=[self.observed_rpc(n,"tx","?hash=0x"+expected+"&prove=true") for n in self.c.plan["nodes"]]
                lab.require(all(normal.comet_hash(r["hash"])==expected for r in rows),"normal included transaction identity differs")
                lab.require(len({int(r["height"]) for r in rows})==1 and all(int(r["tx_result"].get("code",0))==0 for r in rows),"normal included execution/height differs")
                notify(dict(kind="included"))
                lab.write_new(case/"four-node-inclusion.json",dict(rows=rows,qualifiedFinal=False,interpretation="original hash-bound execution observations only"));return int(rows[0]["height"])
            except (OSError,ValueError,KeyError):pass
            except RuntimeError as error:
                if "identity differs" in str(error) or "execution/height differs" in str(error):raise
            stop.wait(.02)
        raise RuntimeError("original submitted hash unresolved at bounded inclusion cutoff; no replay")
    def wait_successor(self,height,case,stop):
        # The original live CLI fails once (and retires its lane) if H+1 is
        # absent. Wait on original observations BEFORE publishing that request.
        # This readiness record grants no finality; the normal proof still must
        # authenticate exact H/H+1 and the original sender must confirm it.
        until=time.monotonic()+self.c.proof_timeout
        while time.monotonic()<until and not stop.is_set():
            try:
                observed=[]
                for node in self.c.plan["nodes"]:
                    status=self.observed_rpc(node,"status")
                    info=self.observed_rpc(node,"abci_info")["response"]
                    lab.require(status["node_info"]["network"]==self.c.plan["chainId"],"normal successor chain identity differs")
                    observed.append(dict(node=node["index"],engineHeight=int(status["sync_info"]["latest_block_height"]),applicationHeight=int(info["last_block_height"])))
                if all(min(o["engineHeight"],o["applicationHeight"])>=height+1 for o in observed):
                    lab.write_new(case/"successor-availability.json",dict(transactionHeight=height,minimumSuccessorHeight=height+1,observations=observed,observedMonotonicNs=time.monotonic_ns(),qualifiedFinal=False))
                    return
            except (OSError,ValueError,KeyError):pass
            except RuntimeError as error:
                if "chain identity differs" in str(error):raise
            stop.wait(.02)
        raise RuntimeError("original H+1 not observed before bounded cutoff; preserve submitted original UNKNOWN, no proof publication or replay")
    def live_materials_command(self, lane, operation, prefix, sequence, stop, *, path=None, tx=None):
        if "session" in lane:
            lab.require(not stop.is_set(), "original live session canceled before command")
            transaction = {}
            if operation == "request":
                transaction = dict(transaction_file=str(path),
                                   transaction_sha256=normal.comet_hash(tx["abciHash"]),
                                   native_wire_hash=normal.comet_hash(tx["nativeHash"]))
            started = time.monotonic_ns()
            if operation == "result":
                original_path = self.w.work / "public" / f"{prefix}-live-result.log"
                transaction["retain_original"] = lambda raw: proof_readback.write_new(original_path, raw)
            reply = lane["session"].exchange(operation, sequence, **transaction)
            returned = time.monotonic_ns()
            group = "live_publish" if operation == "request" else "live_result"
            self.c.measurements.record(group, prefix, reply)
            timings = reply["timings"]
            if operation == "request":
                lab.require(reply["requestPath"] == str(lane["policy"].parent / f"request-{sequence:06d}.json"),
                            "original live publication path differs")
            lab.write_new(self.w.work / "public" / f"{prefix}-live-session-{operation}.json",
                          dict(node=lane["node"], policySHA256=lane["pin"], sequence=sequence,
                               parentElapsedNs=returned-started, calleeElapsedNs=reply["calleeElapsedNs"],
                               timings=timings, intervalsOverlap=True))
            return reply.get("result")
        args = ["live-materials", operation, "--synthetic", "--policy", str(lane["policy"]),
                "--policy-sha256", lane["pin"], "--sequence", str(sequence)]
        suffix = "result"
        if operation == "request":
            suffix = "publish"
            args.extend(("--transaction", str(path),
                         "--transaction-sha256", normal.comet_hash(tx["abciHash"]),
                         "--native-wire-hash", normal.comet_hash(tx["nativeHash"])))
            if getattr(self.c, 'request_stage_observation', False):
                args.append('--observe-stages')
        return self.call(f"{prefix}-live-{suffix}", args)

    def retain_live_proof_failure(self, output, case, lane, sequence, stop, until):
        # The producer opens the final path before writing the JSON record.
        # Only reread this same output, within the existing proof deadline.
        deadline = min(until, time.monotonic() + .1)
        while True:
            try:
                raw = proof_readback.read_original(output / 'failure.json', limit=4096, allow_empty=True)
                failure = proof_readback.strict(raw)
                break
            except (RuntimeError, ValueError) as error:
                if not isinstance(error, json.JSONDecodeError) and str(error) != 'original public input changed during read':
                    raise
                remaining = deadline - time.monotonic()
                if remaining <= 0 or stop.wait(min(.01, remaining)):
                    raise
        lab.require(type(failure) is dict
                    and set(failure) == {'Version', 'PolicySHA256', 'Outcome', 'FirstCauseSHA256', 'Sequence'}
                    and failure['Version'] == 'YNX-PQ-LAB-LIVE-MATERIALS-FAILURE/v1'
                    and failure['PolicySHA256'] == lane['pin']
                    and failure['Outcome'] == 'unknown'
                    and type(failure['Sequence']) is int and failure['Sequence'] == sequence
                    and type(failure['FirstCauseSHA256']) is str
                    and re.fullmatch('[0-9a-f]{64}', failure['FirstCauseSHA256']),
                    'original proof failure record differs')
        proof_readback.write_new(case / 'original-live-proof-failure.json', raw)

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
            self.live_materials_command(lane, "request", prefix, seq, stop, path=path, tx=tx)
            output=lane["policy"].parent/("operation-%06d"%seq);until=time.monotonic()+self.c.proof_timeout
            notify(dict(kind="normal_stage",stage="live_capture"))
            while not (output/"result.json").exists() and not stop.is_set() and time.monotonic()<until:
                if (output/'failure.json').exists():
                    try:
                        self.retain_live_proof_failure(output, case, lane, seq, stop, until)
                    except (OSError, RuntimeError, ValueError) as error:
                        raise RuntimeError('normal live proof operation is UNKNOWN; original failure record unavailable') from error
                    raise RuntimeError('normal live proof operation is UNKNOWN')
                stop.wait(.02)
            lab.require((output/"result.json").exists(),"normal original live proof result not supplied before bounded cutoff")
            notify(dict(kind="normal_stage",stage="live_read"))
            result=self.live_materials_command(lane, "result", prefix, seq, stop)
            lab.require(result["version"]=="YNX-PQ-LAB-LIVE-MATERIALS-RESULT/v1" and result["outcome"]=="verified_transaction_data" and result["policySHA256"]==lane["pin"] and int(result["sequence"])==seq and result["owningNodeIndex"]==lane["node"] and result["sourceKind"]=="original-node-owning-stores" and result["syntheticOnly"] is True and result["sourceReadOnly"] is True and result["authorityGranted"] is False and result["fourNodeAgreementClaim"] is False,"normal original live result scope differs")
            lab.require(normal.comet_hash(result["transactionHash"])==normal.comet_hash(tx["abciHash"]) and normal.comet_hash(result["nativeWireHash"])==normal.comet_hash(tx["nativeHash"]),"normal live proof original dual identity differs")
            for key in ("materials","proof","checkpoint"):normal.public_file(output,result[key])
            context=result["verified"];directory=output/"verifier"
            request=normal.public_file(directory,context["request"]);trust=normal.public_file(directory,context["context"])
            lab.require(context["verifierArguments"]==["--trust-context",str(trust),"--trust-context-sha256",context["context"]["sha256"]],"normal original independent verifier invocation differs")
            notify(dict(kind="normal_stage",stage="proof_public_export"))
            info=(self.c.bins/"ynx-consensus-proof-verify").stat()
            lab.require((info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns)==self.c.verifier_binary_identity,"original normal verifier binary identity changed")
            public_closure=proof_readback.export_original_public_proof(self.w.work/"public",case,directory,context,result["proof"],getattr(self.c,'consumer_source',CALLEE_SOURCE),self.c.verifier_binary_pin)
            notify(dict(kind="normal_stage",stage="verifier"))
            verified=self.helper(prefix+"-normal-verifier",[str(self.c.bins/"ynx-consensus-proof-verify"),*context["verifierArguments"]],request)
            normal.require_verified(verified,tx)
            return result,verified,public_closure
        except BaseException:
            lane["retired"]=True;raise
        finally:
            if not lane["retired"]:self.queue.put(lane)
    def publish(self,row,account,notify,stop):
        case=self.w.work/"public/load-operations"/("%05d"%row["index"]);case.mkdir(mode=0o700)
        directory=os.open(case.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
        lab.write_new(case/"operation-intent.json",dict(logicalId=row["id"],operationId=row["operationId"],ownerIndex=account["ownerIndex"],nonce=str(row["nonce"]),mode=self.c.mode,kind="normal independent single transfer",sourceGrant=False))
        started=time.monotonic_ns();tx,path,raw,request=self.original(row,account,case,notify,stop)
        notify(dict(kind="signed",hash=normal.comet_hash(tx["abciHash"]),nativeHash=normal.comet_hash(tx["nativeHash"])))
        self.broadcast_once(row,tx,raw,case,notify,stop)
        return dict(row=row,account=account,case=case,started=started,tx=tx,path=path,request=request)
    def observe(self,handle,notify,stop):
        row,tx,case=handle['row'],handle['tx'],handle['case']
        height=self.observe_inclusion(row,tx,case,notify,stop)
        notify(dict(kind="normal_stage",stage="successor_availability"))
        self.wait_successor(height,case,stop)
        return handle
    def finalize(self,handle,notify,stop):
        row,account,case,started,tx,path,request=(handle[k] for k in ('row','account','case','started','tx','path','request'))
        proof,verified,public_closure=self.live_proof(row,tx,path,case,notify,stop)
        confirmed=None
        if self.c.mode=="online":
            notify(dict(kind="normal_stage",stage="confirm"))
            confirmed=self.confirm_original(row,request,proof,case,notify,stop)
            lab.require(confirmed["code"]=="PROOF_CONFIRMED_DATA","normal original pending operation not confirmed")
            normal.require_verified(dict(code="VERIFIED_TRANSACTION_DATA",result=confirmed["result"]["result"]),tx)
        notify(dict(kind="normal_stage",stage="receipt"))
        final=dict(id=row["id"],operationId=row["operationId"],mode=self.c.mode,transaction=tx,normalLiveResult=proof,normalVerifier=verified,normalConfirm=confirmed,originalPublicProofClosure=public_closure,parentPipelineNs=time.monotonic_ns()-started,physicalCommitMeasured=False,sourceGrant=False)
        lab.write_new(case/"qualified-receipt.json",final)
        if self.c.mode=="online":
            notify(dict(kind="normal_stage",stage="proof_portable_export"))
            proof_readback.finalize_portable_catalog(self.w.work/"public",case,public_closure,row)
        notify(dict(kind="qualified",hash=normal.comet_hash(tx["abciHash"]),nativeHash=normal.comet_hash(tx["nativeHash"]),normalVerifierCode=verified["code"],executionSuccessful=verified["result"]["executionSuccessful"],executionCode=verified["result"]["executionCode"],transactionType=verified["result"]["transactionType"],members=int(tx["members"]),nativeGrant=verified["result"]["nativeGrant"],normalConfirmCode=None if confirmed is None else confirmed["code"],proofReference=str((case/"qualified-receipt.json").relative_to(self.w.work/"public"))))
    def perform(self,row,account,notify,stop):
        # Legacy sequential entry stays byte/protocol equivalent.
        self.finalize(self.observe(self.publish(row,account,notify,stop),notify,stop),notify,stop)
    def stop(self):
        self.stop_event.set();self.w.stopping=True
        with self.w.lock:children=list(self.w.children)
        for child in children:
            if child["name"].startswith("load-") and child["process"].poll() is None:
                try:os.killpg(child["process"].pid,signal.SIGTERM)
                except ProcessLookupError:pass
        # Terminate before closing buffered stdin so a stalled child cannot
        # hold a writer/close lock past the bounded cleanup boundary.
        senders = [session.proc for session in self.sessions.values()]
        proof_sessions = [child["process"] for child in children
                          if child["name"].startswith("load-live-session-")]
        for process in [*senders, *proof_sessions]:
            if process.stdin is not None and not process.stdin.closed:
                try:process.stdin.close()
                except (OSError,ValueError):pass


def attach_live_reader(ceremony, live_module):
    lab.require(not ceremony.nodes and getattr(ceremony,'live_reader',None) is None,
                'one normal private reader must attach before original node startup')
    reader=live_module.NormalLiveReader(ceremony,lab)
    ceremony.live_reader=reader
    return reader


def create_network_window(hook,ceremony,args,tools,plan_pin,demand):
    reader=getattr(ceremony,'live_reader',None)
    required=getattr(args,'first_trial_profile','own1b') in ('7c25', HELD_TRIAL_PROFILE)
    lab.require(not required or reader is not None,'7c25 normal private live reader NOT_SUPPLIED')
    window=hook.NetworkWindow(ceremony,lab,args.commit,tools,plan_pin,demand,
        live_reader=reader,header_capture=getattr(args,'header_hop_capture',False),
        header_capture_seconds=min(120,args.seconds+args.tail_seconds+10))
    lab.require(window.live_reader is reader,'normal network window must retain the same sole private reader')
    return window


def validate_options(args):
    profile=getattr(args,'first_trial_profile','own1b')
    lab.require(profile in ('own1b','d24','1695','7c25',HELD_TRIAL_PROFILE) and (profile=='own1b' or getattr(args,'initialize_before_load',False)),'selected source requires explicit same-window first100 profile')
    lab.require(type(getattr(args, 'held_ready_only', False)) is bool and
                (not getattr(args, 'held_ready_only', False) or profile == HELD_TRIAL_PROFILE),
                'READY-only requires the fixed held first100 profile')
    if profile in ('7c25', HELD_TRIAL_PROFILE):
        expected = HELD_TRIAL_SOURCE if profile == HELD_TRIAL_PROFILE else first_trial_7c25_source.SOURCE
        lab.require(args.commit==expected and getattr(args,'sender_backend','auto')=='public-owner',
                    'selected first100 requires its exact source and explicit public-owner backend')
    lab.require(args.mode in ("online","pre-signed") and args.rate in (100,500,1000) and 1<=args.accounts<=996 and 1<=args.per_account<=1024 and 1<=args.seconds<=60 and 1<=args.tail_seconds<=120 and 1<=args.proof_timeout<=120,"bounded explicit original load configuration required")
    if getattr(args,'initialization_only',False):
        lab.require(getattr(args,'staged_publication',False) and (args.mode,args.rate,args.seconds,args.accounts,args.per_account)==('online',100,5,500,1),'initialization-only requires exact original staged online500 plus4 reserved owners; no reduced-account qualification')
    demand=args.rate*args.seconds
    lab.require(demand<=10000 and args.accounts*args.per_account>=demand,"complete original account capacity must cover fixed demand")
    lab.require((args.accounts+4)*args.per_account<=(10000 if args.mode=="online" else 1024),"current normal original corpus aggregate capacity exceeded")
    if getattr(args,'initialize_before_load',False):
        lab.require((args.mode,args.rate,args.seconds,args.accounts,args.per_account,args.tail_seconds,args.proof_timeout)==('online',100,5,500,1,30,30) and getattr(args,'staged_publication',False) and not getattr(args,'initialization_only',False),'selected same-window initialization then first100 profile only; no500/1000 permission')
        lab.require(all(getattr(args,key,False) is True for key in ('startup_timings','wire_observation','commit_observation','network_accounting','owned_storage_accounting')) and not getattr(args,'header_hop_capture',False),'selected original first100 observation configuration required')
    if getattr(args,'staged_publication',False):lab.require(args.mode=='online','staged cold sender pipeline requires explicit online mode')
    return demand


def process_capacity(args):
    # This is a necessary lower bound, not a guarantee that transient helpers
    # and proof readers will fit. Keep the original ownership limit unchanged.
    if getattr(args,'staged_publication',False):
        limit=lab.guard.CAPS['ownedProcesses']
        public=sender_backend_kind(args)=='public-owner';senders=1 if public else 2
        held = getattr(args, 'first_trial_profile', 'own1b') == HELD_TRIAL_PROFILE
        maximum=5+senders+3+(4 if held else 0)
        if held:
            return dict(originalOwnedPIDLimit=limit, minimumLongLivedPIDs=10,
                        maximumRuntimePIDs=maximum, originalNodeProcesses=4,
                        maximumSignSenderProcesses=1, persistentProofProcesses=4,
                        maximumSharedProofHelperProcesses=3, canFitNecessaryLowerBound=maximum<=limit)
        return dict(originalOwnedPIDLimit=limit,minimumLongLivedPIDs=6 if public else 5,maximumRuntimePIDs=maximum,originalNodeProcesses=4,maximumSignSenderProcesses=senders,maximumSharedProofHelperProcesses=3,accountCount=args.accounts,completeDemand=args.rate*args.seconds,oneWaveIndependentAccountCapacity=args.accounts,oneWaveCoversFullDemand=args.accounts>=args.rate*args.seconds,canFitNecessaryLowerBound=maximum<=limit,normalLargeOwnerInputQualified=STAGED_SOURCE_QUALIFICATION is not None,interpretation=('one normal public-owner stream with per-account original custody; cold validation remains in first command' if public else 'bounded original cold opens; process leases separate from account pending; large-account input/full normal callee qualification is a separate hard gate'))
    senders=args.accounts if args.mode=="online" else 0
    required=1+4+senders  # parent supervisor + four original nodes + per-owner CLI
    limit=lab.guard.CAPS["ownedProcesses"]
    return dict(originalOwnedPIDLimit=limit,minimumLongLivedPIDs=required,originalNodeProcesses=4,normalSenderProcesses=senders,
        accountCount=args.accounts,completeDemand=args.rate*args.seconds,canFitNecessaryLowerBound=required<=limit,
        interpretation="original one-owner persistent sender process count; transient helpers/proof callees add demand; no multiplex, auto pool reduction or adaptive offered rate")


def tool_identity():
    root=Path(__file__).resolve().parents[2]
    return dict(commit=lab.git(root,'rev-parse','HEAD'),tree=lab.git(root,'rev-parse','HEAD^{tree}'),
        driverSHA256=lab.guard.digest(Path(__file__)),resourceGuardSHA256=lab.guard.digest(Path(__file__).with_name('consensus-linux-cohort.py')))


def sender_backend_kind(args):
    selected=getattr(args,'sender_backend','auto')
    lab.require(selected in ('auto','bounded-cold','public-owner'),'explicit normal sender backend required')
    staged=getattr(args,'staged_publication',False)
    if selected=='auto':return 'bounded-cold' if staged else 'per-account'
    lab.require(staged and args.mode=='online','selected sender backend requires original staged online demand')
    if selected=='public-owner':
        lab.require(args.commit in PUBLIC_OWNER_ABI_SOURCES,'exact public owner ABI required; source qualification is separate')
        if args.commit == HELD_TRIAL_SOURCE:
            lab.require(getattr(args, 'first_trial_profile', 'own1b') == HELD_TRIAL_PROFILE
                        and getattr(args, 'initialize_before_load', False),
                        'held-session source requires its explicit first100 profile')
        if args.commit==first_trial_7c25_source.SOURCE:
            lab.require(getattr(args,'first_trial_profile','own1b')=='7c25' and getattr(args,'initialize_before_load',False),
                        'future public owner requires its separately qualified 7c25 profile')
    return selected


def prepare_live_materials_session(backend, lane, check):
    ceremony = backend.c
    name = f"load-live-session-{lane['node']}"
    path = backend.w.work / ".private" / (name + ".log")
    stream = SenderSession.__new__(SenderSession)
    stream.path = path
    stream.partial = b""
    stream.offset = 0
    launched = time.monotonic_ns()
    # Refusal ends this lane's stream. Keep its PID under the Window guard,
    # but let the original lane retirement handle that exit, not node liveness.
    stream.proc = backend.w.launch(name, [
        str(ceremony.bins / "ynx-consensus-pq-lab"), "live-materials-session",
        "--synthetic", "--policy", str(lane["policy"]), "--policy-sha256", lane["pin"],
        "--ready", "--timings",
    ], stdin_pipe=True, thread_safe=True, private_log=True)
    deadline = time.monotonic() + ceremony.proof_timeout
    # READY and requests stay in the private stream. The normal portable
    # catalog also requires the accepted original result frame for each proof.
    ready = stream.receive(None, backend.stop_event,
                           "YNX-PQ-LAB-LIVE-MATERIALS-READY/v1", deadline, check)
    received = time.monotonic_ns()
    timing = callee_snapshot(ready.get("preparationTimings"))
    transport = module("original_live_materials_transport", "pq-live-materials-transport.py")
    def receive(*, include_original=False):
        return stream.receive(None, backend.stop_event,
                              "YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1",
                              time.monotonic() + ceremony.proof_timeout,
                              include_original=include_original)
    lane["session"] = transport.Lane(stream.proc.stdin, receive, ready, policy_sha256=lane["pin"],
                                     node=lane["node"], max_operations=ceremony.operations)
    return dict(node=lane["node"], policySHA256=lane["pin"], parentLaunchMonotonicNs=launched,
                parentReadyReceivedMonotonicNs=received, parentLaunchToReadyNs=received-launched,
                calleeStartupElapsedNs=ready["startupElapsedNs"], calleePreparationTimings=timing)


def make_sender_backend(ceremony,owners,stop,kind,*,prepare_public_source=False,persistent_live=False):
    lab.require(kind == 'public-owner' or not (prepare_public_source or persistent_live),
                'prepared live transport requires the public owner backend')
    if kind=='per-account':return NormalBackend(ceremony,owners,stop)
    if kind=='bounded-cold':
        pool=module('original_bounded_sender_backend','pq-bounded-sender-backend.py')
        return pool.backend_class(NormalBackend,SenderSession,normal,lab)(ceremony,owners,stop)
    lab.require(kind=='public-owner' and ceremony.consumer_source in PUBLIC_OWNER_ABI_SOURCES,
                'exact normal public-owner source required; no backend fallback')
    transport=module('normal_public_owner_transport','pq-public-owner-transport.py')
    pool=module('normal_public_owner_backend','pq-public-owner-backend.py')
    Session=transport.session_class(SenderSession,normal,lab)
    return pool.backend_class(NormalBackend,Session,normal,lab)(
        ceremony,owners,stop,prepare_source=prepare_public_source,
        prepare_live_session=prepare_live_materials_session if persistent_live else None)


def load_conditions(args):
    # Rate increases are intentional. All other workload/observer settings
    # must remain fixed across a source's 100 -> 500 -> 1000 progression.
    # This does NOT assert equal random keys/canonical inputs across sources.
    result=dict(mode=args.mode,accounts=args.accounts,perAccountCapacity=args.per_account,
        senderBackend=sender_backend_kind(args),
        firstTrialProfile=getattr(args,'first_trial_profile','own1b'),
        seconds=args.seconds,tailSeconds=args.tail_seconds,proofTimeout=args.proof_timeout,
        **{key:bool(getattr(args,key,False)) for key in ('staged_publication','wire_observation','network_accounting','commit_observation','owned_storage_accounting','header_hop_capture','startup_timings','initialize_before_load')},
        sameHost=True,physicalFaultDomains=1,cryptoOrAuthorityChanged=False,canonicalInputPairEquality='NOT_YET_QUALIFIED')
    if getattr(args,'first_trial_profile','own1b')=='7c25':
        result['requestStageObservation']=True
    if result['firstTrialProfile'] == HELD_TRIAL_PROFILE:
        result.update(preparePublicSource=True, persistentLiveMaterials=True)
    return result


def validate_escalation(args):
    if args.rate==100:return
    lab.require(args.prior_result and args.prior_result_sha256,"higher load requires the actual preceding level's pinned original result")
    path=Path(args.prior_result);lab.require(path.resolve()==path and lab.guard.digest(path)==args.prior_result_sha256,"preceding exact result pin differs")
    prior=json.loads(path.read_bytes());r=prior["loadResult"];n=r["configuredDemand"]
    lab.require(prior.get('caps')==lab.CAPS and prior.get('toolIdentity')==tool_identity() and prior.get('loadConditions')==load_conditions(args),'preceding source tools/caps/workload conditions missing or changed; no escalation from a different measurement setup')
    lab.require(prior["source"]["commit"]==args.commit and prior["mode"]==args.mode and prior["cleanupComplete"] is True and prior["firstCause"] is None and r["firstCause"] is None and prior["normalLiveCalleeUsed"] is True,"matching actual original preceding run required")
    lab.require(r["requestedOfferedTPS"]==(100 if args.rate==500 else 500) and r["windowCompleted"] is True and r["notReleased"]==0 and r["releasedWithinWindow"]==n and r["notSubmitted"]==0 and r["lateSubmitted"]==0 and r["notQualified"]==0 and r["sourceAcceptanceOrInclusionWithinWindow"]*1000>=n*999 and r["backlogGrowing"] is False,"preceding level did not deliver full independent demand/final data without growing backlog")
    q=r["submitToQualifiedReceiptObserved"]
    lab.require(q["censored"]==0 and q["p95Ms"]<=2000 and q["p99Ms"]<=5000,"preceding observed qualified receipt latency target not achieved")


def run(args):
    demand=validate_options(args)
    backend_kind=sender_backend_kind(args) # Source/semantic/window gates below still run before any Window.
    lab.require(not getattr(args,'startup_timings',False) or args.commit in STARTUP_TIMING_ABI_SOURCES,'matching original startup timing ABI required; old source cannot inherit new flags')
    lab.require(not getattr(args,"header_hop_capture",False) or args.network_accounting,"header capture requires original owned network accounting scope")
    first_trial=getattr(args,'initialize_before_load',False)
    profile=getattr(args,'first_trial_profile','own1b')
    held = profile == HELD_TRIAL_PROFILE
    if held:
        trial_source = module('held_first100_source', 'pq-held-first100-source.py')
        lab.require((trial_source.SOURCE, trial_source.TREE) == (HELD_TRIAL_SOURCE, HELD_TRIAL_TREE),
                    'held first100 source and CI qualification differ')
        identity = lab.check_source(Path(args.source), args.commit)
        lab.require(identity['tree'] == HELD_TRIAL_TREE, 'exact held-session source tree differs')
        if not args.execute:
            return dict(status='prepared-only', source=identity, configuredDemand=demand,
                        requestedOfferedTPS=args.rate, loadConditions=load_conditions(args),
                        processCapacity=process_capacity(args), actualLoadExecuted=False)
        lab.require(os.environ.get('GITHUB_JOB') == 'first100-held-public-owner'
                    and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
                    and os.environ.get('GITHUB_RUN_ATTEMPT') == '1',
                    'held first100 requires its original scheduled controller job')
    else:
        trial_source={'own1b':first_trial_source,'d24':first_trial_d24_source,'1695':first_trial_1695_source,'7c25':first_trial_7c25_source}[profile]
    expected_source=trial_source.SOURCE if first_trial else STAGED_CALLEE_SOURCE if getattr(args,'staged_publication',False) else CALLEE_SOURCE
    lab.require(args.commit==expected_source,('exact staged normal consumer source required; c06 diagnostic qualification cannot be transferred' if getattr(args,'staged_publication',False) else 'exact c06 Commit consumer source required; old703 qualification cannot be reused'))
    trial_qualification=(trial_source.trial_qualification() if profile=='1695' else trial_source.qualification()) if first_trial else None
    if getattr(args,'staged_publication',False) and args.execute and not first_trial:
        if getattr(args,'initialization_only',False):initialization.source_functional_data()
        else:lab.require(STAGED_SOURCE_QUALIFICATION is not None and args.commit==STAGED_CALLEE_SOURCE,'normal staged large-owner callee/source/new normal CI/actual500 initialized-owner qualification NOT_SUPPLIED; no Python fallback or source monkeypatch')
    if getattr(args,"commit_observation",False):
        observed_source=trial_source.SOURCE if first_trial else STAGED_CALLEE_SOURCE if getattr(args,'staged_publication',False) else COMMIT_OBSERVATION_SOURCE
        lab.require(observed_source is not None and args.commit==observed_source,"final exact CORE Commit consumer source/normal CI/same-input equivalence NOT_SUPPLIED; old703 continuation cannot qualify it")
    source=Path(args.source);identity=lab.check_source(source,args.commit)
    live_module=module('current_normal_private_live_reader','pq-normal-live-reader.py') if profile=='7c25' or held else None
    if live_module is not None and not held:live_module.qualify(identity) # Exact source/module/tagged CI; never inherit old9081.
    if getattr(args,'staged_publication',False):lab.require(identity['tree']==(trial_source.TREE if first_trial else STAGED_CALLEE_TREE),'exact staged normal source tree differs')
    lab.git(source,"merge-base","--is-ancestor",normal.HELPER_COMMIT,args.commit)
    if args.wire_observation:lab.git(source,"merge-base","--is-ancestor",normal.WIRE_OBSERVER_COMMIT,args.commit)
    lab.require(b"live-materials" in __import__('subprocess').check_output(["git","-C",str(source),"show",args.commit+":cmd/ynx-consensus-pq-lab/main.go"]),"matching original CORE continuous materials callee NOT_SUPPLIED")
    if not args.execute:return dict(status="prepared-only",source=identity,mode=args.mode,requestedOfferedTPS=args.rate,configuredDemand=demand,accountCount=args.accounts,actualLoadExecuted=False,sameWindowInitializationRequested=first_trial,sourceFunctionalData=trial_qualification,fullFinalityCallee="original CORE live-materials policy/startup and original signer/verifier/confirm required")
    validate_escalation(args)
    lab.require(sys.platform=="linux" and os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted","original isolated hosted Linux job required")
    parent=Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    # Retain actual admission values even when the original floor refuses.
    # No Window, port, build, key or node exists in this owned case yet.
    work=Path(tempfile.mkdtemp(prefix="pq-independent-load-",dir=parent));work.chmod(0o700);(work/".private").mkdir(mode=0o700);(work/"public").mkdir(mode=0o700);(work/"public/load-operations").mkdir(mode=0o700)
    rows,_=lab.guard.proc_inventory()
    admission=dict(observedMonotonicNs=time.monotonic_ns(),availableMemoryBytes=lab.guard.memory_available(),freeDiskBytes=shutil.disk_usage(parent).free,conflictingHeavyProcesses=lab.heavy_processes(rows),caps=dict(lab.CAPS),ownedPIDLimit=lab.guard.CAPS['ownedProcesses'],scope="before original Window/port/build/key/node creation")
    lab.write_new(work/"public/fresh-resource-admission.json",admission)
    lab.admit(admission['availableMemoryBytes'],admission['freeDiskBytes'],admission['conflictingHeavyProcesses']);lab.ports_available()
    lab.require(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"original Linux subreaper required")
    roots=[]
    for root in (source,Path(__file__).resolve().parents[2]):
        if any(existing==root or existing in root.parents for existing in roots):continue
        roots=[existing for existing in roots if root not in existing.parents];roots.append(root)
    w=lab.Window(source,work,additional_storage=tuple(roots));stop=threading.Event();backend=monitor=journal=ceremony=network=storage=None
    initialization_journal=Journal(work/"public/initialization-events.jsonl")
    stages=initialization.InitializationStages(on_event=initialization_journal.emit)
    result=dict(schema="YNX-PQ-INDEPENDENT-NORMAL-RUN/v1",source=identity,caps=lab.CAPS,storageRoots=[str(p) for p in w.storage_roots],mode=args.mode,requestedOfferedTPS=args.rate,configuredDemand=demand,firstCause=None,loadExecuted=False,normalLiveCalleeUsed=False,stableFinalTPS="UNMEASURED",P95FinalConfirmation="UNMEASURED",actualHopBytesPerTx="UNMEASURED",firstSaturatedChainStage="UNMEASURED",sameHost=True,physicalFaultDomains=1,signerTransport="original per-account persistent stdin/stdout with actual DATA-ready and measured normal CLI; cold initialization retained outside offered clock, no pre-sign/reserved nonce; source703 includes other changes and is not a pure-cache A/B")
    result["toolIdentity"]=tool_identity()
    result["loadConditions"]=load_conditions(args)
    result["freshResourceAdmission"]=admission
    hardware=module('original_runtime_hardware','pq-runtime-hardware.py')
    result['runtimeHardware']=hardware.capture(work)
    lab.write_new(work/'public/runtime-hardware.json',result['runtimeHardware'])
    if first_trial:result['sameWindowInitializationSourceFunctionalData']=trial_qualification
    result["initializationOnlyRequested"]=getattr(args,"initialization_only",False)
    if result["initializationOnlyRequested"]:result["initializationSourceFunctionalData"]=initialization.source_functional_data()
    lab.write_new(work/"public/requested-load.json",dict(source=identity,mode=args.mode,rate=args.rate,seconds=args.seconds,tailSeconds=args.tail_seconds,accounts=args.accounts,perAccountCapacity=args.per_account,configuredDemand=demand,sourceGrant=False))
    try:
        result["processCapacity"]=process_capacity(args)
        lab.require(result["processCapacity"]["canFitNecessaryLowerBound"],"normal per-owner sender pool cannot fit original owned PID limit; original multiplex callee required or explicit different workload; full configured demand retained, no rate reduction")
        bins=work/".private/bin"
        if live_module is not None:
            composed=work/".private/live-matching-source"
            stages.run('prepare_normal_live_source',None,lambda:w.wait(w.launch('prepare-normal-live-source',
                [sys.executable,'-I','-B',str(Path(__file__).with_name('pq-normal-live-reader.py')),
                 '--prepare-source',str(source),'--destination',str(composed),
                 *(['--held-source-only'] if held else [])])))
            composition=json.loads((work/'public/prepare-normal-live-source.log').read_bytes())
            lab.require(composition['source']==identity and composition['buildSource']==str(composed/'source')
                        and composition['originalSourceUnchanged'] is True,'exact current normal live source composition differs')
            selection=composition['originalCoreSelection'];raw_selection=lab.guard.bounded(Path(selection['receiptPath']),64<<10)
            lab.require(hashlib.sha256(raw_selection).hexdigest()==selection['receiptSHA256']
                        and len(raw_selection)==selection['receiptBytes'],'original live source selection pin differs')
            with (work/'public/normal-live-source-selection.json').open('xb') as output:output.write(raw_selection)
            dependencies=composition['originalNativeSourceDependencies']
            raw_dependencies=lab.guard.bounded(Path(dependencies['receiptPath']),64<<10)
            lab.require(len(raw_dependencies)==dependencies['receiptBytes']
                        and hashlib.sha256(raw_dependencies).hexdigest()==dependencies['receiptSHA256']
                        and json.loads(raw_dependencies)==dependencies['sourceDependencies'],
                        'original native supporting source receipt differs')
            with (work/'public/normal-live-source-dependencies.json').open('xb') as output:output.write(raw_dependencies)
            result['normalLiveSourceDependencies']=dependencies
            result['normalLiveBuildSource']=composition
            w.source=composed/'source'
        for name in ("ynx-consensus-pq-lab","ynx-comet","ynx-consensus-proof-verify"):
            stages.run("build",name,lambda name=name:w.wait(w.launch("build-"+name,["go","build","-mod=readonly","-p","1",*(["-trimpath","-buildvcs=false"] if live_module is not None else []),*(["-tags",live_module.BUILD_TAG] if live_module is not None and name=="ynx-comet" else []),"-o",str(bins/name),"./cmd/"+name])))
        result["binaries"]={n:lab.guard.digest(bins/n) for n in ("ynx-consensus-pq-lab","ynx-comet","ynx-consensus-proof-verify")}
        if live_module is not None:
            result['normalLiveBuildProvenance']={}
            for name,pin in result['binaries'].items():
                w.wait(w.launch('buildinfo-'+name,['go','version','-m',str(bins/name)]))
                info=work/'public'/('buildinfo-'+name+'.log');build=next(row for row in w.children if row['name']=='build-'+name)
                result['normalLiveBuildProvenance'][name]=dict(binarySHA256=pin,buildArgv=build['command'],buildCwd=str(w.source),
                    sourceSelectionSHA256=selection['receiptSHA256'],sourceDependenciesReceiptSHA256=dependencies['receiptSHA256'],buildInfoFile=info.name,buildInfoSHA256=lab.guard.digest(info),
                    originalSource=identity,selectedOptionalForkTree=composition['optionalForkTree'])
        root=work/".private/network"
        def create_original():
            p=w.launch("create-original",[str(bins/"ynx-consensus-pq-lab"),"create","--synthetic","--root",str(root),"--transactions",str(args.per_account),"--batch-size","1","--owners",str(args.accounts+4),*(["--online"] if args.mode=="online" else []),"--base-p2p-port","31656","--base-rpc-port","31757"])
            w.wait(p)
        stages.run("create_original","all-configured-owners",create_original)
        created=json.loads((work/"public/create-original.log").read_bytes())
        staged=getattr(args,'staged_publication',False)
        ceremony=initialization.instrumented_ceremony_class(LoadCeremony)(w,root,created,bins,args.wire_observation,initialization_stages=stages,expected_owners=args.accounts+4,operations=demand,proof_timeout=args.proof_timeout,commit_observation=getattr(args,"commit_observation",False),sender_pool=staged,consumer_source=args.commit,startup_timings=getattr(args,'startup_timings',False))
        ceremony.sender_arguments=STAGED_SENDER_ARGUMENTS if staged else ()
        # This assignment is reached only after the matching source CI AND
        # per-height semantic evidence have passed the selected source gate.
        ceremony.request_stage_observation=profile=='7c25'
        ceremony.finalize_observation_enabled=held
        if live_module is not None:
            attach_live_reader(ceremony,live_module)
            result['normalPrivateLiveReaderRequested']=True
        if staged:
            result['coldBootstrapReadinessBudget']=initialization.cold_readiness_budget(w)
            ceremony.initial_quiet_timeout=result['coldBootstrapReadinessBudget']['grantedColdPhaseSeconds']
            # The independently reopened PQ nodes are a second cold start.
            # quiet() re-clamps this request to the same remaining885s active
            # budget; all steady-state quiet/POST/finality defaults stay60s.
            ceremony.activation_quiet_timeout=result['coldBootstrapReadinessBudget']['requestedColdPhaseSeconds']
        owners=[dict(ownerIndex=o["index"],address=o["owner"],nextNonce=int(o["initialNonce"])+1,capacity=int(o["memberCapacity"])) for o in ceremony.workload["owners"][4:]]
        lab.require(ceremony.workload["batchSize"]=="1" and ceremony.workload["outstandingPerOwner"]=="1" and ceremony.workload["batchWaitNanoseconds"]=="0","original independent single transfers and one pending required")
        plan=scheduler.make_plan(ceremony.pin,ceremony.workload_pin,args.mode,owners,args.rate,args.seconds*1_000_000_000,args.tail_seconds*1_000_000_000)
        staged_scheduler=module('original_staged_pipeline','pq-staged-independent-scheduler.py') if staged else None
        if staged:plan=staged_scheduler.configure(plan)
        lab.write_new(work/"public/load-plan.json",plan);result["planSHA256"]=lab.guard.digest(work/"public/load-plan.json")
        result["activation"]=ceremony.prepare_network();result["preparationUnconfirmedOwners"]=sorted(ceremony.pending_owners);result["livePolicies"]=[dict(node=l["node"],policy=str(l["policy"]),sha256=l["pin"]) for l in ceremony.live]
        if staged:
            checkpoint=ceremony.quiet()
            result['initializedAccountReadback']=stages.run('complete_account_readback','all-four-nodes',lambda:initialization.complete_account_readback(ceremony.plan['nodes'],ceremony.workload['owners'][4:],checkpoint,ceremony.root,check=w.sample))
            lab.write_new(work/'public/initialized-account-readback.json',result['initializedAccountReadback'])
        result["normalLiveCalleeUsed"]=True
        if getattr(args,'initialization_only',False):
            stages.seal()
            result['initializationOnlyComplete']=True
            result['initializationScope']='normal create504, four-node bootstrap/activation/live policies, full500 original account census; original reserved preparation traffic only; no business load release, signing, POST, or finality claim'
            return result # Existing finally performs the same bounded stop and preserves all originals.
        backend=make_sender_backend(ceremony,owners,stop,backend_kind,
                                    prepare_public_source=True,persistent_live=True) if held else make_sender_backend(ceremony,owners,stop,backend_kind)
        if backend_kind=='bounded-cold':
            result['signerTransport']='original cold per-operation DATA-ready/sign/EOF; same original owner/operation reopen for normal full proof Confirm; no automatic retry'
        elif backend_kind=='public-owner':
            result['signerTransport']='original sender-owners public scope; one serialized Go stream, separate original owner custody/nonce/UNKNOWN; first command retains measured cold validation; no automatic retry'
        if held:
            result['signerTransport'] = 'prepared original sender-owners with per-command current checkpoint validation'
        journal=Journal(work/"public/load-events.jsonl")
        monitor=Monitor(w,stop);monitor.thread.start()
        result["senderPoolPreparation"]=stages.run("sender_pool_preparation",None,lambda:backend.prepare(monitor.check))
        if getattr(args,"owned_storage_accounting",False):
            store_module=module("original_pq_store_window","pq-owned-storage-window.py")
            storage=store_module.OwnedStorageWindow(ceremony)
            lab.write_new(work/"public/owned-storage-before.json",storage.capture("before"));monitor.check()
        if args.network_accounting:
            hook=module("original_pq_network_window","pq-network-window.py")
            network=create_network_window(hook,ceremony,args,lab.git(Path(__file__).resolve().parents[2],"rev-parse","HEAD"),result["planSHA256"],demand)
            network.capture("start");monitor.check()
        if first_trial:
            monitor.check()
            result['preloadInitialization']=stages.run('preload_initialization_gate','first100-before-release',lambda:preload_initialization.validate(result.get('initializedAccountReadback'),w.process_receipt(),result['preparationUnconfirmedOwners'],w.started+lab.CAPS['totalSeconds']-lab.CAPS['cleanupSeconds']-time.monotonic(),args.seconds,args.tail_seconds))
            lab.write_new(work/'public/preload-initialization.json',result['preloadInitialization'])
        stages.seal()
        if getattr(args, 'held_ready_only', False):
            pool = result['senderPoolPreparation']
            lab.require(pool['bootstrapLoaded'] is True and pool['signed'] is False
                        and pool['nonceReserved'] is False and pool['loadClockStarted'] is False
                        and [lane['node'] for lane in pool['liveMaterialsPreparation']] == list(range(4)),
                        'all four original proof sessions must be READY before the no-release boundary')
            monitor.check()
            result['heldReadyOnlyComplete'] = True
            return result
        result["loadExecuted"]=True
        result["loadResult"]=(staged_scheduler.run(plan,backend,journal.emit,monitor.check,stop,ledger_module=scheduler) if staged else scheduler.run(plan,backend,journal.emit,monitor.check,stop))
        monitor.check();lab.check_source(source,args.commit)
        result["firstCause"]=result["loadResult"]["firstCause"]
    except BaseException as error:result["firstCause"]=str(error)
    finally:
        stop.set()
        if backend is not None:
            backend.stop()
            if getattr(backend, "pool_ready", None) is not None:
                # A later lane can fail before the whole pool returns. Keep
                # the successful earlier READY frames and their elapsed times.
                result.setdefault("senderPoolPreparation", backend.pool_ready)
            result["normalHelperLifecycle"]=dict(maxConcurrent=backend.helper_limit,cleanupDebt=backend.helper_cleanup_debt,parentTiming=backend.helper_timing_report())
            result['normalObservationRPCTiming']=backend.rpc_measurements.report()
            if hasattr(backend,'cold_sender_report'):result['boundedColdSenderLifecycle']=backend.cold_sender_report()
            if hasattr(backend,'public_owner_report'):result['normalPublicOwnerTransport']=backend.public_owner_report()
        stages.seal();result['initializationStages']=stages.report()
        try:
            initialization_journal.close()
            result['initializationJournalSegments']=[dict(path=str(p.relative_to(work/'public')),bytes=p.stat().st_size,sha256=lab.guard.digest(p)) for p in initialization_journal.paths]
        except BaseException as error:
            result['initializationJournalError']=dict(errorType=type(error).__name__)
            result['firstCause']=result['firstCause'] or 'original initialization journal close/pin failed'

        result["networkAccountingRequested"]=args.network_accounting
        if network is not None and network.start is not None:
            try:
                result["networkAccounting"]=finish_network_accounting(network,result)
                if live_module is not None:
                    result['liveNetworkReads']=ceremony.live_reader.evidence
                    result['networkBaseline']=normal.network_baseline_result(network,result['networkAccounting'],ceremony.live_reader,work/'public')
                    lab.require(result['networkBaseline']['status']=='OBSERVED','actual current normal private wire/TCP reads incomplete; retain UNKNOWN')
                if monitor is not None:monitor.check()
            except Exception as error:
                result["networkAccounting"]=dict(status="UNKNOWN",reason="original network checkpoint or accounting failed",errorType=type(error).__name__,physicalBytesMeasured=False,gainsQualified=False)
                result["firstCause"]=result["firstCause"] or "original network checkpoint or accounting artifact failed"
        if monitor is not None:
            monitor.close()
            result["resourceObserverRetired"]=not monitor.thread.is_alive()
            if monitor.thread.is_alive():result["firstCause"]=result["firstCause"] or "original resource observer did not retire within bounded cleanup"
        if journal is not None:
            journal.close();result["journalSegments"]=[dict(path=str(p.relative_to(work/"public")),bytes=p.stat().st_size,sha256=lab.guard.digest(p)) for p in journal.paths]
        try:result["cleanupComplete"]=w.stop()
        except BaseException as error:result["cleanupComplete"]=False;result["cleanupError"]=str(error);result["directOwnedCleanupAfterFailure"]=getattr(w,"direct_cleanup_after_failure",[])
        if ceremony is not None and ceremony.commit_observation_enabled:
            try:
                observed=commit_readback.retain_after_stop(w,ceremony.commit_observation_descriptors,ceremony.plan["chainId"],ceremony.plan["originalGenesisHash"])
                result["normalCommitObservation"]=observed
                if not observed["fourOriginalSnapshotsValid"]:result["firstCause"]=result["firstCause"] or "original normal Commit observations incomplete/invalid; preserve missing/overflow and first cause"
                measured=sum(lab.private_bytes(root) for root in w.storage_roots);w.peak_bytes=max(w.peak_bytes,measured)
                observed["postStopStorageBytes"]=measured
                lab.require(measured<=lab.CAPS["newBytes"],"original Commit public readback exceeded unchanged8GiB storage cap")
            except BaseException as error:
                result["commitObservationReadbackError"]=dict(errorType=type(error).__name__,reason=str(error),missingStagesAreUnknown=True)
                result["firstCause"]=result["firstCause"] or "original normal Commit readback failed"
        if ceremony is not None and ceremony.finalize_observation_enabled:
            finalize = module('original_finalize_observation', 'pq-finalize-observation.py')
            observed_finalize = finalize.retain_after_stop(w, ceremony.finalize_observation_descriptors,
                                                          ceremony.plan["chainId"], ceremony.plan["originalGenesisHash"],
                                                          proof_readback)
            result['normalFinalizeObservation'] = observed_finalize
            if not observed_finalize['fourComplete']:
                result['firstCause'] = result['firstCause'] or 'original Finalize observation incomplete; preserve original failure and coverage'
        if storage is not None:
            try:
                observed=storage.finish(result.get("normalCommitObservation"))
                lab.write_new(work/"public/owned-storage-accounting.json",observed);result["ownedStorageAccounting"]=observed
                measured=sum(lab.private_bytes(root) for root in w.storage_roots);w.peak_bytes=max(w.peak_bytes,measured)
                lab.require(measured<=lab.CAPS["newBytes"],"original store metadata exceeded unchanged8GiB storage cap")
            except Exception as error:
                result["ownedStorageAccounting"]=dict(status="UNKNOWN",reason=str(error),actualLoadWindowCommitCount=None)
                result["firstCause"]=result["firstCause"] or "original store accounting failed"
        result["resourceGuardStageElapsed"]=w.sample_stage_report()
        result["peakRSSSample"] = getattr(w, "peak_rss_sample", None)
        result.update(elapsedSeconds=time.monotonic()-w.started,peakRSSBytes=w.peak_rss,peakNewBytes=w.peak_bytes,resourceSamples=w.samples,processes=w.process_receipt(),retiredSamplingEvidence=w.retired_samples,resourceObserverVersion=lab.RSS_OBSERVER_VERSION,processEvidenceVersion=lab.PROCESS_EVIDENCE_VERSION,rssSamplingFallbackEvidence=w.rss_fallback_samples)
        if ceremony is not None:
            result["wireObservation"]=ceremony.wire_readback()
            if callable(getattr(ceremony,'readiness_report',None)):result['originalReadinessObservations']=ceremony.readiness_report()
            result["normalCalleeMeasurements"]=ceremony.measurements.report()
            result["preparationSenderMeasurements"]=copy.deepcopy(getattr(ceremony,"preparation_sender_measurements",[]))
            result['preparationStartupMeasurements']=dict(requested=getattr(ceremony,'startup_timings_enabled',False),expectedRegistrationReplies=4,expectedActivationReplies=1,records=copy.deepcopy(getattr(ceremony,'preparation_startup_measurements',[])),intervalsOverlap=True,sourceGrant=False)
            result['failedCalleeMeasurements']=dict(attempted=getattr(ceremony,'failed_callee_attempts',0),retained=len(getattr(ceremony,'failed_callee_measurements',[])),recordLimit=64,records=copy.deepcopy(getattr(ceremony,'failed_callee_measurements',[])),successfulReplyCoverageUnchanged=True,authorityGranted=False)
        if "loadResult" not in result:
            result["preparationOnlyDemandAccounting"]=dict(configuredDemand=demand,notReleased=demand,notSubmitted=demand,notQualified=demand,meaning="normal preparation never opened the requested load window; no achieved offered rate or business TPS")
        if getattr(args,'staged_publication',False):normal.apply_normal_clean_exit(result)
        if getattr(args,'initialization_only',False):
            try:result['initializationDataValidation']=initialization.require_complete_initialization(result)
            except BaseException as error:
                result['initializationDataValidation']=dict(completeNormalInitializationObserved=False,reason=str(error),pressureAuthorized=False)
                result['firstCause']=result['firstCause'] or str(error)
        result['loadCompletionDiagnostics']=completion_diagnostics(result)
        lab.write_new(work/"public/receipt.json",result);print(json.dumps(dict(publicArtifacts=str(work/"public"),firstCause=result["firstCause"],loadExecuted=result["loadExecuted"])))
    return result


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--source",required=True);p.add_argument("--commit",required=True);p.add_argument("--mode",choices=("online","pre-signed"),required=True)
    p.add_argument("--rate",type=int,choices=(100,500,1000),default=100);p.add_argument("--seconds",type=int,required=True);p.add_argument("--tail-seconds",type=int,default=30);p.add_argument("--accounts",type=int,required=True);p.add_argument("--per-account",type=int,required=True);p.add_argument("--proof-timeout",type=int,default=30);p.add_argument("--wire-observation",action="store_true");p.add_argument("--prior-result");p.add_argument("--prior-result-sha256");p.add_argument("--execute",action="store_true")
    p.add_argument("--commit-observation",action="store_true",help="explicit final qualified normal Commit consumer only; no signer fsync/finality or whole replay claim")
    p.add_argument("--header-hop-capture",action="store_true",help="explicit owned controlled-netns exact-tuple IPv4 header-only capture; no physical-wire claim or permission escalation")
    p.add_argument("--network-accounting",action="store_true",help="explicit frozen LINK owned TCP pre-load/post-drain checkpoints; absent live metrics remain unmeasured")
    p.add_argument("--owned-storage-accounting",action="store_true",help="metadata-only exact original lab blockstore/stateDB/application paths; allocation is not disk writes or per-transaction bytes")
    p.add_argument('--initialization-only',action='store_true',help='exact staged500+4 normal functional initialization and cleanup only; no business load; separate from pressure qualification')
    p.add_argument('--staged-publication',action='store_true',help='separate bounded normal sign/POST, inclusion and original final-proof lanes; exact qualified large-owner normal callee required; not a new pressure authorization')
    p.add_argument('--sender-backend',choices=('auto','bounded-cold','public-owner'),default='auto',help='explicit normal sender transport; public-owner requires exact1695 ABI plus separate source/semantic/window qualification; no automatic fallback')
    p.add_argument('--startup-timings',action='store_true',help='matching original source ABI only: registration/activation and node startup wall stages; separate source CI and runtime window gates still required')
    p.add_argument('--initialize-before-load',action='store_true',help='Root-selected separate1b first100 profile: complete original504 initialization/census/bootstrap0 and livePQ gate in same window before release; no500/1000 or actual window grant')
    p.add_argument('--first-trial-profile',choices=('own1b','d24','1695','7c25',HELD_TRIAL_PROFILE),default='own1b',help='explicit fixed source selection for same-window first100 only; each source keeps its independent CI/semantic gates; no pressure grant')
    def interrupted(signum,frame):raise RuntimeError("normal independent load received signal "+str(signum))
    signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGTERM,interrupted)
    args=p.parse_args();result=run(args);print(json.dumps(result))
    if args.execute and args.initialization_only:lab.require(result["firstCause"] is None and result["cleanupComplete"] is True and result.get("initializationOnlyComplete") is True and result.get("loadExecuted") is False,"full500 normal initialization incomplete; preserve first cause and original inputs")
    elif args.execute:lab.require(result["firstCause"] is None and result["cleanupComplete"] and result.get("loadResult",{}).get("windowCompleted") is True and result["loadResult"]["notQualified"]==0,"original finite load incomplete or unresolved; retain full demand and originals, do not escalate")
