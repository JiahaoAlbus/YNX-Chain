"""Open-loop demand and account accounting. No signing, RPC or proof verifier.

Normal backend implementations own those operations. A backend cannot release an
account without a successful original qualified receipt; UNKNOWN is never replayed.
Control tests of this module are not chain measurements.
"""
import collections
import concurrent.futures
import hashlib
import json
import math
import queue
import threading
import time

SCHEMA="YNX-PQ-INDEPENDENT-LOAD-PLAN/v1"
MAX_DEMAND=10000


class KnownFailure(Exception):
    """A normal identity-bound rejection, never an uncertain external effect."""


class ArrivalClock:
    """The original declared-cohort design: time releases do not wait for IO."""
    def __init__(self,plan,origin,stop):
        self.plan,self.origin,self.stop=plan,origin,stop;self.offsets=[None]*len(plan["rows"])
        self.thread=threading.Thread(target=self.loop,name="independent-original-arrivals",daemon=True)
    def loop(self):
        for row in self.plan["rows"]:
            due=self.origin+row["logicalArrivalOffsetNs"]
            while not self.stop.is_set():
                remaining=due-time.monotonic_ns()
                if remaining<=0:break
                self.stop.wait(remaining/1e9)
            if self.stop.is_set():return
            self.offsets[row["index"]]=time.monotonic_ns()-self.origin


def require(value,message):
    if not value:raise ValueError(message)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def make_plan(network_pin,workload_pin,mode,owners,rate,window_ns,tail_ns):
    require(mode in ("online","pre-signed"),"separate original signing mode required")
    require(type(rate) is int and rate in (100,500,1000),"explicit original load level required")
    require(type(window_ns) is int and 0<window_ns<=60_000_000_000 and rate*window_ns%1_000_000_000==0,"complete integer fixed-window demand required")
    require(type(tail_ns) is int and 0<tail_ns<=120_000_000_000,"bounded explicit drain tail required")
    count=rate*window_ns//1_000_000_000
    require(0<count<=MAX_DEMAND,"normal original operation capacity exceeded")
    require(owners and len({o["ownerIndex"] for o in owners})==len(owners) and len({o["address"] for o in owners})==len(owners),"distinct original account pool required")
    for owner in owners:
        require(type(owner["ownerIndex"]) is int and owner["ownerIndex"]>=4 and type(owner["nextNonce"]) is int and 0<owner["nextNonce"]<1<<64 and type(owner["capacity"]) is int and owner["capacity"]>0 and owner["nextNonce"]+owner["capacity"]<=1<<64,"bounded original account state required")
    require(sum(o["capacity"] for o in owners)>=count,"original total account capacity cannot cover full demand")
    for pin in (network_pin,workload_pin):require(len(pin)==64 and all(c in "0123456789abcdef" for c in pin),"original input SHA256 pin required")
    identity=[SCHEMA,network_pin,workload_pin,mode,rate,window_ns]
    rows=[dict(index=i,id=sha(json.dumps(identity+[i],separators=(",",":")).encode()),logicalArrivalOffsetNs=i*1_000_000_000//rate) for i in range(count)]
    return dict(schema=SCHEMA,networkPlanSHA256=network_pin,workloadSHA256=workload_pin,mode=mode,requestedOfferedTPS=rate,windowNs=window_ns,tailNs=tail_ns,configuredDemand=count,accounts=[dict(o) for o in owners],rows=rows,
                businessType="pq_transfer",membersPerRequest=1,outstandingPerAccount=1,workerLimit=len(owners),clock="parent monotonic since fixed start; original logical arrival, actual release and receipt times retained",automaticRateAdaptation=False)


class Ledger:
    def __init__(self,plan,emit):
        self.plan=plan;self.emit=emit;self.rows=[dict(r,status="not_released",activeStage="not_released",stageTimes=[],ownerIndex=None,operationId=None,nonce=None,releasedNs=None,claimedNs=None,signedNs=None,submittedNs=None,ackNs=None,includedNs=None,finalNs=None,hash=None,nativeHash=None,error=None) for r in plan["rows"]]
        self.accounts={o["ownerIndex"]:dict(o,pending=None,quarantined=False,used=0) for o in plan["accounts"]}
        self.free=collections.deque(self.accounts);self.waiting=collections.deque();self.next_release=0;self.hashes=set();self.samples=[];self.last_sample=-1
        self.terminal_count=0

    def release(self,now):
        while self.next_release<len(self.rows) and self.rows[self.next_release]["logicalArrivalOffsetNs"]<=now:
            row=self.rows[self.next_release];self.next_release+=1
            row.update(status="queued",activeStage="account_queue",releasedNs=now)
            self.emit(dict(kind="logical_release",id=row["id"],index=row["index"],atNs=now,dueNs=row["logicalArrivalOffsetNs"]))
            self.waiting.append(row["index"])

    def release_clock(self,clock):
        while self.next_release<len(self.rows) and clock.offsets[self.next_release] is not None:
            row=self.rows[self.next_release];at=clock.offsets[self.next_release];self.next_release+=1
            row.update(status="queued",activeStage="account_queue",releasedNs=at)
            self.emit(dict(kind="logical_release",id=row["id"],index=row["index"],atNs=at,dueNs=row["logicalArrivalOffsetNs"]))
            self.waiting.append(row["index"])

    def reserve(self,now):
        while self.free and self.waiting:
            owner=self.free.popleft();account=self.accounts[owner]
            require(account["pending"] is None and not account["quarantined"],"account pending invariant failed")
            if account["used"]>=account["capacity"]:continue
            index=self.waiting.popleft();row=self.rows[index]
            operation=sha(json.dumps([self.plan["networkPlanSHA256"],row["id"],owner,str(account["nextNonce"])],separators=(",",":")).encode())
            # Claim is durable BEFORE invoking any normal signer or transport.
            account["pending"]=index;account["used"]+=1
            row.update(status="reserved",activeStage="worker_queue",ownerIndex=owner,nonce=account["nextNonce"],operationId=operation,claimedNs=now,stageTimes=[["worker_queue",now]])
            self.emit(dict(kind="account_claim",id=row["id"],index=index,ownerIndex=owner,nonce=str(row["nonce"]),operationId=operation,atNs=now))
            return row,dict(account)
        return None

    def event(self,event):
        index=event["index"];require(type(index) is int and 0<=index<len(self.rows),"original demand index required")
        row=self.rows[index];require(row["ownerIndex"] in self.accounts,"unclaimed demand cannot have an outcome")
        account=self.accounts[row["ownerIndex"]]
        require(account["pending"]==index and event["id"]==row["id"],"original account/operation event differs")
        stage=event["kind"];at=event["atNs"]
        require(type(at) is int and at>=row["releasedNs"],"parent monotonic event required")
        if stage=="normal_stage":
            name=event["stage"]
            require(name in ("checkpoint","signer","presigned","durable_original","post","inclusion","proof_queue","live_publish","live_capture","live_read","verifier","confirm","receipt") and row["status"] not in ("qualified","failed","unknown"),"normal stage point differs")
            require(not row["stageTimes"] or at>=row["stageTimes"][-1][1],"normal stage clock regressed")
            row["activeStage"]=name;row["stageTimes"].append([name,at])
        elif stage=="signed":
            require(row["status"]=="reserved" and event["hash"] not in self.hashes,"duplicate original or repeated signing event")
            for key in ("hash","nativeHash"):require(type(event[key]) is str and len(event[key])==64 and all(c in "0123456789abcdef" for c in event[key]),"original raw SHA256 identity required")
            self.hashes.add(event["hash"]);row.update(status="signed",signedNs=at,hash=event["hash"],nativeHash=event["nativeHash"])
        elif stage=="submitted":
            require(row["status"]=="signed" and at>=row["signedNs"],"one original submission required")
            row.update(status="submitted",submittedNs=at)
        elif stage=="ack":
            require(row["status"]=="submitted" and at>=row["submittedNs"],"original ACK order differs")
            row["ackNs"]=at
        elif stage=="included":
            require(row["status"]=="submitted" and at>=row["submittedNs"],"original inclusion order differs")
            row.update(status="included",includedNs=at)
        elif stage=="qualified":
            require(row["status"]=="included" and at>=row["includedNs"] and event["hash"]==row["hash"] and event["nativeHash"]==row["nativeHash"] and event["normalVerifierCode"]=="VERIFIED_TRANSACTION_DATA" and event["executionSuccessful"] is True and event["executionCode"]=="0" and event["transactionType"]=="pq_transfer" and event["members"]==1 and event["nativeGrant"] is False,"normal complete successful same-identity proof required")
            require(self.plan["mode"]!="online" or event.get("normalConfirmCode")=="PROOF_CONFIRMED_DATA","normal original pending confirmation required")
            row.update(status="qualified",activeStage="qualified",finalNs=at,terminalNs=at,proofReference=event["proofReference"])
            account.update(pending=None,nextNonce=row["nonce"]+1)
            if account["used"]<account["capacity"]:self.free.append(account["ownerIndex"])
        elif stage in ("failed","unknown"):
            require(row["status"] not in ("qualified","failed","unknown"),"terminal original cannot be replayed")
            row.update(status=stage,activeStage=stage,error=event["error"],terminalNs=at);account["quarantined"]=True
            # pending deliberately remains bound even after a known rejection.
        else:raise ValueError("unsupported original scheduler event")
        if stage in ("qualified","failed","unknown"):self.terminal_count+=1
        self.emit(event)

    def sample(self,now):
        bucket=now//1_000_000_000
        if bucket==self.last_sample:return
        self.last_sample=bucket
        qualified=sum(r["status"]=="qualified" for r in self.rows)
        self.samples.append(dict(atNs=now,logicalReleased=self.next_release,queued=len(self.waiting),pending=sum(a["pending"] is not None for a in self.accounts.values()),qualified=qualified,unconfirmedReleased=self.next_release-qualified,stageCounts=dict(collections.Counter(r["activeStage"] for r in self.rows))))

    def report(self,cutoff,first_cause=None):
        window=self.plan["windowNs"];n=len(self.rows);counts=collections.Counter(r["status"] for r in self.rows)
        submitted=[r for r in self.rows if r["submittedNs"] is not None];final=[r for r in self.rows if r["finalNs"] is not None]
        def quantiles(start,end):
            values=sorted(r[end]-r[start] for r in self.rows if r[start] is not None and r[end] is not None)
            return dict(denominator=n,observed=len(values),censored=n-len(values),**{f"p{p}Ms":values[(n*p+99)//100-1]/1e6 if len(values)>=(n*p+99)//100 else None for p in (50,95,99)})
        inside=[r for r in final if r["finalNs"]<window]
        releases_inside=sum(r["releasedNs"] is not None and r["releasedNs"]<window for r in self.rows)
        submissions_inside=sum(r["submittedNs"]<window for r in submitted)
        backlog_samples=[s for s in self.samples if s["atNs"]<window]
        # Descriptive only: never assert no growth from too few observations.
        growth=None if len(backlog_samples)<3 else backlog_samples[-1]["unconfirmedReleased"]>backlog_samples[len(backlog_samples)//2]["unconfirmedReleased"]
        evidenced_inside=sum((r["ackNs"] is not None and r["ackNs"]<window) or (r["includedNs"] is not None and r["includedNs"]<window) for r in self.rows)
        operational=sorted((r for r in self.rows if r["error"] is not None),key=lambda r:r["terminalNs"])
        stages=collections.defaultdict(list)
        for row in self.rows:
            completed=[]
            points=row["stageTimes"]
            for i,(name,at) in enumerate(points):
                end=points[i+1][1] if i+1<len(points) else row["finalNs"]
                if end is not None:
                    duration=end-at;completed.append(dict(stage=name,durationNs=duration))
                    stages[name].append(duration)
            row["completedStageDurations"]=completed
        stage_summary={name:dict(denominator=n,completed=len(values),censoredOrNotReached=n-len(values),totalNs=sum(values),maxNs=max(values),interpretation="parent-observed normal callee interval, including its IO and scheduling; unresolved last interval excluded") for name,values in stages.items()}
        return dict(schema="YNX-PQ-INDEPENDENT-LOAD-RESULT/v1",mode=self.plan["mode"],requestedOfferedTPS=self.plan["requestedOfferedTPS"],configuredDemand=n,windowNs=window,observationCutoffNs=cutoff,windowCompleted=cutoff>=window,
            logicalReleased=self.next_release,releasedWithinWindow=releases_inside,notReleased=n-self.next_release,submitted=len(submitted),submittedWithinWindow=submissions_inside,lateSubmitted=len(submitted)-submissions_inside,notSubmitted=n-len(submitted),
            qualified=len(final),qualifiedWithinWindow=len(inside),qualifiedInTail=len(final)-len(inside),notQualified=n-len(final),terminalCounts=dict(counts),actualSubmissionAttemptTPS=submissions_inside*1e9/window,sourceAcceptanceOrInclusionWithinWindow=evidenced_inside,actualSourceEvidencedTPS=evidenced_inside*1e9/window,actualQualifiedWindowTPS=len(inside)*1e9/window,
            endToEndLogicalArrivalToQualified=quantiles("logicalArrivalOffsetNs","finalNs"),submitToInclusionObserved=quantiles("submittedNs","includedNs"),submitToQualifiedReceiptObserved=quantiles("submittedNs","finalNs"),
            releaseToAccountClaim=quantiles("releasedNs","claimedNs"),completedStageIntervals=stage_summary,
            releaseLagMs=[None if r["releasedNs"] is None else (r["releasedNs"]-r["logicalArrivalOffsetNs"])/1e6 for r in self.rows],queueSamples=self.samples,backlogGrowing=growth,
            accountState=[dict(a) for a in self.accounts.values()],accountStateMeaning="pending is the retained controller reservation; normal CORE journal remains authoritative for actual native pending state",rows=self.rows,firstCause=first_cause,firstOperationalFailure=None if not operational else dict(index=operational[0]["index"],id=operational[0]["id"],atNs=operational[0]["terminalNs"],error=operational[0]["error"]),stableFinalTPS="UNMEASURED",P95FinalConfirmation="UNMEASURED",physicalCommitMeasured=False,
            interpretation="finite independently scheduled single-transfer cohort; submitted denotes one attempted HTTP POST, source acceptance/inclusion evidence is separate; missing demand and censored full-cohort quantiles retained, not survivor-only percentiles; observed receipt bounds include original proof-consumer overhead; no sustained qualification")


def run(plan,backend,emit,check_resources,stop,origin=None):
    """The clock/controller never waits for an account's blocking normal callee.

    backend.perform(row, account, notify, stop) uses original normal operations.
    All mutable demand/account accounting remains on this controller thread.
    """
    ledger=Ledger(plan,emit);events=queue.Queue(maxsize=max(256,len(plan["rows"])*32));futures={};failure=None
    origin=time.monotonic_ns() if origin is None else origin
    deadline=origin+plan["windowNs"]+plan["tailNs"]
    pool=concurrent.futures.ThreadPoolExecutor(max_workers=plan["workerLimit"],thread_name_prefix="original-pq-account")
    clock=ArrivalClock(plan,origin,stop)
    def notify(index,identity,payload):
        events.put(dict(payload,index=index,id=identity,atNs=time.monotonic_ns()-origin))
    def perform(row,account):
        try:backend.perform(dict(row),account,lambda event:notify(row["index"],row["id"],event),stop)
        except Exception as error:
            notify(row["index"],row["id"],dict(kind="failed" if isinstance(error,KnownFailure) else "unknown",error=str(error)))
    try:
        clock.thread.start()
        while time.monotonic_ns()<deadline and not stop.is_set():
            now=time.monotonic_ns()-origin
            ledger.release_clock(clock)
            while True:
                try:ledger.event(events.get_nowait())
                except queue.Empty:break
            check_resources()
            while True:
                reserved=ledger.reserve(time.monotonic_ns()-origin)
                if reserved is None:break
                row,account=reserved;futures[row["index"]]=pool.submit(perform,row,account)
            ledger.sample(time.monotonic_ns()-origin)
            if now>=plan["windowNs"] and ledger.next_release==len(ledger.rows) and ledger.terminal_count==len(ledger.rows):break
            stop.wait(.001)
    except BaseException as error:failure=str(error)
    finally:
        stop.set()
        if clock.thread.ident is not None:clock.thread.join(timeout=1)
        if clock.thread.is_alive():failure=failure or "independent original arrival clock did not retire"
        try:ledger.release_clock(clock)
        except BaseException as error:failure=failure or str(error)
        try:backend.stop()
        except BaseException as error:failure=failure or str(error)
        _,unfinished=concurrent.futures.wait(list(futures.values()),timeout=10)
        if unfinished:failure=failure or "normal backend workers did not retire within bounded cleanup"
        pool.shutdown(wait=False,cancel_futures=True)
        while True:
            try:ledger.event(events.get_nowait())
            except queue.Empty:break
            except Exception as error:failure=failure or str(error)
        for row in ledger.rows:
            if row["ownerIndex"] is not None and row["status"] not in ("qualified","failed","unknown"):
                ledger.event(dict(kind="unknown",id=row["id"],index=row["index"],atNs=time.monotonic_ns()-origin,error="original operation incomplete at bounded cutoff; preserve state and reconcile, never retry"))
        try:check_resources()
        except BaseException as error:failure=failure or str(error)
    result=ledger.report(time.monotonic_ns()-origin,failure)
    result.update(originMonotonicNs=str(origin),offeredWindowEndMonotonicNs=str(origin+plan["windowNs"]),
                  clockMeaning="same parent monotonic clock as original network checkpoints; wall-clock time not inferred")
    return result
