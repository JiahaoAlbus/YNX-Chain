"""Opt-in finite DRIVER binding for the original durable staged scheduler.

Private originals stay under the same Window and are never an archive grant.
The normal Core/source/window limits still apply. Reading a stopped ledger is
read-only accounting, never recovery, re-signing or cryptographic verification.
"""
import contextlib
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import stat
import threading
import time


def module(name):
    path=Path(__file__).with_name(name)
    spec=importlib.util.spec_from_file_location(path.stem,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

d=module('pq-durable-demand-ledger.py')
staged=module('pq-staged-independent-scheduler.py')
require=d.require
SCHEMA='YNX-PQ-DURABLE-DRIVER-ACCOUNTING/v1'
RUN_SCHEMA='YNX-PQ-INDEPENDENT-DURABLE-RUN/v1'
PLAN_SCHEMA='YNX-PQ-DURABLE-DRIVER-PLAN/v1'
DB_LIMIT=1<<30
ENVELOPE_LIMIT=40<<20
COUNTS=('logicalReleased','notReleased','submitted','included','qualified','notQualified','notSubmitted',
        'submittedWithinWindow','qualifiedWithinWindow','lateSubmitted','qualifiedInTail','releasedWithinWindow')


failure_message=d.failure_message


def selected(args):
    value=getattr(args,'durable_accounting',False)
    require(type(value) is bool,'explicit durable accounting boolean required')
    return value


def validate_options(args):
    if not selected(args):return
    require(getattr(args,'staged_publication',False) is True and args.mode=='online'
            and getattr(args,'owned_storage_accounting',False) is True,
            'durable accounting requires original staged online and owned storage observation')
    require(not getattr(args,'initialization_only',False) and not getattr(args,'held_ready_only',False),
            'durable accounting requires the original finite business profile')
    require(type(args.seconds) is int and 1<=args.seconds<=60 and type(args.rate) is int
            and args.rate in (100,500,1000) and args.rate*args.seconds<=10000,
            'original finite driver limits unchanged; no600000 runtime capacity')


def make_plan(network,workload,args,owners):
    validate_options(args);require(selected(args),'durable driver entry is explicitly opt-in')
    return staged.configure_durable(d.make_plan(network,workload,args.mode,owners,args.rate,
        args.seconds*1_000_000_000,args.tail_seconds*1_000_000_000,enabled=True),enabled=True)


def accounting_plan(plan):
    return d.make_plan(plan['networkPlanSHA256'],plan['workloadSHA256'],plan['mode'],plan['accounts'],
        plan['requestedOfferedTPS'],plan['windowNs'],plan['tailNs'],enabled=True)


def public_plan(plan):
    value=accounting_plan(plan)
    return dict(schema=PLAN_SCHEMA,plan={key:item for key,item in value.items() if key!='rows'},
                pipeline=plan['pipeline'],rowsMaterialized=False,runtimeAuthorized=False,automaticRetry=False)


def strict(raw,limit=1<<20):
    require(type(raw) is bytes and len(raw)<=limit,'bounded original accounting JSON required')
    def pairs(items):
        value={}
        for key,item in items:
            require(key not in value,'duplicate original accounting field');value[key]=item
        return value
    def constant(value):raise ValueError('non-finite original accounting number')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=constant)


class StopOnce:
    """Same backend, same original stop exactly once, including preparation errors."""
    def __init__(self,backend):
        self.backend=backend;self.lock=threading.Lock();self.done=threading.Event()
        self.attempted=False;self.error=None;self.thread=None
    def __getattr__(self,name):return getattr(self.backend,name)
    def stop(self):
        with self.lock:
            require(not self.attempted,'original backend stop already attempted; never repeat')
            self.attempted=True
        try:self.backend.stop()
        except BaseException as error:
            self.error=failure_message(error);raise
        finally:self.done.set()
    def finish(self,timeout=1):
        require(type(timeout) in (int,float) and 0<=timeout<=10,'bounded original stop wait required')
        with self.lock:
            if not self.attempted and self.thread is None:
                def close():
                    try:self.stop()
                    except BaseException:pass # The original error is retained, not a success.
                self.thread=threading.Thread(target=close,name='original-durable-preparation-stop',daemon=True)
                try:self.thread.start()
                except BaseException as error:self.error=failure_message(error)
        retired=self.done.wait(timeout)
        return dict(attempted=self.attempted,retired=retired,error=self.error,
                    cleanupDebt=not retired or self.error is not None,automaticRetry=False)


def pin(path,limit):
    """Bound a private original without loading a large database into memory."""
    path=Path(path)
    require(path.is_absolute() and path.resolve(strict=True)==path,'canonical private original required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);digest=hashlib.sha256();size=0
    try:
        before=os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_mode&0o777==0o600
                and before.st_uid==os.getuid() and before.st_size<=limit,'private original file identity/bound differs')
        while True:
            raw=os.read(fd,1<<20)
            if not raw:break
            size+=len(raw);require(size<=limit,'private original grew beyond bound');digest.update(raw)
        after=os.fstat(fd);named=Path(path).lstat()
        fields=lambda info:(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns,info.st_nlink,info.st_mode)
        require(fields(before)==fields(after)==fields(named) and size==before.st_size,'private original changed while pinning')
    finally:os.close(fd)
    return dict(bytes=size,sha256=digest.hexdigest())


class DriverAccounting:
    def __init__(self,window,monitor,stop,plan):
        self.w,self.monitor,self.stop=window,monitor,stop
        self.plan=accounting_plan(plan);self.staged_plan=staged.configure_durable(self.plan,enabled=True)
        require(self.plan['configuredDemand']<=10000 and self.plan['windowNs']<=60_000_000_000,
                'original finite runtime limits unchanged')
        work=Path(window.work)
        require(work.is_absolute() and work.resolve(strict=True)==work and work in window.storage_roots,
                'same original Window work root must be owned storage')
        parent=work/'.private'
        require(parent.resolve(strict=True)==parent and stat.S_ISDIR(parent.stat().st_mode)
                and parent.stat().st_uid==os.getuid() and parent.stat().st_mode&0o077==0,
                'same original private directory required')
        self.directory=parent/'durable-demand';self.directory.mkdir(mode=0o700)
        info=self.directory.stat();self.identity=(info.st_dev,info.st_ino)
        self.path=self.directory/'accounting.sqlite';self.raw=None;self.database=None;self.envelope_status='NOT_REACHED'
        self.peak_bytes=0;self.checks=0;self.started=False
        window.sample() # Same owned parent+descendant RSS, whole storage and reserve guard.
        self.check()
    def check(self):
        self.monitor.check()
        info=self.directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and (info.st_dev,info.st_ino)==self.identity
                and info.st_mode&0o777==0o700,'original private accounting directory changed')
        total=0
        with os.scandir(self.directory) as entries:
            for index,entry in enumerate(entries):
                require(index<3 and entry.name in ('accounting.sqlite','accounting.sqlite-journal','interrupted-result.json'),
                        'unexpected original accounting sidecar; preserve, never delete')
                try:info=entry.stat(follow_symlinks=False)
                except FileNotFoundError:
                    require(entry.name=='accounting.sqlite-journal','original accounting file disappeared');continue
                require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_mode&0o777==0o600
                        and info.st_uid==os.getuid(),'private original accounting file identity differs')
                limit=ENVELOPE_LIMIT if entry.name=='interrupted-result.json' else DB_LIMIT+(65536 if entry.name.endswith('-journal') else 0)
                require(info.st_size<=limit,'original accounting file budget exceeded');total+=info.st_size
        require(total<=2*DB_LIMIT+65536+ENVELOPE_LIMIT,'original DB plus rollback journal budget exceeded')
        self.peak_bytes=max(self.peak_bytes,total);self.checks+=1
    def run(self,backend,emit,*,ledger_module=None):
        require(not self.started,'original accounting window cannot restart');self.started=True
        self.check()
        self.raw=staged.run_durable(self.staged_plan,backend,emit,self.check,self.stop,
            ledger_path=self.path,enabled=True,ledger_module=ledger_module,max_db_bytes=DB_LIMIT)
        artifact=self.raw.get('durableLedgerArtifact')
        if artifact is not None:
            require(artifact['path']==str(self.path),'original durable artifact escaped same Window')
            self.database={key:artifact[key] for key in ('bytes','sha256','planSHA256')}
        # Preserve every bounded diagnostic in the private case, not the public
        # receipt. Even an incomplete snapshot remains incomplete after writing.
        if not self.raw['durableAccountingComplete']:
            self.envelope_status='NOT_RETAINED'
            try:
                self.check() # A resource refusal is never permission for another large write.
                raw=(d.encoded(self.raw,ENVELOPE_LIMIT-1)+'\n').encode()
                directory=os.open(self.directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                try:
                    parent=os.fstat(directory)
                    require((parent.st_dev,parent.st_ino)==self.identity,'original interrupted directory identity differs')
                    name='interrupted-result.json'
                    fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
                    with os.fdopen(fd,'wb') as out:
                        require(out.write(raw)==len(raw),'original interrupted write incomplete')
                        out.flush();os.fsync(out.fileno());written=os.fstat(out.fileno())
                        require(stat.S_ISREG(written.st_mode) and written.st_mode&0o777==0o600
                                and written.st_uid==os.getuid() and written.st_nlink==1 and written.st_size==len(raw),
                                'original interrupted file identity/length differs')
                        os.fsync(directory)
                        named=os.stat(name,dir_fd=directory,follow_symlinks=False)
                        fields=lambda info:(info.st_dev,info.st_ino,info.st_mode,info.st_nlink,info.st_size,info.st_mtime_ns,info.st_ctime_ns)
                        require(fields(written)==fields(os.fstat(out.fileno()))==fields(named),
                                'original interrupted file changed while retaining')
                    current=self.directory.lstat()
                    require(stat.S_ISDIR(current.st_mode) and (current.st_dev,current.st_ino)==self.identity
                            and current.st_mode&0o777==0o700,'original interrupted directory changed')
                finally:os.close(directory)
                self.envelope_status='RETAINED'
            except BaseException as error:
                self.raw['privateEnvelopeError']=failure_message(error)
                self.raw['firstCause']=self.raw.get('firstCause') or failure_message(error)
        else:self.envelope_status='NOT_NEEDED'
        return self.public_result()
    def public_result(self):
        raw=self.raw;require(raw is not None,'original load outcome NOT_SUPPLIED')
        # Raw unapplied events, pending identities and absolute private paths
        # remain in the original private envelope/DB, never a public projection.
        keys=('schema','configuredDemand','windowNs','observationCutoffNs','windowCompleted','firstCause',
              'firstOperationalFailure','terminalCounts','originMonotonicNs','offeredWindowEndMonotonicNs',
              'durableAccountingComplete','stableFinalTPS','P95FinalConfirmation','physicalCommitMeasured',*COUNTS,*d.INTERVALS)
        result={key:raw[key] for key in keys if key in raw}
        if not raw['durableAccountingComplete']:
            result.update({key:None for key in (*COUNTS,*d.INTERVALS)})
        result.update(mode=self.plan['mode'],requestedOfferedTPS=self.plan['requestedOfferedTPS'],
                      rowsStoredPrivately=True,automaticRetry=False,runtimeAuthorized=False,pressureAuthorized=False)
        state=raw['pipeline']
        result['pipeline']={key:state[key] for key in ('schema','bounds','stageWorkers','queuePeak','eventQueuePeak',
            'arrivalQueuePeak','operationPeak','workerThreadsRetired','backendStopRetired','cleanupDebt','callbacksMayStillArrive','ledgerInitialization')}
        return result
    def receipt(self,public_plan_sha256,first_cause=None):
        raw=self.raw or {};complete=raw.get('durableAccountingComplete') is True
        counts={key:raw.get(key) if complete else None for key in COUNTS}
        intervals={key:raw.get(key) if complete else None for key in d.INTERVALS}
        return dict(schema=SCHEMA,publicPlanSHA256=public_plan_sha256,configuredDemand=self.plan['configuredDemand'],
            loadStarted=self.started,accountingComplete=complete,firstCause=raw.get('firstCause') or first_cause,
            observationCutoffNs=raw.get('observationCutoffNs'),database=self.database,counts=counts,intervals=intervals,
            interruptedEnvelopeStatus=self.envelope_status,
            resourceScope=dict(originalWindow=True,parentAndDescendantRSS=True,wholeOwnedStorage=True,
                rollbackJournalIncluded=True,databaseLimitBytes=DB_LIMIT,rollbackJournalLimitBytes=DB_LIMIT+65536,
                privateEnvelopeLimitBytes=ENVELOPE_LIMIT,metadataChecks=self.checks,peakObservedPrivateBytes=self.peak_bytes,
                metadataIsNotDiskWrites=True),
            originalPrivateDataArchived=False,reopenMode='read-only-original-accounting',automaticRetry=False,
            pressureAuthorized=False,cryptographyReverified=False)
    @contextlib.contextmanager
    def readonly_rows(self):
        require(self.raw is not None and self.database is not None,'pinned original database NOT_SUPPLIED')
        expected={key:self.database[key] for key in ('bytes','sha256')}
        require(pin(self.path,DB_LIMIT)==expected,'original stopped accounting bytes differ')
        require(not Path(str(self.path)+'-journal').exists(),'original rollback journal requires owning recovery; never auto-replay')
        ledger=d.open_readonly(self.path,self.plan,self.database['planSHA256'],max_db_bytes=DB_LIMIT)
        try:yield (ledger.row(index) for index in range(self.plan['configuredDemand']))
        finally:
            ledger.close();require(pin(self.path,DB_LIMIT)==expected,'original read-only accounting changed')


def readback(receipt,plan_raw,*,private_database=None):
    """Strict local accounting reader. An absent private original is not a pass."""
    fields={'schema','publicPlanSHA256','configuredDemand','loadStarted','accountingComplete','firstCause',
            'observationCutoffNs','database','counts','intervals','resourceScope','originalPrivateDataArchived',
            'reopenMode','automaticRetry','pressureAuthorized','cryptographyReverified','interruptedEnvelopeStatus'}
    require(type(receipt) is dict and set(receipt)==fields and receipt['schema']==SCHEMA,'closed durable receipt required')
    for key in ('originalPrivateDataArchived','automaticRetry','pressureAuthorized','cryptographyReverified'):
        require(receipt[key] is False,'durable accounting cannot grant archive/replay/authority')
    require(receipt['reopenMode']=='read-only-original-accounting','only original read-only audit is permitted')
    require(receipt['interruptedEnvelopeStatus'] in ('NOT_REACHED','NOT_NEEDED','RETAINED','NOT_RETAINED'),
            'original interrupted evidence status differs')
    require(hashlib.sha256(plan_raw).hexdigest()==receipt['publicPlanSHA256'],'original public plan pin differs')
    encoded=strict(plan_raw,d.MAX_PLAN_BYTES)
    require(type(encoded) is dict and set(encoded)=={'schema','plan','pipeline','rowsMaterialized','runtimeAuthorized','automaticRetry'}
            and encoded['schema']==PLAN_SCHEMA and encoded['rowsMaterialized'] is False
            and encoded['runtimeAuthorized'] is False and encoded['automaticRetry'] is False,'closed durable plan required')
    p=encoded['plan'];plan=d.make_plan(p['networkPlanSHA256'],p['workloadSHA256'],p['mode'],p['accounts'],p['requestedOfferedTPS'],p['windowNs'],p['tailNs'],enabled=True)
    require(p=={key:value for key,value in plan.items() if key!='rows'} and encoded['pipeline']==staged.configure_durable(plan,enabled=True)['pipeline'],
            'original bounded plan metadata differs')
    n=plan['configuredDemand'];require(type(receipt['configuredDemand']) is int and receipt['configuredDemand']==n<=10000
            and plan['windowNs']<=60_000_000_000,'original finite denominator differs')
    require(type(receipt['loadStarted']) is bool and type(receipt['accountingComplete']) is bool
            and (receipt['firstCause'] is None or type(receipt['firstCause']) is str),'original accounting status differs')
    require(set(receipt['counts'])==set(COUNTS) and set(receipt['intervals'])==set(d.INTERVALS),'closed original count/interval set required')
    complete=receipt['accountingComplete'];cutoff=receipt['observationCutoffNs']
    require(cutoff is None and not complete or type(cutoff) is int and 0<=cutoff<1<<63,'original cutoff required')
    for value in receipt['counts'].values():require(type(value) is int and 0<=value<=n if complete else value is None,'unobserved count cannot become zero')
    if complete:
        c=receipt['counts']
        require(c['logicalReleased']+c['notReleased']==c['submitted']+c['notSubmitted']==c['qualified']+c['notQualified']==n
                and c['qualified']<=c['included']<=c['submitted']<=c['logicalReleased']
                and c['submittedWithinWindow']+c['lateSubmitted']==c['submitted']
                and c['qualifiedWithinWindow']+c['qualifiedInTail']==c['qualified']
                and c['releasedWithinWindow']<=c['logicalReleased'],'full original counts do not reconcile')
    for value in receipt['intervals'].values():
        if not complete:require(value is None,'incomplete accounting cannot claim latency');continue
        require(type(value) is dict and set(value)=={'denominator','observed','censored','p50Ms','p95Ms','p99Ms'}
                and type(value['denominator']) is int and value['denominator']==n and type(value['observed']) is int and 0<=value['observed']<=n
                and type(value['censored']) is int and value['censored']==n-value['observed'],'full original interval denominator differs')
        for key in ('p50Ms','p95Ms','p99Ms'):
            number=value[key];require(type(number) in (int,float) and math.isfinite(number) and number>=0 if value['observed']==n else number is None,
                                     'incomplete full-demand percentile cannot be supplied')
        if value['observed']==n:require(value['p50Ms']<=value['p95Ms']<=value['p99Ms'],'original percentile order differs')
    resource=receipt['resourceScope']
    expected=dict(originalWindow=True,parentAndDescendantRSS=True,wholeOwnedStorage=True,rollbackJournalIncluded=True,
                  databaseLimitBytes=DB_LIMIT,rollbackJournalLimitBytes=DB_LIMIT+65536,privateEnvelopeLimitBytes=ENVELOPE_LIMIT,metadataIsNotDiskWrites=True)
    require(type(resource) is dict and set(resource)==set(expected)|{'metadataChecks','peakObservedPrivateBytes'}
            and all(type(resource[key]) is type(value) and resource[key]==value for key,value in expected.items())
            and type(resource['metadataChecks']) is int and resource['metadataChecks']>=1
            and type(resource['peakObservedPrivateBytes']) is int and 0<=resource['peakObservedPrivateBytes']<=2*DB_LIMIT+65536+ENVELOPE_LIMIT,
            'original resource accounting scope differs')
    database=receipt['database']
    require(database is None or type(database) is dict and set(database)=={'bytes','sha256','planSHA256'},'closed private artifact pin required')
    if database is not None:
        require(type(database['bytes']) is int and 0<database['bytes']<=DB_LIMIT,'original database bound differs')
        for key in ('sha256','planSHA256'):require(type(database[key]) is str and len(database[key])==64 and all(c in '0123456789abcdef' for c in database[key]),'original SHA256 required')
        require(database['planSHA256']==hashlib.sha256(d.encoded(p,d.MAX_PLAN_BYTES).encode()).hexdigest(),
                'private original plan pin differs')
    require(not complete or receipt['loadStarted'] and database is not None,'complete accounting requires original load and artifact')
    report=dict(schema='YNX-PQ-DURABLE-LOCAL-READBACK/v1',configuredDemand=n,accountingComplete=complete,
                privateOriginalStatus='NOT_SUPPLIED',pressureAuthorized=False,cryptographyReverified=False,automaticRetry=False,
                originalResourceGuardIndependentlyReverified=False)
    if private_database is None:return report
    require(database is not None,'private original artifact pin NOT_SUPPLIED')
    path=Path(private_database);expected_pin={key:database[key] for key in ('bytes','sha256')}
    require(pin(path,DB_LIMIT)==expected_pin,'original stopped DB bytes differ')
    require(not Path(str(path)+'-journal').exists(),'original rollback journal requires owning recovery; never auto-replay')
    ledger=d.open_readonly(path,plan,database['planSHA256'],max_db_bytes=DB_LIMIT)
    try:
        report['pendingOriginalCount']=len(ledger.audit()['originalPending'])
        if complete:
            actual=ledger.report(cutoff,receipt['firstCause'])
            require(receipt['counts']=={key:actual[key] for key in COUNTS}
                    and receipt['intervals']=={key:actual[key] for key in d.INTERVALS},'original DB and public accounting differ')
        report['privateOriginalStatus']='READ_ONLY_ORIGINAL_ACCOUNTING_OBSERVED'
    finally:ledger.close()
    require(pin(path,DB_LIMIT)==expected_pin,'read-only original DB changed')
    return report


def main(argv=None):
    import argparse
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for key in ('receipt','receipt-sha256','plan','plan-sha256','output'):parser.add_argument('--'+key,required=True)
    parser.add_argument('--database',help='optional same stopped private original; audit only, never reopen writable')
    args=parser.parse_args(argv)
    def original(path,expected,limit):
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,'rb') as source:
            require(stat.S_ISREG(os.fstat(source.fileno()).st_mode),'original regular JSON required')
            raw=source.read(limit+1)
        require(len(raw)<=limit and hashlib.sha256(raw).hexdigest()==expected,'original JSON bytes/pin differ')
        return raw
    raw=original(args.receipt,args.receipt_sha256,1<<20)
    plan_raw=original(args.plan,args.plan_sha256,d.MAX_PLAN_BYTES)
    result=readback(strict(raw),plan_raw,private_database=args.database)
    fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as output:json.dump(result,output,sort_keys=True);output.write('\n');output.flush();os.fsync(output.fileno())
    return 0


if __name__=='__main__':raise SystemExit(main())
