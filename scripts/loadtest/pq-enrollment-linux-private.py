"""One hosted Linux synthetic reservation integration; never a load window.

Uses the original Window, Monitor, normal Core create/test/CLI and existing
private FD transport. Source admission is frozen here, not supplied by argv or
environment. Custody, transcript, SQLite and outboxes remain job-private.
"""
import argparse
import ctypes
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import signal
import shutil
import stat
import sys
import tempfile
import threading
import time


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

r=module('pq-enrollment-reservation-transport.py')
driver=module('pq-independent-load.py');lab=driver.lab
stopped_reader=module('pq-enrollment-stopped-readback.py')
require=r.require
# Exact normal integration source, inspected locally against original Git
# objects. This permits one synthetic test job, not source CI or runtime grants.
HOSTED_SYNTHETIC_SOURCE=dict(
    commit='9ae8c53359f5513c693d0820d79bd8d94b6a66a0',
    tree='5307338a908cdfe3d0f8bc0b6947b2f73479eae4',
    forkTree='47d7cfeee7cd178cb897eda57a4674677fac7e67',goVersion='1.26.11',
    blobs={
        'cmd/ynx-consensus-pq-lab/enrollment_original.go':'c9c5ab953240f6e2b1a55f89e662ae72c39de7d0',
        'internal/consensus/pq_lab_enrollment_original.go':'260ce946f8c76b63c15ff08a6d389138a74a8b52',
        'internal/consensus/pq_lab_enrollment_confirm.go':'6285b8973854eefec31f7efb53f1173829413a2f',
        'internal/consensus/pq_lab_enrollment_original_cli_test.go':'2beea214a67dd739fe23d527d51939b1abd998f5',
        'internal/consensus/pq_lab_enrollment_private_fixture_test.go':'9e5a46a73fad0c5a4e482de5e23f9358716553f4',
        'internal/consensus/pq_lab_enrollment_handshake_test.go':'f7a68a6b4f867adc67e864f66a8aed186f048811',
        'internal/consensus/pq_lab_enrollment_binary_fd_test.go':'c136f03816d062995d2f1b96278a772d49450aff'})
PUBLIC_NAME='SUMMARY.json'
# Process-level strong custody, not an automatic reaper or retry queue. A
# dynamic module/Window going out of scope must not discard an uncertain Popen.
# At interpreter/job exit the remaining operation is still UNKNOWN; descriptor
# closure on exit is NOT proof that its child/descendants have retired.
_CUSTODY=vars(sys).setdefault('_ynx_enrollment_fixture_custody_v1',
                            dict(lock=threading.Lock(),owners={}))
_READ_SCOPE_DEBT=[] # Strong custody of uncertain observer/FD shutdown; never retry.


def identity():
    value=HOSTED_SYNTHETIC_SOURCE
    require(value is not None,'fixed fetchable Core synthetic source not supplied')
    r.b.closed(value,('commit','tree','forkTree','goVersion','blobs'),'closed frozen synthetic source required')
    require(value['commit']==r.INSPECTED_SYNTHETIC_HANDSHAKE and all(
        type(value[k]) is str and re.fullmatch('[0-9a-f]{40}',value[k]) for k in ('commit','tree','forkTree')),
        'exact inspected source/tree/fork required')
    require(value['goVersion']=='1.26.11' and type(value['blobs']) is dict and value['blobs'],
            'original fixed toolchain and ABI blobs required')
    return value


def check_source(source):
    value=identity();actual=lab.check_source(source,value['commit'])
    require(actual=={k:value[k] for k in ('commit','tree','forkTree')},'original source tree/fork differs')
    for name,pin in value['blobs'].items():
        require(type(name) is str and name.startswith(('internal/consensus/','cmd/ynx-consensus-pq-lab/'))
                and '..' not in Path(name).parts and re.fullmatch('[0-9a-f]{40}',pin), 'frozen original ABI blob required')
        require(lab.git(source,'rev-parse','HEAD:'+name)==pin,'original Core ABI blob differs')
    return actual


def hosted_parent(parent):
    require(sys.platform=='linux' and os.environ.get('GITHUB_ACTIONS')=='true'
            and os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted','isolated GitHub-hosted Linux required')
    require(os.environ.get('GITHUB_RUN_ATTEMPT')=='1','original synthetic job cannot be rerun after UNKNOWN')
    require(re.fullmatch('[1-9][0-9]*',os.environ.get('GITHUB_RUN_ID','')),'original hosted run identity required')
    require(parent.is_absolute() and parent.resolve(strict=True)==parent,'canonical job-private parent required')
    temp=Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    require(parent==temp,'original RUNNER_TEMP parent required')
    return parent


def initial_report():
    return dict(schema='YNX-PERF-SYNTHETIC-RESERVATION-LINUX/v1',status='UNKNOWN',
        sourceCIQualified=False,runtimeAuthorized=False,pressureAuthorized=False,nativeGrant=False,
        nonceReleased=False,automaticRetry=False,privateDataExported=False,nodeStarted=False,
        businessLoadExecuted=False,normalFixtureTestPassed=False,localPairReservationObserved=False,
        peerAckBytesMatch=False,bothOutboxRequestBytesMatch=False,operationIdentity='UNKNOWN',
        stoppedReadback=stopped_reader.report(),stoppedReadResources=None,
        currentEligibility='UNKNOWN',cleanupComplete=False,cleanupDebt=False,firstCause=None,
        cleanupErrors=[],steps=[],missingEvidence=[],resourceSemantics=
        'Original periodic owned RSS/log/storage observations, not hard cgroup or hard log ceilings; '
        'sampled peaks are not lifetime peaks. GOMEMLIMIT is not a resource admission.')


def enable_original_subreaper():
    libc=ctypes.CDLL(None,use_errno=True)
    require(libc.prctl(36,1,0,0,0)==0,'original Linux subreaper unavailable')
    enabled=ctypes.c_int()
    require(libc.prctl(37,ctypes.byref(enabled),0,0,0)==0 and enabled.value==1,
            'original Linux subreaper readback differs')


class StoppedReadScope:
    """Same supervisor and owned storage, after original descendant retirement.

    Reuses original inventory/RSS/storage guards without touching stopped logs
    or restarting a Window. Samples are observations, never a continuous cap.
    The main-thread alarm bounds the read operation; the periodic observer has
    a separate bounded retirement, with unresolved handles retained as debt.
    """
    SECONDS=10
    def __init__(self,window):
        require(sys.platform=='linux' and threading.current_thread() is threading.main_thread(),
                'stopped originals require original Linux main-thread read scope')
        self.window=window;self.lock=threading.Lock();self.roots=[];self.monitor=None
        self.first=None;self.closed=False;self.closing=False;self.alarm=False;self.cleanup_debt=False;self.samples=0
        self.cleanup_errors=[]
        self.storage_bytes=None;self.last_storage=None
        self.peak=None;self.peak_bytes=None;self.first_ns=None;self.last_ns=None;self.fallback_kinds=set()
        self.pid=os.getpid();self.started=time.monotonic()
        self.until=min(self.started+self.SECONDS,window.started+lab.CAPS['totalSeconds']-1)
        self.stop=threading.Event();self.old_alarm=None
        with lab.bounded_original_lifecycle(window.lock,.05):
            require(window.closed_for_launch and window.launches_closed and not window.pending_launches
                and not window.launch_cleanup_debt and not getattr(window,'launch_cleanup_failure',None),
                'original stopped ownership is incomplete')
            require(all(vars(row['process']).get('returncode') is not None for row in window.children),
                    'original child is not reaped')
            self.known=dict(window.known);self.start_ticks=self.known.get(self.pid)
            paths=tuple(window.storage_roots)
            root_ids=dict(getattr(window,'_enrollment_storage_identities',{}))
        require(type(self.start_ticks) is int and self.start_ticks>0,'original supervisor startTicks missing')
        require(1<=len(paths)<=8 and Path(window.work) in paths,'original owned storage scope missing')
        self.paths=paths;self.root_ids=root_ids
    def _open_roots(self):
        for path in self.paths:
            path=Path(path)
            require(path.is_absolute() and path.resolve(strict=True)==path,'original storage path changed')
            fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
            # Own the raw FD before any following syscall can fail.
            self.roots.append((path,fd,None));info=os.fstat(fd);self.roots[-1]=(path,fd,info)
            require(self.root_ids.get(str(path))==(info.st_dev,info.st_ino),'pre-launch owned storage identity missing or changed')
        self._root_check()
    def _root_check(self):
        for path,fd,before in self.roots:
            current=path.lstat();held=os.fstat(fd)
            require(stat.S_ISDIR(current.st_mode) and (current.st_dev,current.st_ino)==(before.st_dev,before.st_ino)
                    ==(held.st_dev,held.st_ino) and current.st_uid==held.st_uid==os.geteuid(),
                    'original stopped storage identity differs')
    def _deadline(self):
        require(not self.closed and time.monotonic()<self.until,'original stopped read deadline exceeded')
    def sample(self,*,final=False):
        require(self.lock.acquire(timeout=.05),'original stopped read observer lock unavailable')
        try:return self._sample(force_storage=final)
        finally:self.lock.release()
    def _sample(self,*,force_storage=False):
        self._deadline();self._root_check()
        rows,_=lab.guard.proc_inventory()
        require(self.pid in rows and rows[self.pid]['startTicks']==self.start_ticks,
                'original stopped supervisor identity missing or changed')
        ids=lab.guard.owned_set(rows,self.pid,known=self.known)
        require(ids==[self.pid],'original descendants not retired at stopped read boundary')
        fallback=[];retired=[]
        size=lab.owned_rss(self.pid,rows[self.pid],retired.append,fallback.append)
        require(type(size) is int and size>=0 and not retired,'original live supervisor RSS unavailable')
        for entry in fallback:self.fallback_kinds.add(entry.get('sampleKind','UNKNOWN'))
        self.peak=size if self.peak is None else max(self.peak,size)
        # Preserve the original allocated-byte and regular-file inventory. No
        # new smaller cache/storage domain is substituted for the original one.
        now=time.monotonic()
        if force_storage or self.last_storage is None or now-self.last_storage>=1:
            self.storage_bytes=sum(lab.private_bytes(path) for path,_,_ in self.roots);self.last_storage=now
        storage=self.storage_bytes
        self.peak_bytes=storage if self.peak_bytes is None else max(self.peak_bytes,storage)
        require(size<=lab.CAPS['rssBytes'],'owned RSS exceeded 4GiB during stopped read')
        require(storage<=lab.CAPS['newBytes'],'new artifacts exceeded 8GiB during stopped read')
        require(shutil.disk_usage(self.window.work).free>=1<<30,'runtime disk reserve below 1GiB during stopped read')
        self._root_check();self._deadline()
        now=time.monotonic_ns();self.first_ns=now if self.first_ns is None else self.first_ns;self.last_ns=now;self.samples+=1
    def start(self):
        require(self.monitor is None and not self.closed,'stopped read scope is one-shot')
        require(signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0) and signal.getsignal(signal.SIGALRM)==signal.SIG_DFL,
                'original stopped read timer already owned')
        self.old_alarm=signal.getsignal(signal.SIGALRM)
        def deadline(_signum,_frame):raise TimeoutError('original stopped read alarm deadline')
        signal.signal(signal.SIGALRM,deadline);self.alarm=True
        signal.setitimer(signal.ITIMER_REAL,max(.001,self.until-time.monotonic()))
        self._open_roots()
        self.monitor=driver.Monitor(self,self.stop)
        self.sample();self.monitor.thread.start()
    def check(self,*,final=False):
        require(self.monitor is not None and not self.closing,'original stopped read observer not started or closing')
        self.monitor.check();self.sample(final=final);self.monitor.check()
    def close(self):
        if self.closed or self.closing:return
        self.closing=True
        def secondary(error):
            self.cleanup_debt=True
            self.cleanup_errors.append(failure(error))
            if self.first is None:self.first=failure(error)
        if self.alarm:
            self.alarm=False
            try:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,self.old_alarm)
            except BaseException as error:secondary(error)
        if self.monitor is not None:
            self.monitor.finished.set()
            if self.monitor.thread.ident is not None:
                try:self.monitor.thread.join(timeout=.5)
                except BaseException as error:secondary(error)
            if self.monitor.thread.is_alive():
                secondary(RuntimeError('original stopped read observer did not retire'))
                self.closed=True;_READ_SCOPE_DEBT.append(self);return
            snapshot=self.monitor.failure_snapshot()
            if snapshot is not None and self.first is None:
                self.first=dict(type=snapshot['errorType'],message=snapshot['originalError'])
        self.closed=True
        roots,self.roots=self.roots,[] # Single close responsibility, no reused FD retry.
        for _,fd,_ in roots:
            try:os.close(fd)
            except BaseException as error:secondary(error)
        if self.cleanup_debt:_READ_SCOPE_DEBT.append(self)
    def report(self):
        return dict(schema='YNX-PERF-STOPPED-READ-RESOURCES/v1',
            status='OBSERVED' if self.closed and self.samples>0 and self.first is None and not self.cleanup_debt else 'UNKNOWN',
            pid=self.pid,startTicks=self.start_ticks,samples=self.samples,firstSampleMonotonicNs=self.first_ns,
            lastSampleMonotonicNs=self.last_ns,peakSampledRSSOrUpperBoundBytes=self.peak,
            peakSampledOwnedBytes=self.peak_bytes,fallbackKinds=sorted(self.fallback_kinds),
            caps=dict(rssBytes=lab.CAPS['rssBytes'],ownedBytes=lab.CAPS['newBytes'],ownedProcesses=lab.guard.CAPS['ownedProcesses'],diskReserveBytes=1<<30),
            deadlineSeconds=self.SECONDS,originalTotalDeadlinePreserved=True,cleanupDebt=self.cleanup_debt,
            firstCauseType=None if self.first is None else self.first['type'],
            firstCauseSHA256=None if self.first is None else r.b.sha(r.original.canonical(self.first)),
            cleanupErrors=[dict(type=error['type'],sha256=r.b.sha(r.original.canonical(error))) for error in self.cleanup_errors],
            monitorRetired=self.monitor is not None and not self.monitor.thread.is_alive(),
            continuousRSSLimitProven=False,readOnly=True,normalWindowRestarted=False)


def finish_stopped_readback(window,lifecycle,out,handshake,binaries):
    """Actual job continuation after stop, never another producer invocation."""
    if handshake is None or binaries is None:
        out['stoppedReadback']['missingEvidence']=['originalStoppedHandshakePins'];return
    if not out['cleanupComplete'] or out['cleanupDebt'] or out.get('resourceFailureType') is not None:
        out['stoppedReadback']['missingEvidence']=['originalRetirementWithoutResourceDebt'];return
    process=None if lifecycle is None else lifecycle.process
    if process is None or type(vars(process).get('returncode')) is not int \
            or lifecycle.window is not window or lifecycle.registered is not True \
            or not any(row['process'] is process and row['name']=='original-enrollment-handshake' for row in window.children):
        out['stoppedReadback']['missingEvidence']=['originalReapedProducerHandle'];return
    scope=None
    try:
        scope=StoppedReadScope(window);scope.start()
        out['stoppedReadback']=stopped_reader.audit_stopped_originals(handshake=handshake,
            binary_pins={role+'SHA256':pin['sha256'] for role,pin in binaries.items()},
            stopped=dict(originalProcessReaped=True,ownedDescendantsRetired=True,cleanupDebt=False,firstCause=out['firstCause']),
            check_resources=scope.check,enabled=True)
        scope.check(final=True)
        observed=out['stoppedReadback']
        if observed['firstCauseType'] is not None:
            out['firstCause']=out['firstCause'] or dict(type=observed['firstCauseType'],message='original stopped byte read refused; see retained error SHA')
        if observed['cleanupDebt']:out['cleanupDebt']=True;out['cleanupComplete']=False
    except BaseException as error:
        original=None if scope is None or scope.monitor is None else scope.monitor.failure_snapshot()
        first=failure(error) if original is None else dict(type=original['errorType'],message=original['originalError'])
        out['firstCause']=out['firstCause'] or first
        if scope is not None and scope.first is None:scope.first=first
        if not isinstance(error,Exception):raise
    finally:
        if scope is not None:
            try:scope.close()
            except BaseException as error:
                scope.cleanup_debt=True
                scope.cleanup_errors.append(failure(error))
                if scope.first is None:scope.first=failure(error)
                if scope not in _READ_SCOPE_DEBT:_READ_SCOPE_DEBT.append(scope)
            out['stoppedReadResources']=scope.report()
            if scope.first is not None:out['firstCause']=out['firstCause'] or scope.first
            if scope.cleanup_debt:out['cleanupDebt']=True;out['cleanupComplete']=False
        if out['firstCause'] is not None or out['cleanupDebt']:
            for key in ('bothConfirmationByteBindingsObserved','bothOutboxByteBindingsObserved','coldRecoveryReplyBytesMatch'):
                out['stoppedReadback'][key]=False


class PendingFixtureLaunch:
    """Same original Window's pending admission for the bounded pipe callee.

    Popen happens outside Window.lock. No second constructor, reaper or signal
    owner is created. The original Window can observe/cancel its descendant
    closure while construction is pending; the real handle is always retained.
    """
    def __init__(self,window,stop):
        self.window=window;self.stop=stop;self.token=object();self.locked=False;self.registered=False
        self.process=None;self.pidfd=None;self.pending=None;self.pidfd_close_error=None
        self.identity_lock=threading.Lock();self.custodied=False;self.begun=False;self.identity_bound=False
    def begin(self):
        w=self.window
        require(not self.begun,'original private lifecycle cannot be reused');self.begun=True
        with lab.bounded_original_lifecycle(_CUSTODY['lock'],.05):
            require(len(_CUSTODY['owners'])<lab.guard.CAPS['ownedProcesses'],'original process custody bound reached')
            _CUSTODY['owners'][self.token]=self;self.custodied=True
        require(w.launch_lock.acquire(timeout=1),'original launch serialization unavailable')
        self.locked=True
        with lab.bounded_original_lifecycle(w.lock):
            w.sample()
            require(not self.stop.is_set() and not w.closed_for_launch and not w.launches_closed
                    and not w.launch_cleanup_debt,'original Window refused private fixture admission')
            self.pending=dict(name='original-enrollment-handshake',requestedNs=time.monotonic_ns(),
                              process=None,log=None)
            w.pending_launches[self.token]=self.pending
    def retain(self,proc,argv,*,pidfd=None):
        # Sole constructor thread updates this already-published record, before
        # it can block on Window.lock. Both owners retain the SAME real handle;
        # no second constructor, numeric-PID recovery or re-admission is added.
        if proc is None:return
        require(self.pending is not None and (self.process is None or self.process is proc),'original pending process identity differs')
        self.process=proc;self.pending['process']=proc;self.pending['command']=list(argv)
        proc._ynx_original_pidfd_required=True
        if pidfd is not None:
            require(self.pidfd_close_error is None,'original pidfd close unknown; cannot replace its identity')
            require(not self.identity_bound or self.pidfd==pidfd,'original pending pidfd identity differs')
            self.identity_bound=True
            self.pidfd=pidfd;self.pending['pidfd']=pidfd
            proc._ynx_original_pidfd=self
    def send(self,signum,*,timeout=.05):
        require(type(timeout) in (int,float) and 0<=timeout<=.05,'bounded original pidfd signal required')
        with lab.bounded_original_lifecycle(self.identity_lock,timeout):
            require(self.pidfd is not None and self.pidfd_close_error is None,
                    'original private pidfd unavailable; no numeric fallback')
            signal.pidfd_send_signal(self.pidfd,signum,None,0)
    def close_retired_identity(self,*,timeout=.05):
        with lab.bounded_original_lifecycle(self.identity_lock,timeout):
            if self.pidfd_close_error is not None:raise self.pidfd_close_error
            if self.process is not None and vars(self.process).get('returncode') is None:return False
            if self.pidfd is not None:
                owned=self.pidfd;self.pidfd=None;self.pending['pidfd']=None
                self.pending['pidfdCloseStatus']='UNKNOWN'
                try:os.close(owned)
                except BaseException as error:self.pidfd_close_error=error;self._debt(error);raise
                self.pending['pidfdCloseStatus']='CLOSED'
        if self.custodied:
            with lab.bounded_original_lifecycle(_CUSTODY['lock'],timeout):
                require(_CUSTODY['owners'].get(self.token) is self,'original process custody differs')
                del _CUSTODY['owners'][self.token];self.custodied=False
        return True
    def _debt(self,error):
        self.stop.set();self.window.closed_for_launch=True;self.window.launches_closed=True
        if self.pending is not None:
            self.pending['cleanupDebt']=True;self.pending.setdefault('firstErrorType',type(error).__name__)
    def publish(self,proc,argv):
        self.retain(proc,argv)
        try:self._publish(proc,argv)
        except BaseException as error:self._debt(error);raise
    def _publish(self,proc,argv):
        w=self.window
        with lab.bounded_original_lifecycle(w.lock):
            require(self.token in w.pending_launches,'original pending constructor missing')
            w.pending_launches[self.token]['process']=proc
            row=dict(name='original-enrollment-handshake',process=proc,persistent=False,
                     command=list(argv),startedNs=time.monotonic_ns())
            try:lab.bind_process_lifecycle(proc)
            finally:w.children.append(row);self.registered=True
            try:
                current=lab.guard.parse_stat(lab.guard.bounded(Path('/proc')/str(proc.pid)/'stat'),proc.pid)
                row['startTicks']=current['startTicks'];w.known[proc.pid]=current['startTicks']
            except FileNotFoundError:
                row['startTicks']=None
                require(proc.poll() is not None,'live original fixture identity unavailable')
            if w.launch_guard_failure is not None:raise w.launch_guard_failure
            require(not self.stop.is_set() and not w.closed_for_launch and not w.launches_closed
                    and not w.launch_cleanup_debt,'original pending fixture cancelled before business publication')
            w.sample();w.pending_launches.pop(self.token)
        self._unlock()
    def _unlock(self):
        if self.locked:self.locked=False;self.window.launch_lock.release()
    def finish(self,proc,argv=()):
        w=self.window
        try:
            self.retain(proc,argv)
            self.close_retired_identity()
            with lab.bounded_original_lifecycle(w.lock,w._cleanup_wait_remaining()):
                if proc is not None and not self.registered:
                    # Binding/registration failed after a REAL Popen returned.
                    # Keep that original handle even if it is already reaped.
                    row=dict(name='original-enrollment-handshake',process=proc,persistent=False,
                             command=list(argv),startedNs=None,startTicks=None)
                    try:
                        if '_ynx_lifecycle_lock' not in vars(proc):lab.bind_process_lifecycle(proc)
                    finally:w.children.append(row);self.registered=True
                pending=w.pending_launches.get(self.token)
                if pending is not None:
                    pending['process']=proc
                    if proc is None or proc.poll() is not None:w.pending_launches.pop(self.token)
                    else:
                        w.launches_closed=True
                        w.launch_cleanup_debt.append(dict(name=pending['name'],errorType='UnretiredOriginalProcess',
                            meaning='original private constructor remains pending; preserve UNKNOWN'))
        except BaseException as error:self._debt(error);raise
        finally:self._unlock()


def failure(error):return dict(type=type(error).__name__,message=r.d.failure_message(error))


def public_projection(value):
    # Deliberately constructed whitelist. Do not upload process argv, error
    # text, raw logs, private paths, credentials, requests, DB, or Go fixture.
    keys=('schema','status','sourceCIQualified','runtimeAuthorized','pressureAuthorized','nativeGrant',
          'nonceReleased','automaticRetry','privateDataExported','nodeStarted','businessLoadExecuted',
          'normalFixtureTestPassed','localPairReservationObserved','peerAckBytesMatch',
          'bothOutboxRequestBytesMatch','operationIdentity','currentEligibility','cleanupComplete',
          'cleanupDebt','missingEvidence','resourceSemantics')
    out={k:value[k] for k in keys}
    out['firstCauseType']=None if value['firstCause'] is None else value['firstCause']['type']
    out['firstCauseSHA256']=None if value['firstCause'] is None else hashlib.sha256(
        r.original.canonical(value['firstCause'])).hexdigest()
    out['cleanupErrorTypes']=[e['type'] for e in value['cleanupErrors']]
    for key in ('source','tools','runID','runAttempt','binaries','planSHA256','workloadSHA256','databasePin',
                'framePins','outboxRequestPins','caps','peakRSSBytes','peakOwnedBytes','monitorRetired','resourceFailureType',
                'privateProcessReceiptSHA256'):
        if key in value:out[key]=value[key]
    observed=value['stoppedReadback']
    require(set(observed)==set(stopped_reader.report()),'closed stopped original projection required')
    out['stoppedReadback']=observed # Reader returns fixed labels/hash-only data, never input paths or payload.
    out['stoppedReadResources']=value['stoppedReadResources']
    out['steps']=[{key:step[key] for key in ('name','returnCode','elapsedNs')} for step in value['steps']]
    return out


def publish(directory,value):
    require(directory.is_absolute() and directory.parent.resolve(strict=True)==directory.parent
            and not os.path.lexists(directory),'fresh public summary destination required')
    directory.mkdir(mode=0o700)
    lab.write_new(directory/PUBLIC_NAME,public_projection(value))


def private_audit(pins,output,result):
    database=result.get('database')
    require(type(database) is dict,'original stopped ledger pin missing')
    names=tuple(r.PrivateTranscript.NAMES)+('SYNTHETIC-ENROLLMENT-ATTEMPT.json','SYNTHETIC-ENROLLMENT-PEER-ACK.json')
    file_pins={}
    for name in names:
        path=(pins.root if name.startswith('SYNTHETIC-') else output/'frames')/name
        raw=r.c.read(path,r.FRAME_LIMIT);file_pins[name]=dict(bytes=len(raw),sha256=r.b.sha(raw))
    db_pin={key:database[key] for key in ('bytes','sha256','planSHA256')}
    observed=r.audit_private_reservation(pins=pins,transcript=output/'frames',database=output/'original.sqlite',
        database_pin=db_pin,file_pins=file_pins,enabled=True)
    return observed,db_pin,file_pins


def run(source,parent,*,enabled=False,stop=None):
    require(enabled is True,'explicit private synthetic job required')
    out=initial_report();work=None;window=None;monitor=None;lease=None;lifecycle=None;handshake=None;binaries=None
    stop=threading.Event() if stop is None else stop
    try:
        fixed=identity();source=Path(source);parent=hosted_parent(Path(parent))
        require(source!=parent and not parent.is_relative_to(source),'private work must be outside source')
        out['source']=check_source(source)
        tools=Path(__file__).resolve().parents[2]
        out['tools']=lab.check_source(tools,lab.git(tools,'rev-parse','HEAD'))
        out.update(runID=os.environ['GITHUB_RUN_ID'],runAttempt=1,
                   caps=dict(lab.CAPS,ownedProcesses=lab.guard.CAPS['ownedProcesses']))
        # One original job marker. Existing or uncertain attempts are not
        # removed, reopened, or converted to permission for another operation.
        lease=os.open(parent/'pq-enrollment-synthetic-once.lock',os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
        fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB);os.fsync(lease)
        folder=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(folder)
        finally:os.close(folder)
        rows,_=lab.guard.proc_inventory()
        lab.admit(lab.guard.memory_available(),shutil.disk_usage(parent).free,lab.heavy_processes(rows))
        enable_original_subreaper()
        work=Path(tempfile.mkdtemp(prefix='pq-enrollment-private-',dir=parent));work.chmod(0o700)
        (work/'.private').mkdir(mode=0o700);(work/'public').mkdir(mode=0o700)
        window=lab.Window(source,work)
        window._enrollment_storage_identities={}
        for path in window.storage_roots:
            info=path.stat();window._enrollment_storage_identities[str(path)]=(info.st_dev,info.st_ino)
        # This disposable supervisor and all its children inherit the SAME
        # original file-size cap, including the FD-executed test process.
        resource.setrlimit(resource.RLIMIT_FSIZE,(lab.CAPS['newBytes'],lab.CAPS['newBytes']))
        window.env.update(GOMAXPROCS='1',GOMEMLIMIT='512MiB',GOFLAGS='',GOTOOLCHAIN='local')
        monitor=driver.Monitor(window,stop);monitor.thread.start()
        def check():
            monitor.check()
            require(not stop.is_set(),'original synthetic job cancelled; retain UNKNOWN')
            window.sample();monitor.check()
        def command(name,argv):
            check();start=time.monotonic_ns()
            # The observer already runs. Original thread-safe launch applies
            # affinity/FSIZE before exec; no preexec_fn after the monitor starts.
            proc=window.launch(name,argv,private_log=True,thread_safe=True,stop=stop)
            try:
                while proc.poll() is None:check();time.sleep(.2)
                check();returncode=proc.returncode
                require(returncode==0,'original '+name+' failed; retain private original log')
            finally:
                out['steps'].append(dict(name=name,returnCode=proc.returncode,elapsedNs=time.monotonic_ns()-start))
            check();return returncode
        command('original-go-version',['go','env','GOVERSION'])
        require(r.c.read(work/'.private/original-go-version.log',128)==('go'+fixed['goVersion']+'\n').encode(),
                'exact original Go toolchain required')
        cli=work/'.private/bin/ynx-consensus-pq-lab';test=work/'.private/bin/consensus.test'
        command('original-cli-build',['go','build','-mod=readonly','-p','1','-trimpath','-buildvcs=true','-o',str(cli),'./cmd/ynx-consensus-pq-lab'])
        command('original-test-build',['go','test','-mod=readonly','-p','1','-trimpath','-buildvcs=true','-c','-o',str(test),'./internal/consensus'])
        require(check_source(source)==out['source'],'source changed during original builds')
        # Only this same-job original build supplies these pins. This is not a
        # production binary/CI allowlist and cannot be injected via CLI/env.
        binaries={}
        for role,path in (('test',test),('cli',cli)):
            with r.c.held(path,64<<20,executable=True) as (raw,_):
                binaries[role]=dict(bytes=len(raw),sha256=r.b.sha(raw))
        out['binaries']=binaries
        root=work/'.private/original-lab'
        command('original-create',[str(cli),'create','--synthetic','--online','--owners','5','--transactions','100','--batch-size','1','--root',str(root)])
        plan=r.c.read(root/'network-plan.json',1<<20);workload=r.c.read(root/'workload/PUBLIC-WORKLOAD.json',8<<20)
        out.update(planSHA256=r.b.sha(plan),workloadSHA256=r.b.sha(workload))
        pins=r.PinnedOriginals(root,fixed['commit'],out['planSHA256'],out['workloadSHA256'])
        check();require(check_source(source)==out['source'],'source changed before original handshake')
        lifecycle=PendingFixtureLaunch(window,stop)
        credential=os.open(root/'workload/private-senders/recovery.raw',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
        output=work/'.private/reservation'
        try:
            result=r._run_synthetic_fixture(binding={key+'SHA256':value['sha256'] for key,value in binaries.items()},
                source=fixed['commit'],source_directory=source,test_binary=test,cli_binary=cli,root=root,
                plan_sha256=pins.plan_pin,workload_sha256=pins.workload_pin,credential_fd=credential,
                output=output,check_resources=check,timeout=240,stop=stop,launch_lifecycle=lifecycle)
        finally:os.close(credential)
        out['normalFixtureTestPassed']=result['normalFixtureTestPassed']
        out['firstCause']=result['firstCause'];out['cleanupDebt']=result['cleanupDebt']
        if result.get('database'):
            observed,db_pin,file_pins=private_audit(pins,output,result)
            out.update(databasePin=db_pin,framePins=file_pins)
            handshake=dict(originalLaunch=dict(root=pins.root,source=pins.source,planSHA256=pins.plan_pin,workloadSHA256=pins.workload_pin),
                transcript=output/'frames',database=output/'original.sqlite',database_pin=db_pin,file_pins=file_pins)
            out['outboxRequestPins']={role:observed['originalPins'][role+'OutboxRequest']
                for role in ('funding','migration') if role+'OutboxRequest' in observed.get('originalPins',{})}
            for key in ('localPairReservationObserved','peerAckBytesMatch','bothOutboxRequestBytesMatch'):out[key]=observed[key]
            out['firstCause']=out['firstCause'] or observed['firstCause']
            out['cleanupDebt']=out['cleanupDebt'] or observed['cleanupDebt']
        check();require(check_source(source)==out['source'],'source changed after original synthetic process')
    except BaseException as error:
        out['firstCause']=out['firstCause'] or failure(error)
        if not isinstance(error,Exception):stop.set();raise
    finally:
        stop.set()
        if window is not None:
            # Monitor retirement consumes the same original cleanup budget;
            # Window.stop must not start a fresh 15 seconds afterwards.
            until=time.monotonic()+lab.CAPS['cleanupSeconds']
            previous=getattr(window,'launch_cleanup_deadline',None)
            window.launch_cleanup_deadline=until if previous is None else min(previous,until)
        if monitor is not None:
            try:monitor.close()
            except BaseException as error:
                out['cleanupErrors'].append(failure(error));out['firstCause']=out['firstCause'] or failure(error);out['cleanupDebt']=True
            out['monitorRetired']=not monitor.thread.is_alive()
            snapshot=monitor.failure_snapshot()
            if snapshot is not None:
                out['resourceFailureType']=snapshot['errorType']
                out['firstCause']=out['firstCause'] or dict(type=snapshot['errorType'],message=snapshot['originalError'])
            if not out['monitorRetired']:out['cleanupDebt']=True
        if window is not None:
            try:
                retired=window.stop()
                if retired is not True:
                    out['cleanupDebt']=True
                    out['firstCause']=out['firstCause'] or dict(type='RuntimeError',message='original owned descendants not fully retired')
                out['cleanupComplete']=retired is True and not out['cleanupDebt']
            except BaseException as error:
                out['cleanupErrors'].append(failure(error));out['firstCause']=out['firstCause'] or failure(error);out['cleanupDebt']=True
            if lifecycle is not None:
                try:
                    require(lifecycle.close_retired_identity(timeout=min(.05,window._cleanup_wait_remaining())),
                            'original private fixture identity remains live; retain process custody')
                except BaseException as error:
                    out['cleanupErrors'].append(failure(error));out['firstCause']=out['firstCause'] or failure(error)
                    out['cleanupDebt']=True;out['cleanupComplete']=False
            out.update(peakRSSBytes=window.peak_rss,peakOwnedBytes=window.peak_bytes)
            try:
                out['originalProcessReceipt']=window.process_receipt()
                out['originalLaunchLifecycle']=window.launch_cleanup_report()
                out['privateProcessReceiptSHA256']=hashlib.sha256(r.original.canonical(
                    dict(processes=out['originalProcessReceipt'],launch=out['originalLaunchLifecycle']))).hexdigest()
            except BaseException as error:
                out['cleanupErrors'].append(failure(error));out['firstCause']=out['firstCause'] or failure(error)
                out['cleanupDebt']=True;out['cleanupComplete']=False
            # No sample after stop: ordinary stopped logs may be closed without
            # retire_log metadata. No invented post-readback resource proof.
            try:finish_stopped_readback(window,lifecycle,out,handshake,binaries)
            except BaseException as error:
                # This is already the stopped-job finally path. A cancellation
                # or secondary observer failure must not skip private receipt
                # preservation and the original lease close below.
                out['cleanupErrors'].append(failure(error));out['firstCause']=out['firstCause'] or failure(error)
                out['cleanupDebt']=True;out['cleanupComplete']=False
        if work is not None:
            try:r.original._retain_readback(work/'.private',out)
            except Exception as error:
                out['cleanupErrors'].append(failure(error));out['firstCause']=out['firstCause'] or failure(error);out['cleanupDebt']=True;out['cleanupComplete']=False
        if lease is not None:
            try:os.close(lease)
            except Exception as error:
                out['cleanupErrors'].append(failure(error));out['firstCause']=out['firstCause'] or failure(error);out['cleanupDebt']=True;out['cleanupComplete']=False
    return out


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--print-source',action='store_true');parser.add_argument('--execute',action='store_true')
    parser.add_argument('--source-directory');parser.add_argument('--work-parent');parser.add_argument('--public-output')
    args=parser.parse_args(argv)
    if args.print_source:
        print(identity()['commit']);return 0
    require(args.execute and args.source_directory and args.work_parent and args.public_output,'explicit complete private job input required')
    with r.original.original_dispatch_signals() as stop:
        out=run(args.source_directory,args.work_parent,enabled=True,stop=stop)
    publish(Path(args.public_output),out)
    good=all(out[k] for k in ('normalFixtureTestPassed','localPairReservationObserved','peerAckBytesMatch',
                             'bothOutboxRequestBytesMatch','cleanupComplete')) and out['firstCause'] is None
    good=good and out['stoppedReadback']['bothConfirmationByteBindingsObserved'] \
        and out['stoppedReadback']['originalPendingPreserved'] \
        and out['stoppedReadResources'] is not None and out['stoppedReadResources']['status']=='OBSERVED'
    return 0 if good else 2 # Synthetic function result only; status stays UNKNOWN.


if __name__=='__main__':raise SystemExit(main())
