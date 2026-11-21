"""Original stopped normal-node Commit snapshots only; no finality or signer I/O."""
import hashlib
import json
import os
import re
from pathlib import Path
import stat

VERSION='YNX-COMET-COMMIT-OBSERVATION/v1'
SCOPE='synthetic-loopback-lab/v1'
MAX_SAMPLES=128
MAX_BYTES=512<<10 # Exact c06 producer output ceiling; not the generic log cap.

def require(ok,message):
    if not ok:raise RuntimeError(message)
def integer(value):return type(value) is int and 0<=value<1<<63
def strict(raw):
    def pairs(items):
        value={}
        for key,item in items:
            require(key not in value,'duplicate original Commit observation field');value[key]=item
        return value
    return json.loads(raw,object_pairs_hook=pairs)
def arguments(output,private_root):
    output,private_root=Path(output),Path(private_root)
    require(private_root.resolve(strict=True)==private_root and output.is_absolute() and output.parent==private_root and not output.exists() and not output.is_symlink(),'fresh canonical private Commit observation path required')
    return ['--commit-observation-output',str(output),'--commit-observation-scope',SCOPE]

CAPTURE_BOUNDARY='synchronous-original-block-executor-Commit-return;normal-stop-output;replay-and-early-failures-not-covered'

def validate_declared_contract(snapshot,pid,chain_id,genesis_hash,require_runtime_boundary=True):
    # Fields checked against CORE actual Go-marshaled PUBLIC fixture/type source;
    # the fixture is schema evidence ONLY and cannot pass runtime-boundary checks.
    require(type(snapshot) is dict and snapshot.get('version')==VERSION and snapshot.get('scope')==SCOPE,'original Commit observation version/scope differs')
    require(type(snapshot.get('processID')) is int and snapshot['processID']==pid and snapshot.get('chainID')==chain_id and snapshot.get('originalGenesisHash')==genesis_hash,'original Commit process/chain/genesis identity differs')
    require(type(snapshot.get('captureBoundary')) is str,'original capture boundary required')
    if require_runtime_boundary:require(snapshot['captureBoundary']==CAPTURE_BOUNDARY,'PUBLIC schema fixture is not normal runtime evidence')
    for key in ('independentFinality','signerFsyncMeasured'):require(snapshot.get(key) is False,'original Commit meaning differs: '+key)
    require(type(snapshot.get('maxSamples')) is int and snapshot['maxSamples']==MAX_SAMPLES,'original fixed128 bound differs')
    coverage=snapshot.get('coverage');require(type(coverage) is dict,'original nested Commit coverage missing')
    for key,value in [('allCommitAttemptsCovered',False),('replayCoverageComplete',False),('unreportedStagesAreUnknown',True),('prePersistenceFailuresHaveNoTiming',True)]:require(coverage.get(key) is value,'original nested Commit coverage differs: '+key)
    require(type(coverage.get('notificationCaptureComplete')) is bool,'original notification coverage marker missing')
    gaps=coverage.get('observedHeightGaps');require(type(gaps) is list and len(gaps)<=MAX_SAMPLES,'original bounded height gaps missing')
    for gap in gaps:require(type(gap) is dict and integer(gap.get('afterHeight')) and integer(gap.get('beforeHeight')) and gap['beforeHeight']>gap['afterHeight']+1,'original Commit height gap invalid')
    uint=lambda value:type(value) is int and 0<=value<1<<64
    for key in ('successNotifications','errorNotifications','droppedSuccessSamples'):require(uint(snapshot.get(key)),'original Commit counter missing/invalid: '+key)
    rejected=snapshot.get('rejectedNotifications');require(type(rejected) is dict and len(rejected)<=64,'original rejectedNotifications map required')
    for key,value in rejected.items():require(type(key) is str and 0<len(key)<=128 and uint(value),'original rejection counter invalid')
    require(type(snapshot.get('sampleOverflow')) is bool and (snapshot['droppedSuccessSamples']==0 or snapshot['sampleOverflow'] is True),'original Commit overflow marker differs')
    require(type(snapshot.get('latestTimingAvailable')) is bool,'original latest timing marker missing')
    def point(value):require(type(value) is dict and integer(value.get('height')) and value['height']>0 and type(value.get('appHash')) is str and re.fullmatch('[0-9a-f]{64}',value['appHash']) is not None and value['appHash']!='0'*64,'original Commit checkpoint invalid')
    def timing(value,height=None):
        require(type(value) is dict and integer(value.get('height')) and value['height']>0 and (height is None or value['height']==height) and value.get('storage') in ('atomic-json','snapshot-journal-v1','block-journal-v2') and type(value.get('durable')) is bool and integer(value.get('elapsedNs')) and integer(value.get('payloadBytes')),'original CommitTimingSample differs')
        stages=value.get('stagesNs');require(type(stages) is dict and len(stages)<=32,'original bounded Commit stages required')
        for stage,ns in stages.items():require(type(stage) is str and re.fullmatch('[a-z0-9_]{1,64}',stage) is not None and integer(ns) and ns<=value['elapsedNs'],'original Commit stage value missing/invalid')
        require(not value['durable'] or (value['elapsedNs']>0 and value['payloadBytes']>0 and bool(stages)),'durable original Commit timing cannot be empty')
    def sample(value):point(value);timing(value.get('persistence'),value['height']);require(value['persistence']['durable'] is True,'successful original sample must be durable')
    for key in ('lastFailure','unobservedLatest','finalCheckpoint'):require(key in snapshot,'original nullable failure/missing markers required')
    if snapshot['lastFailure'] is not None:
        failed=snapshot['lastFailure'];require(type(failed) is dict and failed.get('notificationObserved') is True and 'timing' in failed and 'committedCheckpoint' in failed and 'attemptAppHash' in failed,'original failure markers differ')
        if failed['timing'] is not None:timing(failed['timing']);require(failed['timing']['durable'] is False,'failed attempt cannot inherit successful timing')
        if failed['committedCheckpoint'] is not None:point(failed['committedCheckpoint'])
        require(failed['attemptAppHash'] is None,'failed attempt AppHash is unavailable, not prior committed hash')
    if snapshot['unobservedLatest'] is not None:sample(snapshot['unobservedLatest'])
    if snapshot['finalCheckpoint'] is not None:point(snapshot['finalCheckpoint'])
    samples=snapshot.get('samples');require(type(samples) is list and len(samples)<=MAX_SAMPLES and len(samples)<=snapshot['successNotifications'],'original fixed128 Commit samples differ')
    previous=0
    for value in samples:sample(value);require(value['height']>previous,'original Commit samples duplicate/regressed');previous=value['height']
    return snapshot

def persistence_stage_summary(snapshot):
    """Reduce validated retained successes only; keep each node/storage separate.

    Neither failure timings nor unobservedLatest are successful sample members.
    Missing stages stay missing; stage spans are never summed into a fake total.
    """
    def distribution(values):
        ordered=sorted(values);n=len(ordered)
        return dict(count=n,minNs=ordered[0] if n else None,
                    medianNs=(ordered[(n-1)//2]+ordered[n//2])/2 if n else None,
                    maxNs=ordered[-1] if n else None,
                    retainedSampleP95Ns=ordered[(95*n+99)//100-1] if n>=20 else None)
    groups={}
    for sample in snapshot['samples']:
        value=sample['persistence'];groups.setdefault(value['storage'],[]).append(value)
    reduced={}
    for storage,values in sorted(groups.items()):
        names=sorted({name for value in values for name in value['stagesNs']})
        reduced[storage]=dict(retainedSuccessCount=len(values),
            heightRange=[values[0]['height'],values[-1]['height']],
            persistenceElapsed=distribution([v['elapsedNs'] for v in values]),
            stages={name:dict(distribution([v['stagesNs'][name] for v in values if name in v['stagesNs']]),
                              missingRetainedSamples=sum(name not in v['stagesNs'] for v in values)) for name in names})
    return dict(schema='YNX-PERF-RETAINED-COMMIT-STAGES/v1',byStorage= reduced,
        retainedSuccessCount=len(snapshot['samples']),successNotifications=snapshot['successNotifications'],
        errorNotifications=snapshot['errorNotifications'],droppedSuccessSamples=snapshot['droppedSuccessSamples'],
        sampleOverflow=snapshot['sampleOverflow'],notificationCaptureComplete=snapshot['coverage']['notificationCaptureComplete'],
        observedHeightGaps=[dict(v) for v in snapshot['coverage']['observedHeightGaps']],
        rejectedNotifications=dict(snapshot['rejectedNotifications']),
        lastFailureTimingAvailable=snapshot['lastFailure'] is not None and snapshot['lastFailure']['timing'] is not None,
        unobservedLatestExcluded=snapshot['unobservedLatest'] is not None,
        allCommitAttemptsCovered=False,unreportedStagesAreUnknown=True,stagesAdded=False,
        businessTPS=None,inclusionLatency=None,finalConfirmationLatency=None,
        meaning='Per original node and storage, retained successful persistence spans only. P95 is nearest rank for at least20 retained samples, never a sustained/business latency. No node pooling, failure/overflow zero fill, stage addition or chain bottleneck inference.')

def retain_after_stop(window,descriptors,chain_id,genesis_hash):
    result=dict(schema='YNX-PERF-ORIGINAL-COMMIT-READBACK/v1',expectedNodes=4,originalSnapshots=[],errors=[],allCommitAttemptsCovered=False,replayCoverageComplete=False,unreportedStagesAreUnknown=True,independentFinality=False,signerFsyncMeasured=False,meaning='Only original stopped normal-node snapshots. Persistence spans are not signer fsync, inclusion, finality or complete replay/commit coverage; absent stages are UNKNOWN.')
    require(len(descriptors)==4,'four original normal-node Commit descriptors required')
    for descriptor in descriptors:
        path=Path(descriptor['path']);name=descriptor['processName'];node=descriptor['node']
        try:
            child=next((c for c in window.children if c['name']==name),None)
            require(child is not None and child['process'].poll() is not None,'original Commit producer must be stopped before readback')
            require(path.resolve(strict=True)==path,'original Commit observation path may not be redirected')
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
            try:
                before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode)==0o600 and before.st_nlink==1 and 0<before.st_size<=MAX_BYTES,'original Commit output must be exclusive0600 regular bounded JSON')
                with os.fdopen(fd,'rb',closefd=False) as stream:raw=stream.read(MAX_BYTES+1)
                after=os.fstat(fd);require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) and len(raw)==before.st_size,'original Commit output changed during stopped readback')
            finally:os.close(fd)
            public=window.work/'public'/('commit-observation-node-%d-original.json'%node)
            with open(public,'xb') as out:os.chmod(public,0o600);out.write(raw);out.flush();os.fsync(out.fileno())
            folder=os.open(public.parent,os.O_RDONLY)
            try:os.fsync(folder)
            finally:os.close(folder)
            record=dict(node=node,processName=name,pid=child['process'].pid,path=str(public.relative_to(window.work/'public')),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),sourceStopped=True,usable=False)
            result['originalSnapshots'].append(record)
            snapshot=validate_declared_contract(strict(raw),child['process'].pid,chain_id,genesis_hash)
            record.update(usable=True,sampleCount=len(snapshot['samples']),droppedSuccessSamples=snapshot['droppedSuccessSamples'],overflow=snapshot['sampleOverflow'],rawOriginalObservation=snapshot,retainedPersistenceStages=persistence_stage_summary(snapshot))
        except (OSError,ValueError,RuntimeError,KeyError) as error:result['errors'].append(dict(node=node,errorType=type(error).__name__,reason=str(error),missingStagesAreUnknown=True))
    result['validOriginalNodes']=sum(x['usable'] for x in result['originalSnapshots']);result['fourOriginalSnapshotsValid']=result['validOriginalNodes']==4 and not result['errors']
    return result
