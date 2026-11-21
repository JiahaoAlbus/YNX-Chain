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


class PendingFixtureLaunch:
    """Same original Window's pending admission for the bounded pipe callee.

    Popen happens outside Window.lock. No second constructor, reaper or signal
    owner is created. The original Window can observe/cancel its descendant
    closure while construction is pending; the real handle is always retained.
    """
    def __init__(self,window,stop):
        self.window=window;self.stop=stop;self.token=object();self.locked=False;self.registered=False
    def begin(self):
        w=self.window
        require(w.launch_lock.acquire(timeout=1),'original launch serialization unavailable')
        self.locked=True
        with lab.bounded_original_lifecycle(w.lock):
            w.sample()
            require(not self.stop.is_set() and not w.closed_for_launch and not w.launches_closed
                    and not w.launch_cleanup_debt,'original Window refused private fixture admission')
            w.pending_launches[self.token]=dict(name='original-enrollment-handshake',requestedNs=time.monotonic_ns(),
                                                process=None,log=None)
    def publish(self,proc,argv):
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
    out=initial_report();work=None;window=None;monitor=None;lease=None;stop=threading.Event() if stop is None else stop
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
    return 0 if good else 2 # Synthetic function result only; status stays UNKNOWN.


if __name__=='__main__':raise SystemExit(main())
