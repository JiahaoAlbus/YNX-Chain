"""Synthetic-only physical Commit clock reader; never source or finality authority.

The producer must bind a pidfd immediately after its original Popen, before
publishing it to any reaper, then probe that same handle while the node is live.
Old archives have neither that evidence nor a parent clock domain: they remain
NOT_SUPPLIED. No API here starts a node, retries work or grants runtime access.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import stat
import time


SOURCE_BINDING = 'linker-declared-requires-original-manifest-build-binary-and-process-proof'
BOUNDARY = 'local-persistent-ABCI-Commit-return-upper-bound-before-mempool-update;not-consensus-vote-or-finality'
# The owning source/CI controller must bind one exact reviewed Core successor.
# No caller, environment variable or historical receipt can fill this gate.
COMMIT_CLOCK_SOURCE = None
_commit_spec=importlib.util.spec_from_file_location('original_commit_clock_snapshot',Path(__file__).with_name('pq-commit-observation.py'))
_commit=importlib.util.module_from_spec(_commit_spec);_commit_spec.loader.exec_module(_commit)


def require(ok, message):
    if not ok: raise ValueError(message)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value, size):
    return type(value) is str and re.fullmatch('[0-9a-f]{%d}' % size, value) is not None


def decimal(value, *, positive=False):
    require(type(value) is str and re.fullmatch(r'0|[1-9][0-9]*',value) is not None, 'canonical original decimal required')
    number=int(value)
    require(number < 1<<63 and (number>0 or not positive), 'bounded original decimal required')
    return number


def strict(raw, limit):
    require(type(raw) is bytes and 0<len(raw)<=limit, 'bounded original JSON bytes required')
    def pairs(items):
        result={}
        for key,value in items:
            require(key not in result, 'duplicate original JSON field')
            result[key]=value
        return result
    def invalid(value):raise ValueError('nonfinite original JSON')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=invalid)


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
    spec=importlib.util.spec_from_file_location('clock_original_owner_pidfd',Path(__file__).with_name('pq-experimental-owner-pidfd.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    anchor=module.OriginalOwnerPidfd(proc)
    try:
        with anchor.lock: _live(anchor.fd, proc.pid)
    except BaseException:
        anchor.close(); raise
    return anchor


def _digest_fd(fd):
    h=hashlib.sha256()
    while True:
        block=os.read(fd,1<<20)
        if not block: return h.hexdigest()
        h.update(block)


def capture_built_binary(binary_path):
    """Pin the actual completed original build file, never a CLI assertion."""
    path=Path(binary_path)
    require(path.is_absolute() and path.resolve(strict=True)==path, 'canonical built binary required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_size>0, 'original built binary is not regular')
        digest=_digest_fd(fd);after=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        fields=lambda item:(item.st_dev,item.st_ino,item.st_size,item.st_mtime_ns,item.st_ctime_ns)
        require(fields(before)==fields(after)==fields(named), 'original built binary changed during pin')
        return dict(path=str(path),sha256=digest,device=before.st_dev,inode=before.st_ino,size=before.st_size)
    finally:os.close(fd)


def _start_ticks(pid):
    data=Path('/proc/%d/stat' % pid).read_text()
    end=data.rfind(')'); require(end > 0, 'original process stat malformed')
    fields=data[end+2:].split(); require(len(fields)>19 and fields[19].isdigit(), 'original start time unavailable')
    return fields[19]


def capture_owned_executable(proc, anchor, binary_path, binary_sha):
    """No numeric-PID fallback: hash the currently running original exe FD."""
    require(anchor.pid==proc.pid, 'original process pidfd differs')
    with anchor.lock:
        require(anchor.fd is not None, 'original process pidfd already retired')
        return _capture_owned_executable(proc,anchor.fd,binary_path,binary_sha)


def _capture_owned_executable(proc, pidfd, binary_path, binary_sha):
    require(pin(binary_sha,64), 'exact original binary digest required')
    path=Path(binary_path)
    require(path.is_absolute() and path.resolve(strict=True)==path, 'canonical original executable path required')
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
            current=os.stat(binary_path,follow_symlinks=False)
            require((a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(a2.st_dev,a2.st_ino,a2.st_size,a2.st_mtime_ns,a2.st_ctime_ns)
                    and (e.st_dev,e.st_ino,e.st_size,e.st_mtime_ns,e.st_ctime_ns)==(e2.st_dev,e2.st_ino,e2.st_size,e2.st_mtime_ns,e2.st_ctime_ns)
                    and (e.st_dev,e.st_ino,e.st_size,e.st_mtime_ns,e.st_ctime_ns)==(current.st_dev,current.st_ino,current.st_size,current.st_mtime_ns,current.st_ctime_ns), 'original executable changed while read')
            ns=os.stat('/proc/%d/ns/time' % pid); _live(pidfd,pid)
            require(_start_ticks(pid)==before, 'original process start identity changed')
            return dict(pid=pid,startTicks=before,binarySHA256=binary_sha,binaryPath=str(binary_path),device=a.st_dev,inode=a.st_ino,size=a.st_size,
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
    selection=strict(selection_raw,64<<10); dependencies=strict(dependencies_raw,64<<10)
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
    physical=receipt['commitClockBuiltBinary']
    require(physical['path']==binary_path and physical['sha256']==binary
            and all(type(physical.get(key)) is int and physical[key]>0 for key in ('device','inode','size')),
            'original physical built binary identity differs')
    reference=receipt['commitClockBuildIdentity']
    require(len(build_identity_raw)==reference['bytes'] and sha(build_identity_raw)==reference['sha256'], 'original binary identity bytes differ')
    identity_processes=[p for p in receipt['processes'] if p['name']=='commit-clock-build-identity']
    require(len(identity_processes)==1 and type(identity_processes[0]['pid']) is int and identity_processes[0]['pid']==reference['pid']
            and type(identity_processes[0]['exitCode']) is int and identity_processes[0]['exitCode']==0
            and identity_processes[0]['command']==[binary_path,'synthetic-commit-clock-build-identity','--synthetic'],
            'original build identity command differs')
    declared=strict(build_identity_raw,16<<10)
    require(declared['version']=='YNX-COMET-COMMIT-CLOCK-BUILD/v1' and declared['status']=='DECLARED'
            and declared['sourceRevision']==source and declared['sourceBinding']==SOURCE_BINDING
            and declared['syntheticOnly'] is True and declared['runtimeAuthorized'] is False and declared['nodeStarted'] is False,
            'actual original binary build declaration differs')
    return binary,binary_path,physical


def reduce(receipt, *, expected_source, parent, node_evidence, inclusion, selection_raw, dependencies_raw, build_identity_raw, network_plan_raw):
    """Join original full-demand rows; missing/mismatched evidence stays censored.

    `node_evidence` contains four ordered original private snapshot bytes,
    their receipt-bound monotonic snapshot bytes and the original live pidfd
    executable probes. `inclusion` maps the original operation index to the
    existing four-node original RPC receipt bytes, pinned by the original receipt.
    The caller must retain those exact
    originals; this function cannot create them or upgrade their provenance.
    """
    rows=receipt.get('loadResult',{}).get('rows',[]); demand=receipt.get('configuredDemand')
    require(type(demand) is int and 0<demand<=10000 and type(rows) is list and len(rows)==demand
            and all(type(row) is dict and type(row.get('index')) is int and pin(row.get('id'),64) for row in rows)
            and sorted(row['index'] for row in rows)==list(range(demand))
            and len({row['id'] for row in rows})==demand, 'original unique full demand required')
    hashes=[row.get('hash') for row in rows if row.get('hash') is not None]
    require(all(pin(value,64) for value in hashes) and len(hashes)==len(set(hashes)), 'original transaction hashes cannot be reused')
    result=dict(status='NOT_SUPPLIED',configuredDemand=demand,observed=0,censored=demand,rows=[],
                independentFinality=False,runtimeAuthorized=False,physicalCommitMeaning='per-node local persistent ABCI Commit return upper bounds; not consensus vote or finality')
    try:
        require(COMMIT_CLOCK_SOURCE is not None and expected_source==COMMIT_CLOCK_SOURCE,
                'exact reviewed original Commit clock source/CI NOT_SUPPLIED')
        binary,binary_path,physical=_source_binding(receipt,expected_source,selection_raw,dependencies_raw,build_identity_raw)
        require(sha(network_plan_raw)==receipt['activation']['networkPlanSHA256'], 'original network plan bytes differ')
        network=strict(network_plan_raw,1<<20)
        require(network['chainId']=='ynx_642399-1' and pin(network['originalGenesisHash'],64), 'original synthetic network identity differs')
        require(parent['processID']==receipt['commitClockParent']['processID'] and parent==receipt['commitClockParent']
                and type(parent['processID']) is int and parent['processID']>0
                and receipt['loadResult']['originProcessID']==parent['processID']
                and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',parent['bootID'])
                and re.fullmatch(r'[0-9]+:[0-9]+',parent['timeNamespace'])
                and parent['clock']=='CLOCK_MONOTONIC', 'original physical parent clock identity differs')
        origin=decimal(receipt['loadResult']['originMonotonicNs'])
        require(decimal(parent['observedStartNs'])<=decimal(parent['observedEndNs'])<=origin, 'parent domain observation occurs after origin')
        require(type(node_evidence) is list and len(node_evidence)==4, 'four original node evidence slots required')
        original_nodes=[]
        for i in range(4):
            matches=[process for process in receipt['processes'] if process['name']=='pq-node-%d'%i]
            require(len(matches)==1 and type(matches[0]['pid']) is int and matches[0]['pid']>0
                    and type(matches[0]['startTicks']) is int and matches[0]['startTicks']>0,
                    'one original live identity per node required')
            original_nodes.append(matches[0])
        require(len({process['pid'] for process in original_nodes})==4
                and all(process['pid']!=parent['processID'] for process in original_nodes), 'original node process identities reused')
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
            commit=strict(raw,512<<10); clock=strict(clock_raw,512<<10)
            probes=[x for x in receipt['commitClockProcessProbes'] if x['node']==i]
            require(len(probes)==1 and probes[0]['probe']==probe, 'original node probe is not receipt-bound')
            process=original_nodes[i]
            require(all(type(value) is int for value in (old['pid'],new['pid'],probe['pid'],commit['processID'],clock['processID']))
                    and process['pid']==old['pid']==new['pid']==probe['pid']==commit['processID']==clock['processID']
                    and probe['identity']=='original-unpublished-pidfd-and-live-proc-exe' and probe['binarySHA256']==binary
                    and probe['binaryPath']==binary_path and process['command'].count(binary_path)==1
                    and all(type(probe.get(key)) is int and probe[key]==physical[key] for key in ('device','inode','size'))
                    and process['startTicks']==decimal(probe['startTicks'],positive=True) and probe['timeNamespace']==parent['timeNamespace']
                    and decimal(probe['observedStartNs'])<=decimal(probe['observedEndNs'])<=origin, 'original node process/executable differs')
            require(commit['version']=='YNX-COMET-COMMIT-OBSERVATION/v1' and commit['scope']=='synthetic-loopback-lab/v1'
                    and commit['coverage']['notificationCaptureComplete'] is True and commit['independentFinality'] is False,
                    'original node Commit coverage unavailable')
            _commit.validate_declared_contract(commit,process['pid'],network['chainId'],network['originalGenesisHash'])
            require(clock['version']=='YNX-COMET-COMMIT-MONOTONIC/v1' and clock['status']=='OBSERVED'
                    and clock['scope']=='synthetic-loopback-lab/v1' and clock['sourceRevision']==expected_source
                    and clock['sourceBinding']==SOURCE_BINDING and clock['clock']=='CLOCK_MONOTONIC'
                    and clock['bootID']==parent['bootID'] and clock['timeNamespace']==parent['timeNamespace']
                    and clock['captureBoundary']==BOUNDARY and clock['independentFinality'] is False
                    and clock['chainID']==commit['chainID']==network['chainId']
                    and clock['originalGenesisHash']==commit['originalGenesisHash']==network['originalGenesisHash'], 'original clock domain/source differs')
            samples=clock['samples']; old_samples=commit['samples']
            require(type(samples) is list and type(old_samples) is list and len(samples)==len(old_samples)
                    and all(type(s['height']) is int and s['height']>0 and type(s['monotonicNs']) is str and re.fullmatch(r'0|[1-9][0-9]*',s['monotonicNs']) for s in samples)
                    and all(a['height']==b['height'] and a['appHash']==b['appHash'] for a,b in zip(samples,old_samples)),
                    'original node sample sequence differs')
            heights=[s['height'] for s in samples]; times=[decimal(s['monotonicNs']) for s in samples]
            require(len(heights)==len(set(heights)) and all(a<b for a,b in zip(heights,heights[1:]))
                    and all(a<=b for a,b in zip(times,times[1:])), 'original node clock order or height differs')
            c=[x for x in commit['samples'] if x['height']==height]; t=[x for x in samples if x['height']==height]
            require(len(c)==len(t)==1 and c[0]['appHash']==t[0]['appHash'] and pin(t[0]['appHash'],64)
                    and c[0]['persistence']['height']==height and c[0]['persistence']['durable'] is True, 'original exact height and app hash unavailable')
            return decimal(t[0]['monotonicNs']),t[0]['appHash']
        except (KeyError,ValueError,RuntimeError,TypeError,AttributeError,IndexError,StopIteration,OverflowError): return None
    for row in rows:
        entry=dict(index=row['index'],id=row['id'],nodesNs=[None]*4,fourNodeUpperBoundNs=None,status='CENSORED')
        try:
            inc_raw=inclusion[row['index']]; references=[x for x in receipt['commitClockInclusions'] if x['index']==row['index']]
            require(len(references)==1 and len(inc_raw)==references[0]['bytes'] and sha(inc_raw)==references[0]['sha256'], 'original inclusion bytes differ')
            inc=strict(inc_raw,4<<20); rr=inc['rows']; tx=row['hash']; sent=row['submittedNs']
            require(pin(tx,64) and type(sent) is int and sent>=0 and type(rr) is list and len(rr)==4, 'original submitted operation unavailable')
            heights=[decimal(r['height'],positive=True) for r in rr]
            require(heights[0]>0 and len(set(heights))==1 and all(r['hash'].lower()==tx and type(r['tx_result']['code']) is int and r['tx_result']['code']==0 for r in rr), 'original successful four-node inclusion differs')
            require(type(inc['observedMonotonicNs']) is int and 0<=inc['observedMonotonicNs']<1<<63, 'original inclusion observation clock differs')
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
        except (KeyError,ValueError,TypeError,AttributeError,IndexError,OverflowError): pass
        result['rows'].append(entry)
    result.update(status='OBSERVED_OR_CENSORED',censored=demand-result['observed'])
    return result
