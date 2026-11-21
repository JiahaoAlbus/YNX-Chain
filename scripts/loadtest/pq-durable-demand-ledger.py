"""Opt-in disk accounting for the ORIGINAL independent scheduler.

This stores observations; it is not a signer, verifier, source grant or runner.
The original Ledger.reserve/event functions remain the transition authority.
Fresh databases only: reopening is read-only, never a retry or nonce release.
The current Core corpus and driver gates are intentionally unchanged.
"""
import collections.abc
import collections
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location('durable_original_scheduler',Path(__file__).with_name('pq-independent-scheduler.py'))
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
require=original.require
SCHEMA='YNX-PQ-DURABLE-DEMAND/v1'
MAX_DEMAND=600000
MAX_WINDOW_NS=600_000_000_000
MAX_RECORD_BYTES=64<<10
MAX_PLAN_BYTES=512<<10
MAX_EVENTS_PER_OPERATION=128
MAX_DB_BYTES=2<<30
CLOCKS=('releasedNs','claimedNs','signedNs','submittedNs','ackNs','includedNs','finalNs')
INTERVALS={
    'endToEndLogicalArrivalToQualified':('logicalArrivalOffsetNs','finalNs'),
    'submitToInclusionObserved':('submittedNs','includedNs'),
    'submitToQualifiedReceiptObserved':('submittedNs','finalNs'),
    'submitToCheckTxAckObserved':('submittedNs','ackNs'),
    'inclusionToQualifiedReceiptObserved':('includedNs','finalNs'),
    'releaseToAccountClaim':('releasedNs','claimedNs')}


def encoded(value,limit=MAX_RECORD_BYTES):
    raw=json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    require(len(raw)<=limit,'bounded original durable record exceeded; preserve pending')
    return raw.decode()


class DemandRows(collections.abc.Sequence):
    """The same stable ids as make_plan, without allocating the demand array."""
    def __init__(self,identity,count,rate):self.identity=tuple(identity);self.count=count;self.rate=rate
    def __len__(self):return self.count
    def __getitem__(self,index):
        require(type(index) is int,'one original index required; no materialized slices')
        if not 0<=index<self.count:raise IndexError(index)
        return dict(index=index,id=original.sha(json.dumps([*self.identity,index],separators=(',',':')).encode()),
                    logicalArrivalOffsetNs=index*1_000_000_000//self.rate)


def make_plan(network_pin,workload_pin,mode,owners,rate,window_ns,tail_ns,*,enabled=False):
    require(enabled is True,'durable demand accounting is explicitly opt-in')
    require(type(window_ns) is int and 0<window_ns<=MAX_WINDOW_NS and rate in (100,500,1000)
            and rate*window_ns%1_000_000_000==0,'bounded integer durable demand required')
    count=rate*window_ns//1_000_000_000
    require(0<count<=MAX_DEMAND and 0<len(owners)<=996,'bounded full demand and original owner pool required')
    require(all(type(o.get('capacity')) is int and 0<o['capacity']<=1024 for o in owners),
            'original per-owner capacity is unchanged; Core successor admission required')
    require(sum(o['capacity'] for o in owners)>=count,'original total account capacity cannot cover full demand')
    # Reuse the normal pin/owner/nonce/mode checks on a bounded prefix. No Core
    # capacity grant is inferred from this accounting-only plan.
    plan=original.make_plan(network_pin,workload_pin,mode,owners,rate,min(window_ns,1_000_000_000),tail_ns)
    plan.update(windowNs=window_ns,configuredDemand=count)
    plan['rows']=DemandRows([original.SCHEMA,network_pin,workload_pin,mode,rate,window_ns],count,rate)
    plan['durableAccounting']=dict(schema=SCHEMA,sourceCapacityQualified=False,runtimeAuthorized=False,
                                   pressureAuthorized=False,automaticRetry=False)
    return plan


def initial_row(plan,index):
    return dict(plan['rows'][index],status='not_released',activeStage='not_released',stageTimes=[],
                ownerIndex=None,operationId=None,nonce=None,hash=None,nativeHash=None,error=None,
                **{key:None for key in CLOCKS})


def freeze_plan(plan):
    frozen=make_plan(plan['networkPlanSHA256'],plan['workloadSHA256'],plan['mode'],
                     [dict(owner) for owner in plan['accounts']],plan['requestedOfferedTPS'],
                     plan['windowNs'],plan['tailNs'],enabled=True)
    require(encoded({k:v for k,v in frozen.items() if k!='rows'},MAX_PLAN_BYTES)==
            encoded({k:v for k,v in plan.items() if k!='rows'},MAX_PLAN_BYTES),
            'closed original durable plan metadata differs')
    return frozen


class _OneRow:
    def __init__(self,row,count):self.row=row;self.count=count
    def __len__(self):return self.count
    def __getitem__(self,index):
        require(index==self.row['index'],'original transient row binding differs')
        return self.row


class _Hashes:
    def __init__(self,connection):self.db=connection
    def __contains__(self,value):return self.db.execute('SELECT 1 FROM rows WHERE hash=?',(value,)).fetchone() is not None
    def add(self,value):pass # The same transaction stores the row under a UNIQUE index.


class DurableLedger:
    def __init__(self,plan,path,emit,check_resources,*,enabled=False,max_db_bytes=1<<30):
        require(enabled is True,'durable demand accounting is explicitly opt-in')
        require(type(plan.get('rows')) is DemandRows and len(plan['rows'])==plan['configuredDemand'],
                'original lazy full-demand plan required')
        identity=(original.SCHEMA,plan['networkPlanSHA256'],plan['workloadSHA256'],plan['mode'],
                  plan['requestedOfferedTPS'],plan['windowNs'])
        require(plan['rows'].identity==identity and plan['rows'].rate==plan['requestedOfferedTPS'],
                'original lazy demand identity differs')
        require(callable(emit) and callable(check_resources),'original event and resource observers required')
        require(type(max_db_bytes) is int and 256<<10<=max_db_bytes<=MAX_DB_BYTES and max_db_bytes%4096==0,
                'fixed durable page budget required; not a larger cohort storage grant')
        self.path=Path(path);parent=self.path.parent
        require(self.path.is_absolute() and parent.resolve(strict=True)==parent and not parent.is_symlink(),
                'canonical original private ledger directory required')
        info=parent.stat()
        require(info.st_uid==os.getuid() and info.st_mode&0o077==0,'private owner-only durable directory required')
        self.plan=freeze_plan(plan);plan=self.plan
        self.emit=emit;self.check_resources=check_resources;self.max_db_bytes=max_db_bytes
        self.failed=None;self.read_only=False;self.closed=False
        self.check_resources();self._space()
        fd=os.open(self.path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:before=os.fstat(fd);os.fsync(fd)
        finally:os.close(fd)
        self.identity=(before.st_dev,before.st_ino)
        self.db=sqlite3.connect(str(self.path),isolation_level=None,timeout=1)
        require((before.st_dev,before.st_ino)==(self.path.stat().st_dev,self.path.stat().st_ino),
                'original exclusive ledger identity changed')
        try:
            self.db.execute('PRAGMA page_size=4096')
            require(self.db.execute('PRAGMA page_size').fetchone()[0]==4096,'original durable page size differs')
            require(self.db.execute('PRAGMA journal_mode=DELETE').fetchone()[0]=='delete','original rollback journal required')
            self.db.execute('PRAGMA synchronous=FULL');self.db.execute('PRAGMA cache_size=-4096')
            self.db.execute('PRAGMA mmap_size=0')
            require(self.db.execute('PRAGMA max_page_count='+str(max_db_bytes//4096)).fetchone()[0]==max_db_bytes//4096,
                    'original durable page limit was not applied')
            self.db.executescript('''
                CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE releases(first_idx INTEGER PRIMARY KEY,end_idx INTEGER NOT NULL,at_ns INTEGER NOT NULL);
                CREATE TABLE owners(owner INTEGER PRIMARY KEY,pending INTEGER,quarantined INTEGER NOT NULL,
                    used INTEGER NOT NULL,capacity INTEGER NOT NULL,free_turn INTEGER NOT NULL,data TEXT NOT NULL);
                CREATE INDEX available_owner ON owners(quarantined,pending,free_turn);
                CREATE TABLE rows(idx INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,operation_id TEXT UNIQUE NOT NULL,
                    hash TEXT UNIQUE,status TEXT NOT NULL,releasedNs INTEGER,claimedNs INTEGER,signedNs INTEGER,
                    submittedNs INTEGER,ackNs INTEGER,includedNs INTEGER,finalNs INTEGER,error_at INTEGER,data TEXT NOT NULL);
                CREATE INDEX row_status ON rows(status);
                CREATE INDEX row_error ON rows(error_at,idx);
                CREATE TABLE events(seq INTEGER PRIMARY KEY,idx INTEGER,kind TEXT NOT NULL,at_ns INTEGER NOT NULL,data TEXT NOT NULL);
                CREATE INDEX event_row ON events(idx);
                CREATE INDEX event_clock ON events(at_ns);
                CREATE TABLE intervals(metric TEXT NOT NULL,idx INTEGER NOT NULL,value INTEGER NOT NULL,
                    PRIMARY KEY(metric,idx));
                CREATE INDEX interval_rank ON intervals(metric,value,idx);
            ''')
            metadata={key:value for key,value in plan.items() if key!='rows'}
            self.plan_sha256=hashlib.sha256(encoded(metadata,MAX_PLAN_BYTES).encode()).hexdigest()
            with self._transaction():
                for key,value in dict(schema=SCHEMA,plan=encoded(metadata,MAX_PLAN_BYTES),planSHA256=self.plan_sha256,
                                      released='0',claimed='0',lastRelease='-1',freeTail=str(len(plan['accounts'])),sealed='false').items():
                    self.db.execute('INSERT INTO metadata VALUES(?,?)',(key,value))
                for turn,owner in enumerate(plan['accounts']):
                    account=dict(owner,pending=None,quarantined=False,used=0)
                    self._save_account(account,turn,insert=True)
        except BaseException:
            self.db.close();self.closed=True;raise # Keep the exclusive partial file.

    def _space(self):
        require(shutil.disk_usage(self.path.parent).free>=1<<30,'original runtime disk reserve below 1GiB')

    def _budget(self):
        self.check_resources();self._space()
        info=self.path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_mode&0o777==0o600
                and (info.st_dev,info.st_ino)==self.identity,'original durable ledger identity changed')
        require(info.st_size<=self.max_db_bytes,'durable database page budget exceeded')
        journal=Path(str(self.path)+'-journal')
        # Rollback pages can transiently duplicate database pages. Account for
        # both inside the unchanged whole-window guard, never delete history.
        if journal.exists():require(journal.stat().st_size<=self.max_db_bytes+65536,'durable rollback journal budget exceeded')

    @contextlib.contextmanager
    def _transaction(self):
        require(not self.read_only and not self.closed and self.failed is None,'durable ledger stopped; inspect original, never replay')
        try:
            self._budget();self.db.execute('BEGIN IMMEDIATE')
            yield
            self.db.execute('COMMIT')
            # Keep the rollback-journal directory transition durable before
            # returning a claim to the normal business caller. Failure here
            # leaves the committed reservation intact and blocks further work.
            directory=os.open(self.path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(directory)
            finally:os.close(directory)
            self._budget()
        except BaseException as error:
            self.failed=self.failed or str(error)
            if self.db.in_transaction:
                try:self.db.execute('ROLLBACK')
                except sqlite3.Error:pass # Preserve the first failed durable write.
            raise

    def _meta(self,key):return self.db.execute('SELECT value FROM metadata WHERE key=?',(key,)).fetchone()[0]
    def _set(self,key,value):self.db.execute('UPDATE metadata SET value=? WHERE key=?',(str(value),key))
    @property
    def next_release(self):return int(self._meta('released'))
    @property
    def terminal_count(self):return self.db.execute("SELECT count(*) FROM rows WHERE status IN ('qualified','failed','unknown')").fetchone()[0]

    def _record(self,event):
        require(type(event.get('atNs')) is int and 0<=event['atNs']<1<<63,'bounded original event clock required')
        index=event.get('index')
        if index is not None:
            require(self.db.execute('SELECT count(*) FROM events WHERE idx=?',(index,)).fetchone()[0]<MAX_EVENTS_PER_OPERATION,
                    'original operation event budget exceeded; preserve pending')
        self.db.execute('INSERT INTO events(idx,kind,at_ns,data) VALUES(?,?,?,?)',(index,event['kind'],event['atNs'],encoded(event)))

    def _publish(self,event):
        try:self.emit(event)
        except BaseException as error:
            self.failed=self.failed or str(error);raise # The committed claim stays durable.

    def release(self,now):
        require(self._meta('sealed')=='false','original observation cutoff is sealed; no new releases')
        require(type(now) is int and 0<=now<1<<63,'original monotonic release required')
        old=self.next_release
        end=min(self.plan['configuredDemand'],now*self.plan['requestedOfferedTPS']//1_000_000_000+1)
        require(now>=int(self._meta('lastRelease')),'original release clock regressed')
        if end==old:return
        event=dict(kind='logical_release_range',firstIndex=old,endIndexExclusive=end,atNs=now)
        with self._transaction():
            self.db.execute('INSERT INTO releases VALUES(?,?,?)',(old,end,now))
            self._set('released',end);self._set('lastRelease',now);self._record(event)
        self._publish(event)

    def row(self,index):
        require(type(index) is int and 0<=index<self.plan['configuredDemand'],'original demand index required')
        value=self.db.execute('SELECT data FROM rows WHERE idx=?',(index,)).fetchone()
        if value:return json.loads(value[0])
        row=initial_row(self.plan,index)
        if index<self.next_release:
            release=self.db.execute('SELECT at_ns FROM releases WHERE first_idx<=? ORDER BY first_idx DESC LIMIT 1',(index,)).fetchone()
            require(release is not None,'original release range missing')
            row.update(status='queued',activeStage='account_queue',releasedNs=release[0])
        return row

    def _save_account(self,account,turn,insert=False):
        values=(account['pending'],int(account['quarantined']),account['used'],account['capacity'],turn,encoded(account),account['ownerIndex'])
        if insert:self.db.execute('INSERT INTO owners(pending,quarantined,used,capacity,free_turn,data,owner) VALUES(?,?,?,?,?,?,?)',values)
        else:self.db.execute('UPDATE owners SET pending=?,quarantined=?,used=?,capacity=?,free_turn=?,data=? WHERE owner=?',values)

    def _save_row(self,row):
        for key in CLOCKS:
            require(row[key] is None or type(row[key]) is int and 0<=row[key]<1<<63,'bounded original clock required')
        columns=['id','operation_id','hash','status',*CLOCKS,'error_at','data']
        values=[row['id'],row['operationId'],row['hash'],row['status'],*[row[key] for key in CLOCKS],
                row.get('terminalNs') if row['error'] is not None else None,encoded(row)]
        names=','.join(['idx',*columns]);placeholders=','.join('?' for _ in range(len(values)+1))
        update=','.join(name+'=excluded.'+name for name in columns)
        self.db.execute('INSERT INTO rows('+names+') VALUES('+placeholders+') ON CONFLICT(idx) DO UPDATE SET '+update,[row['index'],*values])
        for name,(start,end) in INTERVALS.items():
            if row[start] is not None and row[end] is not None:
                value=row[end]-row[start];require(value>=0,'original interval regressed')
                self.db.execute('INSERT INTO intervals VALUES(?,?,?) ON CONFLICT(metric,idx) DO UPDATE SET value=excluded.value',
                                (name,row['index'],value))

    def reserve(self,now):
        require(self._meta('sealed')=='false','original observation cutoff is sealed; no new claims')
        require(type(now) is int and 0<=now<1<<63,'original monotonic claim required')
        with self._transaction():
            index=int(self._meta('claimed'))
            if index>=self.next_release:return None
            value=self.db.execute('SELECT data,free_turn FROM owners WHERE pending IS NULL AND quarantined=0 AND used<capacity ORDER BY free_turn LIMIT 1').fetchone()
            if value is None:return None
            account=json.loads(value[0]);row=self.row(index);events=[]
            require(now>=row['releasedNs'],'claim cannot predate original release')
            reducer=SimpleNamespace(plan=self.plan,rows=_OneRow(row,self.plan['configuredDemand']),
                accounts={account['ownerIndex']:account},free=collections.deque([account['ownerIndex']]),waiting=collections.deque([index]),emit=events.append)
            result=original.Ledger.reserve(reducer,now)
            require(result is not None and len(events)==1,'original reserve did not produce one claim')
            self._save_row(row);self._save_account(account,value[1]);self._set('claimed',index+1);self._record(events[0])
        self._publish(events[0]) # Successful return is after FULL durable commit.
        return result

    def event(self,event):
        require(type(event) is dict and type(event.get('index')) is int,'original event required')
        with self._transaction():
            row=self.row(event['index'])
            require(row['ownerIndex'] is not None,'unclaimed demand cannot have an outcome')
            require(event.get('id')==row['id'] and type(event.get('atNs')) is int and 0<=event['atNs']<1<<63,
                    'original operation event identity/clock differs')
            cutoff=self._meta('sealed')
            if cutoff!='false':
                self._record(dict(kind='late_original_event',index=row['index'],id=row['id'],atNs=event['atNs'],original=event))
                # The caller must drain the original observation queue BEFORE
                # seal. Receipt accounting is frozen even if a later consumer
                # presents an earlier timestamp; preserve it for reconciliation.
                return
            value=self.db.execute('SELECT data,free_turn FROM owners WHERE owner=?',(row['ownerIndex'],)).fetchone()
            account=json.loads(value[0]);published=[]
            reducer=SimpleNamespace(plan=self.plan,rows=_OneRow(row,self.plan['configuredDemand']),
                accounts={account['ownerIndex']:account},hashes=_Hashes(self.db),free=collections.deque(),terminal_count=0,emit=published.append)
            original.Ledger.event(reducer,event)
            require(len(published)==1,'original reducer did not retain one event')
            turn=value[1]
            if reducer.free:
                turn=int(self._meta('freeTail'));self._set('freeTail',turn+1)
            self._save_row(row);self._save_account(account,turn);self._record(event)
        self._publish(event)

    def seal(self,cutoff):
        require(type(cutoff) is int and 0<=cutoff<1<<63 and self._meta('sealed')=='false',
                'one original observation cutoff required')
        with self._transaction():
            # The controller seals after draining observations made BEFORE the
            # cutoff. Never retroactively censor a nonce already released here.
            require(int(self._meta('lastRelease'))<cutoff,'cutoff precedes an already-applied original release')
            last_event=self.db.execute('SELECT max(at_ns) FROM events').fetchone()[0]
            require(last_event is None or last_event<cutoff,'cutoff precedes an already-applied original event')
            for key in CLOCKS:
                last=self.db.execute('SELECT max('+key+') FROM rows').fetchone()[0]
                require(last is None or last<cutoff,'cutoff precedes an already-applied original observation')
            self._set('sealed',cutoff);self._record(dict(kind='observation_cutoff',atNs=cutoff))

    def report(self,cutoff,first_cause=None):
        require(type(cutoff) is int and 0<=cutoff<1<<63,'original cutoff required')
        require(self._meta('sealed')==str(cutoff),'report requires the exact sealed original cutoff')
        n=self.plan['configuredDemand'];window=self.plan['windowNs'];released=self.next_release
        counts=dict(self.db.execute('SELECT status,count(*) FROM rows GROUP BY status'))
        counts['queued']=released-int(self._meta('claimed'));counts['not_released']=n-released
        def count(key,inside=False):
            return self.db.execute('SELECT count(*) FROM rows WHERE '+key+(' < ?' if inside else ' IS NOT NULL'),(window,) if inside else ()).fetchone()[0]
        summary=dict(schema='YNX-PQ-DURABLE-LOAD-ACCOUNTING/v1',configuredDemand=n,windowNs=window,
            observationCutoffNs=cutoff,windowCompleted=cutoff>=window,logicalReleased=released,notReleased=n-released,
            terminalCounts={key:value for key,value in counts.items() if value},submitted=count('submittedNs'),
            included=count('includedNs'),qualified=count('finalNs'),notQualified=n-count('finalNs'),
            submittedWithinWindow=count('submittedNs',True),qualifiedWithinWindow=count('finalNs',True),
            firstCause=first_cause or self.failed,accountState=[json.loads(r[0]) for r in self.db.execute('SELECT data FROM owners ORDER BY owner')],
            rowCountMaterialized=self.db.execute('SELECT count(*) FROM rows').fetchone()[0],
            eventCount=self.db.execute('SELECT count(*) FROM events').fetchone()[0],planSHA256=self.plan_sha256,
            lateOriginalEvents=self.db.execute("SELECT count(*) FROM events WHERE kind='late_original_event'").fetchone()[0],
            automaticRetry=False,runtimeAuthorized=False,pressureAuthorized=False,stableFinalTPS='UNMEASURED',
            interpretation='Durable parent observations only; original Core journal and normal verifier remain authoritative. Missing outcomes retain the full denominator; this is not a sustained throughput qualification.')
        for name in INTERVALS:
            observed=self.db.execute('SELECT count(*) FROM intervals WHERE metric=?',(name,)).fetchone()[0]
            values={}
            for p in (50,95,99):
                rank=(n*p+99)//100-1
                values['p%dMs'%p]=None if observed!=n else self.db.execute('SELECT value FROM intervals WHERE metric=? ORDER BY value,idx LIMIT 1 OFFSET ?',(name,rank)).fetchone()[0]/1e6
            summary[name]=dict(denominator=n,observed=observed,censored=n-observed,**values)
        error=self.db.execute('SELECT data FROM rows WHERE error_at IS NOT NULL ORDER BY error_at,idx LIMIT 1').fetchone()
        row=None if error is None else json.loads(error[0])
        summary['firstOperationalFailure']=None if row is None else dict(index=row['index'],id=row['id'],atNs=row['terminalNs'],error=row['error'])
        summary['unresolvedClaimed']=sum(a['pending'] is not None for a in summary['accountState'])
        return summary

    def export_rows(self,path,*,max_bytes):
        require(not self.read_only,'read-only original audit cannot create a new export')
        require(type(max_bytes) is int and 0<max_bytes<=MAX_DB_BYTES,'bounded complete row export required')
        target=Path(path);require(target.parent.resolve(strict=True)==self.path.parent and target!=self.path,'fresh sibling export required')
        fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);digest=hashlib.sha256();size=0
        try:
            with os.fdopen(fd,'wb') as out:
                for index in range(self.plan['configuredDemand']):
                    self._budget();raw=(encoded(self.row(index))+'\n').encode()
                    require(size+len(raw)<=max_bytes,'complete row export exceeds bound; preserve partial, never truncate denominator')
                    out.write(raw);digest.update(raw);size+=len(raw)
                out.flush();os.fsync(out.fileno())
        except BaseException:raise # Preserve partial export; no overwrite/retry.
        return dict(path=str(target),rows=self.plan['configuredDemand'],bytes=size,sha256=digest.hexdigest(),complete=True)

    def audit(self):
        """Interrupted claims are UNKNOWN work for the original owner, not retries."""
        pending=[json.loads(row[0]) for row in self.db.execute('SELECT data FROM owners WHERE pending IS NOT NULL ORDER BY owner')]
        return dict(schema=SCHEMA,configuredDemand=self.plan['configuredDemand'],logicalReleased=self.next_release,
                    claimed=int(self._meta('claimed')),originalPending=pending,
                    pendingMeaning='Controller reservations require original-operation reconciliation; no nonce release or signing permission.',
                    sealedCutoffNs=None if self._meta('sealed')=='false' else int(self._meta('sealed')),
                    readOnly=self.read_only,automaticRetry=False,runtimeAuthorized=False,pressureAuthorized=False)

    def close(self):
        if not self.closed:self.db.close();self.closed=True


def open_readonly(path,plan,expected_plan_sha256,*,max_db_bytes=1<<30):
    """Audit only, including pending originals after an interrupted process."""
    value=DurableLedger.__new__(DurableLedger);value.path=Path(path);value.plan=freeze_plan(plan);plan=value.plan
    require(value.path.is_absolute() and value.path.resolve(strict=True)==value.path and not value.path.is_symlink(),
            'canonical original ledger required')
    info=value.path.stat();require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and 0<info.st_size<=max_db_bytes<=MAX_DB_BYTES,
                                   'bounded original regular ledger required')
    value.identity=(info.st_dev,info.st_ino)
    value.db=sqlite3.connect(value.path.as_uri()+'?mode=ro',uri=True,isolation_level=None,timeout=1)
    value.db.execute('PRAGMA query_only=ON');value.db.execute('PRAGMA cache_size=-4096');value.db.execute('PRAGMA mmap_size=0')
    try:
        metadata={key:item for key,item in plan.items() if key!='rows'}
        digest=hashlib.sha256(encoded(metadata,MAX_PLAN_BYTES).encode()).hexdigest()
        require(value._meta('schema')==SCHEMA and digest==expected_plan_sha256==value._meta('planSHA256')
                and encoded(metadata,MAX_PLAN_BYTES)==value._meta('plan'),'original durable plan binding differs')
    except BaseException:value.db.close();raise
    value.plan_sha256=digest;value.max_db_bytes=max_db_bytes;value.failed=None;value.read_only=True;value.closed=False
    value.check_resources=lambda:None
    return value
