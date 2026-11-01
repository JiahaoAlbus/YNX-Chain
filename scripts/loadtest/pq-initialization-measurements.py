"""Parent initialization spans and complete original account readback.

These observations never authorize execution, replace normal Go validation, or
qualify cryptography/finality. No credentials, commands, or state bytes exported.
"""
import functools
import hashlib
import json
import os
from pathlib import Path
import stat
import time


LIVE_SOURCE='896ea094c985cd4b9e90681e436285a9bba0a979'
LIVE_TREE='b99d095d2783da95c64583e81084f0b928ec3532'
SOURCE_FUNCTIONAL_SHA256='4ff5e4d1a301e4b8c636baadcfde1459f35107f2e2b5dedc456a3817f3e7deae' # Exact original three-Linux-group DATA, not full500.


class InitializationStages:
    def __init__(self,clock=time.monotonic_ns,limit=2048,on_event=None):
        self.clock=clock;self.limit=limit;self.records=[];self.attempted=0;self.enabled=True;self.on_event=on_event;self.journal_errors=[]
    def run(self,stage,identity,operation):
        if not self.enabled:return operation()
        index=self.attempted;self.attempted+=1;requested=self.clock();start=None;outcome='NOT_STARTED';error_type=None;original_error=None
        try:
            if self.on_event is not None:
                self.on_event(dict(kind='initialization_stage_requested',index=index,stage=stage,identity=identity,requestedMonotonicNs=requested,elapsedNs=None,completed=False,missingReturnIsUnknown=True))
            start=self.clock() if self.on_event is not None else requested
            outcome='FAILED'
            result=operation();outcome='RETURNED';return result
        except BaseException as error:
            original_error=error;error_type=type(error).__name__
            if start is None and self.on_event is not None:self.journal_errors.append(dict(index=index,phase='request',errorType=error_type))
            raise
        finally:
            end=self.clock()
            record=dict(index=index,stage=stage,identity=identity,requestedMonotonicNs=requested,startedMonotonicNs=start,returnedMonotonicNs=end,elapsedNs=end-start if start is not None else None,requestJournalElapsedNs=start-requested if start is not None else None,outcome=outcome,errorType=error_type)
            if len(self.records)<self.limit:self.records.append(record)
            if self.on_event is not None:
                try:self.on_event(dict(record,kind='initialization_stage_returned',completed=start is not None))
                except BaseException as error:
                    self.journal_errors.append(dict(index=index,phase='return',errorType=type(error).__name__))
                    if original_error is None:raise
    def seal(self):self.enabled=False
    def report(self):
        return dict(schema='YNX-PERF-ORIGINAL-INITIALIZATION-STAGES/v1',clock='parent_monotonic_ns',attempted=self.attempted,retained=len(self.records),omitted=self.attempted-len(self.records),recordLimit=self.limit,sealed=not self.enabled,journalErrors=[dict(v) for v in self.journal_errors],records=[dict(v) for v in sorted(self.records,key=lambda v:v['index'])],intervalsOverlap=True,unreachedStagesAreUnknown=True,cryptographyOrFinalityQualified=False,meaning='Nested parent wall spans, including normal resource guards and process dispatch/wait; request-journal fsync overhead recorded separately; containing parent spans include nested telemetry overhead; never add nested spans or infer Go callee CPU time. RETURNED means the original method returned, not business/finality success.')


def instrumented_ceremony_class(Base):
    class MeasuredCeremony(Base):
        def __init__(self,*args,initialization_stages,**kwargs):
            self.initialization_stages=initialization_stages;super().__init__(*args,**kwargs)
    def wrapper(name):
        original=getattr(Base,name)
        @functools.wraps(original)
        def measured(self,*args,**kwargs):
            # Only public bounded operation labels/owner numbers, never argv,
            # raw payloads, private file paths, requests, or credentials.
            identity=(args[0] if name in ('call','transfer','traffic','post_once','sender_command') else 'bootstrap' if name=='start' and not (args and args[0] is not None) and kwargs.get('activation') is None else 'pq' if name=='start' else None)
            return self.initialization_stages.run(name,identity,lambda:original(self,*args,**kwargs))
        return measured
    for name in ('prepare_network','start','quiet','call','transfer','traffic','post_once','sender_command','halt_post','activation_startup'):
        setattr(MeasuredCeremony,name,wrapper(name))
    return MeasuredCeremony


def complete_account_readback(nodes,manifest_owners,checkpoint,root,read_limit=128<<20,check=lambda:None):
    """Read each ORIGINAL stopped/quiet application once, no retries or writes.

    Normal Go nodes must have independently initialized and validated first.
    This is a matching account/nonce/balance census, not static/PQ verification.
    """
    def require(value,message):
        if not value:raise RuntimeError(message)
    require(len(nodes)==4 and [n['index'] for n in nodes]==list(range(4)),'four original node identities required')
    require(manifest_owners and len(manifest_owners)<=996,'complete bounded load owner input required')
    expected={}
    for i,owner in enumerate(manifest_owners,4):
        require(owner['index']==i and type(owner['owner']) is str and owner['owner'] not in expected,'distinct contiguous original load owner identities required')
        nonce=owner['initialNonce'];balance=owner['initialBalance']
        require(type(nonce) is str and nonce.isdecimal() and str(int(nonce))==nonce and type(balance) is str and balance.isdecimal() and str(int(balance))==balance,'canonical original nonce/balance required')
        expected[owner['owner']]=(int(nonce),int(balance))
    observations=[];root=Path(root)
    for node in nodes:
        check()
        path=Path(node['statePath']);require(path.resolve()==path and root in path.parents,'original state snapshot escaped owned root')
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        try:
            before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and 0<before.st_size<=read_limit,'bounded regular original state required')
            with os.fdopen(fd,'rb',closefd=False) as handle:raw=handle.read(read_limit+1)
            check() # Account for the live raw snapshot, before releasing it.
            after=os.fstat(fd);current=os.stat(path,follow_symlinks=False)
            signature=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            require(len(raw)==before.st_size and signature(before)==signature(after)==signature(current),'original quiet snapshot changed during account census; no retry')
        finally:os.close(fd)
        state=json.loads(raw);check() # Both raw bytes and parsed state are still resident.
        require(state.get('initialized') is True and state.get('height')==checkpoint['height'] and state.get('appHash')==checkpoint['appHash'],'account snapshot differs from original common initialized checkpoint')
        rows=state.get('accounts');require(type(rows) is list,'original state account array required')
        found={}
        for account in rows:
            address=account['address']
            if address not in expected:continue
            require(address not in found,'duplicate original load account in state')
            require(type(account.get('nonce')) is int and type(account.get('balance')) is int and (account['nonce'],account['balance'])==expected[address],'load account original nonce/balance differs; no sign or replay')
            found[address]=True
        require(len(found)==len(expected),'full original independent load account cohort not initialized')
        check()
        observations.append(dict(node=node['index'],height=checkpoint['height'],appHash=checkpoint['appHash'],snapshotBytes=len(raw),snapshotSHA256=hashlib.sha256(raw).hexdigest(),matchingOriginalLoadAccounts=len(found)))
        del raw,state,rows,found
    return dict(schema='YNX-PERF-ORIGINAL-INITIALIZED-ACCOUNT-CENSUS/v1',configuredLoadAccounts=len(expected),completeFourNodeAccountReadback=True,nodes=observations,normalGoStaticOrCryptoQualification=False,signCommandsIssued=0,businessPOSTsIssued=0,sourceGrant=False,meaning='All configured business accounts matched original manifest nonce/balance at the common four-node initialized checkpoint. This census alone is not normal Go full-history validation, sender readiness, signing, inclusion, finality, or performance qualification.')


def source_functional_data():
    # Source-functional DATA only; actual full500 initialization remains a
    # separate normal run, and business pressure retains its absent hard gate.
    if type(SOURCE_FUNCTIONAL_SHA256) is not str or len(SOURCE_FUNCTIONAL_SHA256)!=64:raise RuntimeError('exact new live-source Linux qualification NOT_SUPPLIED')
    path=Path(__file__).with_name('fixtures')/'896-live-functional-original.json'
    with path.open('rb') as source:raw=source.read((64<<10)+1)
    if hashlib.sha256(raw).hexdigest()!=SOURCE_FUNCTIONAL_SHA256:raise RuntimeError('exact new original source-functional receipt pin differs')
    data=json.loads(raw)
    if not (data['schema']=='YNX-PERF-LIVE-SOURCE-FUNCTIONAL-DATA/v1' and data['sourceSHA']==LIVE_SOURCE and data['sourceTree']==LIVE_TREE and data['sourceFunctionalQualified'] is True and set(data['officialLinuxGroups'])=={'resource','commit','client'} and data['actual500InitializedOwnersQualified'] is False and data['pressureAuthorized'] is False and data['sourceGrant'] is False):raise RuntimeError('original live-source functional scope differs')
    return dict(receiptSHA256=SOURCE_FUNCTIONAL_SHA256,source=LIVE_SOURCE,runId=41306177925,jobId=124846905898,scope='three original Linux source-functional groups only',actual500OwnerInputPreviouslyQualified=False,pressureAuthorized=False,wholeResourceCIConclusionAtReceipt=data['workflowObservations']['resource']['conclusion'])


def require_complete_initialization(result):
    """Finite receipt contract for the sole normal initialization run.

    Validating this DATA contract never authorizes/dispatches a pressure window.
    """
    def require(value,message):
        if not value:raise RuntimeError(message)
    caps=dict(totalSeconds=900,cleanupSeconds=15,rssBytes=4<<30,newBytes=8<<30,initialMemoryBytes=6<<30,initialDiskBytes=16<<30,logBytes=4<<20,cpus=2)
    require(result.get('source',{}).get('commit')==LIVE_SOURCE and result.get('source',{}).get('tree')==LIVE_TREE,'exact original qualified live source and tree required')
    require(result.get('caps')==caps and result.get('configuredDemand')==500 and result.get('mode')=='online','unchanged original caps and full500 cohort required')
    require(result.get('initializationOnlyRequested') is True and result.get('initializationOnlyComplete') is True and result.get('cleanupComplete') is True and result.get('firstCause') is None and result.get('normalLiveCalleeUsed') is True,'normal initialization incomplete or cleanup debt; preserve first cause')
    require(result.get('loadExecuted') is False and 'loadResult' not in result,'initialization receipt cannot contain a business load result')
    demand=result.get('preparationOnlyDemandAccounting',{})
    require(all(demand.get(k)==500 for k in ('configuredDemand','notReleased','notSubmitted','notQualified')),'full unreleased500 demand must remain visible')
    prerequisite=result.get('initializationSourceFunctionalData',{})
    require(type(SOURCE_FUNCTIONAL_SHA256) is str and prerequisite.get('receiptSHA256')==SOURCE_FUNCTIONAL_SHA256 and prerequisite.get('pressureAuthorized') is False and prerequisite.get('actual500OwnerInputPreviouslyQualified') is False,'original source-functional prerequisite cannot become prior500 or pressure qualification')
    census=result.get('initializedAccountReadback',{})
    require(census.get('completeFourNodeAccountReadback') is True and census.get('configuredLoadAccounts')==500 and census.get('normalGoStaticOrCryptoQualification') is False,'four-node full500 original account census required')
    nodes=census.get('nodes',[])
    require(len(nodes)==4 and [n['node'] for n in nodes]==list(range(4)) and all(n.get('matchingOriginalLoadAccounts')==500 for n in nodes),'every original node must match all500 accounts')
    require(len({(n.get('height'),n.get('appHash')) for n in nodes})==1,'all four original account snapshots must share checkpoint')
    admission=result.get('freshResourceAdmission',{})
    require(admission.get('caps')==caps and admission.get('ownedPIDLimit')==16 and admission.get('conflictingHeavyProcesses')==[],'fresh exact original resource admission required')
    require(type(admission.get('availableMemoryBytes')) is int and admission['availableMemoryBytes']>=caps['initialMemoryBytes'] and type(admission.get('freeDiskBytes')) is int and admission['freeDiskBytes']>=caps['initialDiskBytes'],'fresh actual memory/disk capacity below original admission')
    samples=result.get('resourceSamples',[])
    require(samples and all(type(v.get('processes')) is int and 0<v['processes']<=16 and type(v.get('rssBytes')) is int and 0<=v['rssBytes']<=caps['rssBytes'] and type(v.get('newBytes')) is int and 0<=v['newBytes']<=caps['newBytes'] for v in samples),'actual bounded original resource samples required')
    require(type(result.get('elapsedSeconds')) in (int,float) and 0<=result['elapsedSeconds']<=900 and type(result.get('peakRSSBytes')) is int and 0<=result['peakRSSBytes']<=caps['rssBytes'] and type(result.get('peakNewBytes')) is int and 0<=result['peakNewBytes']<=caps['newBytes'],'original resource/deadline cap exceeded')
    measured=result.get('initializationStages',{});records=measured.get('records',[])
    require(measured.get('sealed') is True and measured.get('journalErrors',[])==[] and measured.get('omitted')==0 and measured.get('retained')==measured.get('attempted')==len(records),'complete sealed initialization spans required')
    require(records and all(v.get('outcome')=='RETURNED' and v.get('errorType') is None and type(v.get('elapsedNs')) is int and 0<=v['elapsedNs']==v['returnedMonotonicNs']-v['startedMonotonicNs'] for v in records),'failed/missing initialization stage cannot be qualified')
    stages=[v['stage'] for v in records]
    require(stages.count('build')==3 and stages.count('create_original')==1 and stages.count('prepare_network')==1 and stages.count('complete_account_readback')==1,'original build/create/prepare/full account stages required')
    return dict(schema='YNX-PERF-COMPLETE-NORMAL-INITIALIZATION-DATA/v1',source=result['source'],configuredLoadAccounts=500,completeNormalInitializationObserved=True,cleanupComplete=True,loadExecuted=False,pressureAuthorized=False,sourceGrant=False,meaning='Original normal initialization and full-account DATA receipt contract only. A new business pressure window and same-condition source comparison require separate Root selection; no TPS/finality inferred.')
