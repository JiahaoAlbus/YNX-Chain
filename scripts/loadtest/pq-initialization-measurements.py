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


class InitializationStages:
    def __init__(self,clock=time.monotonic_ns,limit=2048):
        self.clock=clock;self.limit=limit;self.records=[];self.attempted=0;self.enabled=True
    def run(self,stage,identity,operation):
        if not self.enabled:return operation()
        index=self.attempted;self.attempted+=1;start=self.clock();outcome='FAILED';error_type=None
        try:
            result=operation();outcome='RETURNED';return result
        except BaseException as error:
            error_type=type(error).__name__;raise
        finally:
            end=self.clock()
            if len(self.records)<self.limit:
                self.records.append(dict(index=index,stage=stage,identity=identity,startedMonotonicNs=start,returnedMonotonicNs=end,elapsedNs=end-start,outcome=outcome,errorType=error_type))
    def seal(self):self.enabled=False
    def report(self):
        return dict(schema='YNX-PERF-ORIGINAL-INITIALIZATION-STAGES/v1',clock='parent_monotonic_ns',attempted=self.attempted,retained=len(self.records),omitted=self.attempted-len(self.records),recordLimit=self.limit,sealed=not self.enabled,records=[dict(v) for v in sorted(self.records,key=lambda v:v['index'])],intervalsOverlap=True,unreachedStagesAreUnknown=True,cryptographyOrFinalityQualified=False,meaning='Nested parent wall spans, including normal resource guards and process dispatch/wait; never add nested spans or infer Go callee CPU time. RETURNED means the original method returned, not business/finality success.')


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


def complete_account_readback(nodes,manifest_owners,checkpoint,root,read_limit=128<<20):
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
        path=Path(node['statePath']);require(path.resolve()==path and root in path.parents,'original state snapshot escaped owned root')
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        try:
            before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and 0<before.st_size<=read_limit,'bounded regular original state required')
            with os.fdopen(fd,'rb',closefd=False) as handle:raw=handle.read(read_limit+1)
            after=os.fstat(fd);current=os.stat(path,follow_symlinks=False)
            signature=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            require(len(raw)==before.st_size and signature(before)==signature(after)==signature(current),'original quiet snapshot changed during account census; no retry')
        finally:os.close(fd)
        state=json.loads(raw)
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
        observations.append(dict(node=node['index'],height=checkpoint['height'],appHash=checkpoint['appHash'],snapshotBytes=len(raw),snapshotSHA256=hashlib.sha256(raw).hexdigest(),matchingOriginalLoadAccounts=len(found)))
        del raw,state,rows,found
    return dict(schema='YNX-PERF-ORIGINAL-INITIALIZED-ACCOUNT-CENSUS/v1',configuredLoadAccounts=len(expected),completeFourNodeAccountReadback=True,nodes=observations,normalGoStaticOrCryptoQualification=False,signCommandsIssued=0,businessPOSTsIssued=0,sourceGrant=False,meaning='All configured business accounts matched original manifest nonce/balance at the common four-node initialized checkpoint. This census alone is not normal Go full-history validation, sender readiness, signing, inclusion, finality, or performance qualification.')


def source_functional_data():
    # Exact original CORE normal-workflow named-case receipt, independently
    # read and pinned by PERF. Only a prerequisite for initialization, never
    # proof that 500 owners/Node initialization/load already succeeded.
    path=Path(__file__).with_name('fixtures')/'c4b-source-functional-original.json'
    with path.open('rb') as source:raw=source.read((64<<10)+1)
    pin='2daaf7e71840e15dc27dba9ff8883e285c5f3bacd88b7df655c6330a025e3664'
    if hashlib.sha256(raw).hexdigest()!=pin:raise RuntimeError('exact c4b original source-functional receipt pin differs')
    data=json.loads(raw)
    if not (data['sourceSHA']=='c4b39c73ec3a43c2ba32f7071bb735b0c0447f5e' and data['runId']==41297681663 and data['jobId']==124821886065 and data['jobConclusion']=='success' and data['originalCLIAssertion']['suitePassed'] is True and data['originalInternalAssertion']['suitePassed'] is True):raise RuntimeError('original source-functional scope differs')
    return dict(receiptSHA256=pin,source=data['sourceSHA'],runId=data['runId'],jobId=data['jobId'],scope='original c4b named source-functional cases only',actual500OwnerInputPreviouslyQualified=False,pressureAuthorized=False,wholeResourceCIConclusionAtReceipt=data['wholeConclusionAtReceipt'])


def require_complete_initialization(result):
    """Finite receipt contract for the sole normal initialization run.

    Validating this DATA contract never authorizes/dispatches a pressure window.
    """
    def require(value,message):
        if not value:raise RuntimeError(message)
    caps=dict(totalSeconds=900,cleanupSeconds=15,rssBytes=4<<30,newBytes=8<<30,initialMemoryBytes=6<<30,initialDiskBytes=16<<30,logBytes=4<<20,cpus=2)
    require(result.get('source',{}).get('commit')=='c4b39c73ec3a43c2ba32f7071bb735b0c0447f5e' and result.get('source',{}).get('tree')=='2fd621242e73e1cb4901413c03f7d48336801d11','exact original c4b source and tree required')
    require(result.get('caps')==caps and result.get('configuredDemand')==500 and result.get('mode')=='online','unchanged original caps and full500 cohort required')
    require(result.get('initializationOnlyRequested') is True and result.get('initializationOnlyComplete') is True and result.get('cleanupComplete') is True and result.get('firstCause') is None and result.get('normalLiveCalleeUsed') is True,'normal initialization incomplete or cleanup debt; preserve first cause')
    require(result.get('loadExecuted') is False and 'loadResult' not in result,'initialization receipt cannot contain a business load result')
    demand=result.get('preparationOnlyDemandAccounting',{})
    require(all(demand.get(k)==500 for k in ('configuredDemand','notReleased','notSubmitted','notQualified')),'full unreleased500 demand must remain visible')
    prerequisite=result.get('initializationSourceFunctionalData',{})
    require(prerequisite.get('receiptSHA256')=='2daaf7e71840e15dc27dba9ff8883e285c5f3bacd88b7df655c6330a025e3664' and prerequisite.get('pressureAuthorized') is False and prerequisite.get('actual500OwnerInputPreviouslyQualified') is False,'original source-functional prerequisite cannot become prior500 or pressure qualification')
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
    require(measured.get('sealed') is True and measured.get('omitted')==0 and measured.get('retained')==measured.get('attempted')==len(records),'complete sealed initialization spans required')
    require(records and all(v.get('outcome')=='RETURNED' and v.get('errorType') is None and type(v.get('elapsedNs')) is int and 0<=v['elapsedNs']==v['returnedMonotonicNs']-v['startedMonotonicNs'] for v in records),'failed/missing initialization stage cannot be qualified')
    stages=[v['stage'] for v in records]
    require(stages.count('build')==3 and stages.count('create_original')==1 and stages.count('prepare_network')==1 and stages.count('complete_account_readback')==1,'original build/create/prepare/full account stages required')
    return dict(schema='YNX-PERF-COMPLETE-NORMAL-INITIALIZATION-DATA/v1',source=result['source'],configuredLoadAccounts=500,completeNormalInitializationObserved=True,cleanupComplete=True,loadExecuted=False,pressureAuthorized=False,sourceGrant=False,meaning='Original normal initialization and full-account DATA receipt contract only. A new business pressure window and same-condition source comparison require separate Root selection; no TPS/finality inferred.')
