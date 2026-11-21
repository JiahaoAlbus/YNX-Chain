#!/usr/bin/env python3
"""Run the unchanged original315 Python controls, never a business attempt.

The old chain-core workflow and its concurrency group are not modified. This
source-only job executes its exact frozen PYDURABLE body under the original
hosted Linux Window/Monitor. Sampled caps are not continuous hard ceilings.
"""
import argparse
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
import textwrap
import threading
import time

BRANCH='refs/heads/codex/perf-durable-driver-20261121'
ORIGINAL_SHA256='566884cc0cdc9443299c4d38b9da8ec0bea1ba87cb443061a24ebc10523c4a97'
ORIGINAL_COUNT=315
SOURCE_ONLY_SECONDS=300
FD_CLOSE_ERRORS=[] # Sticky original close debt; never retry a consumed FD.


def close_original_fd(fd):
    primary=sys.exc_info()[1]
    try:os.close(fd)
    except BaseException as error:
        FD_CLOSE_ERRORS.append(failure(error))
        if primary is not None:raise primary from error
        raise


def require(value,message):
    if not value:raise RuntimeError(message)


def fixture_bytes(root,identity,*,entry_limit=200000):
    """Count this job's deliberate filesystem fault fixtures without following.

    Business Window artifact rejection remains unchanged. Only this separate
    test domain contains expected symlink/FIFO/socket negative-control inputs.
    Hardlinks count once by device/inode at the maximum observed allocation.
    """
    seen={};entries=0
    def key(info):return info.st_dev,info.st_ino
    def count(info):
        require(not stat.S_ISCHR(info.st_mode) and not stat.S_ISBLK(info.st_mode),
                'device in source-control fixture domain')
        require(any(f(info.st_mode) for f in (stat.S_ISREG,stat.S_ISDIR,stat.S_ISLNK,stat.S_ISFIFO,stat.S_ISSOCK)),
                'unknown fixture inode type')
        seen[key(info)]=max(seen.get(key(info),0),info.st_size,info.st_blocks*512)
    def visit(fd,depth):
        nonlocal entries
        require(depth<=40,'source-control fixture depth bound')
        with os.scandir(fd) as iterator:
            for entry in iterator:
                entries+=1;require(entries<=entry_limit,'source-control fixture inventory bound; no truncation')
                try:info=entry.stat(follow_symlinks=False)
                except FileNotFoundError:continue # Original concurrent deletion semantics.
                count(info)
                if stat.S_ISDIR(info.st_mode):
                    try:child=os.open(entry.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
                    except FileNotFoundError:continue
                    try:
                        require(key(os.fstat(child))==key(info),'fixture directory replaced')
                        visit(child,depth+1)
                        try:current=os.stat(entry.name,dir_fd=fd,follow_symlinks=False)
                        except FileNotFoundError:current=None
                        if current is not None:
                            require(key(current)==key(info) and stat.S_ISDIR(current.st_mode),'fixture directory replaced during sample')
                    finally:close_original_fd(child)
    fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        info=os.fstat(fd);require(key(info)==identity,'original fixture root identity changed')
        count(info);visit(fd,0)
        current=root.lstat()
        require(key(current)==identity and stat.S_ISDIR(current.st_mode),
                'original fixture root replaced during sample')
        return sum(seen.values())
    finally:close_original_fd(fd)


def cover_fixture_storage(window,root,lab):
    info=root.stat();identity=(info.st_dev,info.st_ino);original=window._sample
    def sample():
        original() # Every original PID/RSS/disk/log guard remains first.
        size=fixture_bytes(root,identity)
        combined=window.storage_bytes+size
        window.peak_bytes=max(window.peak_bytes,combined)
        require(combined<=lab.CAPS['newBytes'],'combined source-control storage exceeded original8GiB')
    window._sample=sample


def module(file):
    path=Path(__file__).with_name(file)
    spec=importlib.util.spec_from_file_location('source_controls_'+file,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


def original_script(source):
    raw=(source/'.github/workflows/chain-core.yml').read_text()
    start="          python3 -B - <<'PYDURABLE'\n";end='\n          PYDURABLE\n'
    require(raw.count(start)==raw.count(end)==1,'one original durable CI body required')
    body=textwrap.dedent(raw.split(start,1)[1].split(end,1)[0])+'\n'
    require(hashlib.sha256(body.encode()).hexdigest()==ORIGINAL_SHA256,'original315 CI script changed; no substitute selection')
    return body


def hosted_identity(env,platform,parent):
    require(platform=='linux' and env.get('GITHUB_ACTIONS')=='true'
            and env.get('RUNNER_ENVIRONMENT')=='github-hosted','fresh GitHub-hosted Linux required')
    require(env.get('GITHUB_EVENT_NAME')=='push' and env.get('GITHUB_REF')==BRANCH,
            'this source-only job accepts its own branch push only')
    require(env.get('GITHUB_RUN_ATTEMPT')=='1','no automatic rerun of this original source job')
    require(re.fullmatch('[1-9][0-9]*',env.get('GITHUB_RUN_ID',''))
            and re.fullmatch('[0-9a-f]{40}',env.get('GITHUB_SHA','')),'exact original run/source identity required')
    require(parent.is_absolute() and parent.resolve(strict=True)==parent
            and parent==Path(env['RUNNER_TEMP']),'canonical original job temp required')
    return dict(commit=env['GITHUB_SHA'],runID=env['GITHUB_RUN_ID'],runAttempt=1)


def bounded_original(path,limit,*,root,root_identity):
    require(path.parent==root/'pq-durable-driver-controls' and path.name in ('original-controls.log','RESULT.json'),
            'closed original source output path required')
    key=lambda s:(s.st_dev,s.st_ino)
    root_fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        require(key(os.fstat(root_fd))==root_identity,'original output root identity changed')
        folder=os.open('pq-durable-driver-controls',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=root_fd)
        try:
            parent_identity=key(os.fstat(folder))
            fd=os.open(path.name,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=folder)
            try:
                before=os.fstat(fd)
                require(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0<before.st_size<=limit,
                        'bounded original source-control output required')
                parts=[];remaining=limit+1
                while remaining:
                    part=os.read(fd,min(65536,remaining))
                    if not part:break
                    parts.append(part);remaining-=len(part)
                raw=b''.join(parts);after=os.fstat(fd);current=os.stat(path.name,dir_fd=folder,follow_symlinks=False)
                identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
                require(identity(before)==identity(after)==identity(current) and len(raw)==before.st_size,
                        'original source-control output changed')
                current_parent=os.stat('pq-durable-driver-controls',dir_fd=root_fd,follow_symlinks=False)
                current_root=root.lstat()
                require(key(current_parent)==parent_identity and stat.S_ISDIR(current_parent.st_mode)
                        and key(current_root)==root_identity and stat.S_ISDIR(current_root.st_mode),
                        'original output parent replaced during read')
                return raw
            finally:close_original_fd(fd)
        finally:close_original_fd(folder)
    finally:close_original_fd(root_fd)


def retain(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
    try:
        view=memoryview(raw)
        while view:
            written=os.write(fd,view);require(written>0,'source artifact short write');view=view[written:]
        os.fsync(fd)
        before=os.fstat(fd);current=path.lstat()
        require(before.st_nlink==1 and before.st_size==len(raw)
                and (before.st_dev,before.st_ino)==(current.st_dev,current.st_ino),'retained output identity changed')
    finally:close_original_fd(fd)
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:close_original_fd(fd)


def observe_result(root,public,identity,*,root_identity):
    directory=root/'pq-durable-driver-controls'
    log=bounded_original(directory/'original-controls.log',4<<20,root=root,root_identity=root_identity)
    raw=bounded_original(directory/'RESULT.json',65536,root=root,root_identity=root_identity)
    # Exact original public-control outputs only. Never copy the child log,
    # work tree, SQLite, credentials or any synthetic business artifacts.
    retain(public/'original-controls.log',log);retain(public/'RESULT.json',raw)
    result=json.loads(raw)
    require(result.get('sourceCommit')==identity['commit'] and result.get('runID')==identity['runID']
            and result.get('platform')=='linux' and result.get('declaredTotal')==ORIGINAL_COUNT
            and result.get('allDeclaredActuallyPassedWithoutSkip') is True
            and result.get('logSHA256')==hashlib.sha256(log).hexdigest(),
            'original315 controls not fully passed; retain original log')
    return dict(logSHA256=hashlib.sha256(log).hexdigest(),resultSHA256=hashlib.sha256(raw).hexdigest(),
                declaredTotal=ORIGINAL_COUNT,allDeclaredActuallyPassedWithoutSkip=True)


def failure(error):
    try:message=str(error)
    except BaseException:message='<original message unavailable>'
    return dict(type=type(error).__name__,message=message)


def record_failure(out,error,*,cleanup=False):
    value=failure(error)
    if out['firstCause'] is None:out['firstCause']=value
    if cleanup:out['cleanupDebt']=True;out['cleanupErrors'].append(value)


def public_summary(out):
    value={k:out[k] for k in ('schema','status','source','runID','runAttempt','originalScriptSHA256',
        'controls','caps','observedPeakRSSBytes','observedPeakStorageBytes','monitorRetired','cleanupComplete',
        'cleanupDebt','runtimeAuthorized','fullToolsCIQualified','pressureAuthorized','nodeStarted','businessLoadExecuted')}
    def safe(error):
        if error is None:return None
        message=error['message'];prefix=message[:16384]
        return dict(type=error['type'],messageSHA256=hashlib.sha256(prefix.encode('utf-8','surrogatepass')).hexdigest(),
                    messageHashEncoding='utf-8-surrogatepass',messageHashScope='entire' if len(message)<=16384 else 'prefix',
                    messageCharactersObserved=len(message),messageCharactersHashed=len(prefix))
    value['firstCause']=safe(out['firstCause']);value['cleanupErrors']=[safe(e) for e in out['cleanupErrors']]
    value['resourceSemantics']='Original periodic owned PID/RSS/storage/log sampling; no continuous hard cap or lifetime peak claim.'
    return value


def run():
    source=Path(__file__).resolve().parents[2];parent=Path(os.environ['RUNNER_TEMP'])
    identity=hosted_identity(os.environ,sys.platform,parent);original_script(source)
    private=module('pq-enrollment-linux-private.py');lab=private.lab;driver=private.driver
    out=dict(schema='YNX-PERF-ORIGINAL315-SOURCE-CONTROLS/v1',status='UNKNOWN',source=None,
        runID=identity['runID'],runAttempt=1,originalScriptSHA256=ORIGINAL_SHA256,controls=None,
        caps=dict(lab.CAPS,ownedProcesses=lab.guard.CAPS['ownedProcesses']),observedPeakRSSBytes=None,
        observedPeakStorageBytes=None,monitorRetired=False,cleanupComplete=False,cleanupDebt=False,
        firstCause=None,cleanupErrors=[],runtimeAuthorized=False,fullToolsCIQualified=False,
        pressureAuthorized=False,nodeStarted=False,businessLoadExecuted=False)
    public=parent/'pq-durable-source-controls-public';public.mkdir(mode=0o700)
    window=monitor=None;lease=None;stop=threading.Event();os.umask(0o077)
    try:
        out['source']=lab.check_source(source,identity['commit'])
        lease=os.open(parent/'pq-durable-python-source-once.lock',os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
        private.fcntl.flock(lease,private.fcntl.LOCK_EX|private.fcntl.LOCK_NB);os.fsync(lease)
        folder=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(folder)
        finally:close_original_fd(folder)
        rows,_=lab.guard.proc_inventory()
        lab.admit(lab.guard.memory_available(),shutil.disk_usage(parent).free,lab.heavy_processes(rows))
        private.enable_original_subreaper()
        work=Path(tempfile.mkdtemp(prefix='pq-durable-source-private-',dir=parent));work.chmod(0o700)
        (work/'.private').mkdir(mode=0o700);(work/'public').mkdir(mode=0o700)
        window=lab.Window(source,work,additional_storage=(public,))
        resource.setrlimit(resource.RLIMIT_FSIZE,(lab.CAPS['newBytes'],lab.CAPS['newBytes']))
        control_temp=Path(tempfile.mkdtemp(prefix='pq-durable-fixtures-private-',dir=parent));control_temp.chmod(0o700)
        info=control_temp.stat();fixture_identity=(info.st_dev,info.st_ino)
        cover_fixture_storage(window,control_temp,lab)
        # Every normal tempfile spelling points at the same explicitly owned
        # fixture domain; no unobserved /tmp side domain is introduced.
        window.env.update({key:str(control_temp) for key in ('RUNNER_TEMP','TMPDIR','TMP','TEMP')})
        monitor=driver.Monitor(window,stop);monitor.thread.start()
        deadline=time.monotonic()+SOURCE_ONLY_SECONDS
        def check():
            monitor.check();require(not stop.is_set(),'source-control original stop requested')
            require(time.monotonic()<deadline,'source-control execution deadline exceeded')
            window.sample();monitor.check()
        check()
        child=window.launch('original315-python-controls',[sys.executable,'-B',str(Path(__file__).resolve()),'--execute-original'],
                            private_log=True,thread_safe=True,stop=stop)
        while child.poll() is None:check();stop.wait(.2)
        check()
        out['controls']=observe_result(control_temp,public,identity,root_identity=fixture_identity)
        require(child.returncode==0,'original315 child exit was not successful')
        check()
    except BaseException as error:
        record_failure(out,error)
        if not isinstance(error,Exception):raise
    finally:
        stop.set()
        if monitor is not None:
            try:private.retire_original_job_monitor(monitor,out)
            except BaseException as error:record_failure(out,error,cleanup=True)
        if window is not None:
            out.update(observedPeakRSSBytes=window.peak_rss,observedPeakStorageBytes=window.peak_bytes)
            try:
                clean=window.stop()
                if clean is not True:record_failure(out,RuntimeError('original Window cleanup not proven'),cleanup=True)
                out['cleanupComplete']=clean is True and out['monitorRetired'] and not out['cleanupDebt']
            except BaseException as error:record_failure(out,error,cleanup=True)
        if lease is not None:
            try:close_original_fd(lease)
            except BaseException as error:record_failure(out,error,cleanup=True)
        if FD_CLOSE_ERRORS:
            out['cleanupDebt']=True;out['cleanupErrors'].extend(dict(e) for e in FD_CLOSE_ERRORS)
        if out['cleanupDebt']:out['cleanupComplete']=False
        if out['controls'] is not None and out['cleanupComplete'] and out['firstCause'] is None:out['status']='ORIGINAL315_PASSED'
        try:retain(public/'SUMMARY.json',(json.dumps(public_summary(out),sort_keys=True)+'\n').encode())
        except BaseException as error:
            record_failure(out,error,cleanup=True);out['status']='UNKNOWN';out['cleanupComplete']=False
            # No second file write. The closed public projection in the
            # original job log retains the first cause if artifact IO failed.
            print(json.dumps(public_summary(out),sort_keys=True))
            if not isinstance(error,Exception):raise
    return 0 if out['status']=='ORIGINAL315_PASSED' else 1


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--execute-original',action='store_true');args=parser.parse_args(argv)
    if args.execute_original:
        source=Path(__file__).resolve().parents[2]
        hosted_identity(os.environ,sys.platform,Path(os.environ['RUNNER_TEMP']))
        require(module('consensus-linux-cohort.py').check_source(source,os.environ['GITHUB_SHA']),
                'exact unchanged source required')
        exec(compile(original_script(source),'.github/workflows/chain-core.yml:PYDURABLE','exec'),{'__name__':'__main__'})
        return 0
    return run()


if __name__=='__main__':raise SystemExit(main())
