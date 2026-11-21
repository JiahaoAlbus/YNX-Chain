"""Measure exact original pair producers with public, synthetic data only.

This does not start a node, submit a transaction, qualify a source/window, or
claim online throughput. Each fixed producer runs once in its own fresh Python
process on the same Linux host; all generated work belongs to that process.
"""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import random
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time

BEFORE='1dbb08737a928de405ec3f806784fb0d1a09065a'
AFTER='b3acf52ad4fdaf12d58b8df3be4ba925b75c7c0d'
PREFIX='scripts/loadtest/same-runner/'
HISTOGRAM=Path(__file__).with_name('fixtures')/'same-runner-rss-117mb-sizes.json'
RSS_CAP=4<<30


def require(ok,message):
    if not ok:raise RuntimeError(message)


def git(repo,*args):
    return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.PIPE)


def source(repo,destination,commit):
    """Export only tracked regular files from the exact Git object, no checkout."""
    require(type(commit) is str and re.fullmatch('[0-9a-f]{40}',commit),'exact source commit required')
    require(git(repo,'rev-parse',commit+'^{commit}').decode().strip()==commit,'original Git object differs')
    raw=git(repo,'archive','--format=tar',commit,'--',PREFIX.rstrip('/'))
    require(len(raw)<=16<<20,'bounded public source archive required')
    count=total=0
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as archive:
        for item in archive:
            path=PurePosixPath(item.name)
            if item.isdir() and item.name in ('scripts','scripts/loadtest'):
                continue
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in item.name
                and (item.name==PREFIX.rstrip('/') or item.name.startswith(PREFIX)), 'source archive path escaped')
            if item.isdir():continue
            require(item.isfile() and 0<=item.size<=8<<20,'regular bounded source leaf required')
            count+=1;total+=item.size;require(count<=128 and total<=16<<20,'source closure bound exceeded')
            target=destination.joinpath(*path.parts);target.parent.mkdir(parents=True,exist_ok=True)
            source_file=archive.extractfile(item);require(source_file is not None,'source leaf unavailable')
            content=source_file.read(item.size+1);require(len(content)==item.size,'source leaf length differs')
            with target.open('xb') as out:out.write(content)
    require(count==48,'exact original pair fixture source closure differs')
    return destination/PREFIX


def sizes(path=HISTOGRAM):
    data=json.loads(Path(path).read_bytes())
    require(data.get('schema')=='YNX-SYNTHETIC-RSS-SIZE-HISTOGRAM/v1'
        and data.get('syntheticOnly') is True and data.get('containsOriginalPaths') is False
        and data.get('containsOriginalContent') is False,'synthetic size-only metadata required')
    items=data.get('histogram');require(type(items) is list and len(items)<=512,'bounded size histogram required')
    values=[]
    for row in items:
        require(type(row) is dict and set(row)=={'bytes','count'} and type(row['bytes']) is int
                and 0<=row['bytes']<=128<<20 and type(row['count']) is int and 0<row['count']<=512,'invalid histogram item')
        values.extend([row['bytes']]*row['count']);require(len(values)<=512,'histogram count exceeded')
    require(len(values)==data['entries']==302 and sum(values)==data['totalBytes']==117004940
            and max(values)==70298628 and sum(x>8<<20 for x in values)==1,'original size-only distribution differs')
    return values


def payload(path,size,seed,*,json_string=False):
    """Create deterministic synthetic bytes with mixed compressibility."""
    require(type(size) is int and size>=0 and (not json_string or size>=2),'synthetic payload size differs')
    generator=random.Random(seed);digest=hashlib.sha256();remaining=size
    with path.open('xb') as out:
        if json_string:out.write(b'"');digest.update(b'"');remaining-=2
        while remaining:
            chunk=base64.b64encode(generator.randbytes(2100))+b'A'*1296
            chunk=chunk[:min(remaining,len(chunk))];out.write(chunk);digest.update(chunk);remaining-=len(chunk)
        if json_string:out.write(b'"');digest.update(b'"')
    require(path.stat().st_size==size,'synthetic payload length differs')
    return digest.hexdigest()


def populate(work,distribution):
    """Add only synthetic bytes; large blob has the original migration-role fence."""
    public=work/'public';area=public/'rss-synthetic-fixture';area.mkdir()
    blob_root=public/'proof-public-blobs';blob_root.mkdir(exist_ok=True)
    large=next(i for i,size in enumerate(distribution) if size>8<<20)
    temporary=work/'.private/rss-synthetic-migration.tmp'
    pin=payload(temporary,distribution[large],large,json_string=True)
    blob=blob_root/(pin+'.json');os.rename(temporary,blob)
    manifest=public/'load-operations/99999/original-public-proof-manifest.json';manifest.parent.mkdir(parents=True)
    manifest.write_text(json.dumps(dict(schema='YNX-PERF-ORIGINAL-PUBLIC-PROOF-CLOSURE/v1',syntheticOnly=True,
        authorityGranted=False,actualNetworkExecutionClaim=False,entries=dict(migration=dict(sha256=pin,
        publicRelativePath='proof-public-blobs/'+pin+'.json',bytes=distribution[large]))),separators=(',',':')))
    for index,size in enumerate(distribution):
        if index!=large:payload(area/('%05d.bin'%index),size,index)
    return dict(entries=len(distribution),bytes=sum(distribution),largest=distribution[large],
                additionalManifestBytes=manifest.stat().st_size,originalContentCopied=False)


class Sampler:
    """Sample the same original owned-PID/RSS functions; missing stays UNKNOWN."""
    def __init__(self,lab,launcher,launcher_start):
        self.lab=lab;self.guard=lab.guard;self.known={};self.records=[];self.lock=threading.Lock()
        self.launcher=launcher;self.launcher_start=launcher_start
        self.stop_event=threading.Event();self.error=None;self.thread=threading.Thread(target=self.loop,name='synthetic-rss-sampler')
    def sample(self,label):
        with self.lock:
            if self.error is not None:raise RuntimeError('original synthetic RSS sampler failed')
            rows,_=self.guard.proc_inventory()
            require(self.launcher in rows and rows[self.launcher]['startTicks']==self.launcher_start,
                    'original launcher identity unavailable')
            ids=self.guard.owned_set(rows,self.launcher,known=self.known)
            observed=[]
            for pid in ids:
                row=rows[pid];self.known[pid]=row['startTicks'];alternatives=[]
                rss=self.lab.owned_rss(pid,row,fallback=alternatives.append)
                require(type(rss) is int and rss>=0,'original owned RSS unavailable; never substitute zero')
                require(all(event['sampleKind']=='same-thread-group-smaps' for event in alternatives),
                        'virtual-size upper bound cannot be reported as measured RSS')
                observed.append(dict(pid=pid,startTicks=row['startTicks'],rssBytes=rss,fallbacks=alternatives))
            total=sum(row['rssBytes'] for row in observed)
            require(total<=RSS_CAP,'owned RSS exceeded unchanged 4GiB')
            require(len(self.records)<4096,'bounded synthetic RSS samples exceeded')
            self.records.append(dict(label=label,monotonicNs=time.monotonic_ns(),rssBytes=total,processes=observed))
    def loop(self):
        while not self.stop_event.wait(.25):
            try:self.sample('periodic')
            except BaseException as error:
                with self.lock:self.error=type(error).__name__
                return
    def close(self):
        self.stop_event.set();self.thread.join(timeout=5)
        require(not self.thread.is_alive() and self.error is None,'original synthetic RSS sampling incomplete')


def run_sampled(case,sampler):
    """Preserve the original failure if stopping the sampler also fails."""
    primary=None
    try:
        result=case.run();sampler.sample('finished');return result
    except BaseException as error:
        primary=error;raise
    finally:
        try:sampler.close()
        except BaseException as error:
            if primary is None:raise
            if hasattr(primary,'add_note'):primary.add_note('secondary sampler stop failure: '+type(error).__name__)


def worker(source_dir,work,distribution):
    require(sys.platform=='linux','actual Linux /proc required; no platform substitution')
    source_dir=Path(source_dir);work=Path(work)
    spec=importlib.util.spec_from_file_location('synthetic_original_pair_case',source_dir/'test_pq_same_runner_pair_producer.py')
    case_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(case_module)
    spec=importlib.util.spec_from_file_location('synthetic_original_rss_guard',source_dir/'consensus-linux-cohort.py')
    lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
    rows,_=lab.guard.proc_inventory();memory=lab.guard.memory_available();disk=shutil.disk_usage(work).free;heavy=lab.heavy_processes(rows)
    lab.admit(memory,disk,heavy) # Original 6GiB/16GiB and heavy-process floor; no relaxation.
    launcher=os.getppid();require(launcher in rows,'original launcher identity unavailable')
    case=case_module.Case(work);producer=case_module.producer;sampler=Sampler(lab,launcher,rows[launcher]['startTicks']);shapes={}
    original_public=producer.public_files;original_copy=producer.copy_payload
    def public(workdir):
        sampler.sample(workdir.name+':before-snapshot');value=original_public(workdir)
        sampler.sample(workdir.name+':after-snapshot');return value
    def copy_files(destination,files):
        sampler.sample(destination.name+':before-copy');value=original_copy(destination,files)
        sampler.sample(destination.name+':after-copy');return value
    producer.public_files=public;producer.copy_payload=copy_files
    for label in ('before','after'):
        adapter=case.adapters[label];execute=adapter.execute;admit=adapter.admit
        def wrapped_execute(register,*,adapter=adapter,execute=execute,label=label):
            execute(register);shapes[label]=populate(adapter.work,distribution)
        def wrapped_admit(roots,*,admit=admit,label=label):
            sampler.sample(label+':admission');return admit(roots)
        adapter.execute=wrapped_execute;adapter.admit=wrapped_admit
    sampler.sample('start');sampler.thread.start()
    result=run_sampled(case,sampler)
    require(result['status']=='PAYLOADS_SEALED_AWAITING_ORIGINAL_ACTIONS_UPLOADS'
        and result['firstCause'] is None and shapes.get('before')==shapes.get('after'),
        'synthetic original pair incomplete; no RSS comparison')
    return dict(status='OBSERVED_SYNTHETIC_ONLY',admission=dict(availableMemoryBytes=memory,freeDiskBytes=disk,
        conflictingHeavyProcesses=heavy),shape=shapes['before'],samples=sampler.records,
        samplePeakRSSBytes=max(row['rssBytes'] for row in sampler.records),rssCapBytes=RSS_CAP,
        ownedScope='same launcher and its observed descendants including the worker',
        actualWindowExecuted=False,transactionSent=False,sourceQualified=False,runtimePermissionGranted=False,
        exactTransientPeakProven=False,originalPayloadContentCopied=False)


def run(repo,output):
    require(sys.platform=='linux','actual Linux /proc required; no platform substitution')
    repo=Path(repo).resolve(strict=True);output=Path(output)
    require(output.is_absolute() and not output.exists() and output.parent.resolve(strict=True)==output.parent,
            'fresh absolute synthetic result path required')
    require(git(repo,'merge-base','--is-ancestor',BEFORE,AFTER)==b'', 'original source ancestry differs')
    expected={PREFIX+'pq-same-runner-controls.py',PREFIX+'pq-same-runner-pair-producer.py',PREFIX+'test_pq_same_runner_pair_producer.py'}
    changed=set(git(repo,'diff','--name-only',BEFORE,AFTER,'--',PREFIX).decode().splitlines())
    require(changed==expected,'original producer candidate changed outside expected public source leaves')
    sizes();records=[]
    result=dict(schema='YNX-PERF-SYNTHETIC-PAIR-RSS/v1',status='INCOMPLETE',runs=records,
        comparisonScope='same host, separate fresh Python processes; synthetic original producer only',
        originalArchiveSizeDistributionOnly=True,baselineFixtureOverheadIncluded=True,samplingMayMissTransientPeaks=True,
        onlineTPSQualified=False,actualWindowExecuted=False,runtimePermissionGranted=False)
    primary=None
    try:
        for label,commit in (('before',BEFORE),('after',AFTER)):
            # The preceding generated fixture is removed before the next run;
            # only this process-created synthetic temporary tree is affected.
            with tempfile.TemporaryDirectory(prefix='ynx-synthetic-rss-'+label+'-',dir=output.parent) as temp:
                directory=Path(temp).resolve();src=source(repo,directory,commit);work=directory/'work';work.mkdir()
                child=subprocess.run([sys.executable,'-I','-B',str(Path(__file__).resolve()),'--worker',str(src),str(work),str(HISTOGRAM)],
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=600,check=False)
                require(child.returncode==0,'synthetic '+label+' worker failed: '+child.stderr.decode(errors='replace')[-1000:])
                record=json.loads(child.stdout);record.update(label=label,controllerCommit=commit,
                    producerGitBlob=git(repo,'rev-parse',commit+':'+PREFIX+'pq-same-runner-pair-producer.py').decode().strip())
                records.append(record)
        result.update(status='OBSERVED_SYNTHETIC_ONLY',
            peakChangeBytes=records[1]['samplePeakRSSBytes']-records[0]['samplePeakRSSBytes'])
    except BaseException as error:
        primary=error
        result['firstCause']=dict(type=type(error).__name__,message=str(error))
        raise
    finally:
        try:
            with output.open('x') as target:
                json.dump(result,target,sort_keys=True,separators=(',',':'));target.write('\n');target.flush();os.fsync(target.fileno())
        except BaseException as error:
            if primary is None:raise
            if hasattr(primary,'add_note'):primary.add_note('secondary result retention failure: '+type(error).__name__)
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--run',action='store_true');parser.add_argument('--repo');parser.add_argument('--output')
    parser.add_argument('--worker',nargs=3,help=argparse.SUPPRESS)
    args=parser.parse_args(argv)
    if args.worker:
        require(not args.run and args.repo is None and args.output is None,'worker cannot activate another entry')
        print(json.dumps(worker(args.worker[0],args.worker[1],sizes(args.worker[2])),sort_keys=True,separators=(',',':')));return
    if not args.run:
        print(json.dumps(dict(executed=False,syntheticOnly=True,runtimePermissionGranted=False)));return
    require(args.repo is not None and args.output is not None,'explicit source repository and new output required')
    result=run(args.repo,args.output)
    print(json.dumps(dict(status='OBSERVED_SYNTHETIC_ONLY',sourceCommits=[x['controllerCommit'] for x in result['runs']],
                          peakChangeBytes=result['peakChangeBytes'],runtimePermissionGranted=False)))


if __name__=='__main__':main()
