"""Private synthetic pre-sign reservation barrier for the ORIGINAL ledger.

This consumes an already-owned Unix socketpair, not a network endpoint. The
normal producer/source gate is deliberately closed. The private exchange is
also used by bounded process controls; it does not identify a process, verify
custody, sign, authenticate a proof, release a nonce, or reconnect an attempt.
"""
import importlib.util
import math
import os
from pathlib import Path
import select
import socket
import stat
import time


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

original=module('pq-enrollment-original-command.py')
d=module('pq-durable-demand-ledger.py')
b=original.b;c=original.c;require=b.require
NORMAL_RESERVATION_PRODUCER=None
INSPECTED_SYNTHETIC_HANDSHAKE='95b16ee7e21b8bc37dc7871f16919fc879a79a0c'
# Exact test-only frames were inspected at this source. This is NOT a normal
# callee, binary allowlist, CI qualification or permission to spawn a producer.
FRAME_LIMIT=32<<10
PREFIX='YNX-PQ-ENROLLMENT-RESERVE-'
FIELDS={
    'READY':('version','sourceCommit','root','planPath','planSHA256','workloadPath','workloadSHA256',
             'ownerIndex','ownerAddress','nextNonce'),
    'INIT':('version','sourceCommit','index','fundingOperationId','ownerIndex','fundingNonce'),
    'REQUEST':('version','sourceCommit','index','planSHA256','workloadSHA256','requestSHA256','request'),
    'ACK':('version','status','sourceCommit','index','requestSHA256','fundingOperationId','migrationOperationId',
           'ownerIndex','fundingNonce','signingAuthorized','nonceReleased','automaticRetry')}


def frame(kind,value):
    b.closed(value,FIELDS[kind],'closed original '+kind+' reservation frame required')
    require(value['version']==PREFIX+kind+'/v1','original reservation version differs')
    raw=original.canonical({key:value[key] for key in FIELDS[kind]})+b'\n'
    require(len(raw)<=FRAME_LIMIT,'original reservation frame exceeded bound');return raw


def decode(kind,raw):
    require(type(raw) is bytes and 1<len(raw)<=FRAME_LIMIT and raw.endswith(b'\n'),
            'bounded complete original reservation frame required')
    value=d.enrollment.strict(raw[:-1],FRAME_LIMIT-1)
    require(frame(kind,value)==raw,'exact canonical original reservation frame required')
    return value


def unknown():
    return dict(schema='YNX-PERF-ENROLLMENT-RESERVATION-EXCHANGE/v1',status='UNKNOWN',
        readyObserved=False,initBytesSent=0,requestObserved=False,reservationReturnObserved=False,
        ackBytesSent=0,ackSendCompleted=False,ackReceiptObserved=False,signingObserved=False,
        operationIdentity='UNKNOWN',currentEligibility='UNKNOWN',signingAuthorized=False,
        nonceReleased=False,automaticRetry=False,runtimeAuthorized=False,pressureAuthorized=False,
        sourceCIQualified=False,peerProcessIdentityVerified=False,functionalControlOnly=True,offeredLoadExecuted=False,
        firstCause=None,cleanupErrors=[],
        originalFramesRetained=False,cleanupDebt=False,missingEvidence=[])


class PinnedOriginals:
    """Independent launch pins, read BEFORE READY; no current-state authority."""
    def __init__(self,root,source,plan_sha256,workload_sha256):
        self.root=Path(root);self.source=source
        require(self.root.is_absolute() and str(self.root)==str(root) and self.root.resolve(strict=True)==self.root,
                'canonical original synthetic root required')
        info=self.root.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid==os.geteuid() and not info.st_mode&0o077,
                'private original synthetic root required')
        self.identity=(info.st_dev,info.st_ino)
        require(d.enrollment.inspected_source(source) and b.hex_pin(plan_sha256) and b.hex_pin(workload_sha256),
                'independently pinned inspected source/plan/workload required')
        self.plan_pin=plan_sha256;self.workload_pin=workload_sha256
        self.plan_path=self.root/'network-plan.json';self.workload_path=self.root/'workload/PUBLIC-WORKLOAD.json'
        self.plan_raw=c.read(self.plan_path,1<<20);self.workload_raw=c.read(self.workload_path,8<<20)
        require(b.sha(self.plan_raw)==plan_sha256 and b.sha(self.workload_raw)==workload_sha256,
                'independent original file SHA differs')
        plan=d.enrollment.strict(self.plan_raw,1<<20);w=d.enrollment.strict(self.workload_raw,8<<20)
        require(type(plan) is dict and plan.get('version')=='YNX-PQ-LOOPBACK-NETWORK/v1'
                and plan.get('syntheticOnly') is True and plan.get('publicNetwork') is False
                and plan.get('rootDir')==str(self.root) and plan.get('nativeChainId')=='642399',
                'original synthetic plan scope differs')
        require(type(w) is dict and w.get('version')=='YNX-PQ-LOOPBACK-WORKLOAD/v1'
                and w.get('syntheticOnly') is True and w.get('networkStarted') is False
                and w.get('deployedSourceQualification') is False and w.get('authorityGranted') is False
                and w.get('mode')=='online' and w.get('nativeChainId')==plan['nativeChainId']
                and all(b.hex_pin(plan.get(key)) and w.get(key)==plan[key]
                        for key in ('originalGenesisHash','migrationStateHash'))
                and w.get('ownerCapacity')=='5' and w.get('totalMemberCapacity')=='500'
                and w.get('batchSize')=='1' and w.get('outstandingPerOwner')=='1'
                and w.get('batchWaitNanoseconds')=='0' and 'transactions' in w and w['transactions'] is None,
                'exact five-owner original online workload required')
        owners=w.get('owners');require(type(owners) is list and len(owners)==5,'five original owners required')
        require(all(type(o) is dict and type(o.get('index')) is int and o['index']==i
                    and type(o.get('owner')) is str and 0<len(o['owner'])<=128
                    and o.get('initialNonce')=='1' and o.get('memberCapacity')=='100'
                    for i,o in enumerate(owners)) and len({o['owner'] for o in owners})==5,
                'original owner identities/nonce/capacity differ')
        self.owner=dict(ownerIndex=4,address=owners[4]['owner'],nextNonce=2,capacity=100)
        self.check()

    def check(self):
        info=self.root.lstat()
        require(stat.S_ISDIR(info.st_mode) and (info.st_dev,info.st_ino)==self.identity
                and info.st_uid==os.geteuid() and not info.st_mode&0o077,'original synthetic root changed')
        require(c.read(self.plan_path,1<<20)==self.plan_raw and c.read(self.workload_path,8<<20)==self.workload_raw,
                'original pinned bytes changed during reservation')

    def plan(self):
        return d.make_plan(self.plan_pin,self.workload_pin,'online',[self.owner],100,
                           1_000_000_000,1_000_000_000,enabled=True)


class PrivateTranscript:
    """Exclusive bounded public frames in an owner-only PRIVATE directory."""
    NAMES=frozenset(('ready.jsonl','init.jsonl','request.jsonl','ack-intent.jsonl','result.json'))
    def __init__(self,path):
        self.path=Path(path);self.fd=None;self.parent=None;self.closed=False;self.attempted=set();self.retained={}
        require(self.path.is_absolute() and self.path.parent.resolve(strict=True)==self.path.parent,
                'original canonical transcript parent required')
        self.parent=os.open(self.path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
        try:
            self.parent_info=os.fstat(self.parent)
            require(self.parent_info.st_uid==os.geteuid() and not self.parent_info.st_mode&0o077,
                    'private original transcript parent required')
            os.mkdir(self.path.name,0o700,dir_fd=self.parent)
            self.fd=os.open(self.path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=self.parent)
            self.info=os.fstat(self.fd);os.fsync(self.fd);os.fsync(self.parent);self.check()
        except BaseException:
            try:self.close()
            except BaseException:pass # Keep the original creation/barrier failure.
            raise

    def check(self):
        current=self.path.lstat();parent=self.path.parent.lstat()
        require(not self.closed and stat.S_ISDIR(current.st_mode) and stat.S_IMODE(current.st_mode)==0o700
                and (current.st_dev,current.st_ino)==(self.info.st_dev,self.info.st_ino)
                and (parent.st_dev,parent.st_ino)==(self.parent_info.st_dev,self.parent_info.st_ino),
                'original transcript directory identity changed')

    def write(self,name,raw):
        require(name in self.NAMES and type(raw) is bytes and 0<len(raw)<=FRAME_LIMIT,
                'bounded original reservation transcript required')
        self.attempted.add(name);self.check()
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=self.fd);failure=None
        try:
            initial=os.fstat(fd);pending=memoryview(raw)
            while pending:
                n=os.write(fd,pending);require(n>0,'original transcript short write');pending=pending[n:]
            os.fsync(fd);os.fsync(self.fd);self.check()
            current=os.fstat(fd);named=os.stat(name,dir_fd=self.fd,follow_symlinks=False)
            require(b.metadata(current)==b.metadata(named) and current.st_size==len(raw)
                    and current.st_nlink==1 and stat.S_IMODE(current.st_mode)==0o600
                    and (current.st_dev,current.st_ino)==(initial.st_dev,initial.st_ino),
                    'original transcript file identity changed')
        except BaseException as error:failure=error
        finally:
            try:os.close(fd)
            except BaseException as error:failure=failure or error
        if failure is not None:raise failure
        self.retained[name]=dict(bytes=len(raw),sha256=b.sha(raw),status='RETAINED')

    def close(self):
        self.closed=True;errors=[]
        for name in ('fd','parent'):
            fd=getattr(self,name,None)
            if fd is not None:
                setattr(self,name,None)
                try:os.close(fd)
                except Exception as error:errors.append(error)
        if errors:raise errors[0]


class ReservationExchange:
    """One socket instance, one INIT, one ACK; failures permanently stop it.

    The process owner must independently bind its original Popen/source/binary.
    This layer cannot claim SO_PEERCRED identifies a child for a parent-created
    pair. The same ledger and transcript survive every uncertain outcome.
    """
    def __init__(self,peer,ledger,pins,transcript,*,timeout=90,stop=None,enabled=False):
        require(enabled is True,'private original reservation is explicitly opt-in')
        require(type(timeout) in (int,float) and math.isfinite(timeout) and .05<=timeout<=90,
                'bounded original reservation deadline required')
        require(isinstance(peer,socket.socket) and peer.family==socket.AF_UNIX
                and peer.getsockopt(socket.SOL_SOCKET,socket.SO_TYPE)==socket.SOCK_STREAM
                and peer.getsockname() in ('',b'') and peer.getpeername() in ('',b'') and 3<=peer.fileno()<=4096,
                'original unnamed connected Unix stream socketpair required')
        require(isinstance(pins,PinnedOriginals) and isinstance(transcript,PrivateTranscript)
                and not ledger.read_only and not ledger.closed and ledger.failed is None
                and ledger.next_release==0 and ledger.audit()['claimed']==0,
                'fresh original writable ledger and private transcript required')
        require(d.encoded({k:v for k,v in ledger.plan.items() if k!='rows'},d.MAX_PLAN_BYTES)==
                d.encoded({k:v for k,v in pins.plan().items() if k!='rows'},d.MAX_PLAN_BYTES),
                'original durable plan does not match independently pinned workload')
        self.peer,self.ledger,self.pins,self.transcript=peer,ledger,pins,transcript
        self.timeout,self.stop,self.used=timeout,stop,False
        self.out=unknown();self.out.update(sourceCommit=pins.source,planSHA256=pins.plan_pin,workloadSHA256=pins.workload_pin)
        self.origin=None;self.row=None;self.deadline=None
        self.partial=None

    def check(self):
        if self.stop is not None and self.stop.is_set():raise InterruptedError('original reservation cancelled; preserve pending')
        if time.monotonic()>=self.deadline:raise TimeoutError('original reservation socket deadline exceeded')
        self.ledger.check_resources()

    def receive(self,kind):
        raw=bytearray();self.partial=(kind,raw)
        while True:
            self.check()
            if not select.select([self.peer],[],[],min(.05,max(0,self.deadline-time.monotonic())))[0]:continue
            try:part=self.peer.recv(min(4096,FRAME_LIMIT+1-len(raw)))
            except BlockingIOError:continue
            if not part:raise EOFError('original '+kind+' frame ended early')
            raw.extend(part)
            if b'\n' in part:
                require(raw.endswith(b'\n') and raw.count(b'\n')==1,'one original reservation frame at a time required')
                return bytes(raw)
            require(len(raw)<FRAME_LIMIT,'original reservation frame exceeded bound')

    def send(self,raw,key):
        offset=0
        while offset<len(raw):
            self.check()
            if not select.select([],[self.peer],[],min(.05,max(0,self.deadline-time.monotonic())))[1]:continue
            try:n=self.peer.send(memoryview(raw)[offset:])
            except BlockingIOError:continue
            require(n>0,'original reservation socket short write');offset+=n;self.out[key]=offset

    def run(self):
        require(not self.used,'original reservation attempt cannot be retried');self.used=True
        start=time.monotonic_ns();self.deadline=time.monotonic()+self.timeout;interrupted=None
        try:
            self.peer.setblocking(False);self.check();self.pins.check()
            raw=self.receive('READY');self.transcript.write('ready.jsonl',raw);ready=decode('READY',raw)
            expected=dict(version=PREFIX+'READY/v1',sourceCommit=self.pins.source,root=str(self.pins.root),
                planPath=str(self.pins.plan_path),planSHA256=self.pins.plan_pin,workloadPath=str(self.pins.workload_path),
                workloadSHA256=self.pins.workload_pin,ownerIndex=4,ownerAddress=self.pins.owner['address'],nextNonce='2')
            require(type(ready['ownerIndex']) is int and ready==expected,'original READY differs from independent launch pins')
            self.out['readyObserved']=True;self.pins.check();self.check()
            self.origin=time.monotonic_ns()
            # One actual release is a bounded function control. Retain all 100
            # logical rows; this is not a 100/s offered-load window.
            now=time.monotonic_ns()-self.origin;self.ledger.release_observed(0,1,now)
            self.row,account=self.ledger.reserve(time.monotonic_ns()-self.origin)
            require(self.row['index']==0 and account['ownerIndex']==4,'original first reservation differs')
            self.out.update(index=self.row['index'],fundingOperationId=self.row['operationId'],ownerIndex=4,
                            fundingNonce=str(self.row['nonce']),clockOriginMonotonicNs=self.origin)
            init=dict(version=PREFIX+'INIT/v1',sourceCommit=self.pins.source,index=self.row['index'],
                      fundingOperationId=self.row['operationId'],ownerIndex=4,fundingNonce=str(self.row['nonce']))
            raw=frame('INIT',init);self.transcript.write('init.jsonl',raw);self.send(raw,'initBytesSent')
            raw=self.receive('REQUEST');self.transcript.write('request.jsonl',raw);request=decode('REQUEST',raw)
            require(type(request['index']) is int and request['index']==self.row['index']
                    and request['sourceCommit']==self.pins.source and request['planSHA256']==self.pins.plan_pin
                    and request['workloadSHA256']==self.pins.workload_pin,'original REQUEST identity differs')
            request_raw=original.canonical(request['request']);r=d.enrollment.request(request_raw)
            require(b.hex_pin(request['requestSHA256']) and b.sha(request_raw)==request['requestSHA256'],
                    'original canonical request SHA differs')
            self.out.update(requestObserved=True,requestSHA256=request['requestSHA256'],migrationOperationId=r['migrationOperationId'])
            self.check();self.pins.check()
            retained=self.ledger.prepare_enrollment_pair(self.row['index'],request_raw,request['requestSHA256'],
                self.pins.source,time.monotonic_ns()-self.origin,enabled=True)
            require(retained['status']=='LOCAL_RESERVATION_RETAINED' and retained['requestSHA256']==request['requestSHA256']
                    and retained['sourceCommit']==self.pins.source
                    and all(retained[k] is False for k in ('signingAuthorized','nonceReleased','automaticRetry')),
                    'original durable reservation return differs')
            self.out.update(reservationReturnObserved=True,reservationDurabilityElapsedNs=retained['durabilityElapsedNs'])
            self.pins.check();self.check()
            ack=dict(version=PREFIX+'ACK/v1',status=retained['status'],sourceCommit=self.pins.source,index=self.row['index'],
                requestSHA256=request['requestSHA256'],fundingOperationId=r['fundingOperationId'],
                migrationOperationId=r['migrationOperationId'],ownerIndex=r['ownerIndex'],fundingNonce=r['fundingNonce'],
                signingAuthorized=False,nonceReleased=False,automaticRetry=False)
            raw=frame('ACK',ack);self.transcript.write('ack-intent.jsonl',raw);self.send(raw,'ackBytesSent')
            self.out['ackSendCompleted']=True
        except BaseException as error:
            self.out['firstCause']=dict(type=type(error).__name__,message=d.failure_message(error))
            if not isinstance(error,Exception):interrupted=error
        finally:
            if self.partial is not None:
                kind,partial=self.partial;name=kind.lower()+'.jsonl'
                if partial and name not in self.transcript.attempted:
                    self.out['frameReadIncomplete']=True;self.out['frameReadTruncated']=len(partial)>=FRAME_LIMIT
                    try:self.transcript.write(name,bytes(partial[:FRAME_LIMIT]))
                    except Exception as error:self.out['cleanupErrors'].append(dict(type=type(error).__name__,message=d.failure_message(error)))
            # The child can only observe EOF, never a reconnect/retransmission.
            try:self.peer.close()
            except Exception as error:self.out['cleanupErrors'].append(dict(type=type(error).__name__,message=d.failure_message(error)))
            self.out['elapsedNs']=time.monotonic_ns()-start
            self.out['deadlineScope']='socket IO; original filesystem/SQLite/guard calls are not interruptible here'
            # A successful send is still UNKNOWN until the original producer
            # and outboxes are reconciled. Stop this live ledger in every case.
            self.ledger.failed=self.ledger.failed or (self.out['firstCause'] or {}).get('message') or 'original reservation handed off; UNKNOWN, no retry'
            attempted=self.transcript.attempted-{'result.json'}
            retained={name:value for name,value in self.transcript.retained.items() if name!='result.json'}
            self.out['frameRetention']={name:retained.get(name,dict(status='NOT_RETAINED')) for name in sorted(attempted)}
            self.out['originalFramesRetained']=bool(attempted) and attempted==set(retained) and not self.out.get('frameReadTruncated',False)
            self.out['cleanupDebt']=bool(self.out['cleanupErrors']) or attempted!=set(retained)
            try:
                self.transcript.write('result.json',original.canonical(self.out))
            except Exception as error:
                failure=dict(type=type(error).__name__,message=d.failure_message(error))
                self.out['cleanupErrors'].append(failure);self.out['cleanupDebt']=True
                self.out['firstCause']=self.out['firstCause'] or failure
            self.out['resultRetention']=self.transcript.retained.get('result.json',dict(status='NOT_RETAINED'))
        if interrupted is not None:raise interrupted
        return self.out


def normal_reservation(*,enabled=False,**unused):
    require(enabled is True,'normal pre-sign reservation is explicitly opt-in')
    require(NORMAL_RESERVATION_PRODUCER is None,'normal producer needs a fixed owning implementation, not caller qualification')
    out=unknown();out['missingEvidence']=['fixedNormalSyntheticProducerAndSameSourceBinary',
        'completeSameSourceCI','originalOwnedProcessAndIndependentCreatePins']
    return out


def audit_private_reservation(*,pins,transcript,database,database_pin,file_pins,enabled=False):
    """Join stopped ORIGINAL bytes, including Core's persisted peer ACK.

    This never runs the producer or authenticates its marker/MAC/proofs. Even
    both request files plus the peer ACK are only an original byte relation.
    A re-opened DB cannot reconstruct successful return/delivery or re-ACK.
    All inputs are private; the returned projection contains no raw requests.
    Caller pins do not supply source CI, process identity or current authority.
    """
    require(enabled is True,'private original reservation audit is explicitly opt-in')
    out=unknown();out.update(localPairReservationObserved=False,originalLedgerReadOnly=False,
        peerAckBytesMatch=False,bothOutboxRequestBytesMatch=False,durabilityReturnReconstructed=False,
        originalPins={},privateDataExported=False)
    require(isinstance(pins,PinnedOriginals),'independent original launch pins required')
    out.update(sourceCommit=pins.source,planSHA256=pins.plan_pin,workloadSHA256=pins.workload_pin)
    b.closed(database_pin,('bytes','sha256','planSHA256'),'closed stopped original database pin required')
    require(type(database_pin['bytes']) is int and 0<database_pin['bytes']<=b.accounting.DB_LIMIT
            and b.hex_pin(database_pin['sha256']) and b.hex_pin(database_pin['planSHA256']),
            'bounded original database byte pin required')
    names=('ready.jsonl','init.jsonl','request.jsonl','ack-intent.jsonl','result.json',
           'SYNTHETIC-ENROLLMENT-ATTEMPT.json','SYNTHETIC-ENROLLMENT-PEER-ACK.json')
    b.closed(file_pins,names,'all independent original handshake file pins required')
    for pin in file_pins.values():
        b.closed(pin,('bytes','sha256'),'closed original handshake file pin required')
        require(type(pin['bytes']) is int and 0<pin['bytes']<=FRAME_LIMIT and b.hex_pin(pin['sha256']),
                'bounded original handshake file byte pin required')
    def private_read(path,limit):
        with c.held(path,limit) as (value,fd):
            info=os.fstat(fd)
            require(stat.S_IMODE(info.st_mode)==0o600 and info.st_uid==os.geteuid(),
                    'owner-only original handshake file required')
            return value
    ledger=None;db_expected={key:database_pin[key] for key in ('bytes','sha256')}
    failed=False
    try:
        pins.check();path=Path(database);directory=Path(transcript)
        require(b.accounting.pin(path,b.accounting.DB_LIMIT)==db_expected,'stopped original database SHA differs')
        ledger=d.open_readonly(path,pins.plan(),database_pin['planSHA256'],max_db_bytes=b.accounting.DB_LIMIT)
        out['originalLedgerReadOnly']=True;out['originalPins']['database']=dict(database_pin)
        values={}
        for name in names:
            file=(pins.root if name.startswith('SYNTHETIC-') else directory)/name
            value=private_read(file,FRAME_LIMIT)
            require(file_pins[name]==dict(bytes=len(value),sha256=b.sha(value)),
                    'independent original handshake file SHA differs: '+name)
            values[name]=value;out['originalPins'][name]=dict(file_pins[name])
        ready=decode('READY',values['ready.jsonl']);init=decode('INIT',values['init.jsonl'])
        request=decode('REQUEST',values['request.jsonl']);ack=decode('ACK',values['ack-intent.jsonl'])
        expected_ready=dict(version=PREFIX+'READY/v1',sourceCommit=pins.source,root=str(pins.root),
            planPath=str(pins.plan_path),planSHA256=pins.plan_pin,workloadPath=str(pins.workload_path),
            workloadSHA256=pins.workload_pin,ownerIndex=4,ownerAddress=pins.owner['address'],nextNonce='2')
        require(type(ready['ownerIndex']) is int and ready==expected_ready,'retained READY differs from independent original pins')
        require(type(init['index']) is int and init['index']==0 and type(init['ownerIndex']) is int
                and init['ownerIndex']==4 and init['fundingNonce']=='2' and init['sourceCommit']==pins.source,
                'retained INIT original row/source differs')
        require(type(request['index']) is int and request['index']==init['index']
                and request['sourceCommit']==pins.source and request['planSHA256']==pins.plan_pin
                and request['workloadSHA256']==pins.workload_pin,'retained REQUEST source/plan differs')
        request_raw=original.canonical(request['request']);r=d.enrollment.request(request_raw)
        require(b.sha(request_raw)==request['requestSHA256'],'retained original request SHA differs')
        reservation=ledger.read_enrollment_pair(init['index'],request['requestSHA256'])
        require(reservation.get('requestRaw')==request_raw and reservation.get('sourceCommit')==pins.source
                and init['fundingOperationId']==r['fundingOperationId'] and r['ownerIndex']==4 and r['fundingNonce']=='2',
                'original pair does not match retained private handshake')
        row=ledger.row(init['index']);pending=ledger.audit()['originalPending']
        require(row['operationId']==r['fundingOperationId'] and len(pending)==1 and pending[0]['pending']==init['index']
                and pending[0]['nextNonce']==2,'original handshake pending/nonce was released or replaced')
        expected_ack=dict(version=PREFIX+'ACK/v1',status='LOCAL_RESERVATION_RETAINED',sourceCommit=pins.source,index=init['index'],
            requestSHA256=request['requestSHA256'],fundingOperationId=r['fundingOperationId'],
            migrationOperationId=r['migrationOperationId'],ownerIndex=4,fundingNonce='2',
            signingAuthorized=False,nonceReleased=False,automaticRetry=False)
        require(values['ack-intent.jsonl']==frame('ACK',expected_ack),'retained original ACK differs')
        result=d.enrollment.strict(values['result.json'],FRAME_LIMIT)
        require(type(result) is dict and result.get('schema')==out['schema'] and result.get('status')=='UNKNOWN'
                and result.get('sourceCommit')==pins.source and result.get('planSHA256')==pins.plan_pin
                and result.get('workloadSHA256')==pins.workload_pin
                and result.get('requestSHA256')==request['requestSHA256']
                and result.get('fundingOperationId')==r['fundingOperationId'] and result.get('migrationOperationId')==r['migrationOperationId']
                and all(result.get(key) is False for key in ('signingAuthorized','nonceReleased','automaticRetry')),
                'original exchange result identity/authority differs')
        out.update(localPairReservationObserved=True,requestSHA256=request['requestSHA256'],
            fundingOperationId=r['fundingOperationId'],migrationOperationId=r['migrationOperationId'],
            originalExchangeFirstCause=result.get('firstCause'))
        marker=d.enrollment.strict(values['SYNTHETIC-ENROLLMENT-ATTEMPT.json'],FRAME_LIMIT)
        expected_marker=dict(version='YNX-PQ-SYNTHETIC-ENROLLMENT-ATTEMPT/v1',sourceCommit=pins.source,
            root=str(pins.root),planSHA256=pins.plan_pin,workloadSHA256=pins.workload_pin,outcome='UNKNOWN')
        require(marker==expected_marker and values['SYNTHETIC-ENROLLMENT-ATTEMPT.json']==original.canonical(expected_marker),
                'original synthetic attempt marker differs')
        require(values['SYNTHETIC-ENROLLMENT-PEER-ACK.json']==values['ack-intent.jsonl'][:-1],
                'original peer ACK does not match the retained single send intent')
        out['peerAckBytesMatch']=True
        for role in ('funding','migration'):
            file=pins.root/'workload/sender-public/0004'/r[role+'OperationId']/'request.json'
            value=private_read(file,16<<10)
            require(value==request_raw,'original '+role+' outbox request bytes differ')
            out['originalPins'][role+'OutboxRequest']=dict(bytes=len(value),sha256=b.sha(value))
        out['bothOutboxRequestBytesMatch']=True
    except FileNotFoundError:
        out['missingEvidence'].append('originalPrivateReservationFileOrDatabase')
    except Exception as error:
        failed=True;out['firstCause']=dict(type=type(error).__name__,message=d.failure_message(error))
    finally:
        if ledger is not None:
            try:ledger.close()
            except Exception as error:
                out['cleanupDebt']=True;out['firstCause']=out['firstCause'] or dict(type=type(error).__name__,message=d.failure_message(error))
            try:
                require(b.accounting.pin(Path(database),b.accounting.DB_LIMIT)==db_expected,'read-only original database changed')
                pins.check()
            except Exception as error:
                failed=True;out['firstCause']=out['firstCause'] or dict(type=type(error).__name__,message=d.failure_message(error))
        if failed:
            out['localPairReservationObserved']=False;out['peerAckBytesMatch']=False;out['bothOutboxRequestBytesMatch']=False
    return out
