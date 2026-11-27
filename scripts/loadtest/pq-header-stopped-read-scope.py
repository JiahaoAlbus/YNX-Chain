"""Adapted original c8bc stopped-resource scope; never a runtime grant."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import sys
import threading
import time

_READ_SCOPE_DEBT=sys.__dict__.setdefault("_ynx_header_read_scope_debt_v1",[])
StoppedHeaderDeadline=sys.__dict__.setdefault('_ynx_header_stopped_deadline_type_v1',type('StoppedHeaderDeadline',(TimeoutError,),{}))
def failure(error):
    try:message=str(error)
    except BaseException:message='<original exception message unavailable>'
    return dict(type=type(error).__name__,message=message)
def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()).hexdigest()

class StoppedReadScope:
    """Same supervisor and owned storage, after original descendant retirement.

    Reuses original inventory/RSS/storage guards without touching stopped logs
    or restarting a Window. Samples are observations, never a continuous cap.
    The main-thread alarm bounds the read operation; the periodic observer has
    a separate bounded retirement, with unresolved handles retained as debt.
    """
    SECONDS=10
    def __init__(self,window,*,lab,monitor_factory):
        self.lab=lab;self.monitor_factory=monitor_factory
        self.lab.require(not _READ_SCOPE_DEBT,'previous original stopped-read ownership remains UNKNOWN')
        self.lab.require(sys.platform=='linux' and threading.current_thread() is threading.main_thread(),
                'stopped originals require original Linux main-thread read scope')
        self.window=window;self.lock=threading.Lock();self.roots=[];self.unknown_roots=[];self.monitor=None
        self.first=None;self.first_observed_ns=None;self.closed=False;self.closing=False;self.alarm=False;self.cleanup_debt=False;self.samples=0
        self.cleanup_errors=[]
        self.observer_retired=False
        self.storage_bytes=None;self.last_storage=None
        self.peak=None;self.peak_bytes=None;self.first_ns=None;self.last_ns=None;self.fallback_kinds=set()
        self.pid=os.getpid();self.started=time.monotonic()
        self.until=min(self.started+self.SECONDS,window.started+self.lab.CAPS['totalSeconds']-1)
        self.stop=threading.Event();self.old_alarm=None
        with self.lab.bounded_original_lifecycle(window.lock,.05):
            self.lab.require(window.closed_for_launch and window.launches_closed and not window.pending_launches
                and not window.launch_cleanup_debt and not getattr(window,'launch_cleanup_failure',None),
                'original stopped ownership is incomplete')
            self.lab.require(all(vars(row['process']).get('returncode') is not None for row in window.children),
                    'original child is not reaped')
            self.known=dict(window.known);self.start_ticks=self.known.get(self.pid)
            paths=tuple(window.storage_roots)
            root_ids=dict(getattr(window,'_header_storage_identities',{}))
        self.lab.require(type(self.start_ticks) is int and self.start_ticks>0,'original supervisor startTicks missing')
        self.lab.require(1<=len(paths)<=8 and Path(window.work) in paths,'original owned storage scope missing')
        self.paths=paths;self.root_ids=root_ids
    def _open_roots(self):
        for path in self.paths:
            path=Path(path)
            self.lab.require(path.is_absolute() and path.resolve(strict=True)==path,'original storage path changed')
            fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
            # Own the raw FD before any following syscall can fail.
            self.roots.append((path,fd,None));info=os.fstat(fd);self.roots[-1]=(path,fd,info)
            self.lab.require(self.root_ids.get(str(path))==(info.st_dev,info.st_ino),'pre-launch owned storage identity missing or changed')
        self._root_check()
    def _root_check(self):
        for path,fd,before in self.roots:
            current=path.lstat();held=os.fstat(fd)
            self.lab.require(stat.S_ISDIR(current.st_mode) and (current.st_dev,current.st_ino)==(before.st_dev,before.st_ino)
                    ==(held.st_dev,held.st_ino) and current.st_uid==held.st_uid==os.geteuid(),
                    'original stopped storage identity differs')
    def _deadline(self):
        self.lab.require(not self.closed and time.monotonic()<self.until,'original stopped read deadline exceeded')
    def sample(self,*,final=False):
        self.lab.require(self.lock.acquire(timeout=.05),'original stopped read observer lock unavailable')
        try:return self._sample(force_storage=final)
        finally:self.lock.release()
    def _sample(self,*,force_storage=False):
        self._deadline();self._root_check()
        rows,_=self.lab.guard.proc_inventory()
        self.lab.require(self.pid in rows and rows[self.pid]['startTicks']==self.start_ticks,
                'original stopped supervisor identity missing or changed')
        ids=self.lab.guard.owned_set(rows,self.pid,known=self.known)
        self.lab.require(ids==[self.pid],'original descendants not retired at stopped read boundary')
        fallback=[];retired=[]
        size=self.lab.owned_rss(self.pid,rows[self.pid],retired.append,fallback.append)
        self.lab.require(type(size) is int and size>=0 and not retired,'original live supervisor RSS unavailable')
        for entry in fallback:self.fallback_kinds.add(entry.get('sampleKind','UNKNOWN'))
        self.peak=size if self.peak is None else max(self.peak,size)
        # Preserve the original allocated-byte and regular-file inventory. No
        # new smaller cache/storage domain is substituted for the original one.
        now=time.monotonic()
        if force_storage or self.last_storage is None or now-self.last_storage>=1:
            self.storage_bytes=sum(self.lab.private_bytes(path) for path,_,_ in self.roots);self.last_storage=now
        storage=self.storage_bytes
        self.peak_bytes=storage if self.peak_bytes is None else max(self.peak_bytes,storage)
        self.lab.require(size<=self.lab.CAPS['rssBytes'],'owned RSS exceeded 4GiB during stopped read')
        self.lab.require(storage<=self.lab.CAPS['newBytes'],'new artifacts exceeded 8GiB during stopped read')
        self.lab.require(shutil.disk_usage(self.window.work).free>=1<<30,'runtime disk reserve below 1GiB during stopped read')
        self._root_check();self._deadline()
        now=time.monotonic_ns();self.first_ns=now if self.first_ns is None else self.first_ns;self.last_ns=now;self.samples+=1
    def start(self):
        self.lab.require(self.monitor is None and not self.closed,'stopped read scope is one-shot')
        self.lab.require(signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0) and signal.getsignal(signal.SIGALRM)==signal.SIG_DFL,
                'original stopped read timer already owned')
        self.old_alarm=signal.getsignal(signal.SIGALRM)
        def deadline(_signum,_frame):raise StoppedHeaderDeadline('original stopped read alarm deadline')
        signal.signal(signal.SIGALRM,deadline);self.alarm=True
        signal.setitimer(signal.ITIMER_REAL,max(.001,self.until-time.monotonic()))
        self._open_roots()
        self.monitor=self.monitor_factory(self,self.stop)
        self.sample();self.monitor.thread.start()
    def check(self,*,final=False):
        self.lab.require(self.monitor is not None and not self.closing,'original stopped read observer not started or closing')
        for after in (False,True):
            if after:self.sample(final=final)
            snapshot=self.monitor_snapshot()
            if snapshot is not None:raise RuntimeError(snapshot['originalError'])
    def monitor_snapshot(self):
        if self.monitor is None:return None
        self.lab.require(self.monitor.failure_lock.acquire(timeout=.05),'original stopped observer failure snapshot unavailable')
        try:return None if self.monitor.first_failure is None else dict(self.monitor.first_failure)
        finally:self.monitor.failure_lock.release()
    def remember_first(self,value,observed_ns=...):
        if observed_ns is ...:
            try:observed_ns=time.monotonic_ns()
            except BaseException:observed_ns=None
        if self.first is None or (type(observed_ns) is int and type(self.first_observed_ns) is int
                                  and observed_ns<self.first_observed_ns):
            self.first=value;self.first_observed_ns=observed_ns
    def retain_monitor_failure(self):
        snapshot=self.monitor_snapshot()
        if snapshot is not None:
            self.remember_first(dict(type=snapshot['errorType'],message=snapshot['originalError']),snapshot['observedMonotonicNs'])
    def close(self):
        if self.closed or self.closing:return
        self.closing=True
        def secondary(error):
            self.cleanup_debt=True
            self.cleanup_errors.append(failure(error))
            self.remember_first(failure(error))
        # A failure already latched by the periodic observer precedes timer or
        # join cleanup. Preserve it before either secondary operation can fail.
        try:self.retain_monitor_failure()
        except BaseException as error:secondary(error)
        if self.alarm:
            self.alarm=False
            try:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,self.old_alarm)
            except BaseException as error:secondary(error)
        if self.monitor is not None:
            self.monitor.finished.set()
            join_failed=False
            if self.monitor.thread.ident is not None:
                try:self.monitor.thread.join(timeout=.5)
                except BaseException as error:secondary(error);join_failed=True
            if join_failed or self.monitor.thread.is_alive():
                # An exceptional join is not a retirement proof. In particular
                # do not use an unreliable dead flag to close a live reader's
                # original FDs; retain custody without a second join/close.
                if not join_failed:secondary(RuntimeError('original stopped read observer did not retire'))
                # The observer may have latched a failure during the join.
                # One bounded snapshot can retain its earlier original clock;
                # an unavailable snapshot leaves current evidence UNKNOWN.
                try:self.retain_monitor_failure()
                except BaseException as error:secondary(error)
                self.closed=True;_READ_SCOPE_DEBT.append(self);return
            self.observer_retired=True
            try:self.retain_monitor_failure()
            except BaseException as error:secondary(error)
        self.closed=True
        roots,self.roots=self.roots,[] # Single close responsibility, no reused FD retry.
        for path,fd,identity in roots:
            try:os.close(fd)
            except BaseException as error:
                self.unknown_roots.append((path,fd,identity,error));secondary(error)
        if self.cleanup_debt:_READ_SCOPE_DEBT.append(self)
    def report(self):
        return dict(schema='YNX-PERF-STOPPED-READ-RESOURCES/v1',
            status='OBSERVED' if self.closed and self.samples>0 and self.first is None and not self.cleanup_debt else 'UNKNOWN',
            pid=self.pid,startTicks=self.start_ticks,samples=self.samples,firstSampleMonotonicNs=self.first_ns,
            lastSampleMonotonicNs=self.last_ns,peakSampledRSSOrUpperBoundBytes=self.peak,
            peakSampledOwnedBytes=self.peak_bytes,fallbackKinds=sorted(self.fallback_kinds),
            caps=dict(rssBytes=self.lab.CAPS['rssBytes'],ownedBytes=self.lab.CAPS['newBytes'],ownedProcesses=self.lab.guard.CAPS['ownedProcesses'],diskReserveBytes=1<<30),
            deadlineSeconds=self.SECONDS,originalTotalDeadlinePreserved=True,cleanupDebt=self.cleanup_debt,
            firstCauseType=None if self.first is None else self.first['type'],
            firstCauseSHA256=None if self.first is None else fingerprint(self.first),
            firstCauseObservedMonotonicNs=self.first_observed_ns,
            cleanupErrors=[dict(type=error['type'],sha256=fingerprint(error)) for error in self.cleanup_errors],
            monitorRetired=self.observer_retired,
            continuousRSSLimitProven=False,readOnly=True,normalWindowRestarted=False)

