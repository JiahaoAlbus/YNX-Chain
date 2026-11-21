"""Synthetic-only physical Commit clock reader; never source or finality authority.

The producer must bind a pidfd immediately after its original Popen, before
publishing it to any reaper, then probe that same handle while the node is live.
Old archives have neither that evidence nor a parent clock domain: they remain
NOT_SUPPLIED. No API here starts a node, retries work or grants runtime access.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import select
import stat
import time


SOURCE_BINDING = 'linker-declared-requires-original-manifest-build-binary-and-process-proof'
BOUNDARY = 'local-persistent-ABCI-Commit-return-upper-bound-before-mempool-update;not-consensus-vote-or-finality'


def require(ok, message):
    if not ok: raise ValueError(message)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value, size):
    return type(value) is str and re.fullmatch('[0-9a-f]{%d}' % size, value) is not None


def parent_domain():
    require(os.name == 'posix' and Path('/proc/thread-self/ns/time').exists(), 'Linux parent clock domain unavailable')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    ns = os.stat('/proc/thread-self/ns/time')
    start = time.monotonic_ns(); raw = time.clock_gettime_ns(time.CLOCK_MONOTONIC); end = time.monotonic_ns()
    require(start <= raw <= end, 'original parent monotonic clock differs')
    return dict(processID=os.getpid(),bootID=boot,timeNamespace='%d:%d' % (ns.st_dev,ns.st_ino),
                clock='CLOCK_MONOTONIC',observedStartNs=str(start),observedEndNs=str(end))


def _live(fd, pid):
    # pidfd is acquired before any other owner can reap/publish the Popen.
    fields = Path('/proc/self/fdinfo/%d' % fd).read_text().splitlines()
    values = [line.split(':',1)[1].strip() for line in fields if line.startswith('Pid:')]
    poll = select.poll(); poll.register(fd, select.POLLIN | select.POLLHUP | select.POLLERR)
    require(values == [str(pid)] and not poll.poll(0), 'original pidfd exited or refers to another process')


def bind_unpublished_process(proc):
    """Caller must own Popen exclusively and call before publishing to monitors."""
    require(proc.returncode is None and proc.poll() is None, 'original child already retired')
    fd = os.pidfd_open(proc.pid, 0)
    try: _live(fd, proc.pid)
    except BaseException:
        os.close(fd); raise
    return fd


def _digest_fd(fd):
    h=hashlib.sha256()
    while True:
        block=os.read(fd,1<<20)
        if not block: return h.hexdigest()
        h.update(block)


def _start_ticks(pid):
    data=Path('/proc/%d/stat' % pid).read_text()
    end=data.rfind(')'); require(end > 0, 'original process stat malformed')
    fields=data[end+2:].split(); require(len(fields)>19 and fields[19].isdigit(), 'original start time unavailable')
    return fields[19]


def capture_owned_executable(proc, pidfd, binary_path, binary_sha):
    """No numeric-PID fallback: hash the currently running original exe FD."""
    require(pin(binary_sha,64), 'exact original binary digest required')
    start=time.monotonic_ns(); pid=proc.pid; _live(pidfd,pid); before=_start_ticks(pid)
    expected=os.open(binary_path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        actual=os.open('/proc/%d/exe' % pid,os.O_RDONLY|os.O_CLOEXEC)
        try:
            e=os.fstat(expected); a=os.fstat(actual)
            require(stat.S_ISREG(e.st_mode) and stat.S_ISREG(a.st_mode)
                    and (e.st_dev,e.st_ino,e.st_size)==(a.st_dev,a.st_ino,a.st_size), 'original process executable differs')
            require(_digest_fd(actual)==binary_sha and _digest_fd(expected)==binary_sha, 'original executable digest differs')
            a2=os.fstat(actual); e2=os.fstat(expected)
            require((a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(a2.st_dev,a2.st_ino,a2.st_size,a2.st_mtime_ns,a2.st_ctime_ns)
                    and (e.st_dev,e.st_ino,e.st_size,e.st_mtime_ns,e.st_ctime_ns)==(e2.st_dev,e2.st_ino,e2.st_size,e2.st_mtime_ns,e2.st_ctime_ns), 'original executable changed while read')
            ns=os.stat('/proc/%d/ns/time' % pid); _live(pidfd,pid)
            require(_start_ticks(pid)==before, 'original process start identity changed')
            return dict(pid=pid,startTicks=before,binarySHA256=binary_sha,binaryPath=str(binary_path),device=a.st_dev,inode=a.st_ino,
                        observedStartNs=str(start),observedEndNs=str(time.monotonic_ns()),
                        timeNamespace='%d:%d' % (ns.st_dev,ns.st_ino),identity='original-unpublished-pidfd-and-live-proc-exe')
        finally: os.close(actual)
    finally: os.close(expected)


def _source_binding(receipt, source, selection_raw, dependencies_raw, build_identity_raw):
    require(pin(source,40) and receipt['source']['commit']==source, 'exact new Core source required')
    build=receipt['normalLiveBuildProvenance']['ynx-comet']; identity=receipt['source']
    binary=receipt['binaries']['ynx-comet']; require(pin(binary,64), 'original binary digest missing')
    require(build['binarySHA256']==binary and build['originalSource']==identity, 'original build source or binary differs')
    require(sha(selection_raw)==build['sourceSelectionSHA256'] and sha(dependencies_raw)==build['sourceDependenciesReceiptSHA256'], 'original source manifest digest differs')
    selection=json.loads(selection_raw); dependencies=json.loads(dependencies_raw)
    require(selection['originalSourceCommit']==source and selection['originalSourceTree']==identity['tree']
            and selection['originalProductionForkTree']==identity['forkTree']
            and selection['originalCheckoutWritten'] is False and selection['fakeVCSIdentity'] is False
            and selection['selectedOptionalForkTree']==build['selectedOptionalForkTree'],
            'original composed source manifest differs')
    require(dependencies==receipt['normalLiveSourceDependencies']['sourceDependencies'], 'original native dependency manifest differs')
    argv=build['buildArgv']; require(type(argv) is list and len(argv)==14, 'original synthetic build argv shape differs')
    binary_path=argv[-2]
    require(argv==['go','build','-mod=readonly','-p','1','-trimpath','-buildvcs=false','-ldflags',
                   '-X main.operatorCommitBuildSource='+source,'-tags','ynx_live_wire_observation','-o',binary_path,'./cmd/ynx-comet']
            and build['buildCwd']==selection['sourceDirectory'], 'original synthetic linker build argv differs')
    reference=receipt['commitClockBuildIdentity']
    require(len(build_identity_raw)==reference['bytes'] and sha(build_identity_raw)==reference['sha256'], 'original binary identity bytes differ')
    identity_processes=[p for p in receipt['processes'] if p['name']=='commit-clock-build-identity']
    require(len(identity_processes)==1 and identity_processes[0]['pid']==reference['pid']
            and identity_processes[0]['exitCode']==0
            and identity_processes[0]['command']==[binary_path,'synthetic-commit-clock-build-identity','--synthetic'],
            'original build identity command differs')
    declared=json.loads(build_identity_raw)
    require(declared['version']=='YNX-COMET-COMMIT-CLOCK-BUILD/v1' and declared['status']=='DECLARED'
            and declared['sourceRevision']==source and declared['sourceBinding']==SOURCE_BINDING
            and declared['syntheticOnly'] is True and declared['runtimeAuthorized'] is False and declared['nodeStarted'] is False,
            'actual original binary build declaration differs')
    return binary,binary_path


def reduce(receipt, *, expected_source, parent, node_evidence, inclusion, selection_raw, dependencies_raw, build_identity_raw):
    """Join original full-demand rows; missing/mismatched evidence stays censored.

    `node_evidence` contains four ordered original private snapshot bytes,
    their receipt-bound monotonic snapshot bytes and the original live pidfd
    executable probes. `inclusion` maps the original operation index to the
    existing four-node original RPC receipt bytes, pinned by the original receipt.
    The caller must retain those exact
    originals; this function cannot create them or upgrade their provenance.
    """
    rows=receipt.get('loadResult',{}).get('rows',[]); demand=receipt.get('configuredDemand')
    require(type(demand) is int and type(rows) is list and len(rows)==demand, 'original full demand required')
    result=dict(status='NOT_SUPPLIED',configuredDemand=demand,observed=0,censored=demand,rows=[],
                independentFinality=False,runtimeAuthorized=False,physicalCommitMeaning='per-node local persistent ABCI Commit return upper bounds; not consensus vote or finality')
    try:
        binary,binary_path=_source_binding(receipt,expected_source,selection_raw,dependencies_raw,build_identity_raw)
        require(parent['processID']==receipt['commitClockParent']['processID'] and parent==receipt['commitClockParent']
                and type(parent['processID']) is int and parent['processID']>0
                and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',parent['bootID'])
                and re.fullmatch(r'[0-9]+:[0-9]+',parent['timeNamespace'])
                and parent['clock']=='CLOCK_MONOTONIC', 'original physical parent clock identity differs')
        origin=int(receipt['loadResult']['originMonotonicNs'])
        require(int(parent['observedStartNs'])<=int(parent['observedEndNs'])<=origin, 'parent domain observation occurs after origin')
        require(type(node_evidence) is list and len(node_evidence)==4, 'four original node evidence slots required')
    except (KeyError,ValueError,TypeError,IndexError,OverflowError): return result
    descriptors=receipt.get('normalCommitObservation',{}).get('originalSnapshots',[])
    clock_descriptors=receipt.get('commitMonotonicObservation',{}).get('originalSnapshots',[])
    def one_node(i, height):
        try:
            e=node_evidence[i]; probe=e['processProbe']; raw=e['commitOriginal']; clock_raw=e['clockOriginal']
            olds=[x for x in descriptors if x['node']==i]; news=[x for x in clock_descriptors if x['node']==i]
            require(len(olds)==len(news)==1, 'duplicate or absent original snapshot binding')
            old,new=olds[0],news[0]
            require(sha(raw)==old['sha256'] and len(raw)==old['bytes'] and sha(clock_raw)==new['sha256'] and len(clock_raw)==new['bytes'], 'original snapshot bytes differ')
            commit=json.loads(raw); clock=json.loads(clock_raw)
            processes=[x for x in receipt['processes'] if x['name']=='pq-node-%d'%i]
            probes=[x for x in receipt['commitClockProcessProbes'] if x['node']==i]
            require(len(processes)==len(probes)==1 and probes[0]['probe']==probe, 'original node probe is not receipt-bound')
            process=processes[0]
            require(process['pid']==old['pid']==new['pid']==probe['pid']==commit['processID']==clock['processID']
                    and probe['identity']=='original-unpublished-pidfd-and-live-proc-exe' and probe['binarySHA256']==binary
                    and probe['binaryPath']==binary_path and process['command'].count(binary_path)==1
                    and str(process['startTicks'])==str(probe['startTicks']) and probe['timeNamespace']==parent['timeNamespace']
                    and int(probe['observedEndNs'])<=origin, 'original node process/executable differs')
            require(commit['version']=='YNX-COMET-COMMIT-OBSERVATION/v1' and commit['scope']=='synthetic-loopback-lab/v1'
                    and commit['coverage']['notificationCaptureComplete'] is True and commit['independentFinality'] is False,
                    'original node Commit coverage unavailable')
            require(clock['version']=='YNX-COMET-COMMIT-MONOTONIC/v1' and clock['status']=='OBSERVED'
                    and clock['scope']=='synthetic-loopback-lab/v1' and clock['sourceRevision']==expected_source
                    and clock['sourceBinding']==SOURCE_BINDING and clock['clock']=='CLOCK_MONOTONIC'
                    and clock['bootID']==parent['bootID'] and clock['timeNamespace']==parent['timeNamespace']
                    and clock['captureBoundary']==BOUNDARY and clock['independentFinality'] is False
                    and clock['chainID']==commit['chainID'] and clock['originalGenesisHash']==commit['originalGenesisHash'], 'original clock domain/source differs')
            samples=clock['samples']; old_samples=commit['samples']
            require(type(samples) is list and type(old_samples) is list and len(samples)==len(old_samples)
                    and all(type(s['height']) is int and type(s['monotonicNs']) is str and re.fullmatch(r'[0-9]+',s['monotonicNs']) for s in samples)
                    and all(a['height']==b['height'] and a['appHash']==b['appHash'] for a,b in zip(samples,old_samples)),
                    'original node sample sequence differs')
            heights=[s['height'] for s in samples]; times=[int(s['monotonicNs']) for s in samples]
            require(len(heights)==len(set(heights)) and all(a<b for a,b in zip(heights,heights[1:]))
                    and all(a<=b for a,b in zip(times,times[1:])), 'original node clock order or height differs')
            c=[x for x in commit['samples'] if x['height']==height]; t=[x for x in samples if x['height']==height]
            require(len(c)==len(t)==1 and c[0]['appHash']==t[0]['appHash'] and pin(t[0]['appHash'],64)
                    and c[0]['persistence']['height']==height and c[0]['persistence']['durable'] is True, 'original exact height and app hash unavailable')
            return int(t[0]['monotonicNs']),t[0]['appHash']
        except (KeyError,ValueError,TypeError,IndexError,StopIteration,OverflowError): return None
    for row in rows:
        entry=dict(index=row['index'],id=row['id'],nodesNs=[None]*4,fourNodeUpperBoundNs=None,status='CENSORED')
        try:
            inc_raw=inclusion[row['index']]; references=[x for x in receipt['commitClockInclusions'] if x['index']==row['index']]
            require(len(references)==1 and len(inc_raw)==references[0]['bytes'] and sha(inc_raw)==references[0]['sha256'], 'original inclusion bytes differ')
            inc=json.loads(inc_raw); rr=inc['rows']; tx=row['hash']; sent=row['submittedNs']
            require(pin(tx,64) and type(sent) is int and sent>=0 and type(rr) is list and len(rr)==4, 'original submitted operation unavailable')
            heights=[int(r['height']) for r in rr]
            require(heights[0]>0 and len(set(heights))==1 and all(r['hash'].lower()==tx and type(r['tx_result']['code']) is int and r['tx_result']['code']==0 for r in rr), 'original successful four-node inclusion differs')
            start=origin+sent
            hashes=[]
            for i in range(4):
                sample=one_node(i,heights[0])
                if sample is not None:
                    boundary,app_hash=sample
                    if start<=boundary<=inc['observedMonotonicNs']:
                        entry['nodesNs'][i]=boundary-start; hashes.append(app_hash)
            if len(hashes)==4 and len(set(hashes))!=1: entry['nodesNs']=[None]*4
            if all(value is not None for value in entry['nodesNs']):
                entry.update(status='OBSERVED',fourNodeUpperBoundNs=max(entry['nodesNs'])); result['observed']+=1
        except (KeyError,ValueError,TypeError,IndexError,OverflowError): pass
        result['rows'].append(entry)
    result.update(status='OBSERVED_OR_CENSORED',censored=demand-result['observed'])
    return result
